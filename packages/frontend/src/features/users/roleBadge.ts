/**
 * One badge table for system roles, shared by the users list and the user
 * detail page.
 *
 * These two screens each kept their own copy, and the copies were missing
 * `practice_admin`. A missing entry did not show up as missing: both fell back
 * to the Credentialing Staff badge, so every practice admin was labelled as
 * something they are not, on both screens, while the panel underneath read the
 * same field and printed the truth.
 *
 * So an unknown role now falls back to its own name in neutral grey. A label
 * that guesses wrong is worse than one that admits it does not recognise the
 * value: the wrong guess looks like a real answer and nobody goes looking.
 */
export type RoleBadge = { bg: string; text: string; label: string };

export const ROLE_BADGE: Record<string, RoleBadge> = {
  admin: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Admin' },
  lanyard_staff: { bg: 'bg-indigo-100', text: 'text-indigo-800', label: 'Lanyard Health Staff' },
  credentialing_staff: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Credentialing Staff' },
  practice_admin: { bg: 'bg-teal-100', text: 'text-teal-800', label: 'Practice Admin' },
  provider: { bg: 'bg-green-100', text: 'text-green-800', label: 'Provider' },
};

/** Title Case from a role key: `practice_admin` -> `Practice Admin`. */
function humanize(role: string): string {
  return role
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function badgeFor(role: string): RoleBadge {
  return (
    ROLE_BADGE[role] ?? {
      bg: 'bg-gray-100',
      text: 'text-gray-800',
      label: humanize(role),
    }
  );
}
