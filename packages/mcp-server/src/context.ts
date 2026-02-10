export interface UserContext {
  userId: string;
  email: string;
  role: string;
  providerId?: string;
  isSuperAdmin: boolean;
  practiceIds: string[];
}

/**
 * Returns a Prisma WHERE clause fragment to filter providers by practice.
 * Super admins: {} (no filter).
 * Others: { practiceId: { in: [...] } }.
 * No practices: impossible match so no results are returned.
 */
export function getPracticeProviderFilter(ctx: UserContext): Record<string, unknown> {
  if (ctx.isSuperAdmin) return {};
  if (ctx.practiceIds.length === 0) return { practiceId: '__no_practice_match__' };
  return { practiceId: { in: ctx.practiceIds } };
}

/**
 * Returns a Prisma WHERE clause fragment to filter resources
 * (enrollments, tasks, termination letters) through their provider's practiceId.
 */
export function getPracticeRelationFilter(ctx: UserContext): Record<string, unknown> {
  if (ctx.isSuperAdmin) return {};
  if (ctx.practiceIds.length === 0) {
    return { provider: { practiceId: '__no_practice_match__' } };
  }
  return { provider: { practiceId: { in: ctx.practiceIds } } };
}
