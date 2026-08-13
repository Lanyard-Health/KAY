/**
 * Refuses the API to a signed-in user who has no second sign-in factor and has
 * used up their grace skips.
 *
 * This exists because a redirect in the SPA is not a security control. Someone
 * holding a stolen password gets a real access token from Cognito; they can
 * call the API directly and never load our JavaScript. If enforcement lives
 * only in the frontend, it stops honest users and nobody else. So the check
 * runs on every authenticated request, and the frontend's redirect is only the
 * polite version of the same rule.
 *
 * Called from `authenticate`, not mounted with `app.use`. An app-level
 * middleware runs before any route's own `authenticate`, so req.user is still
 * undefined when it looks — it would wave every request through. That was the
 * first cut of this file and it enforced nothing; the local drive-through
 * caught it (skips exhausted, /providers still 200).
 *
 * Enrollment status is verified against Cognito, never taken from our own
 * database or from the client. See mfaEnrollment.service.
 */
import type { Request, Response } from 'express';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import {
  getMfaEnrollmentStatus,
  allowedSkipsFor,
  enforcementCutoff,
} from '../services/mfaEnrollment.service.js';

/**
 * Paths that stay reachable without a factor, or the flow could never complete.
 *
 * Deliberately narrow, and every entry earns its place:
 *   /auth/      logout plus the enrollment endpoints themselves.
 *   /users/me   the caller's own profile. Without it the app cannot finish
 *               signing in — it has no name or email to render, so the user is
 *               bounced to a setup screen that does not know who they are.
 *               Self-only data, so it grants nothing a password already didn't.
 *
 * `/notifications`, `/dashboard` and the rest are NOT here: a walled user has
 * no business reading practice data of any kind.
 */
const ALWAYS_ALLOWED = [
  '/api/v1/auth/',
  '/api/v1/users/me',
  '/api/health',
  '/health',
];

/**
 * `originalUrl` first because routers rewrite `req.path` to be router-relative,
 * which would stop the prefixes above ever matching. The fallbacks are not
 * decoration: this runs inside `authenticate`, so an undefined field here
 * throws on every authenticated request in the app.
 */
function requestPath(req: Request): string {
  return req.originalUrl || req.url || req.path || '';
}

function isAllowed(path: string): boolean {
  return ALWAYS_ALLOWED.some((prefix) => path.startsWith(prefix));
}

/**
 * @returns true when the request was refused and a 403 already sent, so the
 *   caller must stop. False means carry on.
 */
export async function mfaEnrollmentBlocked(req: Request, res: Response): Promise<boolean> {
  if (!req.user || isAllowed(requestPath(req))) return false;

  try {
    const account = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { createdAt: true, mfaSkipsUsed: true },
    });
    if (!account) return false;

    const allowed = allowedSkipsFor(account.createdAt, enforcementCutoff());
    if (account.mfaSkipsUsed < allowed) return false;

    const token = req.headers.authorization?.split(' ')[1];
    const status = await getMfaEnrollmentStatus(req.user.cognitoId, req.user.email, token);
    if (status.enrolled) return false;

    res.status(403).json({
      success: false,
      code: 'MFA_ENROLLMENT_REQUIRED',
      message: 'Set up a second sign-in step to continue.',
    });
    return true;
  } catch (error) {
    // Fail OPEN, loudly.
    //
    // The alternative locks every customer out of the product whenever Cognito
    // is slow or a credential rotates — turning a availability blip into a
    // total outage, to defend against an attacker who by this point already
    // holds a valid password AND a valid access token. Wrong trade. The error
    // is logged so a silent failure can't quietly disable the gate for good.
    logger.error('MFA enrollment gate could not verify status, allowing request:', error);
    return false;
  }
}
