import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ADMIN_ROLES } from '../constants/roles.js';
import { setAuditContext } from '../middleware/audit.middleware.js';
import { signupLimiter, lookupLimiter } from '../middleware/rate-limit.js';
import { logger } from '../utils/logger.js';
import {
  createInvitation,
  resendInvitation,
  revokeInvitation,
  listInvitations,
  getInvitationByToken,
  acceptInvitation,
} from '../services/practiceInvitation.service.js';

const router = Router();

const practiceRoleSchema = z.enum(['SUPER_ADMIN', 'PRACTICE_ADMIN', 'PRACTICE_STAFF', 'PROVIDER']);

const createSchema = z.object({
  email: z.string().email('A valid email is required'),
  role: practiceRoleSchema.default('PRACTICE_ADMIN'),
});

const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a special character');

const acceptSchema = z.object({
  token: z.string().min(16, 'Invalid token'),
  password: passwordSchema,
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
});

function badRequest(res: Response, parsed: z.SafeParseError<unknown>) {
  res.status(400).json({
    success: false,
    error: {
      message: 'Validation failed',
      details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    },
  });
}

// ── Admin endpoints (auth-gated) ───────────────────────────────────────────

// GET /api/v1/practices/:practiceId/invitations — list invitations for a practice
router.get(
  '/:practiceId/invitations',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await listInvitations(req.params['practiceId']!);
      res.json({ success: true, data: rows });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/practices/:practiceId/invitations — invite someone to the practice
router.post(
  '/:practiceId/invitations',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed);

      setAuditContext(req, { resourceType: 'practice_invitation', action: 'create' });

      const invitation = await createInvitation({
        practiceId: req.params['practiceId']!,
        email: parsed.data.email,
        role: parsed.data.role,
        invitedById: req.user?.id ?? null,
      });
      return res.status(201).json({ success: true, data: invitation });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'PRACTICE_NOT_FOUND')
          return res.status(404).json({ success: false, error: { message: 'Practice not found' } });
        if (error.message === 'EMAIL_EXISTS')
          return res.status(409).json({
            success: false,
            error: { message: 'An account already exists for this email. Use "Add existing user" instead.' },
          });
        if (error.message === 'EMAIL_SEND_FAILED')
          return res.status(502).json({ success: false, error: { message: "We couldn't send that invitation. Check the email and try again." } });
      }
      return next(error);
    }
  }
);

// POST /api/v1/practices/invitations/:id/resend
router.post(
  '/invitations/:id/resend',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      setAuditContext(req, { resourceType: 'practice_invitation', action: 'update' });
      const result = await resendInvitation(req.params['id']!);
      return res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'INVITATION_NOT_FOUND')
          return res.status(404).json({ success: false, error: { message: 'Invitation not found' } });
        if (error.message === 'ALREADY_ACCEPTED')
          return res.status(409).json({ success: false, error: { message: 'That invitation has already been accepted.' } });
        if (error.message === 'EMAIL_SEND_FAILED')
          return res.status(502).json({ success: false, error: { message: "We couldn't re-send that invitation. Please try again." } });
      }
      return next(error);
    }
  }
);

// POST /api/v1/practices/invitations/:id/revoke
router.post(
  '/invitations/:id/revoke',
  authenticate,
  authorize(...ADMIN_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      setAuditContext(req, { resourceType: 'practice_invitation', action: 'update' });
      const result = await revokeInvitation(req.params['id']!);
      return res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'INVITATION_NOT_FOUND')
          return res.status(404).json({ success: false, error: { message: 'Invitation not found' } });
        if (error.message === 'ALREADY_ACCEPTED')
          return res.status(409).json({ success: false, error: { message: 'That invitation has already been accepted.' } });
      }
      return next(error);
    }
  }
);

// ── Public endpoints (no auth; the token is the credential) ─────────────────

// GET /api/v1/practices/invitations/token/:token — details for the accept page
router.get('/invitations/token/:token', lookupLimiter(), async (req: Request, res: Response) => {
  try {
    const result = await getInvitationByToken(req.params['token']!);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('Failed to resolve invitation token:', err);
    res.status(500).json({ success: false, error: { message: 'Something went wrong. Please try again.' } });
  }
});

// POST /api/v1/practices/invitations/accept — set password + join the practice
router.post('/invitations/accept', signupLimiter(), async (req: Request, res: Response) => {
  try {
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed);

    const result = await acceptInvitation(parsed.data);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof Error) {
      const map: Record<string, { code: number; message: string }> = {
        INVALID_TOKEN: { code: 404, message: 'This invitation link is not valid.' },
        ALREADY_USED: { code: 409, message: 'This invitation has already been used. Try signing in.' },
        REVOKED: { code: 410, message: 'This invitation was revoked. Ask your admin to send a new one.' },
        EXPIRED: { code: 410, message: 'This invitation has expired. Ask your admin to send a new one.' },
        EMAIL_EXISTS: { code: 409, message: 'An account already exists for this email. Try signing in instead.' },
      };
      const hit = map[error.message];
      if (hit) return res.status(hit.code).json({ success: false, error: { message: hit.message } });
    }
    logger.error('Failed to accept invitation:', error);
    return res.status(500).json({ success: false, error: { message: "We couldn't finish setting up your account. Please try again." } });
  }
});

export default router;
