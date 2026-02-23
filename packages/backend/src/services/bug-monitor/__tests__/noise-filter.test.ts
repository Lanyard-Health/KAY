import { describe, it, expect } from 'vitest';
import { noiseFilter } from '../noise-filter.js';
import type { SanitizedBugReport } from '../types.js';

const dummyReport: SanitizedBugReport = {
  source: 'backend-runtime',
  title: 'Test',
  errorMessage: 'test error',
  metadata: {},
  occurredAt: new Date(),
  environment: 'development',
  _sanitized: true,
};

describe('NoiseFilter', () => {
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
