import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authLimiter } from '../middleware/rate-limit.js';
import { resendCognitoInvite } from '../services/cognitoUser.service.js';
import { logger } from '../utils/logger.js';

export const authRoutes = Router();
authRoutes.use(authLimiter());

// POST /api/v1/auth/login - Handled by Cognito hosted UI or API
authRoutes.post('/login', async (_req: Request, res: Response, _next: NextFunction) => {
  // Authentication is handled by AWS Cognito
  // This endpoint can be used for custom login flows if needed
  res.json({
    success: true,
    message: 'Use Cognito hosted UI or SDK for authentication',
  });
});

// POST /api/v1/auth/refresh - Refresh access token
authRoutes.post('/refresh', async (_req: Request, res: Response, _next: NextFunction) => {
  // Token refresh is handled by Cognito SDK on the frontend
  res.json({
    success: true,
    message: 'Use Cognito SDK for token refresh',
  });
});

// POST /api/v1/auth/logout
authRoutes.post('/logout', async (_req: Request, res: Response, _next: NextFunction) => {
  // Logout is handled by Cognito - invalidate tokens on client
  res.json({ success: true, message: 'Logged out successfully' });
});

const resendInviteSchema = z.object({
  email: z.string().email().max(320),
});

/**
 * POST /api/v1/auth/resend-invite
 *
 * Recovery path for an account that was invited but never completed setup.
 * Such a user cannot use "forgot password" at all — Cognito refuses to reset a
 * password that was never set — which left them with no self-service route in.
 *
 * Unauthenticated by necessity: the caller cannot sign in, which is the whole
 * problem. Two consequences are handled deliberately.
 *
 * 1. **The response never varies.** Unknown address, already-active account,
 *    invite re-sent — all return the same body. Anything else would let an
 *    anonymous caller test which email addresses hold accounts.
 * 2. **Failures are swallowed.** A Cognito outage must not become a signal
 *    either. It is logged for us and reported as success to the caller.
 *
 * Rate limiting comes from `authLimiter()` mounted on this router.
 */
authRoutes.post('/resend-invite', async (req: Request, res: Response, _next: NextFunction) => {
  const parsed = resendInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'A valid email address is required' });
    return;
  }

  try {
    await resendCognitoInvite(parsed.data.email);
  } catch (error) {
    logger.warn(
      `Invite resend failed: ${error instanceof Error ? error.name : 'unknown error'}`
    );
  }

  res.json({
    success: true,
    message:
      'If that address has an invitation waiting, we have sent it again. Check your inbox and spam folder.',
  });
});
