/**
 * Partner API contract + containment tests.
 *
 * This file runs in the BLOCKING tenant-scope CI job, not the general backend
 * suite (which runs with `|| true`). Two properties are enforced here and
 * nowhere else:
 *
 *   1. Responses contain exactly the documented key set — no more. The internal
 *      routes leak taxIdEncrypted / disciplinaryActions / noteEntries precisely
 *      because nothing asserted their shape.
 *   2. A key scoped to practice A cannot observe practice B, including by
 *      distinguishing "not found" from "not yours".
 *
 * If a schema column is added and silently starts appearing in a response, the
 * key-set assertions below fail. That is intended — update them deliberately.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import router from './partner-api.routes.js';
import { errorHandler } from '../middleware/error.middleware.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const PRACTICE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PRACTICE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const PROVIDER_KEYS = [
  'id', 'npi', 'firstName', 'lastName', 'middleName', 'suffix',
  'providerType', 'taxonomy', 'specialties', 'status', 'practiceId',
  'createdAt', 'updatedAt',
].sort();

const ENROLLMENT_KEYS = [
  'id', 'status', 'subjectType', 'providerId', 'practiceId', 'payer',
  'productTypes', 'applicationDate', 'effectiveDate', 'terminationDate',
  'providerNumber', 'groupNumber', 'createdAt', 'updatedAt',
].sort();

/**
 * A row as Prisma would hand it back if someone widened the select or added an
 * include — i.e. the shape the serializer has to defend against. Every field
 * after the allow-listed ones is something a partner must never receive.
 */
const DIRTY_PROVIDER = {
  id: 'prov-1', npi: '1234567890', firstName: 'Ada', lastName: 'Lovelace',
  middleName: null, suffix: null, providerType: 'MD', taxonomy: '207Q00000X',
  specialties: ['Family Medicine'], status: 'active', practiceId: PRACTICE_A,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'),

  ssnEncrypted: 'iv:tag:ciphertext',
  dateOfBirth: new Date('1815-12-10'),
  caqhUsername: 'ada.caqh',
  caqhPassword: 'hunter2',
  onboardingData: { notes: 'internal' },
  militaryServiceData: { branch: 'none' },
  deletedBy: 'user-9',
  deletionReason: 'duplicate',
  createdById: 'user-1',
  updatedById: 'user-2',
  practiceLocations: [{ id: 'loc-1', taxIdEncrypted: 'iv:tag:ein' }],
  disciplinaryActions: [{ id: 'da-1', category: 'criminal', narrative: 'sealed' }],
  malpracticeInsurances: [{ id: 'mi-1', policyNumber: 'POL-123' }],
  licenses: [{ id: 'lic-1', licenseNumber: 'A-99887' }],
};

const DIRTY_ENROLLMENT = {
  id: 'enr-1', status: 'submitted', subjectType: 'PROVIDER', providerId: 'prov-1',
  practiceId: PRACTICE_A, productTypes: ['medical'],
  applicationDate: new Date('2026-02-01'), effectiveDate: null, terminationDate: null,
  providerNumber: 'PN-1', groupNumber: null,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-02-01'),
  payer: { id: 'pay-1', name: 'Aetna', payerId: '60054' },

  notes: 'called the rep, they were unhelpful',
  payerEmail: 'rep@aetna.example',
  followUpEnabled: true,
  followUpEmail: 'staff@lanyardhealth.com',
  lastFollowUpSentAt: new Date('2026-02-10'),
  slaTargetDate: new Date('2026-03-01'),
  slaBreachedAt: new Date('2026-03-02'),
  confirmationNumber: 'CONF-777',
  notifiedStatuses: ['submitted'],
  isDraft: false,
  createdById: 'user-1',
  updatedById: 'user-2',
  noteEntries: [{ id: 'n-1', body: 'internal staff note', author: { firstName: 'Kay' } }],
};

/** Mounts the router behind a stub that mimics what authenticateApiKey attaches. */
function appScopedTo(practiceIds: string[]) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = {
      id: 'svc-user-1',
      cognitoId: 'apikey:test',
      email: 'apikey+test@lanyardhealth.com',
      role: 'practice_admin',
    };
    req.practiceScope = { isSuperAdmin: false, practiceIds };
    next();
  });
  app.use(router);
  app.use(errorHandler);
  return app;
}

