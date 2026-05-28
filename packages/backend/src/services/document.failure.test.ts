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

vi.mock('../utils/prisma.js', () => ({
  prisma: {
    document: {
      update: mockDocumentUpdate,
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

// Mock AWS SDK clients — Textract.send needs to throw to exercise the failure path
const mockTextractSend = vi.fn();
const mockS3Send = vi.fn();

vi.mock('@aws-sdk/client-textract', () => ({
  TextractClient: vi.fn().mockImplementation(function (this: { send: typeof mockTextractSend }) {
    this.send = mockTextractSend;
  }),
  StartDocumentAnalysisCommand: vi.fn().mockImplementation(function (this: { input: unknown }, input: unknown) {
    this.input = input;
  }),
  GetDocumentAnalysisCommand: vi.fn().mockImplementation(function (this: { input: unknown }, input: unknown) {
    this.input = input;
  }),
}));

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

const { DocumentService } = await import('./document.service.js');

describe('DocumentService.startOcrProcessing — Textract failure path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Service constructor calls ensureBucketExists() which calls s3.send().
    // Make HeadBucket succeed so init doesn't crash.
    mockS3Send.mockResolvedValue({});
  });

  it('writes failureReason into ocrData when Textract throws', async () => {
    const service = new DocumentService();
    mockTextractSend.mockRejectedValue(new Error('Textract: invalid PDF format'));

    await service.startOcrProcessing('doc-id-123', 's3-key-456');

    // Expect TWO update calls:
    //   1. ocrStatus = 'processing' (start of try block)
    //   2. ocrStatus = 'failed' WITH failureReason populated (catch block)
    expect(mockDocumentUpdate).toHaveBeenCalledTimes(2);

    const failureCall = mockDocumentUpdate.mock.calls[1]![0];
    expect(failureCall).toMatchObject({
      where: { id: 'doc-id-123' },
      data: {
        ocrStatus: 'failed',
        ocrData: expect.objectContaining({
          failureReason: 'Textract: invalid PDF format',
          failedAt: expect.any(String),
        }),
      },
    });
  });

  it('failureReason defaults when the thrown error is not an Error instance', async () => {
    const service = new DocumentService();
    mockTextractSend.mockRejectedValue('string-error-not-Error-instance');

    await service.startOcrProcessing('doc-id-456', 's3-key-789');

    const failureCall = mockDocumentUpdate.mock.calls[1]![0];
    expect(failureCall.data.ocrData.failureReason).toBe('OCR processing failed');
  });
});
