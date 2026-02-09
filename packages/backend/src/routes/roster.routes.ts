import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { NotFoundError, ForbiddenError } from '../middleware/error.middleware.js';
import { getPracticeProviderFilter } from '../middleware/practiceScope.middleware.js';
import {
  validateColumns,
  fetchRosterData,
  fetchAllRosterData,
  flattenToRows,
  generateExcel,
} from '../services/roster.service.js';
import type { RosterColumn } from '../services/roster.service.js';

export const rosterRoutes = Router();

// All roster routes require authentication + admin or credentialing_staff
rosterRoutes.use(authenticate);
rosterRoutes.use(authorize('admin', 'credentialing_staff'));

// ==========================================
// Validation Schemas
// ==========================================

const columnSchema = z.object({
  fieldKey: z.string().min(1),
  label: z.string().min(1),
  width: z.number().optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  columns: z.array(columnSchema).min(1),
  filters: z.any().optional(),
  sortConfig: z.any().optional(),
  isShared: z.boolean().optional(),
});

const previewSchema = z.object({
  columns: z.array(columnSchema).min(1),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

const exportSchema = z.object({
  columns: z.array(columnSchema).min(1),
  reportName: z.string().optional(),
});

// ==========================================
// Template CRUD Routes
// ==========================================

// GET /api/v1/roster - List templates (own + shared)
rosterRoutes.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;

      const templates = await prisma.rosterTemplate.findMany({
        where: {
          OR: [
            { createdById: userId },
            { isShared: true },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        include: {
          createdBy: {
            select: { firstName: true, lastName: true },
          },
        },
      });

      res.json({ success: true, data: templates });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/roster/:id - Get single template
rosterRoutes.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const template = await prisma.rosterTemplate.findUnique({
        where: { id: req.params['id'] },
        include: {
          createdBy: {
            select: { firstName: true, lastName: true },
          },
        },
      });

      if (!template) {
        throw new NotFoundError('Roster template');
      }

      // Check access: must be owner or template must be shared
      const userId = req.user!.id;
      if (template.createdById !== userId && !template.isShared) {
        throw new ForbiddenError('Access denied to this template');
      }

      res.json({ success: true, data: template });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/roster - Create template
rosterRoutes.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createTemplateSchema.parse(req.body);

      // Validate all field keys
      validateColumns(data.columns as RosterColumn[]);

      const template = await prisma.rosterTemplate.create({
        data: {
          name: data.name,
          description: data.description,
          columns: data.columns,
          filters: data.filters,
          sortConfig: data.sortConfig,
          isShared: data.isShared ?? false,
          createdById: req.user!.id,
        },
      });

      res.status(201).json({ success: true, data: template });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/roster/:id - Update template (owner or admin only)
rosterRoutes.put(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createTemplateSchema.partial().parse(req.body);

      const existing = await prisma.rosterTemplate.findUnique({
        where: { id: req.params['id'] },
      });

      if (!existing) {
        throw new NotFoundError('Roster template');
      }

      // Only owner or admin can update
      if (existing.createdById !== req.user!.id && req.user!.role !== 'admin') {
        throw new ForbiddenError('Only the template owner or admin can update');
      }

      if (data.columns) {
        validateColumns(data.columns as RosterColumn[]);
      }

      const template = await prisma.rosterTemplate.update({
        where: { id: req.params['id'] },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.columns !== undefined && { columns: data.columns }),
          ...(data.filters !== undefined && { filters: data.filters }),
          ...(data.sortConfig !== undefined && { sortConfig: data.sortConfig }),
          ...(data.isShared !== undefined && { isShared: data.isShared }),
        },
      });

      res.json({ success: true, data: template });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/roster/:id - Delete template (owner or admin only)
rosterRoutes.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.rosterTemplate.findUnique({
        where: { id: req.params['id'] },
      });

      if (!existing) {
        throw new NotFoundError('Roster template');
      }

      if (existing.createdById !== req.user!.id && req.user!.role !== 'admin') {
        throw new ForbiddenError('Only the template owner or admin can delete');
      }

      await prisma.rosterTemplate.delete({
        where: { id: req.params['id'] },
      });

      res.json({ success: true, message: 'Template deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// Preview & Export Routes
// ==========================================

// POST /api/v1/roster/preview - Preview data (paginated JSON)
rosterRoutes.post(
  '/preview',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = previewSchema.parse(req.body);
      const columns = data.columns as RosterColumn[];
      const page = data.page || 1;
      const pageSize = data.pageSize || 25;

      const result = await fetchRosterData(columns, page, pageSize, getPracticeProviderFilter(req));
      const rows = flattenToRows(result.providers, columns);

      res.json({
        success: true,
        data: {
          headers: columns.map(c => c.label),
          rows,
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: Math.ceil(result.total / result.pageSize),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/roster/export - Export XLSX (binary stream download)
rosterRoutes.post(
  '/export',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = exportSchema.parse(req.body);
      const columns = data.columns as RosterColumn[];
      const reportName = data.reportName || 'Roster Report';

      const providers = await fetchAllRosterData(columns, getPracticeProviderFilter(req));
      const rows = flattenToRows(providers, columns);
      const buffer = await generateExcel(columns, rows, reportName);

      const fileName = `${reportName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }
);
