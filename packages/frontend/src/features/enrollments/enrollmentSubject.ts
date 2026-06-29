// Shared subject helpers for enrollments. An enrollment's subject is either an
// individual PROVIDER or a PRACTICE (group / state Medicaid). Kept tiny and pure
// so it's unit-testable without rendering the (large) EnrollmentsList component.

export interface EnrollmentSubjectFields {
  subjectType?: 'PROVIDER' | 'PRACTICE';
  providerId?: string | null;
  practiceId?: string | null;
}

/**
 * True when the enrollment has no individual provider (group / state Medicaid).
 * Prefers the explicit discriminator; falls back to the FK shape for older rows
 * served before subjectType existed. A row with neither FK is NOT a practice.
 */
export function isPracticeEnrollment(e: EnrollmentSubjectFields): boolean {
  return e.subjectType === 'PRACTICE' || (!e.providerId && !!e.practiceId);
}
