import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers/test-app.js';
import { adminUser } from './helpers/fixtures.js';

// Mock prisma for service-level and route-level tests
vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../src/middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../src/middleware/practiceScope.middleware.js', () => ({
  requirePracticeProvider: vi.fn((_req: any, _res: any, next: any) => next()),
  attachPracticeScope: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock aetna auth
vi.mock('../src/services/aetna.auth.js', () => ({
  aetnaAuth: {
    isConfigured: vi.fn().mockReturnValue(true),
    getAccessToken: vi.fn().mockResolvedValue('mock-token'),
    getBaseUrl: vi.fn().mockReturnValue('https://mock-fhir.example.com'),
  },
}));

// Get the prismaMock for assertions
const { prismaMock } = await import('./helpers/mock-prisma.js');
const { aetnaAuth } = await import('../src/services/aetna.auth.js') as any;

// ==========================================
// Test fixtures
// ==========================================

const PROVIDER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PAYER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const testProvider = {
  id: PROVIDER_ID,
  npi: '1234567890',
  firstName: 'Jane',
  lastName: 'Doe',
  middleName: null,
  suffix: null,
  dateOfBirth: new Date('1985-06-15'),
  gender: 'female',
  email: 'jane.doe@example.com',
  phone: '(555) 123-4567',
  mobilePhone: null,
  fax: null,
  providerType: 'psychiatrist',
  taxonomy: null,
  specialties: ['Psychiatry'],
  languages: [],
  status: 'active',
  caqhProviderId: null,
  caqhUsername: null,
  caqhPassword: null,
  caqhCredentialsValid: null,
  caqhCredentialsLastChecked: null,
  createdById: 'admin-user-id',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  maidenName: null,
  ssnEncrypted: null,
  caqhStatus: null,
  caqhLastSync: null,
  lastDirectoryUpdateAt: null,
  practiceId: null,
};

