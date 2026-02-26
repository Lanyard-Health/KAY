import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('./aetna.auth.js', () => ({
  aetnaAuth: {
    isConfigured: vi.fn(),
    getAccessToken: vi.fn(),
    getBaseUrl: vi.fn(),
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { aetnaAuth } from './aetna.auth.js';
import {
  getConfiguredPayers,
  verifyProvider,
  verifyProviderAllPayers,
  getLatestSnapshot,
  getProviderDirectoryStatus,
  getOpenAlerts,
  resolveAlert,
  getSnapshots,
  runScheduledDirectoryChecks,
} from './providerDirectory.service.js';

// ==========================================
// Fixtures
// ==========================================

const mockProvider = {
  id: 'prov-1',
  firstName: 'John',
  lastName: 'Doe',
  npi: '1234567890',
  phone: '5551234',
  specialties: ['family medicine'],
};

const mockPayer = {
  id: 'payer-1',
  name: 'Aetna',
  payerId: 'aetna',
};

const fhirPractitionerBundle = {
  resourceType: 'Bundle',
  total: 1,
  entry: [
    {
      resource: {
        id: 'practitioner-1',
        name: [{ given: ['John'], family: 'Doe' }],
        telecom: [{ system: 'phone', value: '555-1234' }],
      },
    },
  ],
};

const fhirRoleBundle = {
  resourceType: 'Bundle',
  entry: [
    {
      resource: {
        specialty: [{ coding: [{ display: 'Family Medicine' }] }],
        location: [{ display: '123 Main St' }],
        network: [{ display: 'Aetna PPO' }],
      },
    },
  ],
};

const emptyBundle = { resourceType: 'Bundle', total: 0, entry: [] };

function setupAetnaConfigured() {
  vi.mocked(aetnaAuth.isConfigured).mockReturnValue(true);
  vi.mocked(aetnaAuth.getAccessToken).mockResolvedValue('token123');
  vi.mocked(aetnaAuth.getBaseUrl).mockReturnValue('https://fhir.test');
}

function setupFetchSuccess() {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(fhirPractitionerBundle),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(fhirRoleBundle),
    });
}

function setupProviderAndPayer() {
  prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);
  prismaMock.payer.findUnique.mockResolvedValue(mockPayer as any);
}

// ==========================================
// Tests
// ==========================================

beforeEach(() => {
  vi.resetAllMocks();
});

describe('getConfiguredPayers', () => {
  it('returns ["aetna"] when aetnaAuth is configured', () => {
    vi.mocked(aetnaAuth.isConfigured).mockReturnValue(true);
    expect(getConfiguredPayers()).toEqual(['aetna']);
  });

  it('returns empty array when aetnaAuth is not configured', () => {
    vi.mocked(aetnaAuth.isConfigured).mockReturnValue(false);
    expect(getConfiguredPayers()).toEqual([]);
  });
});

describe('verifyProvider', () => {
  it('throws when provider is not found', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(null);
    await expect(verifyProvider('prov-1', 'payer-1')).rejects.toThrow('Provider not found');
  });

  it('throws when payer is not found', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);
    prismaMock.payer.findUnique.mockResolvedValue(null);
    await expect(verifyProvider('prov-1', 'payer-1')).rejects.toThrow('Payer not found');
  });

  it('throws when no adapter is configured for the payer', async () => {
    prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);
    prismaMock.payer.findUnique.mockResolvedValue({ ...mockPayer, payerId: 'unknown' } as any);
    vi.mocked(aetnaAuth.isConfigured).mockReturnValue(false);
    await expect(verifyProvider('prov-1', 'payer-1')).rejects.toThrow('No directory adapter configured for payer');
  });

  it('creates snapshot and resolves old alerts when status is listed', async () => {
    setupAetnaConfigured();
    setupProviderAndPayer();
    setupFetchSuccess();

    const createdSnapshot = { id: 'snap-1', status: 'listed', providerId: 'prov-1', payerId: 'payer-1' };
    prismaMock.providerDirectorySnapshot.create.mockResolvedValue(createdSnapshot as any);
    prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 1 } as any);

    const result = await verifyProvider('prov-1', 'payer-1');

    expect(result).toEqual(createdSnapshot);
    expect(prismaMock.providerDirectorySnapshot.create).toHaveBeenCalledOnce();
    expect(prismaMock.providerDirectoryAlert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId: 'prov-1', payerId: 'payer-1', resolved: false },
        data: expect.objectContaining({ resolved: true, resolvedBy: 'system' }),
      })
    );
    // No new alert created for listed status
    expect(prismaMock.providerDirectoryAlert.create).not.toHaveBeenCalled();
  });

  it('creates snapshot and alert when status is not_found', async () => {
    setupAetnaConfigured();
    setupProviderAndPayer();

    // Return empty bundle for not_found
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ resourceType: 'Bundle', total: 0 }),
    });

    const createdSnapshot = { id: 'snap-2', status: 'not_found', providerId: 'prov-1', payerId: 'payer-1' };
    prismaMock.providerDirectorySnapshot.create.mockResolvedValue(createdSnapshot as any);
    prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.providerDirectoryAlert.create.mockResolvedValue({ id: 'alert-1' } as any);

    const result = await verifyProvider('prov-1', 'payer-1');

    expect(result.status).toBe('not_found');
    expect(prismaMock.providerDirectoryAlert.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId: 'prov-1', payerId: 'payer-1', resolved: false },
      })
    );
    expect(prismaMock.providerDirectoryAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerId: 'prov-1',
          payerId: 'payer-1',
          snapshotId: 'snap-2',
          alertType: 'not_found',
          message: expect.stringContaining('not found'),
        }),
      })
    );
  });

  it('creates snapshot and alert with mismatch details when status is mismatch', async () => {
    setupAetnaConfigured();
    // Provider with a different phone than FHIR response
    const mismatchProvider = { ...mockProvider, phone: '9999999999' };
    prismaMock.provider.findUnique.mockResolvedValue(mismatchProvider as any);
    prismaMock.payer.findUnique.mockResolvedValue(mockPayer as any);
    setupFetchSuccess();

    const createdSnapshot = { id: 'snap-3', status: 'mismatch', providerId: 'prov-1', payerId: 'payer-1' };
    prismaMock.providerDirectorySnapshot.create.mockResolvedValue(createdSnapshot as any);
    prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.providerDirectoryAlert.create.mockResolvedValue({ id: 'alert-2' } as any);

    const result = await verifyProvider('prov-1', 'payer-1');

    expect(result.status).toBe('mismatch');
    expect(prismaMock.providerDirectorySnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'mismatch',
          mismatches: expect.arrayContaining([
            expect.objectContaining({ field: 'phone' }),
          ]),
        }),
      })
    );
    expect(prismaMock.providerDirectoryAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          alertType: 'mismatch',
          message: expect.stringContaining('mismatch'),
          details: expect.arrayContaining([
            expect.objectContaining({ field: 'phone' }),
          ]),
        }),
      })
    );
  });

  it('handles FHIR search failure gracefully', async () => {
    setupAetnaConfigured();
    setupProviderAndPayer();

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    const createdSnapshot = { id: 'snap-err', status: 'error', providerId: 'prov-1', payerId: 'payer-1' };
    prismaMock.providerDirectorySnapshot.create.mockResolvedValue(createdSnapshot as any);

    const result = await verifyProvider('prov-1', 'payer-1');

    expect(result.status).toBe('error');
    // error status doesn't create alerts or resolve old ones
    expect(prismaMock.providerDirectoryAlert.create).not.toHaveBeenCalled();
    expect(prismaMock.providerDirectoryAlert.updateMany).not.toHaveBeenCalled();
  });

  it('passes correct FHIR data into snapshot creation', async () => {
    setupAetnaConfigured();
    setupProviderAndPayer();
    setupFetchSuccess();

    const createdSnapshot = { id: 'snap-4', status: 'listed' };
    prismaMock.providerDirectorySnapshot.create.mockResolvedValue(createdSnapshot as any);
    prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 0 } as any);

    await verifyProvider('prov-1', 'payer-1');

    expect(prismaMock.providerDirectorySnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerId: 'prov-1',
          payerId: 'payer-1',
          status: 'listed',
          listedName: 'John Doe',
          listedNpi: '1234567890',
          listedPhone: '555-1234',
          listedSpecialty: 'Family Medicine',
          listedAddress: '123 Main St',
          networkNames: ['Aetna PPO'],
        }),
      })
    );
  });
});

