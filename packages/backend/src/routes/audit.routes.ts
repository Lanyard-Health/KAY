import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { auditQuerySchema, paginationSchema, parseQuery } from '../utils/queryValidation.js';

export const auditRoutes = Router();

auditRoutes.use(authenticate);
// Visibility contract (matches the Access Review module):
//   admin + lanyard_staff → full audit trail across all practices
//   practice_admin        → only activity of users within their own practice(s)
//   provider / credentialing_staff → rejected.
// lanyard_staff is listed explicitly because the authorize() inheritance only
// kicks in on routes that allow credentialing_staff, which this one no longer does.
auditRoutes.use(authorize('admin', 'lanyard_staff', 'practice_admin'));

/**
 * Server-side scope for audit visibility.
 * Returns null for unrestricted roles (admin, lanyard_staff).
 * For practice_admin, returns the userIds of everyone in their practice(s)
 * (plus themselves) — the only actors whose audit activity they may see.
 */
async function getScopedUserIds(req: Request): Promise<string[] | null> {
  if (req.user?.role !== 'practice_admin') return null;
  const practiceIds = req.practiceScope?.practiceIds ?? [];
  if (practiceIds.length === 0) return [req.user.id];
  const members = await prisma.userPractice.findMany({
    where: { practiceId: { in: practiceIds } },
    select: { userId: true },
  });
  const ids = new Set(members.map((m) => m.userId));
  ids.add(req.user.id);
  return [...ids];
}

// GET /api/v1/audit - Query audit logs
auditRoutes.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize, userId, resourceType, resourceId, action, startDate, endDate } = parseQuery(req.query, auditQuerySchema);

      const scopedUserIds = await getScopedUserIds(req);

      // Practice-scoped viewers may not filter to a user outside their scope.
      let userWhere: Record<string, unknown> = {};
      if (userId) {
        if (scopedUserIds && !scopedUserIds.includes(userId)) {
          return res.status(403).json({ success: false, error: { message: 'Access denied — user not in your practice' } });
        }
        userWhere = { userId };
      } else if (scopedUserIds) {
        userWhere = { userId: { in: scopedUserIds } };
      }

      const where = {
        ...userWhere,
        ...(resourceType && { resourceType }),
        ...(resourceId && { resourceId }),
        ...(action && { action: action as any }),
        ...(startDate || endDate) && {
          timestamp: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        },
      };

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { timestamp: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.json({
        success: true,
        data: {
          data: logs,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/audit/resource/:type/:id - Get audit history for a specific resource
auditRoutes.get(
  '/resource/:type/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scopedUserIds = await getScopedUserIds(req);

      const logs = await prisma.auditLog.findMany({
        where: {
          resourceType: req.params['type'],
          resourceId: req.params['id'],
          ...(scopedUserIds && { userId: { in: scopedUserIds } }),
        },
        orderBy: { timestamp: 'desc' },
        take: 500,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      res.json({ success: true, data: logs });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/audit/user/:userId - Get audit history for a specific user
auditRoutes.get(
  '/user/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const targetUserId = req.params['userId']!;

      // practice_admin can only view audit logs for users in their own practice(s)
      const scopedUserIds = await getScopedUserIds(req);
      if (scopedUserIds && !scopedUserIds.includes(targetUserId)) {
        return res.status(403).json({ success: false, error: { message: 'Access denied — user not in your practice' } });
      }

      const { page, pageSize } = parseQuery(req.query, paginationSchema.extend({
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
      }));

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where: { userId: targetUserId },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { timestamp: 'desc' },
        }),
        prisma.auditLog.count({ where: { userId: targetUserId } }),
      ]);

      res.json({
        success: true,
        data: {
          data: logs,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/audit/stats - Get audit statistics
auditRoutes.get(
  '/stats',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { startDate, endDate } = parseQuery(req.query, z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }));

      const scopedUserIds = await getScopedUserIds(req);
      const scopeFilter = scopedUserIds ? { userId: { in: scopedUserIds } } : {};

      const dateFilter = {
        ...scopeFilter,
        ...(startDate || endDate) && {
          timestamp: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        },
      };

      // Get counts by action type
      const actionCounts = await prisma.auditLog.groupBy({
        by: ['action'],
        where: dateFilter,
        _count: { action: true },
      });

      // Get counts by resource type
      const resourceCounts = await prisma.auditLog.groupBy({
        by: ['resourceType'],
        where: dateFilter,
        _count: { resourceType: true },
      });

      // Get recent activity count
      const last24Hours = await prisma.auditLog.count({
        where: {
          ...scopeFilter,
          timestamp: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      });

      res.json({
        success: true,
        data: {
          byAction: actionCounts.reduce((acc, item) => {
            acc[item.action] = item._count.action;
            return acc;
          }, {} as Record<string, number>),
          byResource: resourceCounts.reduce((acc, item) => {
            acc[item.resourceType] = item._count.resourceType;
            return acc;
          }, {} as Record<string, number>),
          last24Hours,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);
