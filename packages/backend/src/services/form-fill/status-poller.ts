/**
 * Post-submission status poller — STUB (Phase 7).
 *
 * After an EnrollmentRun reaches 'submitting' → 'completed', most payers
 * return an opaque confirmation token. A real credentialing lifecycle
 * continues for weeks while the payer verifies documents, negotiates
 * contracts, and issues a provider ID. Today we have no way to track
 * that asynchronously — users check the payer portal manually.
 *
 * This file establishes the typed seam so the scheduled-job implementation
 * can land in a later phase without another round of plumbing. The
 * intended design is: a node-cron job picks up EnrollmentRuns in 'completed'
 * older than N days, hits the relevant payer's status API (where one
 * exists), and writes updates via logEnrollmentRunTransition.
 */

export interface PollEnrollmentRunStatusInput {
  enrollmentRunId: string;
}

export interface PollEnrollmentRunStatusResult {
  status: 'unchanged' | 'updated' | 'not_supported';
  details?: string;
}

/**
 * Placeholder — always returns 'not_supported'. Wire a real implementation
 * when payer status APIs are available.
 */
export async function pollEnrollmentRunStatus(
  _input: PollEnrollmentRunStatusInput
): Promise<PollEnrollmentRunStatusResult> {
  return { status: 'not_supported', details: 'Post-submission polling not yet implemented' };
}