describe('verifyProviderAllPayers', () => {
  it('returns empty array when no payers are configured', async () => {
    vi.mocked(aetnaAuth.isConfigured).mockReturnValue(false);
    const result = await verifyProviderAllPayers('prov-1');
    expect(result).toEqual([]);
  });

  it('verifies provider against all configured payers', async () => {
    setupAetnaConfigured();
    prismaMock.payer.findMany.mockResolvedValue([mockPayer] as any);
    prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);
    prismaMock.payer.findUnique.mockResolvedValue(mockPayer as any);
    setupFetchSuccess();

    const createdSnapshot = { id: 'snap-all', status: 'listed' };
    prismaMock.providerDirectorySnapshot.create.mockResolvedValue(createdSnapshot as any);
    prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 0 } as any);

    const result = await verifyProviderAllPayers('prov-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(createdSnapshot);
  });
});

describe('getLatestSnapshot', () => {
  it('calls findFirst with correct params ordered by checkedAt desc', async () => {
    const snapshot = { id: 'snap-latest', status: 'listed' };
    prismaMock.providerDirectorySnapshot.findFirst.mockResolvedValue(snapshot as any);

    const result = await getLatestSnapshot('prov-1', 'payer-1');

    expect(result).toEqual(snapshot);
    expect(prismaMock.providerDirectorySnapshot.findFirst).toHaveBeenCalledWith({
      where: { providerId: 'prov-1', payerId: 'payer-1' },
      orderBy: { checkedAt: 'desc' },
    });
  });
});

