/**
 * Builds the self-registration link a new provider opens to onboard into a
 * practice. The provider submits a ProviderApplication via this link, which the
 * practice/admin then approves — at which point the provider is auto-assigned to
 * the practice. Used by the practice header ("Copy Registration Link") and the
 * Assign Provider modal's invite empty state.
 */
export function buildRegistrationLink(practiceId: string): string {
  return `${window.location.origin}/register?practice=${practiceId}`;
}
