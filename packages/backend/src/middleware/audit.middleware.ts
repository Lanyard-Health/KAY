import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import type { AuditAction } from '@prisma/client';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        cognitoId: string;
        email: string;
        role: string;
        providerId?: string;
      };
      practiceScope?: {
        isSuperAdmin: boolean;
        practiceIds: string[];
      };
      auditContext?: {
        resourceType: string;
        resourceId?: string;
        action: AuditAction;
        changes?: Record<string, unknown>;
      };
    }
  }
}

// Map HTTP methods to audit actions
const methodToAction: Record<string, AuditAction> = {
  GET: 'read',
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

// Routes that should not be audited
const excludedPaths = [
  '/health',
  '/api/health',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
];

// GET requests on these path prefixes are sensitive PII reads (provider
// records, enrollment data, document downloads). SOC 2 + breach forensics
// require a record of who-read-what-when, so we audit GETs here in addition
// to the usual write-operation logging.
const SENSITIVE_READ_PATHS = [
  '/api/v1/providers',
  '/api/v1/enrollments',
  '/api/v1/documents',
  // Partner API keys read provider + enrollment data non-interactively. Without
  // this prefix none of that traffic is audited at all, since it matches none
  // of the above. Rows are attributed to the key's service-account user.
  '/api/v1/partner',
];

export function isSensitiveRead(method: string, path: string): boolean {
  if (method !== 'GET') return false;
  return SENSITIVE_READ_PATHS.some((prefix) => path.startsWith(prefix));
}

export async function auditMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip excluded paths
  if (excludedPaths.some(path => req.path.startsWith(path))) {
    next();
    return;
  }

  // Store original end function
  const originalEnd = res.end;
  const startTime = Date.now();

  // Override end to capture response
  res.end = function(this: Response, ...args: Parameters<Response['end']>): Response {
    const responseTime = Date.now() - startTime;

    // Use originalUrl, NOT req.path. Express rewrites req.url (and therefore
    // req.path) to be relative to the mounted router while the request is being
    // handled — and this runs inside that window, so req.path here is
    // "/providers", never "/api/v1/providers". That silently broke both checks
    // below: SENSITIVE_READ_PATHS matched nothing (no GET was ever audited) and
    // extractResourceType found no "v1" segment (writes logged as "unknown").
    // originalUrl is never rewritten. Query string is stripped so it cannot
    // reach a path segment or be mistaken for a resource id.
    const auditPath = (req.originalUrl || req.url).split('?')[0] ?? '';

    // Audit (a) successful write operations and (b) successful sensitive
    // reads on PII routes. Reads are required for SOC 2 + breach forensics
    // even though they don't mutate state.
    const isWrite = req.method !== 'GET';
    const auditableRead = isSensitiveRead(req.method, auditPath);
    if ((isWrite || auditableRead) && res.statusCode < 400) {
      // Prefer the explicit audit context set by route handlers (it knows the
      // true resource + old→new values); fall back to path parsing.
      const action = req.auditContext?.action ?? (methodToAction[req.method] || 'read');
      const resourceType = req.auditContext?.resourceType ?? extractResourceType(auditPath);
      const resourceId = req.auditContext?.resourceId ?? extractResourceId(auditPath);

      // Fire and forget - don't block response
      createAuditLog({
        userId: req.user?.id,
        action,
        resourceType,
        resourceId,
        changes: req.auditContext?.changes,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
      }).catch(err => {
        logger.error('Failed to create audit log', err);
      });
    }

    logger.debug(`${req.method} ${req.path} - ${res.statusCode} - ${responseTime}ms`);

    return originalEnd.apply(this, args);
  } as Response['end'];

  next();
}

function extractResourceType(path: string): string {
  // Extract resource type from path like /api/v1/providers/123
  const parts = path.split('/').filter(Boolean);
  const apiIndex = parts.findIndex(p => p === 'v1');

  if (apiIndex >= 0 && parts[apiIndex + 1]) {
    return parts[apiIndex + 1] ?? 'unknown';
  }

  return 'unknown';
}

