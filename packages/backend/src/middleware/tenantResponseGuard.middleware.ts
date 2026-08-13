import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Last line of defence against cross-tenant leaks: inspects what is actually
 * about to be sent, and refuses to send a practice the caller is not scoped to.
 *
 * Every leak found so far has had the same shape. The route's WHERE clause is
 * correct — it selects the right *users*, or the right *documents* — and a
 * nested select underneath it has no filter, so each correctly-chosen row
 * arrives carrying rows the caller may not see. The access review report and
 * three handlers in user.routes.ts all failed this way, and the file-level CI
 * guardrail passed every one of them, because each file references
 * `req.practiceScope` prominently a few lines above the leak. It checks that
 * scoping was thought about, not that it was applied.
 *
 * Static analysis cannot close that gap: whether a nested select is scoped
 * depends on values known only at request time. So this checks the finished
 * payload instead. A handler written next year by someone who has never read
 * this file still cannot leak a practice id through it.
 *
 * Deliberately narrow: it knows about practice identity only. It is not a
 * general PII filter and must not be sold as one.
 */

/**
 * Routes that legitimately return a practice the caller is not yet scoped to,
 * with the reason. Anything not listed here fails. Keep this list short and
 * make every entry justify itself — an allowlist that grows without argument
 * is the guardrail quietly being switched off.
 */
const CROSS_TENANT_ALLOWED: { method: string; pattern: RegExp; why: string }[] = [
  {
    method: 'POST',
    pattern: /^\/api\/v1\/practices$/,
    why: 'Creating a practice returns it before the creator\'s scope has been recomputed.',
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/practice-signup/,
    why: 'Self-signup runs unauthenticated and returns the practice it just created.',
  },
];

/** Walk a payload and collect every practice identifier it carries. */
function collectPracticeIds(node: unknown, found: Set<string>, depth = 0): void {
  // ponytail: depth cap so a pathological payload cannot spin here. Nothing we
  // return nests anywhere near this deep; raise it if a real response does.
  if (depth > 12 || node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) collectPracticeIds(item, found, depth + 1);
    return;
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'practiceId' && typeof value === 'string') {
      found.add(value);
    } else if (key === 'practice' && value && typeof value === 'object') {
      const id = (value as { id?: unknown }).id;
      if (typeof id === 'string') found.add(id);
      collectPracticeIds(value, found, depth + 1);
    } else {
      collectPracticeIds(value, found, depth + 1);
    }
  }
}

/**
 * Blocking is the correct default: a 500 is a bad afternoon, a leak is a
 * reportable disclosure. `TENANT_GUARD_MODE=log` downgrades it to a warning,
 * for shaking out false positives against real traffic before it enforces.
 */
function isBlocking(): boolean {
  return process.env['TENANT_GUARD_MODE'] !== 'log';
}

export function tenantResponseGuard(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = function guardedJson(body: unknown) {
    const scope = req.practiceScope;

    // Unrestricted by design: the founder, and Lanyard staff who deliver
    // services across every practice. Unauthenticated responses have no scope
    // to check against.
    if (!req.user || !scope || scope.isSuperAdmin || req.user.role === 'lanyard_staff') {
      return originalJson(body);
    }

    const allowed = CROSS_TENANT_ALLOWED.find(
      (entry) => entry.method === req.method && entry.pattern.test(req.baseUrl + req.path)
    );
    if (allowed) return originalJson(body);

    const found = new Set<string>();
    collectPracticeIds(body, found);

    const permitted = new Set(scope.practiceIds);
    const foreign = [...found].filter((id) => !permitted.has(id));

    if (foreign.length) {
      // The ids themselves are logged: without them there is no way to work out
      // which tenant was exposed, and that is the first question asked.
      logger.error(
        `Cross-tenant leak blocked: ${req.method} ${req.baseUrl}${req.path} ` +
          `returned practice(s) [${foreign.join(', ')}] to user ${req.user.id} ` +
          `(role=${req.user.role}, scope=[${scope.practiceIds.join(', ')}])`
      );

      if (isBlocking()) {
        res.status(500);
        return originalJson({
          success: false,
          error: { message: 'Request blocked by tenant isolation check.' },
        });
      }
    }

    return originalJson(body);
  };

  next();
}
