import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SanitizedBugReport } from '../types.js';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

function makeReport(overrides: Partial<SanitizedBugReport> = {}): SanitizedBugReport {
  return {
    source: overrides.source ?? 'backend-runtime',
    title: 'Test Error',
    errorMessage: overrides.errorMessage ?? 'Something broke',
    errorClass: overrides.errorClass,
    stackTrace: overrides.stackTrace,
    metadata: {},
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    environment: 'production',
    _sanitized: true,
  };
}

describe('BugTriager', () => {
  let bugTriager: typeof import('../triage.js')['bugTriager'];

  beforeEach(async () => {
    vi.resetModules();
    mockCreate.mockReset();
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['BUG_TRIAGE_MODEL'] = 'claude-haiku-4-5-20251001';

    const mod = await import('../triage.js');
    bugTriager = mod.bugTriager;
  });

  afterEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['BUG_TRIAGE_MODEL'];
  });

  describe('AI triage', () => {
    it('returns parsed severity and rootCause from Claude response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ severity: 'high', rootCause: 'Database connection pool exhausted' }) }],
      });

      const result = await bugTriager.triage(makeReport());
      expect(result).toEqual({ severity: 'high', rootCause: 'Database connection pool exhausted' });
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('falls back to rule-based when API call throws', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API rate limit'));

      const result = await bugTriager.triage(makeReport({ source: 'security' }));
      // Should fall back to rule-based: security → high
      expect(result).toEqual({ severity: 'high', rootCause: 'Security scan finding — review required' });
    });

    it('falls back when response is not valid JSON', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Sorry, I cannot parse this error.' }],
      });

      const result = await bugTriager.triage(makeReport());
      // Falls back to rule-based: unknown source → low
      expect(result).toEqual({ severity: 'low', rootCause: 'Auto-triaged — review needed' });
    });

    it('falls back when BUG_TRIAGE_MODEL is empty string', async () => {
      delete process.env['BUG_TRIAGE_MODEL'];
      process.env['BUG_TRIAGE_MODEL'] = '';
      vi.resetModules();

      const mod = await import('../triage.js');
      const result = await mod.bugTriager.triage(makeReport({ source: 'ci-failure' }));

      // Should skip AI entirely and use rule-based
      expect(mockCreate).not.toHaveBeenCalled();
      expect(result).toEqual({ severity: 'medium', rootCause: 'CI pipeline failure — check build logs' });
    });
  });

  describe('rule-based fallback', () => {
    it('security source → high', async () => {
      mockCreate.mockRejectedValueOnce(new Error('force fallback'));
      const result = await bugTriager.triage(makeReport({ source: 'security' }));
      expect(result.severity).toBe('high');
      expect(result.rootCause).toContain('Security');
    });

    it('Prisma error class → high', async () => {
      mockCreate.mockRejectedValueOnce(new Error('force fallback'));
      const result = await bugTriager.triage(makeReport({ errorClass: 'PrismaClientKnownRequestError' }));
      expect(result.severity).toBe('high');
      expect(result.rootCause).toContain('Database');
    });

    it('ci-failure source → medium', async () => {
      mockCreate.mockRejectedValueOnce(new Error('force fallback'));
      const result = await bugTriager.triage(makeReport({ source: 'ci-failure' }));
      expect(result.severity).toBe('medium');
      expect(result.rootCause).toContain('CI');
    });

    it('frontend-crash source → medium', async () => {
      mockCreate.mockRejectedValueOnce(new Error('force fallback'));
      const result = await bugTriager.triage(makeReport({ source: 'frontend-crash' }));
      expect(result.severity).toBe('medium');
      expect(result.rootCause).toContain('Frontend');
    });

    it('unknown source → low', async () => {
      mockCreate.mockRejectedValueOnce(new Error('force fallback'));
      const result = await bugTriager.triage(makeReport({ source: 'backend-runtime' }));
      expect(result.severity).toBe('low');
      expect(result.rootCause).toContain('Auto-triaged');
    });
  });
});