const testPayer = {
  id: PAYER_ID,
  name: 'Aetna',
  payerId: 'aetna',
  payerType: 'insurance',
  addressLine1: null,
  city: null,
  state: null,
  zipCode: null,
  phone: null,
  website: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const fhirPractitionerBundle = {
  resourceType: 'Bundle',
  total: 1,
  entry: [
    {
      resource: {
        resourceType: 'Practitioner',
        id: 'practitioner-123',
        name: [{ given: ['Jane'], family: 'Doe' }],
        telecom: [
          { system: 'phone', value: '(555) 123-4567' },
        ],
        identifier: [
          { system: 'http://hl7.org/fhir/sid/us-npi', value: '1234567890' },
        ],
      },
    },
  ],
};

const fhirPractitionerRoleBundle = {
  resourceType: 'Bundle',
  entry: [
    {
      resource: {
        resourceType: 'PractitionerRole',
        specialty: [{ coding: [{ display: 'Psychiatry' }] }],
        location: [{ display: '123 Main St, Springfield, IL' }],
        network: [{ display: 'Aetna Open Access' }],
      },
    },
  ],
};

const fhirEmptyBundle = {
  resourceType: 'Bundle',
  total: 0,
  entry: [],
};

// ==========================================
// Service-level tests
// ==========================================

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('Provider Directory Service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    // Re-apply mock return values (mockReset in mock-prisma.ts may affect these)
    (aetnaAuth.isConfigured as any).mockReturnValue(true);
    (aetnaAuth.getAccessToken as any).mockResolvedValue('mock-token');
    (aetnaAuth.getBaseUrl as any).mockReturnValue('https://mock-fhir.example.com');
  });

  describe('verifyProvider', () => {
    it('returns listed when FHIR Practitioner found and NPI matches', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(testProvider as any);
      prismaMock.payer.findUnique.mockResolvedValue(testPayer as any);
      prismaMock.providerDirectorySnapshot.create.mockResolvedValue({
        id: 'snapshot-1',
        status: 'listed',
        providerId: PROVIDER_ID,
        payerId: PAYER_ID,
      } as any);
      prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 0 });

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(fhirPractitionerBundle),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(fhirPractitionerRoleBundle),
        });

      const { verifyProvider } = await import('../src/services/providerDirectory.service.js');
      const result = await verifyProvider(PROVIDER_ID, PAYER_ID);

      expect(prismaMock.providerDirectorySnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'listed',
            providerId: PROVIDER_ID,
            payerId: PAYER_ID,
          }),
        })
      );
      expect(result.status).toBe('listed');
    });

    it('returns not_found when FHIR Bundle has 0 entries', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(testProvider as any);
      prismaMock.payer.findUnique.mockResolvedValue(testPayer as any);
      prismaMock.providerDirectorySnapshot.create.mockResolvedValue({
        id: 'snapshot-2',
        status: 'not_found',
        providerId: PROVIDER_ID,
        payerId: PAYER_ID,
      } as any);
      prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.providerDirectoryAlert.create.mockResolvedValue({
        id: 'alert-1',
        alertType: 'not_found',
      } as any);

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(fhirEmptyBundle),
      });

      const { verifyProvider } = await import('../src/services/providerDirectory.service.js');
      const result = await verifyProvider(PROVIDER_ID, PAYER_ID);

      expect(prismaMock.providerDirectorySnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'not_found' }),
        })
      );
      expect(prismaMock.providerDirectoryAlert.create).toHaveBeenCalled();
      expect(result.status).toBe('not_found');
    });

    it('returns mismatch when name differs', async () => {
      const mismatchProvider = { ...testProvider, firstName: 'Jane', lastName: 'Smith' };

      prismaMock.provider.findUnique.mockResolvedValue(mismatchProvider as any);
      prismaMock.payer.findUnique.mockResolvedValue(testPayer as any);
      prismaMock.providerDirectorySnapshot.create.mockResolvedValue({
        id: 'snapshot-3',
        status: 'mismatch',
        providerId: PROVIDER_ID,
        payerId: PAYER_ID,
      } as any);
      prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.providerDirectoryAlert.create.mockResolvedValue({
        id: 'alert-2',
        alertType: 'mismatch',
      } as any);

      // FHIR returns Jane Doe but provider is Jane Smith
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(fhirPractitionerBundle),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ resourceType: 'Bundle' }),
        });

      const { verifyProvider } = await import('../src/services/providerDirectory.service.js');
      const result = await verifyProvider(PROVIDER_ID, PAYER_ID);

      expect(prismaMock.providerDirectorySnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'mismatch',
            mismatches: expect.arrayContaining([
              expect.objectContaining({ field: 'name' }),
            ]),
          }),
        })
      );
      expect(result.status).toBe('mismatch');
    });

    it('creates snapshot + alert for not_found result', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(testProvider as any);
      prismaMock.payer.findUnique.mockResolvedValue(testPayer as any);
      prismaMock.providerDirectorySnapshot.create.mockResolvedValue({
        id: 'snapshot-4',
        status: 'not_found',
        providerId: PROVIDER_ID,
        payerId: PAYER_ID,
      } as any);
      prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.providerDirectoryAlert.create.mockResolvedValue({
        id: 'alert-3',
        alertType: 'not_found',
      } as any);

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(fhirEmptyBundle),
      });

      const { verifyProvider } = await import('../src/services/providerDirectory.service.js');
      await verifyProvider(PROVIDER_ID, PAYER_ID);

      expect(prismaMock.providerDirectorySnapshot.create).toHaveBeenCalled();
      expect(prismaMock.providerDirectoryAlert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            alertType: 'not_found',
            snapshotId: 'snapshot-4',
          }),
        })
      );
    });

    it('auto-resolves prior alert when status becomes listed', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(testProvider as any);
      prismaMock.payer.findUnique.mockResolvedValue(testPayer as any);
      prismaMock.providerDirectorySnapshot.create.mockResolvedValue({
        id: 'snapshot-5',
        status: 'listed',
        providerId: PROVIDER_ID,
        payerId: PAYER_ID,
      } as any);
      prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 1 });

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(fhirPractitionerBundle),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ resourceType: 'Bundle' }),
        });

      const { verifyProvider } = await import('../src/services/providerDirectory.service.js');
      await verifyProvider(PROVIDER_ID, PAYER_ID);

      expect(prismaMock.providerDirectoryAlert.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            providerId: PROVIDER_ID,
            payerId: PAYER_ID,
            resolved: false,
          }),
          data: expect.objectContaining({ resolved: true }),
        })
      );
    });

    it('returns error when fetch throws', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(testProvider as any);
      prismaMock.payer.findUnique.mockResolvedValue(testPayer as any);
      prismaMock.providerDirectorySnapshot.create.mockResolvedValue({
        id: 'snapshot-6',
        status: 'error',
        providerId: PROVIDER_ID,
        payerId: PAYER_ID,
      } as any);

      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const { verifyProvider } = await import('../src/services/providerDirectory.service.js');
      const result = await verifyProvider(PROVIDER_ID, PAYER_ID);

      expect(prismaMock.providerDirectorySnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'error' }),
        })
      );
      expect(result.status).toBe('error');
    });
  });

  describe('getProviderDirectoryStatus', () => {
    it('returns summary with snapshot and alert counts', async () => {
      const snapshots = [
        { id: 's1', payerId: 'p1', status: 'listed', checkedAt: new Date(), payer: { id: 'p1', name: 'Aetna' } },
        { id: 's2', payerId: 'p2', status: 'not_found', checkedAt: new Date(), payer: { id: 'p2', name: 'Other' } },
      ];
      const alerts = [
        { id: 'a1', alertType: 'not_found', resolved: false, payer: { id: 'p2', name: 'Other' } },
      ];

      prismaMock.providerDirectorySnapshot.findMany.mockResolvedValue(snapshots as any);
      prismaMock.providerDirectoryAlert.findMany.mockResolvedValue(alerts as any);

      const { getProviderDirectoryStatus } = await import('../src/services/providerDirectory.service.js');
      const result = await getProviderDirectoryStatus(PROVIDER_ID);

      expect(result.summary.listed).toBe(1);
      expect(result.summary.notFound).toBe(1);
      expect(result.summary.openAlerts).toBe(1);
      expect(result.snapshots).toHaveLength(2);
    });
  });

  describe('resolveAlert', () => {
    it('marks alert resolved with timestamp', async () => {
      const resolvedAlert = {
        id: 'alert-1',
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: 'admin@test.com',
      };

      prismaMock.providerDirectoryAlert.update.mockResolvedValue(resolvedAlert as any);

      const { resolveAlert } = await import('../src/services/providerDirectory.service.js');
      const result = await resolveAlert('alert-1', 'admin@test.com');

      expect(result.resolved).toBe(true);
      expect(result.resolvedBy).toBe('admin@test.com');
      expect(prismaMock.providerDirectoryAlert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'alert-1' },
          data: expect.objectContaining({ resolved: true, resolvedBy: 'admin@test.com' }),
        })
      );
    });
  });
});

