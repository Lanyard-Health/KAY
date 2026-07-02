import type { Request, Response, NextFunction } from 'express';
import { prisma, prismaBase } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { ForbiddenError } from './error.middleware.js';

/**
 * Non-middleware helper: initializes req.practiceScope.
 * Called by authenticate middleware after setting req.user.
 * Skips if practiceScope is already set.
 */
export async function initPracticeScope(req: Request): Promise<void> {
  if (req.practiceScope || !req.user) return;

  if (req.user.role === 'admin') {
    req.practiceScope = { isSuperAdmin: true, practiceIds: [] };
    return;
  }

  try {
    // lanyard_staff (Lanyard's own employees) deliver services across ALL practices.
    // We give them every practiceId so the existing practiceIds-based read filters
    // surface all practices — WITHOUT setting isSuperAdmin, which gates founder-only
    // write/escalation checks (e.g. minting admin logins). See project_lanyard_staff_role.
    const practiceIds = req.user.role === 'lanyard_staff'
      ? await loadAllPracticeIds()
      : (await prisma.userPractice.findMany({
          where: { userId: req.user.id },
          select: { practiceId: true },
        })).map((a) => a.practiceId);
    req.practiceScope = { isSuperAdmin: false, practiceIds };
  } catch (err) {
    logger.error('Failed to load practice scope:', err);
    req.practiceScope = { isSuperAdmin: false, practiceIds: [] };
  }
}

// ponytail: queries all practice ids per lanyard_staff request. Practice count is small
// (small/mid practices). Wrap in utils/cache with a short TTL if this ever shows up hot.
async function loadAllPracticeIds(): Promise<string[]> {
  const practices = await prisma.practice.findMany({ select: { id: true } });
  return practices.map((p) => p.id);
}

/**
 * Global middleware: attaches practice scope to every authenticated request.
 * Safety net — initPracticeScope is the primary path (called from authenticate).
 *
 * - admin role → isSuperAdmin = true, bypasses all practice filtering
 * - other roles → queries UserPractice for assigned practiceIds
 */
export async function attachPracticeScope(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) return next();

  if (req.user.role === 'admin') {
    req.practiceScope = { isSuperAdmin: true, practiceIds: [] };
    return next();
  }

  try {
    // lanyard_staff see every practice (cross-practice services) without isSuperAdmin —
    // see initPracticeScope above.
    const practiceIds = req.user.role === 'lanyard_staff'
      ? await loadAllPracticeIds()
      : (await prisma.userPractice.findMany({
          where: { userId: req.user.id },
          select: { practiceId: true },
        })).map((a) => a.practiceId);
    req.practiceScope = { isSuperAdmin: false, practiceIds };

    logger.debug(
      `Practice scope: user=${req.user.id} role=${req.user.role} practiceIds=[${practiceIds.join(',')}]`
    );
  } catch (err) {
    logger.error('Failed to load practice scope:', err);
    req.practiceScope = { isSuperAdmin: false, practiceIds: [] };
  }

  next();
}

/**
 * Route middleware for :providerId routes.
 * Validates that the provider belongs to the user's assigned practice(s).
 * Super admins bypass. Must run AFTER attachPracticeScope.
 */
export async function requirePracticeProvider(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.practiceScope?.isSuperAdmin) return next();

  const providerId = req.params['providerId'] || req.body?.providerId;
  if (!providerId) return next();

  try {
    // Bypass the soft-delete filter so the tenant check still runs for the restore route
    // and any other admin path that legitimately touches soft-deleted rows. Route handlers
    // are responsible for distinguishing "active" from "archived" in their own response.
    const provider = await prismaBase.providerProfile.findUnique({
      where: { id: providerId },
      select: { practiceId: true },
    });

    if (!provider) return next(); // Let route handler deal with 404

    const practiceIds = req.practiceScope?.practiceIds ?? [];

    // If provider has no practice assigned, only admins and the provider themselves can access
    if (!provider.practiceId) {
      if (req.user?.role === 'admin') return next();
      if (req.user?.role === 'provider' && req.user?.providerId === providerId) return next();

      // Carve-out: claiming an unassigned provider INTO a practice the caller is scoped to.
      // lanyard_staff / practice_admin assign providers from the "unassigned" list — this is the
      // legitimate first assignment. We only allow it when the request is setting a practiceId
      // within the caller's own scope. Plain reads of an unassigned provider carry no body
      // practiceId, so they stay blocked and cross-tenant isolation is preserved.
      const targetPracticeId = req.body?.practiceId;
      const canAssign = req.user?.role === 'lanyard_staff' || req.user?.role === 'practice_admin';
      if (canAssign && typeof targetPracticeId === 'string' && practiceIds.includes(targetPracticeId)) {
        return next();
      }

      logger.warn(
        `Practice access denied: user=${req.user?.id} tried to access unassigned provider=${providerId}`
      );
      res.status(403).json({
        success: false,
        error: { message: 'Access denied — unassigned provider' },
      });
      return;
    }

    // If provider IS assigned to a practice, staff must belong to that practice
    if (!practiceIds.includes(provider.practiceId)) {
      logger.warn(
        `Practice access denied: user=${req.user?.id} provider=${providerId} providerPractice=${provider.practiceId}`
      );
      res.status(403).json({
        success: false,
        error: { message: 'Access denied — provider not in your practice' },
      });
      return;
    }
  } catch (err) {
    logger.error('Practice provider check failed:', err);
    res.status(500).json({ success: false, error: { message: 'Internal error' } });
    return;
  }

  next();
}

