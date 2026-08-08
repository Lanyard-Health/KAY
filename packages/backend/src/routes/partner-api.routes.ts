/**
 * Partner read API — the only customer-facing surface.
 *
 * GET /api/v1/partner/providers
 * GET /api/v1/partner/providers/:id
 * GET /api/v1/partner/enrollments
 * GET /api/v1/partner/enrollments/:id
 *
 * Auth is authenticateApiKey (mounted in index.ts), NOT authenticate(). Callers
 * are partner integrations holding a practice-scoped key, never browser users.
 *
 * ── Why this file exists at all ──────────────────────────────────────────────
 * The internal routes cannot be exposed as-is. provider.routes.ts returns a raw
 * Prisma dump filtered by stripSensitiveFields(), a three-field DENY-list — so
 * it currently ships practiceLocations[].taxIdEncrypted, whole
 * disciplinaryActions[] rows, and malpracticeInsurances[].policyNumber.
 * enrollment.routes.ts returns internal staff noteEntries[]. A deny-list fails
 * OPEN the day someone adds a column; every shape below is an ALLOW-list built
 * from explicit object literals, so it fails CLOSED.
 *
 * Rules for anyone editing this file:
 *   1. Never `return { ...row }`. Name every field. A spread is how leaks ship.
 *   2. Never add an `include`/`select` of a relation without adding it to the
 *      serializer by hand — and think about what that relation's columns hold.
 *   3. Out-of-scope resources return 404, never 403: a 403 confirms the row
 *      exists, which is itself a cross-tenant disclosure.
 *   4. New fields are a contract change. Partners build against this shape.
 *
 * partner-api.routes.test.ts asserts the exact key set of every response and
 * runs in the BLOCKING tenant-scope CI job. If you add a field, that test fails
 * until you have deliberately updated it. That is the point.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';

import { prisma } from '../utils/prisma.js';
import { paginationSchema } from '../utils/queryValidation.js';
import {
  getPracticeProviderFilter,
  validateEnrollmentAccess,
} from '../middleware/practiceScope.middleware.js';
import { NotFoundError } from '../middleware/error.middleware.js';

const router = Router();

// ── Serializers ──────────────────────────────────────────────────────────────
// Explicit allow-lists. See rule 1 above.

type ProviderRow = {
  id: string;
  npi: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  suffix: string | null;
  providerType: string;
  taxonomy: string | null;
  specialties: string[];
  status: string;
  practiceId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * NPI is public data (NPPES). Everything omitted here is not: dateOfBirth and
 * ssnEncrypted are breach-notification-grade PII, licenseNumber and DEA/CDS
 * numbers are identity-theft grade, caqh* are portal credentials, and
 * disciplinaryActions carry criminal and board-action narrative.
 */