/** Recursively collects every key name anywhere in the payload. */
function allKeys(value: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((v) => allKeys(v, acc));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

const FORBIDDEN_ANYWHERE = [
  'ssnEncrypted', 'dateOfBirth', 'taxIdEncrypted', 'licenseNumber',
  'caqhUsername', 'caqhPassword', 'onboardingData', 'militaryServiceData',
  'disciplinaryActions', 'malpracticeInsurances', 'practiceLocations', 'licenses',
  'policyNumber', 'narrative', 'deletedBy', 'deletionReason',
  'notes', 'noteEntries', 'payerEmail', 'followUpEmail', 'followUpEnabled',
  'lastFollowUpSentAt', 'slaTargetDate', 'slaBreachedAt', 'confirmationNumber',
  'notifiedStatuses', 'createdById', 'updatedById',
];

describe('partner API — response shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits exactly the documented provider fields, dropping everything else', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([DIRTY_PROVIDER] as never);
    prismaMock.providerProfile.count.mockResolvedValue(1);

    const res = await request(appScopedTo([PRACTICE_A])).get('/providers');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(PROVIDER_KEYS);
  });

  it('emits exactly the documented enrollment fields', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([DIRTY_ENROLLMENT] as never);
    prismaMock.enrollment.count.mockResolvedValue(1);

    const res = await request(appScopedTo([PRACTICE_A])).get('/enrollments');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(ENROLLMENT_KEYS);
    expect(Object.keys(res.body.data[0].payer).sort()).toEqual(['id', 'name', 'payerId']);
  });

  it('leaks no sensitive key at any depth of a provider response', async () => {
    prismaMock.providerProfile.findFirst.mockResolvedValue(DIRTY_PROVIDER as never);

    const res = await request(appScopedTo([PRACTICE_A])).get('/providers/prov-1');
    const keys = allKeys(res.body);

    for (const forbidden of FORBIDDEN_ANYWHERE) {
      expect(keys.has(forbidden), `leaked "${forbidden}"`).toBe(false);
    }
  });

  it('leaks no sensitive key at any depth of an enrollment response', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(DIRTY_ENROLLMENT as never);
    prismaMock.providerProfile.findFirst.mockResolvedValue({
      id: 'prov-1', practiceId: PRACTICE_A,
    } as never);

    const res = await request(appScopedTo([PRACTICE_A])).get('/enrollments/enr-1');
    const keys = allKeys(res.body);

    for (const forbidden of FORBIDDEN_ANYWHERE) {
      expect(keys.has(forbidden), `leaked "${forbidden}"`).toBe(false);
    }
  });

  it('never serialises a raw value the payer relation carries beyond the three allowed fields', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      { ...DIRTY_ENROLLMENT, payer: { id: 'pay-1', name: 'Aetna', payerId: '60054', notes: 'aka Aetna Better Health' } },
    ] as never);
    prismaMock.enrollment.count.mockResolvedValue(1);

    const res = await request(appScopedTo([PRACTICE_A])).get('/enrollments');
    expect(allKeys(res.body).has('notes')).toBe(false);
  });
});

describe('partner API — tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes the provider list to the key\'s practice', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([] as never);
    prismaMock.providerProfile.count.mockResolvedValue(0);

    await request(appScopedTo([PRACTICE_A])).get('/providers');

    const where = prismaMock.providerProfile.findMany.mock.calls[0]![0]!.where as Record<string, any>;
    expect(where['practiceId']).toEqual({ in: [PRACTICE_A] });
    expect(JSON.stringify(where)).not.toContain(PRACTICE_B);
  });

  it('scopes the enrollment list through both provider and practice ownership', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([] as never);
    prismaMock.enrollment.count.mockResolvedValue(0);

    await request(appScopedTo([PRACTICE_A])).get('/enrollments');

    const where = prismaMock.enrollment.findMany.mock.calls[0]![0]!.where as Record<string, any>;
    // Practice-level enrollments (providerId null) must not be silently dropped.
    expect(where['OR']).toEqual([
      { provider: { practiceId: { in: [PRACTICE_A] }, deletedAt: null } },
      { providerId: null, practiceId: { in: [PRACTICE_A] } },
    ]);
    expect(where['isDraft']).toBe(false);
    expect(JSON.stringify(where)).not.toContain(PRACTICE_B);
  });

  it('returns 404, not 403, for a provider in another practice', async () => {
    // Scope is folded into the lookup, so an out-of-scope id simply misses.
    prismaMock.providerProfile.findFirst.mockResolvedValue(null);

    const res = await request(appScopedTo([PRACTICE_A])).get('/providers/prov-in-b');

    expect(res.status).toBe(404);
    const where = prismaMock.providerProfile.findFirst.mock.calls[0]![0]!.where as Record<string, any>;
    expect(where['practiceId']).toEqual({ in: [PRACTICE_A] });
  });

  it('returns 404 for an enrollment that exists but belongs to another practice', async () => {
    // The row IS found — isolation here depends on the access check, and the
    // status code must not reveal that the row exists.
    prismaMock.enrollment.findUnique.mockResolvedValue({
      ...DIRTY_ENROLLMENT, providerId: null, practiceId: PRACTICE_B,
    } as never);

    const res = await request(appScopedTo([PRACTICE_A])).get('/enrollments/enr-in-b');

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(PRACTICE_B);
  });

  it('denies everything when the key resolves to no practice', async () => {
    prismaMock.providerProfile.findMany.mockResolvedValue([] as never);
    prismaMock.providerProfile.count.mockResolvedValue(0);

    await request(appScopedTo([])).get('/providers');

    // The deny-all sentinel, not an unfiltered query.
    const where = prismaMock.providerProfile.findMany.mock.calls[0]![0]!.where as Record<string, any>;
    expect(where['id']).toBe('__no_access__');
  });

  it('denies enrollments when the key resolves to no practice', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([] as never);
    prismaMock.enrollment.count.mockResolvedValue(0);

    await request(appScopedTo([])).get('/enrollments');

    const where = prismaMock.enrollment.findMany.mock.calls[0]![0]!.where as Record<string, any>;
    expect(where['id']).toBe('__no_access__');
  });
});

describe('partner API — pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.providerProfile.findMany.mockResolvedValue([] as never);
    prismaMock.providerProfile.count.mockResolvedValue(0);
  });

  it('caps pageSize so a partner cannot request an unbounded dump', async () => {
    const res = await request(appScopedTo([PRACTICE_A])).get('/providers?pageSize=100000');
    // paginationSchema maxes at 100; anything larger is a 400 rather than a
    // silently-honoured full-table read.
    expect(res.status).toBe(400);
    expect(prismaMock.providerProfile.findMany).not.toHaveBeenCalled();
  });

  it('applies skip/take from the page parameters', async () => {
    await request(appScopedTo([PRACTICE_A])).get('/providers?page=3&pageSize=25');

    const call = prismaMock.providerProfile.findMany.mock.calls[0]![0]!;
    expect(call.skip).toBe(50);
    expect(call.take).toBe(25);
  });
});
