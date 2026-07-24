/**
 * CAQH credential-request routes.
 *
 * Staff endpoint (authenticated) creates/rotates a request and emails the
 * provider. The two public endpoints have NO auth — the emailed token is the
 * credential, mirroring practiceInvitations.routes.ts — and are rate-limited.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize, requireProviderAccess } from '../middleware/auth.middleware.js';
import { requirePracticeProvider } from '../middleware/practiceScope.middleware.js';
import { lookupLimiter, signupLimiter } from '../middleware/rate-limit.js';
import {
  createCredentialRequest,
  getRequestByToken,
  completeCredentialRequest,
} from '../services/caqh-credential-request.service.js';

export const caqhCredentialRequestRoutes = Router();

// POST /api/v1/caqh/credential-requests/:providerId - staff: send (or re-send) the email
caqhCredentialRequestRoutes.post(
  '/credential-requests/:providerId',
  authenticate,
  authorize('admin', 'credentialing_staff'),
  requireProviderAccess,
  requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await createCredentialRequest(req.params['providerId']!, req.user?.id ?? null);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      if (error instanceof Error) {
        const map: Record<string, { code: number; message: string }> = {
          PROVIDER_NOT_FOUND: { code: 404, message: 'Provider does not exist' },
          NO_EMAIL: { code: 400, message: 'This provider has no email on file. Add one to their profile first.' },
          NO_CREDENTIALS: { code: 400, message: 'No CAQH username is saved for this provider yet. Save credentials first.' },
          EMAIL_SEND_FAILED: { code: 502, message: 'The email could not be sent. Try again in a minute.' },
        };
        const known = map[error.message];
        if (known) {
          res.status(known.code).json({ success: false, error: { message: known.message, code: error.message } });
          return;
        }
      }
      next(error);
    }
  }
);

// Public: GET /api/v1/caqh/credential-requests/token/:token - render data for the update form
caqhCredentialRequestRoutes.get(
  '/credential-requests/token/:token',
  lookupLimiter(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const request = await getRequestByToken(req.params['token']!);
      if (!request || request.status !== 'pending') {
        res.status(410).json({
          success: false,
          error: { code: 'LINK_INVALID', message: 'This link has expired or was already used. Ask your Lanyard contact to send a fresh one.' },
        });
        return;
      }
      res.json({ success: true, data: { firstName: request.firstName, usernameOnFile: request.usernameOnFile } });
    } catch (error) {
      next(error);
    }
  }
);

const completeSchema = z.object({
  token: z.string().min(32).max(128),
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

// Public: POST /api/v1/caqh/credential-requests/complete - provider submits corrected login
caqhCredentialRequestRoutes.post(
  '/credential-requests/complete',
  signupLimiter(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = completeSchema.parse(req.body);
      await completeCredentialRequest(body.token, body.username.trim(), body.password);
      res.json({ success: true });
    } catch (error) {
      if (error instanceof Error && ['NOT_FOUND', 'ALREADY_USED', 'REVOKED', 'EXPIRED'].includes(error.message)) {
        res.status(410).json({
          success: false,
          error: { code: 'LINK_INVALID', message: 'This link has expired or was already used. Ask your Lanyard contact to send a fresh one.' },
        });
        return;
      }
      next(error);
    }
  }
);
