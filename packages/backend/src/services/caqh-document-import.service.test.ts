import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

const caqhMocks = vi.hoisted(() => ({
  getDocumentsList: vi.fn(),
  downloadDocument: vi.fn(),
}));

vi.mock('./caqh.service.js', () => ({
  // Vitest v4: constructor mocks must use function(), not arrow
  CaqhService: vi.fn().mockImplementation(function () {
    return caqhMocks;
  }),
}));

const saveImportedDocumentMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ id: 'doc-1', s3Key: 'documents/prov-1/caqh/abc.pdf' }))
);
vi.mock('./document.service.js', () => ({
  // Vitest v4: constructor mocks must use function(), not arrow
  DocumentService: vi.fn().mockImplementation(function () {
    return { saveImportedDocument: saveImportedDocumentMock };
  }),
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { importCaqhDocuments, mapCaqhDocumentType } from './caqh-document-import.service.js';

const provider = { id: 'prov-1', caqhProviderId: '12345678', practiceId: null };

const licenseDoc = {
  DocumentTypeName: 'State License',
  StateIdName: 'CA',
  ExpirationDate: '2027-01-31',
  DocumentStatusName: 'Approved' as const,
  DocumentURL: 'https://caqh.example/doc/1',
};

function mockHappyDownload() {
  caqhMocks.downloadDocument.mockResolvedValue({
    data: Buffer.from('pdf-bytes'),
    contentType: 'application/pdf',
    fileName: 'license.pdf',
  });
}

describe('mapCaqhDocumentType', () => {
  it('classifies known CAQH type names by keyword', () => {
    expect(mapCaqhDocumentType('State License')).toEqual({ type: 'license', classified: true });
    expect(mapCaqhDocumentType('DEA Certificate')).toEqual({ type: 'dea_certificate', classified: true });
    expect(mapCaqhDocumentType('Professional Liability Insurance Face Sheet')).toEqual({
      type: 'malpractice_certificate',
      classified: true,
    });
    expect(mapCaqhDocumentType('Curriculum Vitae')).toEqual({ type: 'cv_resume', classified: true });
  });

  it('routes unknown types to the unclassified bucket — never guesses', () => {
    expect(mapCaqhDocumentType('Mystery Attachment XYZ')).toEqual({ type: 'other', classified: false });
  });
});

describe('importCaqhDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    caqhMocks.getDocumentsList.mockReset();
    caqhMocks.downloadDocument.mockReset();
    prismaMock.providerProfile.findUnique.mockResolvedValue(provider as any);
    prismaMock.document.findFirst.mockResolvedValue(null);
    prismaMock.license.findMany.mockResolvedValue([]);
    prismaMock.malpracticeInsurance.findMany.mockResolvedValue([]);
    prismaMock.boardCertification.findMany.mockResolvedValue([]);
    prismaMock.providerChecklist.findUnique.mockResolvedValue(null);
  });

  it('downloads, saves, and links a license document to the matching state license', async () => {
    caqhMocks.getDocumentsList.mockResolvedValue([licenseDoc]);
    mockHappyDownload();
    prismaMock.license.findMany.mockResolvedValue([{ id: 'lic-ca' }] as any);

    const summary = await importCaqhDocuments('prov-1');

    expect(summary).toMatchObject({ total: 1, imported: 1, linked: 1, failed: 0 });
    expect(saveImportedDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'prov-1',
        documentType: 'license',
        reviewStatus: 'approved', // CAQH-approved + classified → no manual review
        links: { linkedLicenseId: 'lic-ca' },
      })
    );
  });

  it('does not link when two licenses match the state (ambiguous)', async () => {
    caqhMocks.getDocumentsList.mockResolvedValue([licenseDoc]);
    mockHappyDownload();
    prismaMock.license.findMany.mockResolvedValue([{ id: 'lic-1' }, { id: 'lic-2' }] as any);

    const summary = await importCaqhDocuments('prov-1');

    expect(summary.linked).toBe(0);
    expect(saveImportedDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({ links: {} })
    );
  });

  it('skips documents already imported (idempotency by URL fingerprint)', async () => {
    caqhMocks.getDocumentsList.mockResolvedValue([licenseDoc]);
    prismaMock.document.findFirst.mockResolvedValue({ id: 'existing-doc' } as any);

    const summary = await importCaqhDocuments('prov-1');

    expect(summary).toMatchObject({ total: 1, imported: 0, skippedAlreadyImported: 1 });
    expect(caqhMocks.downloadDocument).not.toHaveBeenCalled();
  });

  it('sends unknown types to review as "other" and counts them unclassified', async () => {
    caqhMocks.getDocumentsList.mockResolvedValue([
      { ...licenseDoc, DocumentTypeName: 'Mystery Attachment', DocumentURL: 'https://caqh.example/doc/2' },
    ]);
    mockHappyDownload();

    const summary = await importCaqhDocuments('prov-1');

    expect(summary.unclassified).toBe(1);
    expect(saveImportedDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: 'other', reviewStatus: 'pending' })
    );
  });

  it('flips the COI checklist slot for a CAQH-approved malpractice certificate', async () => {
    caqhMocks.getDocumentsList.mockResolvedValue([
      {
        ...licenseDoc,
        DocumentTypeName: 'Malpractice Insurance Face Sheet',
        DocumentURL: 'https://caqh.example/doc/3',
      },
    ]);
    mockHappyDownload();
    prismaMock.providerChecklist.findUnique.mockResolvedValue({
      id: 'chk-1',
      w9Status: 'not_started',
      w9DocumentId: null,
      coiStatus: 'not_started',
      coiDocumentId: null,
    } as any);
    prismaMock.providerChecklist.update.mockResolvedValue({} as any);

    await importCaqhDocuments('prov-1');

    expect(prismaMock.providerChecklist.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ coiStatus: 'approved', coiDocumentId: 'doc-1' }),
      })
    );
  });

  it('never overwrites a checklist slot a human already filled', async () => {
    caqhMocks.getDocumentsList.mockResolvedValue([
      {
        ...licenseDoc,
        DocumentTypeName: 'Certificate of Insurance',
        DocumentURL: 'https://caqh.example/doc/4',
      },
    ]);
    mockHappyDownload();
    prismaMock.providerChecklist.findUnique.mockResolvedValue({
      id: 'chk-1',
      w9Status: 'not_started',
      w9DocumentId: null,
      coiStatus: 'approved',
      coiDocumentId: 'human-doc',
    } as any);

    await importCaqhDocuments('prov-1');

    expect(prismaMock.providerChecklist.update).not.toHaveBeenCalled();
  });

  it('continues past a single failed download and counts it', async () => {
    caqhMocks.getDocumentsList.mockResolvedValue([
      licenseDoc,
      { ...licenseDoc, DocumentTypeName: 'DEA Certificate', DocumentURL: 'https://caqh.example/doc/5' },
    ]);
    caqhMocks.downloadDocument
      .mockRejectedValueOnce(new Error('CAQH 500'))
      .mockResolvedValueOnce({ data: Buffer.from('ok'), contentType: 'application/pdf' });

    const summary = await importCaqhDocuments('prov-1');

    expect(summary).toMatchObject({ total: 2, imported: 1, failed: 1 });
  });

  it('throws when the provider has no CAQH ID', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue({ ...provider, caqhProviderId: null } as any);

    await expect(importCaqhDocuments('prov-1')).rejects.toThrow('no CAQH Provider ID');
  });
});
