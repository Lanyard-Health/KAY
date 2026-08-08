/**
 * Partner API key authentication.
 *
 * Authenticates the read-only `/api/v1/partner` surface. This is a SEPARATE
 * entry point from authenticate() in auth.middleware.ts, and it must stay that
 * way: a `lyd_` token sent to any other route reaches the Cognito verifier,
 * fails to parse as a JWT, and 401s. That is the only thing keeping a partner
 * key out of the other ~55 routers — there is no allow-list to maintain.
 *
 * DO NOT merge this into authenticate(). See apiKey.middleware.test.ts, which
 * asserts auth.middleware.ts contains no reference to api keys.
 *
 * The caller is a real service-account User row (see scripts/mint-api-key.ts).
 * That is deliberate: AuditLog.userId is a real FK, and the audit write is
 * fire-and-forget — a synthetic id would fail the FK and silently leave partner
 * reads with no audit trail at all.
 */
import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'node:crypto';

import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { UnauthorizedError, ForbiddenError } from './error.middleware.js';
import { setAuditContext } from './audit.middleware.js';

/** Every partner key carries this prefix. Also the gitleaks detection anchor. */
export const API_KEY_PREFIX = 'lyd_live_';

/** Same one-way scheme as practiceInvitation.service.ts — the plaintext is never recoverable. */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export async function authenticateApiKey(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Read-only by construction, not by convention. If a write route ever gets
    // mounted under /api/v1/partner by mistake, a key still cannot reach it.
    if (req.method !== 'GET') {
      next(new ForbiddenError('The partner API is read-only'));
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      next(new UnauthorizedError('No API key provided'));
      return;
    }

    const raw = authHeader.slice('Bearer '.length).trim();
    if (!raw.startsWith(API_KEY_PREFIX)) {
      next(new UnauthorizedError('Invalid API key'));
      return;
    }

    // Indexed equality on a hash of the secret — not a comparison against the
    // secret, so timingSafeEqual is not applicable here. Do not "optimize" this
    // into a prefix lookup followed by a compare; that reintroduces a timing
    // oracle. Do not add a cache either: revocation must take effect instantly.
    const key = await prisma.apiKey.findFirst({
      where: {
        tokenHash: hashApiKey(raw),
        revokedAt: null,
        expiresAt: { gt: new Date() },
        // Offboarding a practice must offboard its partner access with it.
        practice: { deletedAt: null, status: 'ACTIVE' },
        // A key must not outlive the human who authorized it. The JWT path
        // applies the same rule to users (auth.middleware.ts).
        user: { isActive: true },
      },
      select: {
        id: true,
        practiceId: true,
        user: { select: { id: true, cognitoId: true, email: true, role: true } },
      },
    });

    // One generic message for every failure mode above — no oracle telling a
    // caller whether a key exists, is expired, or belongs to a dead practice.
    if (!key) {
      next(new UnauthorizedError('Invalid API key'));
      return;
    }

    req.user = {
      id: key.user.id,
      cognitoId: key.user.cognitoId,
      email: key.user.email,
      role: key.user.role,
      providerId: undefined,
    };

    // Set BEFORE any downstream call. initPracticeScope() early-returns when
    // req.practiceScope is already populated, so this assignment is
    // authoritative for the rest of the request and can never be widened by a
    // role-derived recomputation.
    req.practiceScope = { isSuperAdmin: false, practiceIds: [key.practiceId] };

    // Key name must be exactly `apiKeyId`: sanitizeAuditChanges redacts the
    // keys `apiKey` and `api_key` to [REDACTED].
    setAuditContext(req, { changes: { apiKeyId: key.id } });

    next();
  } catch (error) {
    // Fail closed. A DB error must not distinguish itself from a bad key.
    logger.error('API key authentication failed', { error });
    next(new UnauthorizedError('Invalid API key'));
  }
}
