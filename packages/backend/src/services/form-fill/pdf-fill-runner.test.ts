import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const buildPacketMock = vi.fn();
vi.mock('../credentialing-packet.service.js', () => ({
  buildPacket: (...args: unknown[]) => buildPacketMock(...args),
}));

import { runPdfFill, type StorageAdapter } from './pdf-fill-runner.js';
import { prismaMock } from '../../../tests/helpers/mock-prisma.js';

async function buildTemplate() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 200]);
  const form = pdf.getForm();
  const npi = form.createTextField('provider_npi');
  npi.addToPage(page, { x: 20, y: 150, width: 200, height: 20 });
  return pdf.save();
}

function stubStorage(templateBytes: Uint8Array): StorageAdapter & {
  downloadCalls: string[];
  uploadCalls: Array<{ key: string; size: number }>;
} {
  const downloadCalls: string[] = [];
  const uploadCalls: Array<{ key: string; size: number }> = [];
  return {
    downloadCalls,
    uploadCalls,
    async download(key: string) {
      downloadCalls.push(key);
      return templateBytes;
    },
    async upload(key: string, bytes: Uint8Array) {
      uploadCalls.push({ key, size: bytes.byteLength });
    },
  };
}

function happyPathMocks() {
  prismaMock.enrollmentRun.create.mockResolvedValue({
    id: 'run-1',
    filledArtifacts: null,
  } as any);
  prismaMock.enrollmentRun.update.mockResolvedValue({} as any);
  prismaMock.enrollment.findUnique.mockResolvedValue({
    providerId: 'prov-1',
    payerId: 'payer-1',
  } as any);
  prismaMock.payerForm.findUnique.mockResolvedValue({
    id: 'form-1',
    formName: 'Test BH Application',
    deliveryEngine: 'pdf',
    assetUrl: 'templates/payer-1/test.pdf',
  } as any);
  prismaMock.payerFormField.findMany.mockResolvedValue([
    {
      id: 'f1',
      fieldKey: 'provider_npi',
      fieldLabel: 'Provider NPI',
      fieldType: 'text',
      required: true,
      validationRegex: null,
      orderIndex: 0,
      mappings: [
        {
          sourceKind: 'provider',
          sourcePath: 'npi',
          transform: null,
          fallbackValue: null,
          priority: 0,
        },
      ],
    },
  ] as any);
  buildPacketMock.mockResolvedValue({
    provider: { npi: '1234567893' },
    practice: null,
    practicePayer: null,
    primaryLocation: null,
    sensitive: {
      ssn: null,
      taxIdPersonal: null,
      taxIdGroup: null,
      bankingAccountNumber: null,
      bankingRoutingNumber: null,
    },
    meta: {
      builtAt: new Date().toISOString(),
      decrypted: true,
      payerId: 'payer-1',
      practicePayerId: null,
    },
  });
}