function partnerProvider(p: ProviderRow) {
  return {
    id: p.id,
    npi: p.npi,
    firstName: p.firstName,
    lastName: p.lastName,
    middleName: p.middleName,
    suffix: p.suffix,
    providerType: p.providerType,
    taxonomy: p.taxonomy,
    specialties: p.specialties,
    status: p.status,
    practiceId: p.practiceId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

const providerSelect = {
  id: true,
  npi: true,
  firstName: true,
  lastName: true,
  middleName: true,
  suffix: true,
  providerType: true,
  taxonomy: true,
  specialties: true,
  status: true,
  practiceId: true,
  createdAt: true,
  updatedAt: true,
} as const;

type EnrollmentRow = {
  id: string;
  status: string;
  subjectType: string;
  providerId: string | null;
  practiceId: string | null;
  productTypes: string[];
  applicationDate: Date | null;
  effectiveDate: Date | null;
  terminationDate: Date | null;
  providerNumber: string | null;
  groupNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
  payer: { id: string; name: string; payerId: string } | null;
};

/**
 * Omits the operational interior of an enrollment: `notes` and `noteEntries`
 * (internal staff commentary, with author names), payerEmail/followUp* (our
 * outreach mechanics), sla* (our internal targets), confirmationNumber, and
 * createdById/updatedById. The payer relation is flattened to three fields —
 * a full Payer row carries `notes`, which holds Stedi import aliases.
 */
function partnerEnrollment(e: EnrollmentRow) {
  return {
    id: e.id,
    status: e.status,
    subjectType: e.subjectType,
    providerId: e.providerId,
    practiceId: e.practiceId,
    payer: e.payer ? { id: e.payer.id, name: e.payer.name, payerId: e.payer.payerId } : null,
    productTypes: e.productTypes,
    applicationDate: e.applicationDate,
    effectiveDate: e.effectiveDate,
    terminationDate: e.terminationDate,
    providerNumber: e.providerNumber,
    groupNumber: e.groupNumber,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

const enrollmentSelect = {
  id: true,
  status: true,
  subjectType: true,
  providerId: true,
  practiceId: true,
  productTypes: true,
  applicationDate: true,
  effectiveDate: true,
  terminationDate: true,
  providerNumber: true,
  groupNumber: true,
  createdAt: true,
  updatedAt: true,
  payer: { select: { id: true, name: true, payerId: true } },
} as const;

/**
 * Enrollments have dual ownership — a PROVIDER enrollment is scoped through its
 * provider's practice, a PRACTICE enrollment through practiceId directly.
 * Mirrors enrollmentScopeFilter in enrollment.routes.ts; scoping only through
 * the provider relation would silently hide every practice-level enrollment.
 */
function partnerEnrollmentScope(req: Request): Record<string, unknown> {
  const ids = req.practiceScope?.practiceIds ?? [];
  if (ids.length === 0) return { id: '__no_access__' }; // matches nothing
  return {
    OR: [
      { provider: { practiceId: { in: ids }, deletedAt: null } },
      { providerId: null, practiceId: { in: ids } },
    ],
  };
}

function paged<T>(items: T[], total: number, page: number, pageSize: number) {
  return { success: true, data: items, page, pageSize, total };
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.get('/providers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize } = paginationSchema.parse(req.query);

    const where = getPracticeProviderFilter(req);
    const [rows, total] = await Promise.all([
      prisma.providerProfile.findMany({
        where,
        select: providerSelect,
        orderBy: { lastName: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.providerProfile.count({ where }),
    ]);

    res.json(paged(rows.map((r) => partnerProvider(r as ProviderRow)), total, page, pageSize));
  } catch (error) {
    next(error);
  }
});

router.get('/providers/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Scope is part of the lookup, not a check afterwards — an out-of-scope id
    // is indistinguishable from a nonexistent one.
    const row = await prisma.providerProfile.findFirst({
      where: { id: req.params['id']!, ...getPracticeProviderFilter(req) },
      select: providerSelect,
    });
    if (!row) throw new NotFoundError('Provider not found');

    res.json({ success: true, data: partnerProvider(row as ProviderRow) });
  } catch (error) {
    next(error);
  }
});

router.get('/enrollments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize } = paginationSchema.parse(req.query);

    // Drafts are auto-created placeholders from Practice.targetPayerIds, not
    // real enrollments. They would read as phantom in-flight work to a partner.
    const where = { ...partnerEnrollmentScope(req), isDraft: false };

    const [rows, total] = await Promise.all([
      prisma.enrollment.findMany({
        where,
        select: enrollmentSelect,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.enrollment.count({ where }),
    ]);

    res.json(paged(rows.map((r) => partnerEnrollment(r as EnrollmentRow)), total, page, pageSize));
  } catch (error) {
    next(error);
  }
});

router.get('/enrollments/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await prisma.enrollment.findUnique({
      where: { id: req.params['id']! },
      select: enrollmentSelect,
    });
    // Same 404 for "no such row" and "not yours" — see rule 3.
    if (!row) throw new NotFoundError('Enrollment not found');

    const allowed = await validateEnrollmentAccess(req, {
      providerId: row.providerId,
      practiceId: row.practiceId,
    });
    if (!allowed) throw new NotFoundError('Enrollment not found');

    res.json({ success: true, data: partnerEnrollment(row as EnrollmentRow) });
  } catch (error) {
    next(error);
  }
});

export default router;
