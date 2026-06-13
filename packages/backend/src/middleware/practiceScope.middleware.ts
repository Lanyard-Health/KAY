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
    const assignments = await prisma.userPractice.findMany({
      where: { userId: req.user.id },
      select: { practiceId: true },
    });
    req.practiceScope = {
      isSuperAdmin: false,
      practiceIds: assignments.map((a) => a.practiceId),
    };
  } catch (err) {
    logger.error('Failed to load practice scope:', err);
    req.practiceScope = { isSuperAdmin: false, practiceIds: [] };
  }
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
    const assignments = await prisma.userPractice.findMany({
      where: { userId: req.user.id },
      select: { practiceId: true },
    });

    const practiceIds = assignments.map((a) => a.practiceId);
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
