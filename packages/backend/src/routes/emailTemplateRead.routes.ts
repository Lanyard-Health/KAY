import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { STAFF_ROLES } from '../constants/roles.js';
import { listTemplates, getTemplate } from '../services/emailTemplate.service.js';
import type { EmailTemplateType } from '@prisma/client';

const router = Router();

// GET /  — list active templates, optional ?type= filter
router.get(
  '/',
  authenticate,
  authorize(...STAFF_ROLES),
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

// GET /:id  — single active template
router.get(
  '/:id',
  authenticate,
  authorize(...STAFF_ROLES),
  async (req: Request, res: Response) => {
    try {
      const template = await getTemplate(req.params['id']!);
      if (!template || !template.isActive) {
        res.status(404).json({ success: false, error: { message: 'Template not found' } });
        return;
      }
      res.json({ success: true, data: template });
    } catch (error) {
      res.status(500).json({ success: false, error: { message: 'Failed to get template' } });
    }
  },
);

export default router;
