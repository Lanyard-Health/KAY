/**
 * Display helpers for an enrollment's subject. Since provider-optional
 * enrollments shipped, an enrollment's subject is either an individual PROVIDER
 * or a PRACTICE (group / state Medicaid), and `enrollment.provider` can be null.
 * Never dereference `enrollment.provider` for display without a null check —
 * use these helpers so practice enrollments render the practice instead of
 * crashing on a null provider.
 */

type SubjectProvider =
  | { firstName?: string | null; lastName?: string | null }
  | null
  | undefined;
type SubjectPractice = { name?: string | null } | null | undefined;

/** "First Last" for a provider, else the practice name, else a safe fallback. */
export function subjectName(provider: SubjectProvider, practice: SubjectPractice): string {
  if (provider) {
    const name = `${provider.firstName ?? ''} ${provider.lastName ?? ''}`.trim();
    if (name) return name;
  }
  return practice?.name?.trim() || 'the practice';
}

/** "Last, First" variant used in some email subjects. */
export function subjectNameLastFirst(
  provider: SubjectProvider,
  practice: SubjectPractice
): string {
  if (provider) {
    const last = provider.lastName?.trim();
    const first = provider.firstName?.trim();
    if (last || first) return [last, first].filter(Boolean).join(', ');
  }
  return practice?.name?.trim() || 'the practice';
}
