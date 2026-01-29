import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';

export const auditRoutes = Router();

auditRoutes.use(authenticate);
auditRoutes.use(authorize('admin'));

// GET /api/v1/audit - Query audit logs
auditRoutes.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query['page'] as string) || 1;
      const pageSize = Math.min(parseInt(req.query['pageSize'] as string) || 50, 100);
      const userId = req.query['userId'] as string;
      const resourceType = req.query['resourceType'] as string;
      const action = req.query['action'] as string;
      const startDate = req.query['startDate'] as string;
      const endDate = req.query['endDate'] as string;

      const where = {
        ...(userId && { userId }),
        ...(resourceType && { resourceType }),
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
      const logs = await prisma.auditLog.findMany({
        where: {
          resourceType: req.params['type'],
          resourceId: req.params['id'],
        },
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
      const page = parseInt(req.query['page'] as string) || 1;
      const pageSize = Math.min(parseInt(req.query['pageSize'] as string) || 50, 100);

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where: { userId: req.params['userId'] },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { timestamp: 'desc' },
        }),
        prisma.auditLog.count({ where: { userId: req.params['userId'] } }),
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
      const startDate = req.query['startDate'] as string;
      const endDate = req.query['endDate'] as string;

      const dateFilter = {
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