// ==========================================
// Route-level tests (supertest)
// ==========================================

describe('Provider Directory Routes', () => {
  let app: any;

  beforeEach(async () => {
    global.fetch = vi.fn();
    (aetnaAuth.isConfigured as any).mockReturnValue(true);
    (aetnaAuth.getAccessToken as any).mockResolvedValue('mock-token');
    (aetnaAuth.getBaseUrl as any).mockReturnValue('https://mock-fhir.example.com');
    const routeModule = await import('../src/routes/providerDirectory.routes.js');
    app = createTestApp(routeModule.default, adminUser);
  });

  it('POST /:providerId/verify — 200 with valid payerId', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(testProvider as any);
    prismaMock.payer.findUnique.mockResolvedValue(testPayer as any);
    prismaMock.providerDirectorySnapshot.create.mockResolvedValue({
      id: 'snapshot-1',
      status: 'listed',
    } as any);
    prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 0 });

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(fhirPractitionerBundle),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ resourceType: 'Bundle' }),
      });

    const res = await request(app)
      .post(`/${PROVIDER_ID}/verify`)
      .send({ payerId: PAYER_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /:providerId/verify — 400 with invalid payerId format', async () => {
    const res = await request(app)
      .post(`/${PROVIDER_ID}/verify`)
      .send({ payerId: 'not-a-uuid' });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('GET /:providerId/status — returns directory status summary', async () => {
    prismaMock.providerDirectorySnapshot.findMany.mockResolvedValue([]);
    prismaMock.providerDirectoryAlert.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get(`/${PROVIDER_ID}/status`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('summary');
    expect(res.body.data).toHaveProperty('snapshots');
    expect(res.body.data).toHaveProperty('alerts');
  });

  it('POST /alerts/:alertId/resolve — 200 marks resolved', async () => {
    prismaMock.providerDirectoryAlert.update.mockResolvedValue({
      id: 'alert-1',
      resolved: true,
      resolvedAt: new Date(),
      resolvedBy: 'admin@test.com',
    } as any);

    const res = await request(app)
      .post('/alerts/alert-1/resolve')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /configured-payers — returns list of configured payer adapters', async () => {
    const res = await request(app)
      .get('/configured-payers');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ==========================================
// Aetna adapter unit tests
// ==========================================

describe('Aetna Directory Adapter', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    (aetnaAuth.isConfigured as any).mockReturnValue(true);
    (aetnaAuth.getAccessToken as any).mockResolvedValue('mock-token');
    (aetnaAuth.getBaseUrl as any).mockReturnValue('https://mock-fhir.example.com');
  });

  it('builds correct FHIR Practitioner search URL with NPI identifier', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(testProvider as any);
    prismaMock.payer.findUnique.mockResolvedValue(testPayer as any);
    prismaMock.providerDirectorySnapshot.create.mockResolvedValue({
      id: 'snap-1',
      status: 'listed',
    } as any);
    prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 0 });

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(fhirPractitionerBundle),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ resourceType: 'Bundle' }),
      });

    const { verifyProvider } = await import('../src/services/providerDirectory.service.js');
    await verifyProvider(PROVIDER_ID, PAYER_ID);

    const firstFetchCall = (global.fetch as any).mock.calls[0];
    expect(firstFetchCall[0]).toContain('Practitioner?identifier=http://hl7.org/fhir/sid/us-npi|1234567890');
    expect(firstFetchCall[1].headers.Authorization).toBe('Bearer mock-token');
  });

  it('extracts network names from PractitionerRole', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(testProvider as any);
    prismaMock.payer.findUnique.mockResolvedValue(testPayer as any);
    prismaMock.providerDirectorySnapshot.create.mockImplementation(({ data }: any) => {
      return Promise.resolve({ id: 'snap-2', ...data });
    });
    prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 0 });

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(fhirPractitionerBundle),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(fhirPractitionerRoleBundle),
      });

    const { verifyProvider } = await import('../src/services/providerDirectory.service.js');
    await verifyProvider(PROVIDER_ID, PAYER_ID);

    expect(prismaMock.providerDirectorySnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          networkNames: expect.arrayContaining(['Aetna Open Access']),
        }),
      })
    );
  });
});
