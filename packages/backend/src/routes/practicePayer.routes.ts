import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { prisma } from '../utils/prisma.js';
import { encryptSafe, decryptSafe } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.use(authenticate);

const updateSchema = z.object({
  groupNpi: z.union([z.string().max(20), z.null()]).optional(),
  groupTaxId: z.union([z.string().max(20), z.null()]).optional(),
  groupContractNumber: z.union([z.string().max(100), z.null()]).optional(),
  primaryContactName: z.union([z.string().max(200), z.null()]).optional(),
  primaryContactEmail: z.union([z.string().email().max(200), z.null()]).optional(),
  primaryContactPhone: z.union([z.string().max(20), z.null()]).optional(),
  coiOnFileUrl: z.union([z.string().max(500), z.null()]).optional(),
  w9OnFileUrl: z.union([z.string().max(500), z.null()]).optional(),
  effectiveDate: z.union([z.string().datetime(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).optional(),
  notes: z.union([z.string().max(2000), z.null()]).optional(),
});

// Response masking: never return the encrypted ciphertext. Show a masked
// preview so users can tell whether a value is on file.
function mask(row: any) {
  if (!row) return row;
  const { groupTaxIdEncrypted, ...rest } = row;
  let groupTaxId: string | null = null;
  if (groupTaxIdEncrypted) {
    try {
      const plain = decryptSafe(groupTaxIdEncrypted);
      groupTaxId = plain ? '****' + plain.slice(-4) : null;
    } catch {
      groupTaxId = '****';
    }
  }
  return { ...rest, groupTaxId };
}

function userCanAccessPractice(req: Request, practiceId: string): boolean {
  if (req.practiceScope?.isSuperAdmin) return true;
  return !!req.practiceScope?.practiceIds?.includes(practiceId);
}

// GET /api/v1/practice-payers — list all practice-payer rows for the
// caller's practice (or all if super admin).
router.get(
  '/',
  authorize(...ADMIN_ROLES, 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scopedPracticeIds = req.practiceScope?.practiceIds ?? [];
      const where = req.practiceScope?.isSuperAdmin
        ? {}
        : { practiceId: { in: scopedPracticeIds } };

      const rows = await prisma.practicePayer.findMany({
        where,
        include: { payer: { select: { id: true, name: true, payerType: true } } },
        orderBy: [{ practiceId: 'asc' }, { payer: { name: 'asc' } }],
      });

      res.json({ success: true, data: rows.map(mask) });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/practice-payers/:id — update a single practice-payer row.
// Encrypts groupTaxId via encryptSafe() before persisting.
router.patch(
  '/:id',
  authorize(...ADMIN_ROLES, 'practice_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']!;

      const existing = await prisma.practicePayer.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ success: false, error: { message: 'Not found' } });
      }
      if (!userCanAccessPractice(req, existing.practiceId)) {
        return res.status(403).json({ success: false, error: { message: 'Forbidden' } });
      }

      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Validation failed',
            details: parsed.error.issues.map((i) => ({
              field: i.path.join('.'),
              message: i.message,
            })),
          },
        });
      }
      const v = parsed.data;

      const data: Record<string, unknown> = {};
      if (v.groupNpi !== undefined) data['groupNpi'] = v.groupNpi;
      if (v.groupTaxId !== undefined) {
        data['groupTaxIdEncrypted'] = v.groupTaxId ? encryptSafe(v.groupTaxId) : null;
      }
      if (v.groupContractNumber !== undefined) data['groupContractNumber'] = v.groupContractNumber;
      if (v.primaryContactName !== undefined) data['primaryContactName'] = v.primaryContactName;
      if (v.primaryContactEmail !== undefined) data['primaryContactEmail'] = v.primaryContactEmail;
      if (v.primaryContactPhone !== undefined) data['primaryContactPhone'] = v.primaryContactPhone;
      if (v.coiOnFileUrl !== undefined) data['coiOnFileUrl'] = v.coiOnFileUrl;
      if (v.w9OnFileUrl !== undefined) data['w9OnFileUrl'] = v.w9OnFileUrl;
      if (v.effectiveDate !== undefined) {
        data['effectiveDate'] = v.effectiveDate ? new Date(v.effectiveDate) : null;
      }
      if (v.notes !== undefined) data['notes'] = v.notes;

      const updated = await prisma.practicePayer.update({
        where: { id },
        data,
        include: { payer: { select: { id: true, name: true, payerType: true } } },
      });

      logger.info(`practice-payer ${id} updated by user ${req.user?.id}`);
      res.json({ success: true, data: mask(updated) });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
