import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  softDeleteTemplate,
  sendTemplate,
  listEmailLogs,
} from '../services/emailTemplate.service.js';
import type { EmailTemplateType, EmailSendStatus } from '@prisma/client';
import { sanitizeEmailHtml } from '../utils/sanitize-email-html.js';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(255),
  subject: z.string().min(1).max(500),
  // Sanitized on the way in; the column feeds dangerouslySetInnerHTML (ENG-233).
  body: z.string().min(1).transform(sanitizeEmailHtml),
  type: z.enum(['AUTOMATED_ONBOARDING', 'STATIC_ON_DEMAND']),
  triggerEvent: z.string().max(100).optional(),
});

const updateSchema = createSchema.partial();

const sendSchema = z.object({
  practiceId: z.string().uuid(),
});

// GET /  — list templates, optional ?type= filter
router.get(
  '/',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response) => {
    try {
      const type = req.query['type'] as EmailTemplateType | undefined;
      if (type && !['AUTOMATED_ONBOARDING', 'STATIC_ON_DEMAND'].includes(type)) {
        res.status(400).json({ success: false, error: { message: 'Invalid type filter' } });
        return;
      }
      const templates = await listTemplates(type);
      res.json({ success: true, data: templates });
    } catch (error) {
      res.status(500).json({ success: false, error: { message: 'Failed to list templates' } });
    }
  },
);

// GET /:id  — single template
router.get(
  '/:id',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response) => {
    try {
      const template = await getTemplate(req.params['id']!);
      if (!template) {
        res.status(404).json({ success: false, error: { message: 'Template not found' } });
        return;
      }
      res.json({ success: true, data: template });
    } catch (error) {
      res.status(500).json({ success: false, error: { message: 'Failed to get template' } });
    }
  },
);

// POST /  — create template
router.post(
  '/',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response) => {
    try {
      const parsed = createSchema.parse(req.body);
      const template = await createTemplate({
        ...parsed,
        createdBy: req.user!.id,
      });
      res.status(201).json({ success: true, data: template });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: { message: 'Validation failed', details: error.errors } });
        return;
      }
      res.status(500).json({ success: false, error: { message: 'Failed to create template' } });
    }
  },
);

// PUT /:id  — update template
router.put(
  '/:id',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response) => {
    try {
      const parsed = updateSchema.parse(req.body);
      const template = await updateTemplate(req.params['id']!, parsed);
      res.json({ success: true, data: template });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: { message: 'Validation failed', details: error.errors } });
        return;
      }
      res.status(500).json({ success: false, error: { message: 'Failed to update template' } });
    }
  },
);

// DELETE /:id  — soft delete (isActive = false)
router.delete(
  '/:id',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response) => {
    try {
      await softDeleteTemplate(req.params['id']!);
      res.json({ success: true, message: 'Template deactivated' });
    } catch (error) {
      res.status(500).json({ success: false, error: { message: 'Failed to delete template' } });
    }
  },
);

// POST /:id/send  — send template to a practice
router.post(
  '/:id/send',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response) => {
    try {
      const { practiceId } = sendSchema.parse(req.body);
      const log = await sendTemplate(req.params['id']!, practiceId);
      res.json({ success: true, data: log });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: { message: 'Validation failed', details: error.errors } });
        return;
      }
      const message = error instanceof Error ? error.message : 'Failed to send email';
      const status = ['Template not found', 'Practice not found', 'Practice has no email address', 'Template is inactive'].includes(message) ? 400 : 500;
      res.status(status).json({ success: false, error: { message } });
    }
  },
);

// Email logs router — mounted separately at /api/v1/admin/email-logs
export const emailLogRouter = Router();

emailLogRouter.get(
  '/',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response) => {
    try {
      const practiceId = req.query['practiceId'] as string | undefined;
      const status = req.query['status'] as EmailSendStatus | undefined;
      if (status && !['PENDING', 'SENT', 'FAILED'].includes(status)) {
        res.status(400).json({ success: false, error: { message: 'Invalid status filter' } });
        return;
      }
      const logs = await listEmailLogs({ practiceId, status });
      res.json({ success: true, data: logs });
    } catch (error) {
      res.status(500).json({ success: false, error: { message: 'Failed to list email logs' } });
    }
  },
);

export default router;
