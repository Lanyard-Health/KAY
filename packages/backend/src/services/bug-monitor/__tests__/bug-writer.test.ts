import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SanitizedBugReport } from '../types.js';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

function makeReport(overrides: { errorMessage?: string; metadata?: Record<string, string> } = {}): SanitizedBugReport {
  return {
    source: 'user-report',
    title: 'placeholder',
    errorMessage: overrides.errorMessage ?? 'the save button did nothing',
    metadata: overrides.metadata ?? { route: '/providers/123', userSeverity: 'blocked', userAgent: 'Chrome' },
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    environment: 'development',
    _sanitized: true,
  };
}

describe('BugWriter', () => {
  let bugWriter: typeof import('../bug-writer.js')['bugWriter'];

  beforeEach(async () => {
    vi.resetModules();
    mockCreate.mockReset();
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    bugWriter = (await import('../bug-writer.js')).bugWriter;
  });

  afterEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('structures a valid LLM JSON response into a writeup', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        title: 'Save button does nothing on provider page',
        stepsToReproduce: ['Open a provider', 'Click Save'],
        expected: 'The record saves',
        actual: 'Nothing happens',
        area: 'Provider detail',
        severity: 'high',
      }) }],
    });

    const r = await bugWriter.write(makeReport());
    expect(r.title).toContain('Save button');
    expect(r.stepsToReproduce).toHaveLength(2);
    expect(r.expected).toBe('The record saves');
    expect(r.area).toBe('Provider detail');
    expect(r.severity).toBe('high');
  });

  it('falls back to a ticket built from the raw input when the LLM throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('model unavailable'));
    const r = await bugWriter.write(makeReport({ errorMessage: 'thing broke', metadata: { userSeverity: 'blocked', route: '/x' } }));
    // Never lose the report: raw words preserved, severity from the hint, area from route.
    expect(r.actual).toBe('thing broke');
    expect(r.severity).toBe('high'); // "blocked" -> high
    expect(r.area).toBe('/x');
    expect(r.stepsToReproduce).toEqual(['Not specified by reporter']);
  });

  it('maps the "fyi" severity hint to low when the LLM output is unparseable', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json at all' }] });
    const r = await bugWriter.write(makeReport({ metadata: { userSeverity: 'fyi' } }));
    expect(r.severity).toBe('low');
  });
});
