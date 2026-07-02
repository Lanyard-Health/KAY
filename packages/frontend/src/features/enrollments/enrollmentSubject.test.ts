import { describe, it, expect } from 'vitest';
import { isPracticeEnrollment } from './enrollmentSubject';

describe('isPracticeEnrollment', () => {
  it('is true for an explicit PRACTICE subjectType', () => {
    expect(isPracticeEnrollment({ subjectType: 'PRACTICE', providerId: null, practiceId: 'p1' })).toBe(true);
  });

  it('falls back to FK shape: no provider + a practice => true', () => {
    expect(isPracticeEnrollment({ providerId: null, practiceId: 'p1' })).toBe(true);
  });

  it('is false for a provider enrollment', () => {
    expect(isPracticeEnrollment({ subjectType: 'PROVIDER', providerId: 'pr1', practiceId: null })).toBe(false);
  });

  it('is false when a provider is present even if practiceId is also set', () => {
    expect(isPracticeEnrollment({ providerId: 'pr1', practiceId: 'p1' })).toBe(false);
  });

  it('is false when neither FK is set (incomplete row is not a practice)', () => {
    expect(isPracticeEnrollment({ providerId: null, practiceId: null })).toBe(false);
  });
});