function extractResourceId(path: string): string | undefined {
  // Extract UUID from path
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = path.match(uuidRegex);
  return match?.[0];
}

// Keys whose values must NEVER appear in audit logs (PII / sensitive data)
const SENSITIVE_KEYS = new Set([
  'ssn', 'socialSecurityNumber', 'social_security_number',
  'taxId', 'tax_id', 'taxIdentificationNumber', 'ein',
  'bankAccountNumber', 'bank_account_number', 'accountNumber', 'account_number',
  'routingNumber', 'routing_number',
  'password', 'passwordHash', 'password_hash', 'newPassword', 'oldPassword',
  'secret', 'token', 'accessToken', 'refreshToken',
  'encryptionKey', 'apiKey', 'api_key',
  'creditCard', 'cardNumber', 'card_number', 'cvv', 'cvc',
]);

// Regex patterns to redact values that look like PII regardless of key name
const PII_VALUE_PATTERNS = [
  /^\d{3}-\d{2}-\d{4}$/, // SSN format
  /^\d{9}$/,              // SSN without dashes or tax ID
  /^\d{2}-\d{7}$/,        // EIN format
];

function sanitizeAuditChanges(
  changes: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!changes) return undefined;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    const lowerKey = key.toLowerCase();

    // Redact by key name
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(lowerKey)) {
      // eslint-disable-next-line security/detect-object-injection
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Redact string values matching PII patterns
    if (typeof value === 'string' && PII_VALUE_PATTERNS.some((p) => p.test(value))) {
      // eslint-disable-next-line security/detect-object-injection
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Recursively sanitize nested objects
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // eslint-disable-next-line security/detect-object-injection
      sanitized[key] = sanitizeAuditChanges(value as Record<string, unknown>);
    } else {
      // eslint-disable-next-line security/detect-object-injection
      sanitized[key] = value;
    }
  }
  return sanitized;
}

async function createAuditLog(data: {
  userId?: string;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: data.userId,
      action: data.action,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      changes: (sanitizeAuditChanges(data.changes) as any) ?? undefined,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    },
  });
}

// Helper to set audit context for specific operations
export function setAuditContext(
  req: Request,
  context: Partial<Request['auditContext']>
): void {
  req.auditContext = {
    ...req.auditContext,
    ...context,
  } as Request['auditContext'];
}

// Single resourceType for every "staff member viewed an unmasked sensitive
// field" event, so the full PII-access trail is one query:
//   SELECT * FROM audit_logs WHERE resource_type = 'sensitive_field_reveal'
export const SENSITIVE_REVEAL_RESOURCE = 'sensitive_field_reveal';

/**
 * Record that a user revealed (decrypted to plaintext) a sensitive field —
 * SSN, DEA number, CDS number, etc. SOC 2 (and breach forensics) require an
 * access trail for *reads* of regulated PII, not just edits, and masking alone
 * leaves no record of who looked at the real value.
 *
 * This AWAITS the write and re-throws on failure. Callers MUST treat a thrown
 * error as a hard stop and NOT return the decrypted value — no audit record,
 * no disclosure (fail-closed).
 *
 * We deliberately reuse action `read` + a distinctive resourceType instead of
 * adding a new AuditAction enum value: adding an enum value would require an
 * `ALTER TYPE` migration against the production audit table (and a coordinated
 * client redeploy), which is unnecessary risk for what is semantically a read.
 *
 * NEVER pass the revealed value itself — only the field name and identifiers.
 */
export async function logSensitiveFieldReveal(
  req: Request,
  opts: { field: string; providerId?: string; recordId?: string }
): Promise<void> {
  await createAuditLog({
    userId: req.user?.id,
    action: 'read',
    resourceType: SENSITIVE_REVEAL_RESOURCE,
    resourceId: opts.providerId ?? opts.recordId,
    changes: {
      revealed: opts.field,
      ...(opts.providerId ? { providerId: opts.providerId } : {}),
      ...(opts.recordId ? { recordId: opts.recordId } : {}),
    },
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.get('user-agent'),
  });
}
