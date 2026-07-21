import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ADMIN_ROLES } from '../constants/roles.js';

// Internal Lanyard team ONLY — never 'credentialing_staff' (practice-side).
const internalOnly = authorize(...ADMIN_ROLES, 'lanyard_staff');

const router = Router();

// '' from a cleared form field means "no value" — store null, never ''.
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );

const contactInfoSchema = z.object({
  phone: optionalText(50),
  email: optionalText(200),
  bestWay: optionalText(200),
  hours: optionalText(200),
  notes: optionalText(1000),
});

// GET /enrollments/payers/:payerId/contact-info — row or null (null = the
// designed "Nothing on file" empty state; runtime does NOT fall back to
// Payer.phone — the seeding script materializes that fallback as real rows).
router.get('/payers/:payerId/contact-info', authenticate, internalOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payerId = req.params['payerId']!;
    const payer = await prisma.payer.findUnique({ where: { id: payerId }, select: { id: true } });
    if (!payer) {
      res.status(404).json({ success: false, error: { message: 'Payer not found' } });
      return;
    }
    const info = await prisma.payerContactInfo.findUnique({ where: { payerId } });
    res.json({ success: true, data: info });
  } catch (error) { next(error); }
});

// PUT /enrollments/payers/:payerId/contact-info — staff upsert (D6: staff-entered from seeding on).
router.put('/payers/:payerId/contact-info', authenticate, internalOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payerId = req.params['payerId']!;
    const v = contactInfoSchema.parse(req.body);
    const payer = await prisma.payer.findUnique({ where: { id: payerId }, select: { id: true } });
    if (!payer) {
      res.status(404).json({ success: false, error: { message: 'Payer not found' } });
      return;
    }
    const fields = {
      phone: v.phone ?? null,
      email: v.email ?? null,
      bestWay: v.bestWay ?? null,
      hours: v.hours ?? null,
      notes: v.notes ?? null,
      updatedById: req.user!.id,
    };
    const row = await prisma.payerContactInfo.upsert({
      where: { payerId },
      create: { payerId, ...fields },
      update: fields,
    });
    res.json({ success: true, data: row });
  } catch (error) { next(error); }
});

export default router;
