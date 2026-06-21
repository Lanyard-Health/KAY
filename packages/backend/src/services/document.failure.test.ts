import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env['USE_LOCALSTACK'] = 'true';
  process.env['S3_BUCKET_NAME'] = 'test-bucket';
  process.env['AWS_REGION'] = 'us-east-1';
});

vi.mock('../utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mockDocumentUpdate = vi.fn();
const mockDocumentFindUnique = vi.fn();

vi.mock('../utils/prisma.js', () => ({
  prisma: {
    document: {
      update: mockDocumentUpdate,
      create: vi.fn(),
      findUnique: mockDocumentFindUnique,
    },
  },
}));

const mockS3Send = vi.fn();
const mockExtractWithVision = vi.fn();

// All S3 commands need function-expression constructors so `new XxxCommand(...)` works.
function makeCommandMock() {
  return vi.fn().mockImplementation(function (this: { input: unknown }, input: unknown) {
    this.input = input;
  });
}

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function (this: { send: typeof mockS3Send }) {
    this.send = mockS3Send;
  }),
  PutObjectCommand: makeCommandMock(),
  GetObjectCommand: makeCommandMock(),
  DeleteObjectCommand: makeCommandMock(),
  HeadBucketCommand: makeCommandMock(),
  CreateBucketCommand: makeCommandMock(),
  PutBucketCorsCommand: makeCommandMock(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/url'),
}));

vi.mock('../agents/document-classifier.js', () => ({
  classifyDocumentType: vi.fn(),
}));

vi.mock('../agents/extractors/vision-extractor.js', () => ({
  extractWithVision: mockExtractWithVision,
}));

function s3StreamBody(buf: Buffer) {
  return {
    Body: (async function* () {
      yield new Uint8Array(buf);
    })(),
  };
}

const { DocumentService } = await import('./document.service.js');

describe('DocumentService.runOcr — Claude vision failure path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Every s3.send returns a fresh readable body. Covers both the constructor's
    // ensureBucketExists() probes (which ignore the body) and downloadObject()
    // during runOcr — and dodges the ordering race a one-shot mock would create.
    mockS3Send.mockImplementation(async () => s3StreamBody(Buffer.from('PDF')));
    mockDocumentUpdate.mockResolvedValue({});
    mockDocumentFindUnique.mockResolvedValue({
      id: 'doc-id-123',
      s3Key: 's3-key-456',
      mimeType: 'application/pdf',
      documentType: 'license',
      providerId: 'p1',
    });
  });

  it('writes failureReason into ocrData when extraction throws', async () => {
    const service = new DocumentService();
    // GetObject during downloadObject succeeds; the vision call is what fails.
    mockExtractWithVision.mockRejectedValue(new Error('Vision: invalid PDF format'));

    await service.runOcr('doc-id-123');

    // Expect TWO update calls: processing (start) then failed (catch).
    expect(mockDocumentUpdate).toHaveBeenCalledTimes(2);
    const failureCall = mockDocumentUpdate.mock.calls[1]![0];
    expect(failureCall).toMatchObject({
      where: { id: 'doc-id-123' },
      data: {
        ocrStatus: 'failed',
        ocrData: { failureReason: 'Vision: invalid PDF format' },
      },
    });
  });

  it('failureReason defaults when the thrown value is not an Error instance', async () => {
    const service = new DocumentService();
    mockExtractWithVision.mockRejectedValue('string-error-not-Error-instance');

    await service.runOcr('doc-id-456');

    const failureCall = mockDocumentUpdate.mock.calls[1]![0];
    expect(failureCall.data.ocrData.failureReason).toBe('OCR failed');
  });
});
