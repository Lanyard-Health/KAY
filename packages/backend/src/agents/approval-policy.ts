/**
 * Unified policy for PendingApproval expiry.
 *
 * Before this constant, five PendingApproval call sites disagreed:
 *   - approval.service.ts defaulted to 48h
 *   - manual-adapter.ts hardcoded 7d
 *   - tool-executor.ts requestHumanApproval hardcoded 7d
 *   - workflow-approval.service createStepApproval set NO expiresAt (infinite)
 *   - workflow-approval.service createFollowUpApproval set NO expiresAt (infinite)
 *
 * 7 days is the floor: Kay needs a Friday→Monday window to react without
 * approvals auto-expiring on the weekend. A shorter TTL was creating
 * surprises in the agent flow.
 */
export const APPROVAL_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns the absolute Date when an approval created right now should expire.
 * Use this instead of `new Date(Date.now() + APPROVAL_EXPIRY_MS)` so tests
 * can stub `Date.now()` without also stubbing constant arithmetic.
 */
export function approvalExpiryFromNow(): Date {
  return new Date(Date.now() + APPROVAL_EXPIRY_MS);
}
