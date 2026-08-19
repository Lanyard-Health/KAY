import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authLimiter, mfaLimiter } from '../middleware/rate-limit.js';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  getCognitoUserStatus,
  resendCognitoInvite,
  setCognitoUserPassword,
} from '../services/cognitoUser.service.js';
import {
  getMfaEnrollmentStatus,
  clearMfaStatusCache,
  allowedSkipsFor,
  enforcementCutoff,
} from '../services/mfaEnrollment.service.js';
import { emailService } from '../services/email.service.js';
import { renderProviderActionEmail } from '../services/email-templates.js';
import { prisma } from '../utils/prisma.js';
import { getRedisConnection } from '../utils/redis.js';
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

// ──────────────────────────────────────────────
// Self-service password reset
//
// Cognito's own ForgotPassword is unusable on the production pool: email is
// both the only recovery channel and an enabled MFA factor, and Cognito
// refuses to recover an account through an MFA medium (full history in the
// reissueTemporaryPassword docblock in cognitoUser.service.ts). So the backend
// owns the reset instead: issue a 6-digit code, prove email ownership, then
// set the password via the admin API. The password is only ever changed AFTER
// the code is verified — an anonymous request can't invalidate anyone's
// working password.
//
// Same enumeration rules as /resend-invite: unauthenticated by necessity, the
// response never varies with account existence, failures are swallowed and
// logged without the address.
// ──────────────────────────────────────────────

const RESET_CODE_TTL_SECONDS = 15 * 60;
const RESET_MAX_ATTEMPTS = 5;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
// Keys are keyed by a hash of the email so Redis never stores addresses in the clear.
const resetCodeKey = (email: string): string => `pwreset:code:${sha256(email)}`;
const resetAttemptsKey = (email: string): string => `pwreset:att:${sha256(email)}`;

const forgotPasswordSchema = z.object({
  email: z.string().email().max(320),
});

authRoutes.post('/forgot-password', async (req: Request, res: Response, _next: NextFunction) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'A valid email address is required' });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();

  try {
    const status = await getCognitoUserStatus(email);

    if (status === 'FORCE_CHANGE_PASSWORD') {
      // Never-activated account: it has no password to reset, so a code can't
      // help. Re-send the original invitation instead — the user gets an
      // actionable email either way, and nothing about the response reveals
      // which kind was sent.
      await resendCognitoInvite(email);
    } else if (status) {
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const redis = getRedisConnection();
      await redis.set(resetCodeKey(email), sha256(code), 'EX', RESET_CODE_TTL_SECONDS);
      await redis.del(resetAttemptsKey(email));

      const sent = await emailService.sendEmail({
        to: email,
        subject: 'Your Lanyard password reset code',
        html: renderProviderActionEmail({
          previewText: 'Use this code to reset your Lanyard password.',
          heading: 'Reset your password',
          // ponytail: no name lookup — this pre-auth route deliberately touches
          // no tenant data (tenant-scope guardrail), so the greeting is generic.
          firstName: 'there',
          paragraphs: [
            'Enter this code on the password reset screen to choose a new password. It expires in 15 minutes.',
            'If you did not request this, you can safely ignore this email — your password has not changed.',
          ],
          facts: [{ label: 'Your code', value: code }],
          factsTitle: 'Password reset code',
        }),
      });
      if (!sent.success) {
        logger.warn(`Password reset email not sent: ${sent.error ?? 'unknown error'}`);
      }
    }
  } catch (error) {
    logger.warn(
      `Password reset request failed: ${error instanceof Error ? error.name : 'unknown error'}`
    );
  }

  res.json({
    success: true,
    message: 'If an account exists for that email, a reset code is on its way.',
  });
});

const resetPasswordSchema = z.object({
  email: z.string().email().max(320),
  code: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(12).max(256),
});