describe('getProviderDirectoryStatus', () => {
  it('returns deduped snapshots, open alerts, and summary counts', async () => {
    vi.mocked(aetnaAuth.isConfigured).mockReturnValue(true);

    const snapshots = [
      { id: 'snap-a', payerId: 'payer-1', status: 'listed', payer: mockPayer },
      { id: 'snap-b', payerId: 'payer-1', status: 'not_found', payer: mockPayer }, // older, same payer — deduped
    ];
    prismaMock.providerDirectorySnapshot.findMany.mockResolvedValue(snapshots as any);

    const alerts = [{ id: 'alert-1', payer: mockPayer }];
    prismaMock.providerDirectoryAlert.findMany.mockResolvedValue(alerts as any);

    const result = await getProviderDirectoryStatus('prov-1');

    expect(result.snapshots).toHaveLength(1); // deduped to 1 per payer
    expect(result.snapshots[0]!.id).toBe('snap-a');
    expect(result.alerts).toEqual(alerts);
    expect(result.configuredPayers).toEqual(['aetna']);
    expect(result.summary).toEqual({
      listed: 1,
      notFound: 0,
      mismatch: 0,
      error: 0,
      openAlerts: 1,
    });
  });
});

describe('getOpenAlerts', () => {
  it('calls findMany with resolved=false', async () => {
    const alerts = [{ id: 'alert-1' }];
    prismaMock.providerDirectoryAlert.findMany.mockResolvedValue(alerts as any);

    const result = await getOpenAlerts('prov-1');

    expect(result).toEqual(alerts);
    expect(prismaMock.providerDirectoryAlert.findMany).toHaveBeenCalledWith({
      where: { providerId: 'prov-1', resolved: false },
      include: { payer: true, snapshot: true },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('resolveAlert', () => {
  it('updates alert with resolved=true and resolvedBy', async () => {
    const updated = { id: 'alert-1', resolved: true, resolvedBy: 'user-1' };
    prismaMock.providerDirectoryAlert.update.mockResolvedValue(updated as any);

    const result = await resolveAlert('alert-1', 'user-1');

    expect(result).toEqual(updated);
    expect(prismaMock.providerDirectoryAlert.update).toHaveBeenCalledWith({
      where: { id: 'alert-1' },
      data: expect.objectContaining({ resolved: true, resolvedBy: 'user-1' }),
    });
  });
});

describe('getSnapshots', () => {
  it('returns paginated snapshots without payerId filter', async () => {
    const snapshots = [{ id: 'snap-1' }];
    prismaMock.providerDirectorySnapshot.findMany.mockResolvedValue(snapshots as any);

    const result = await getSnapshots('prov-1');

    expect(result).toEqual(snapshots);
    expect(prismaMock.providerDirectorySnapshot.findMany).toHaveBeenCalledWith({
      where: { providerId: 'prov-1' },
      include: { payer: true },
      orderBy: { checkedAt: 'desc' },
      take: 20,
      skip: 0,
    });
  });

  it('includes payerId filter when provided', async () => {
    prismaMock.providerDirectorySnapshot.findMany.mockResolvedValue([] as any);

    await getSnapshots('prov-1', 'payer-1', 10, 5);

    expect(prismaMock.providerDirectorySnapshot.findMany).toHaveBeenCalledWith({
      where: { providerId: 'prov-1', payerId: 'payer-1' },
      include: { payer: true },
      orderBy: { checkedAt: 'desc' },
      take: 10,
      skip: 5,
    });
  });
});

describe('runScheduledDirectoryChecks', () => {
  it('returns zeros when no payers are configured', async () => {
    vi.mocked(aetnaAuth.isConfigured).mockReturnValue(false);
    const result = await runScheduledDirectoryChecks();
    expect(result).toEqual({ checked: 0, alerts: 0, errors: 0 });
  });

  it('checks all active enrollments and returns correct counts', async () => {
    setupAetnaConfigured();

    const enrollments = [
      { id: 'enr-1', providerId: 'prov-1', payerId: 'payer-1', payer: mockPayer },
    ];
    prismaMock.payerEnrollment.findMany.mockResolvedValue(enrollments as any);

    // verifyProvider chain
    prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);
    prismaMock.payer.findUnique.mockResolvedValue(mockPayer as any);
    setupFetchSuccess();

    const createdSnapshot = { id: 'snap-sched', status: 'listed' };
    prismaMock.providerDirectorySnapshot.create.mockResolvedValue(createdSnapshot as any);
    prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 0 } as any);

    const result = await runScheduledDirectoryChecks();

    expect(result).toEqual({ checked: 1, alerts: 0, errors: 0 });
  });

  it('counts errors when verifyProvider throws', async () => {
    setupAetnaConfigured();

    const enrollments = [
      { id: 'enr-1', providerId: 'prov-1', payerId: 'payer-1', payer: mockPayer },
    ];
    prismaMock.payerEnrollment.findMany.mockResolvedValue(enrollments as any);
    prismaMock.provider.findUnique.mockResolvedValue(null); // will throw

    const result = await runScheduledDirectoryChecks();

    expect(result).toEqual({ checked: 0, alerts: 0, errors: 1 });
  });

  it('counts alerts when snapshot status is not_found', async () => {
    setupAetnaConfigured();

    const enrollments = [
      { id: 'enr-1', providerId: 'prov-1', payerId: 'payer-1', payer: mockPayer },
    ];
    prismaMock.payerEnrollment.findMany.mockResolvedValue(enrollments as any);

    prismaMock.provider.findUnique.mockResolvedValue(mockProvider as any);
    prismaMock.payer.findUnique.mockResolvedValue(mockPayer as any);

    // Empty bundle → not_found
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ resourceType: 'Bundle', total: 0 }),
    });

    const createdSnapshot = { id: 'snap-nf', status: 'not_found' };
    prismaMock.providerDirectorySnapshot.create.mockResolvedValue(createdSnapshot as any);
    prismaMock.providerDirectoryAlert.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.providerDirectoryAlert.create.mockResolvedValue({ id: 'alert-nf' } as any);

    const result = await runScheduledDirectoryChecks();

    expect(result).toEqual({ checked: 1, alerts: 1, errors: 0 });
  });

  it('queries enrollments with correct status filters', async () => {
    setupAetnaConfigured();
    prismaMock.payerEnrollment.findMany.mockResolvedValue([] as any);

    await runScheduledDirectoryChecks();

    expect(prismaMock.payerEnrollment.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['approved', 'in_progress', 'submitted', 'pending_review'] },
        payer: { payerId: { in: ['aetna'] } },
      },
      include: { payer: true },
    });
  });
});

