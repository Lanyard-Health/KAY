import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { ForbiddenError } from './error.middleware.js';

/**
 * Non-middleware helper: initializes req.practiceScope.
 * Called by authenticate middleware after setting req.user.
 * Skips if practiceScope is already set.
 */
export async function initPracticeScope(req: Request): Promise<void> {
  if (req.practiceScope || !req.user) return;

  if (req.user.role === 'admin' || req.user.role === 'ops_staff') {
    // Check for X-Ops-Practice-Context header to narrow scope
    const opsPracticeId = req.headers['x-ops-practice-context'] as string | undefined;
    if (opsPracticeId && (req.user.role === 'admin' || req.user.role === 'ops_staff')) {
      // Validate practice exists
      const practice = await prisma.practice.findUnique({
        where: { id: opsPracticeId },
        select: { id: true },
      });
      if (practice) {
        req.practiceScope = { isSuperAdmin: false, practiceIds: [opsPracticeId] };
        return;
      }
    }
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

  if (req.user.role === 'admin' || req.user.role === 'ops_staff') {
    const opsPracticeId = req.headers['x-ops-practice-context'] as string | undefined;
    if (opsPracticeId) {
      const practice = await prisma.practice.findUnique({
        where: { id: opsPracticeId },
        select: { id: true },
      });
      if (practice) {
        req.practiceScope = { isSuperAdmin: false, practiceIds: [opsPracticeId] };
        return next();
      }
    }
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
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { practiceId: true },
    });

    if (!provider) return next(); // Let route handler deal with 404

    const practiceIds = req.practiceScope?.practiceIds ?? [];

    // If provider has no practice assigned, only admins/ops_staff and the provider themselves can access
    if (!provider.practiceId) {
      if (req.user?.role === 'admin' || req.user?.role === 'ops_staff') return next();
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

  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { practiceId: true },
  });

  if (!provider) return true; // Let route handler deal with 404

  // No practice assigned → only admins/ops_staff and the provider themselves can access
  if (!provider.practiceId) {
    if (req.user?.role === 'admin' || req.user?.role === 'ops_staff') return true;
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
 * For super admins: returns {} (no filter).
 * For others: includes providers in the user's practices OR unassigned (null practiceId).
 * For users with no practices: only shows unassigned providers.
 */
export function getPracticeProviderFilter(
  req: Request
): Record<string, unknown> {
  if (req.practiceScope?.isSuperAdmin) return {};
  const ids = req.practiceScope?.practiceIds ?? [];
  // Non-admin users only see providers assigned to their practices (not unassigned ones)
  if (ids.length === 0) return { id: '__no_access__' }; // matches nothing
  return { practiceId: { in: ids } };
}

/**
 * Returns a Prisma WHERE clause fragment to filter resources (enrollments, tasks,
 * termination letters) through their provider's practiceId.
 * Use: { ...existingWhere, ...getPracticeRelationFilter(req) }
 */
export function getPracticeRelationFilter(
  req: Request
): Record<string, unknown> {
  if (req.practiceScope?.isSuperAdmin) return {};
  const ids = req.practiceScope?.practiceIds ?? [];
  // Non-admin users only see resources for providers in their practices
  if (ids.length === 0) {
    return { provider: { id: '__no_access__' } }; // matches nothing
  }
  return { provider: { practiceId: { in: ids } } };
}
