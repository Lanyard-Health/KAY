import { describe, it, expect } from 'vitest';
import { noiseFilter } from '../noise-filter.js';
import type { BugReport, SanitizedBugReport } from '../types.js';

const dummyReport: SanitizedBugReport = {
  source: 'backend-runtime',
  title: 'Test',
  errorMessage: 'test error',
  metadata: {},
  occurredAt: new Date(),
  environment: 'development',
  _sanitized: true,
};

function makeFrontendBug(overrides: Partial<BugReport> = {}): BugReport {
  return {
    source: 'frontend-crash',
    title: 'Test crash',
    errorMessage: 'Some error',
    metadata: {},
    occurredAt: new Date(),
    environment: 'development',
    ...overrides,
  };
}

describe('NoiseFilter', () => {
  describe('shouldSuppress', () => {
    it('suppresses dev frontend crashes whose filename points at a Vite chunk', () => {
      const bug = makeFrontendBug({
        metadata: {
          filename: 'http://localhost:5190/node_modules/.vite/deps/chunk-QFMFQ3UP.js?v=405800e1',
        },
      });
      expect(noiseFilter.shouldSuppress(bug)).toEqual({
        suppress: true,
        reason: 'dev-vite-chunk-crash',
      });
    });

    it('suppresses dev frontend crashes whose message is the dynamic-import failure', () => {
      const bug = makeFrontendBug({
        errorMessage: 'Failed to fetch dynamically imported module: http://localhost:5190/src/foo.tsx',
      });
      expect(noiseFilter.shouldSuppress(bug)).toEqual({
        suppress: true,
        reason: 'dev-dynamic-import-failure',
      });
    });

    it('does NOT suppress production reports with the same Vite-chunk shape (real CDN issue)', () => {
      const bug = makeFrontendBug({
        environment: 'production',
        metadata: { filename: 'https://app.example/node_modules/.vite/deps/chunk-X.js' },
      });
      expect(noiseFilter.shouldSuppress(bug)).toEqual({ suppress: false });
    });

    it('does NOT suppress dev backend-runtime errors', () => {
      const bug: BugReport = {
        source: 'backend-runtime',
        title: 'Backend crash',
        errorMessage: 'Failed to fetch dynamically imported module',
        metadata: {},
        occurredAt: new Date(),
        environment: 'development',
      };
      expect(noiseFilter.shouldSuppress(bug)).toEqual({ suppress: false });
    });

    it('does NOT suppress dev frontend crashes in user code (not a Vite chunk)', () => {
      const bug = makeFrontendBug({
        errorMessage: 'Cannot read properties of null (reading "goal")',
        metadata: { filename: 'http://localhost:5190/src/features/admin/WorkflowDetail.tsx' },
      });
      expect(noiseFilter.shouldSuppress(bug)).toEqual({ suppress: false });
    });

    it('treats missing metadata.filename as no match (not a crash)', () => {
      const bug = makeFrontendBug({ metadata: {} });
      expect(noiseFilter.shouldSuppress(bug)).toEqual({ suppress: false });
    });
  });

  describe('check', () => {
    it('returns create for first occurrence (count=0)', () => {
      expect(noiseFilter.check(dummyReport, 0)).toEqual({ action: 'create' });
    });

    it('returns digest when below threshold', () => {
      expect(noiseFilter.check(dummyReport, 5)).toEqual({ action: 'digest' });
    });

    it('returns create when at threshold', () => {
      // Default threshold is 10
      expect(noiseFilter.check(dummyReport, 10)).toEqual({ action: 'create' });
    });
  });

  describe('checkEscalation', () => {
    it('escalates one level at 2x daily average', () => {
      expect(noiseFilter.checkEscalation('low', 20, 10)).toBe('medium');
      expect(noiseFilter.checkEscalation('medium', 20, 10)).toBe('high');
      expect(noiseFilter.checkEscalation('high', 20, 10)).toBe('urgent');
    });

    it('goes straight to urgent at 5x daily average', () => {
      expect(noiseFilter.checkEscalation('low', 50, 10)).toBe('urgent');
      expect(noiseFilter.checkEscalation('medium', 50, 10)).toBe('urgent');
    });

    it('does not escalate when rate is at or below baseline', () => {
      expect(noiseFilter.checkEscalation('medium', 10, 10)).toBe('medium');
      expect(noiseFilter.checkEscalation('low', 5, 10)).toBe('low');
    });

    it('stays at urgent when already urgent', () => {
      expect(noiseFilter.checkEscalation('urgent', 20, 10)).toBe('urgent');
    });
  });
});