describe('getProviderDirectoryStatus edge cases', () => {
  it('returns empty results when no snapshots exist', async () => {
    vi.mocked(aetnaAuth.isConfigured).mockReturnValue(true);
    prismaMock.providerDirectorySnapshot.findMany.mockResolvedValue([] as any);
    prismaMock.providerDirectoryAlert.findMany.mockResolvedValue([] as any);

    const result = await getProviderDirectoryStatus('prov-1');

    expect(result.snapshots).toHaveLength(0);
    expect(result.alerts).toHaveLength(0);
    expect(result.summary).toEqual({
      listed: 0,
      notFound: 0,
      mismatch: 0,
      error: 0,
      openAlerts: 0,
    });
  });

  it('dedupes snapshots across multiple payers correctly', async () => {
    vi.mocked(aetnaAuth.isConfigured).mockReturnValue(true);

    const snapshots = [
      { id: 'snap-1', payerId: 'payer-1', status: 'listed', payer: { id: 'payer-1', name: 'Aetna' } },
      { id: 'snap-2', payerId: 'payer-2', status: 'not_found', payer: { id: 'payer-2', name: 'BCBS' } },
      { id: 'snap-3', payerId: 'payer-1', status: 'mismatch', payer: { id: 'payer-1', name: 'Aetna' } }, // older, deduped
    ];
    prismaMock.providerDirectorySnapshot.findMany.mockResolvedValue(snapshots as any);
    prismaMock.providerDirectoryAlert.findMany.mockResolvedValue([] as any);

    const result = await getProviderDirectoryStatus('prov-1');

    expect(result.snapshots).toHaveLength(2);
    expect(result.summary.listed).toBe(1);
    expect(result.summary.notFound).toBe(1);
  });
});