/**
 * Async helper: validates a providerId against practice scope.
 * Returns true if access is allowed, false otherwise.
 * Use inside route handlers for resource-ID routes (tasks, letters, documents, etc.).
 */
export async function validateProviderPracticeAccess(
  req: Request,
  providerId: string
): Promise<boolean> {
  if (req.practiceScope?.isSuperAdmin) return true;

  // Bypass the soft-delete filter so the tenant check still runs for restore + archived
  // paths. Route handlers downstream decide whether to expose the deleted row.
  const provider = await prismaBase.providerProfile.findUnique({
    where: { id: providerId },
    select: { practiceId: true },
  });

  // Fail closed: a missing provider row means we cannot prove the caller's
  // practice owns it, so deny. Every caller passes a providerId taken from an
  // already-fetched resource row, so in practice this only fires on a dangling
  // reference — denying (caller sees the route's 403/404) is the safe default.
  if (!provider) return false;

  // No practice assigned → only admins and the provider themselves can access
  if (!provider.practiceId) {
    if (req.user?.role === 'admin') return true;
    if (req.user?.role === 'provider' && req.user?.providerId === providerId) return true;
    return false;
  }

  // Provider IS assigned to a practice — staff must belong to that practice
  const practiceIds = req.practiceScope?.practiceIds ?? [];
  if (!practiceIds.includes(provider.practiceId)) {
    logger.warn(
      `Practice access denied: user=${req.user?.id} provider=${providerId}`
    );
    return false;
  }

  return true;
}

/**
 * Sync helper: validates that the caller may act on a given practice. Super
 * admins pass; everyone else must have the practice in their scope. Use when the
 * resource IS a practice (e.g. creating a practice enrollment).
 */
export function validatePracticeAccess(req: Request, practiceId: string): boolean {
  if (req.practiceScope?.isSuperAdmin) return true;
  const practiceIds = req.practiceScope?.practiceIds ?? [];
  return practiceIds.includes(practiceId);
}

/**
 * Async helper: validates practice-scope access for an enrollment that may be a
 * PROVIDER enrollment (authz via the provider's practice) or a PRACTICE
 * enrollment (authz via the practice directly). Pass the loaded enrollment row;
 * its scalar FKs (providerId/practiceId) are always present. Returns true if
 * access is allowed, false otherwise. Fails closed when neither FK is set.
 */
export async function validateEnrollmentAccess(
  req: Request,
  enrollment: { providerId: string | null; practiceId: string | null }
): Promise<boolean> {
  if (req.practiceScope?.isSuperAdmin) return true;
  if (enrollment.providerId) {
    return validateProviderPracticeAccess(req, enrollment.providerId);
  }
  if (enrollment.practiceId) {
    const practiceIds = req.practiceScope?.practiceIds ?? [];
    return practiceIds.includes(enrollment.practiceId);
  }
  return false;
}

/**
 * Returns a Prisma WHERE clause fragment to filter providers by practice.
 * Use in list endpoints: { ...existingWhere, ...getPracticeProviderFilter(req) }
 *
 * For super admins: returns { deletedAt: null } (active providers only).
 * For others: includes providers in the user's practices, soft-deleted excluded.
 * For users with no practices: only shows unassigned providers.
 *
 * Note: when applied directly to `providerProfile.find*` queries, the `deletedAt: null`
 * is redundant (the Prisma client extension already adds it). It matters when this
 * fragment is nested under a relation (e.g. `enrollment.findMany({ where: { provider: filter } })`),
 * where the extension does NOT reach.
 */
export function getPracticeProviderFilter(
  req: Request
): Record<string, unknown> {
  if (req.practiceScope?.isSuperAdmin) return { deletedAt: null };
  const ids = req.practiceScope?.practiceIds ?? [];
  // Non-admin users only see providers assigned to their practices (not unassigned ones)
  if (ids.length === 0) return { id: '__no_access__' }; // matches nothing
  return { practiceId: { in: ids }, deletedAt: null };
}

/**
 * Returns a Prisma WHERE clause fragment to filter resources (enrollments, tasks,
 * termination letters) through their provider's practiceId.
 * Use: { ...existingWhere, ...getPracticeRelationFilter(req) }
 *
 * Soft-deleted providers are excluded — resources tied to an archived provider do not
 * surface in active-work lists. Audit/history paths that NEED to show resources for
 * archived providers should inline their own filter, not use this helper.
 */
export function getPracticeRelationFilter(
  req: Request
): Record<string, unknown> {
  if (req.practiceScope?.isSuperAdmin) return { provider: { deletedAt: null } };
  const ids = req.practiceScope?.practiceIds ?? [];
  // Non-admin users only see resources for providers in their practices
  if (ids.length === 0) {
    return { provider: { id: '__no_access__' } }; // matches nothing
  }
  return { provider: { practiceId: { in: ids }, deletedAt: null } };
}