// Error codes reuse Cognito's exception names so the frontend's existing
// mapCognitoError + code-clearing logic keep working unchanged.
authRoutes.post('/reset-password', async (req: Request, res: Response, _next: NextFunction) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: {
        code: 'InvalidParameterException',
        message: 'A valid email, 6-digit code, and password of at least 12 characters are required.',
      },
    });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();

  try {
    const redis = getRedisConnection();
    const storedHash = await redis.get(resetCodeKey(email));
    if (!storedHash) {
      res.status(400).json({
        success: false,
        error: {
          code: 'ExpiredCodeException',
          message: 'That code has expired or was never issued. Request a new one.',
        },
      });
      return;
    }

    const candidateHash = sha256(parsed.data.code);
    const matches =
      storedHash.length === candidateHash.length &&
      timingSafeEqual(Buffer.from(storedHash), Buffer.from(candidateHash));

    if (!matches) {
      const attempts = await redis.incr(resetAttemptsKey(email));
      await redis.expire(resetAttemptsKey(email), RESET_CODE_TTL_SECONDS);
      if (attempts >= RESET_MAX_ATTEMPTS) {
        await redis.del(resetCodeKey(email));
      }
      res.status(400).json({
        success: false,
        error: {
          code: 'CodeMismatchException',
          message: 'That code is not right. Check the email and try again.',
        },
      });
      return;
    }

    // Order matters: set the password first, clear the code after. If Cognito
    // fails here the code survives and the user can simply retry.
    await setCognitoUserPassword(email, parsed.data.newPassword, true);
    await redis.del(resetCodeKey(email), resetAttemptsKey(email));

    res.json({ success: true, message: 'Password updated. You can now sign in.' });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'InvalidPasswordException') {
      res.status(400).json({
        success: false,
        error: {
          code: 'InvalidPasswordException',
          message:
            'That password does not meet the requirements. Use at least 12 characters with upper and lower case letters, a number, and a symbol.',
        },
      });
      return;
    }
    logger.error(`Password reset completion failed: ${name || 'unknown error'}`);
    res.status(500).json({
      success: false,
      error: { code: 'InternalError', message: 'Something went wrong. Please try again.' },
    });
  }
});
export const mfaRoutes = Router();
mfaRoutes.use(mfaLimiter());

/* ------------------------- second-factor enrollment ------------------------ */

/**
 * A separate router, mounted at /api/v1/auth/mfa, so it does NOT inherit
 * `authLimiter` (5 requests / 15 min). Status is read on every sign-in and on
 * every reload of the setup screen; under the login limiter, ordinary use
 * returns 429 and strands the user on a screen that cannot load. Observed
 * locally before this split.
 *
 * Still under the /auth prefix on purpose: the enrollment gate allowlists it,
 * so these stay reachable by exactly the users the gate is walling off.
 *
 * Enrollment itself is NOT here. It happens in the browser through Amplify
 * against the user's own session (setUpTOTP, verifyTOTPSetup,
 * updateMFAPreference, associateWebAuthnCredential). Proxying that through the
 * backend would mean handling the user's TOTP secret server-side for no gain.
 */

/**
 * GET /api/v1/auth/mfa/status
 *
 * What the enrollment screen reads to decide whether to show itself, and
 * whether a "not right now" is still on offer.
 */
mfaRoutes.get(
  '/status',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const account = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { createdAt: true, mfaSkipsUsed: true, mfaEnrolledAt: true },
      });
      if (!account) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      const token = req.headers.authorization?.split(' ')[1];
      const status = await getMfaEnrollmentStatus(req.user!.cognitoId, req.user!.email, token);
      const skipsAllowed = allowedSkipsFor(account.createdAt, enforcementCutoff());
      const skipsRemaining = Math.max(0, skipsAllowed - account.mfaSkipsUsed);

      res.json({
        success: true,
        data: {
          enrolled: status.enrolled,
          methods: status.methods,
          skipsRemaining,
          // False means the setup screen must not offer a way out.
          canSkip: !status.enrolled && skipsRemaining > 0,
          enrolledAt: account.mfaEnrolledAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/auth/mfa/skip
 *
 * Spends one "not right now". Refuses once they run out, so a client that
 * ignores `canSkip` still cannot buy itself extra passes.
 */
mfaRoutes.post(
  '/skip',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const account = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { createdAt: true, mfaSkipsUsed: true },
      });
      if (!account) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      const skipsAllowed = allowedSkipsFor(account.createdAt, enforcementCutoff());
      if (account.mfaSkipsUsed >= skipsAllowed) {
        res.status(403).json({
          success: false,
          code: 'MFA_ENROLLMENT_REQUIRED',
          message: 'Set up a second sign-in step to continue.',
        });
        return;
      }

      const updated = await prisma.user.update({
        where: { id: req.user!.id },
        data: { mfaSkipsUsed: { increment: 1 } },
        select: { mfaSkipsUsed: true },
      });

      res.json({
        success: true,
        data: { skipsRemaining: Math.max(0, skipsAllowed - updated.mfaSkipsUsed) },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/auth/mfa/enrolled
 *
 * Called by the browser once Amplify reports a factor was registered. It only
 * drops the cached status and stamps a timestamp for reporting — the claim is
 * re-verified against Cognito before anything is written, so a client calling
 * this without actually enrolling gets a 400 and no state change.
 */
mfaRoutes.post(
  '/enrolled',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      clearMfaStatusCache(req.user!.cognitoId);

      const token = req.headers.authorization?.split(' ')[1];
      const status = await getMfaEnrollmentStatus(req.user!.cognitoId, req.user!.email, token);
      if (!status.enrolled) {
        res.status(400).json({
          success: false,
          message: 'No second factor is registered on this account yet.',
        });
        return;
      }

      await prisma.user.update({
        where: { id: req.user!.id },
        data: { mfaEnrolledAt: new Date() },
      });

      res.json({ success: true, data: { methods: status.methods } });
    } catch (error) {
      next(error);
    }
  },
);