describe('runPdfFill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fills a PDF end-to-end and advances EnrollmentRun to awaiting_review', async () => {
    happyPathMocks();
    const template = await buildTemplate();
    const storage = stubStorage(template);

    const result = await runPdfFill({
      enrollmentId: 'enr-1',
      payerFormId: 'form-1',
      storage,
      triggeredBy: 'user-1',
    });

    // Run created with filling status, then updated to awaiting_review
    expect(prismaMock.enrollmentRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enrollmentId: 'enr-1',
          status: 'filling',
          triggeredBy: 'user-1',
        }),
      })
    );
    expect(prismaMock.enrollmentRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({ status: 'awaiting_review' }),
      })
    );

    // Template downloaded, filled, uploaded under the expected key
    expect(storage.downloadCalls).toEqual(['templates/payer-1/test.pdf']);
    expect(storage.uploadCalls).toHaveLength(1);
    expect(storage.uploadCalls[0]?.key).toBe('filled/run-1/form-1.pdf');
    expect(storage.uploadCalls[0]!.size).toBeGreaterThan(0);

    // Artifact returned
    expect(result.artifact.filledCount).toBe(1);
    expect(result.artifact.skippedCount).toBe(0);
    expect(result.missingRequired).toEqual([]);
  });

  it('marks run as failed when enrollment is missing', async () => {
    prismaMock.enrollmentRun.create.mockResolvedValue({ id: 'run-1' } as any);
    prismaMock.enrollmentRun.update.mockResolvedValue({} as any);
    prismaMock.enrollment.findUnique.mockResolvedValue(null);

    const storage = stubStorage(new Uint8Array());

    await expect(
      runPdfFill({ enrollmentId: 'gone', payerFormId: 'form-1', storage })
    ).rejects.toThrow(/Enrollment gone not found/);

    expect(prismaMock.enrollmentRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('rejects when PayerForm is not a PDF form', async () => {
    prismaMock.enrollmentRun.create.mockResolvedValue({ id: 'run-1' } as any);
    prismaMock.enrollmentRun.update.mockResolvedValue({} as any);
    prismaMock.enrollment.findUnique.mockResolvedValue({
      providerId: 'p',
      payerId: 'py',
    } as any);
    prismaMock.payerForm.findUnique.mockResolvedValue({
      id: 'form-1',
      deliveryEngine: 'browser',
      assetUrl: null,
    } as any);

    await expect(
      runPdfFill({ enrollmentId: 'enr-1', payerFormId: 'form-1', storage: stubStorage(new Uint8Array()) })
    ).rejects.toThrow(/expected 'pdf'/);
  });

  it('rejects when PDF form has no assetUrl', async () => {
    prismaMock.enrollmentRun.create.mockResolvedValue({ id: 'run-1' } as any);
    prismaMock.enrollmentRun.update.mockResolvedValue({} as any);
    prismaMock.enrollment.findUnique.mockResolvedValue({
      providerId: 'p',
      payerId: 'py',
    } as any);
    prismaMock.payerForm.findUnique.mockResolvedValue({
      id: 'form-1',
      deliveryEngine: 'pdf',
      assetUrl: null,
    } as any);

    await expect(
      runPdfFill({ enrollmentId: 'enr-1', payerFormId: 'form-1', storage: stubStorage(new Uint8Array()) })
    ).rejects.toThrow(/no assetUrl/);
  });

  it('reports missingRequired fields from the recipe', async () => {
    happyPathMocks();
    // Override mappings: source points at a path that resolves to null
    prismaMock.payerFormField.findMany.mockResolvedValue([
      {
        id: 'f1',
        fieldKey: 'provider_npi',
        fieldLabel: 'Provider NPI',
        fieldType: 'text',
        required: true,
        validationRegex: null,
        orderIndex: 0,
        mappings: [
          { sourceKind: 'provider', sourcePath: 'middleName', transform: null, fallbackValue: null, priority: 0 },
        ],
      },
    ] as any);

    const result = await runPdfFill({
      enrollmentId: 'enr-1',
      payerFormId: 'form-1',
      storage: stubStorage(await buildTemplate()),
    });

    expect(result.missingRequired).toEqual(['provider_npi']);
    // Still lands in awaiting_review so staff can fix missing data via review UI
    expect(result.artifact.filledCount).toBe(0);
  });

  it('reuses an existing EnrollmentRun when enrollmentRunId is provided', async () => {
    happyPathMocks();
    prismaMock.enrollmentRun.update.mockResolvedValueOnce({
      id: 'existing-run',
      filledArtifacts: [{ payerFormId: 'other-form', engine: 'pdf' }],
    } as any);

    await runPdfFill({
      enrollmentId: 'enr-1',
      payerFormId: 'form-1',
      enrollmentRunId: 'existing-run',
      storage: stubStorage(await buildTemplate()),
    });

    expect(prismaMock.enrollmentRun.create).not.toHaveBeenCalled();
    // First update re-sets status to filling on the existing run
    expect(prismaMock.enrollmentRun.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'existing-run' },
        data: expect.objectContaining({ status: 'filling' }),
      })
    );
  });
});
