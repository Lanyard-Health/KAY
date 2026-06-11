import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { getCaqhImportSummary } from './caqh-import-summary.service.js';

const provider = {
  id: 'prov-1',
  firstName: 'Jane',
  lastName: 'Doe',
  middleName: null,
  suffix: null,
  phone: '555-1234',
  email: 'jane@test.com',
  caqhImportStatus: 'completed',
  caqhImportError: null,
  caqhImportUpdatedAt: new Date('2026-06-11'),
};

describe('getCaqhImportSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.providerProfile.findUnique.mockResolvedValue(provider as any);
    prismaMock.caqhSyncLog.findFirst.mockResolvedValue(null);
    prismaMock.document.findMany.mockResolvedValue([]);
    prismaMock.providerApplication.findFirst.mockResolvedValue(null);
  });

  it('returns import status, last sync, and imported documents', async () => {
    prismaMock.caqhSyncLog.findFirst.mockResolvedValue({
      id: 'sync-1',
      completedAt: new Date('2026-06-11'),
      changesApplied: { licenses: { created: 2, updated: 0 } },
    } as any);
    prismaMock.document.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        documentType: 'license',
        originalFileName: 'license.pdf',
        description: 'Imported from CAQH (State License, CA, CAQH status: Approved)',
        expirationDate: null,
        reviewStatus: 'approved',
        linkedLicenseId: 'lic-1',
        linkedBoardCertificationId: null,
        linkedMalpracticeInsuranceId: null,
      },
    ] as any);

    const summary = await getCaqhImportSummary('prov-1');

    expect(summary.importStatus).toBe('completed');
    expect(summary.lastSync?.syncId).toBe('sync-1');
    expect(summary.documents).toHaveLength(1);
    expect(summary.documents[0]).toMatchObject({ id: 'doc-1', linkedTo: 'license' });
  });

  it('surfaces conflicts where CAQH overwrote what the application form said', async () => {
    prismaMock.providerApplication.findFirst.mockResolvedValue({
      firstName: 'Jane',
      lastName: 'Smith', // form said Smith; provider (post-CAQH) says Doe
      middleName: null,
      suffix: null,
      phone: '555-1234',
      email: 'jane@test.com',
    } as any);

    const summary = await getCaqhImportSummary('prov-1');

    expect(summary.conflicts).toEqual([
      { field: 'Last name', applicationValue: 'Smith', currentValue: 'Doe' },
    ]);
  });

  it('does not report conflicts for fields the form left blank', async () => {
    prismaMock.providerApplication.findFirst.mockResolvedValue({
      firstName: 'Jane',
      lastName: 'Doe',
      middleName: null, // blank on form, CAQH may have filled it — not a conflict
      suffix: null,
      phone: '555-1234',
      email: 'jane@test.com',
    } as any);
    prismaMock.providerProfile.findUnique.mockResolvedValue({
      ...provider,
      middleName: 'Marie',
    } as any);

    const summary = await getCaqhImportSummary('prov-1');

    expect(summary.conflicts).toEqual([]);
  });

  it('compares case-insensitively (no false conflicts on formatting)', async () => {
    prismaMock.providerApplication.findFirst.mockResolvedValue({
      firstName: 'JANE ',
      lastName: 'doe',
      middleName: null,
      suffix: null,
      phone: '555-1234',
      email: 'Jane@Test.com',
    } as any);

    const summary = await getCaqhImportSummary('prov-1');

    expect(summary.conflicts).toEqual([]);
  });

  it('throws for an unknown provider', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue(null);

    await expect(getCaqhImportSummary('nope')).rejects.toThrow('Provider not found');
  });
});
