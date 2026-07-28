import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { paginationSchema, parseQuery } from '../../utils/queryValidation.js';
import {
  exportEntitlementsCsv,
  getEntitlements,
  getPermissionCatalog,
  rolesGranting,
} from './accessReview.service.js';
import type { UserRole } from '@credential-management/shared';

export const accessReviewRoutes = Router();

accessReviewRoutes.use(authenticate);
// Visibility contract:
//   admin + lanyard_staff → all users across all practices
//   practice_admin        → only users in their own practice(s) (scoped below)
//   provider / credentialing_staff → rejected here.
// NOTE: lanyard_staff must be listed explicitly — the authorize() inheritance
// only maps lanyard_staff onto routes that allow credentialing_staff, and
// credentialing_staff is deliberately NOT allowed on this module.
accessReviewRoutes.use(authorize('admin', 'lanyard_staff', 'practice_admin'));

/**
 * Practice scope for the report.
 * null → unrestricted. Array → only users sharing one of these practices.
 * lanyard_staff gets null (not their practiceIds list) because users without a
 * practice assignment (e.g. internal admins) must still appear in their report.
 */
function reportScope(req: Request): string[] | null {
  if (req.practiceScope?.isSuperAdmin) return null;
  if (req.user?.role === 'lanyard_staff') return null;
  return req.practiceScope?.practiceIds ?? [];
}

const ROLE_VALUES = ['admin', 'lanyard_staff', 'credentialing_staff', 'provider', 'practice_admin'] as const;

const entitlementQuerySchema = paginationSchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
  role: z.enum(ROLE_VALUES).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  permission: z.string().optional(),
});

const entitlementFilterSchema = entitlementQuerySchema.omit({ page: true, pageSize: true });

// GET /api/v1/access-review/entitlements - Paginated user → role → permissions report
accessReviewRoutes.get(
  '/entitlements',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = parseQuery(req.query, entitlementQuerySchema);
      const result = await getEntitlements(q as never, reportScope(req));
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/access-review/entitlements/export.csv - CSV export (same filters + scoping)
accessReviewRoutes.get(
  '/entitlements/export.csv',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = parseQuery(req.query, entitlementFilterSchema);
      const csv = await exportEntitlementsCsv(q, reportScope(req));
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="access-review-${stamp}.csv"`);
      res.send(csv);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/access-review/permissions - Catalog of permissions → granting roles
accessReviewRoutes.get(
  '/permissions',
  (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: getPermissionCatalog() });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/access-review/permissions/:permission/users - "Who can do X?" reverse lookup
accessReviewRoutes.get(
  '/permissions/:permission/users',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const permission = req.params['permission']!;
      const q = parseQuery(req.query, entitlementQuerySchema.omit({ permission: true }));
      const result = await getEntitlements(
        { ...(q as object), permission } as never,
        reportScope(req)
      );
      res.json({
        success: true,
        data: { ...result, permission, grantedByRoles: rolesGranting(permission) as UserRole[] },
      });
    } catch (error) {
      next(error);
    }
  }
);
