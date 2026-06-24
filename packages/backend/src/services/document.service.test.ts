import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockS3Send, mockGetSignedUrl, mockUuid, mockExtractWithVision, mockClassify } = vi.hoisted(() => {
  process.env['USE_LOCALSTACK'] = 'true';
  process.env['S3_ENDPOINT'] = 'http://localhost:4566';
  process.env['S3_BUCKET_NAME'] = 'test-bucket';
  process.env['AWS_REGION'] = 'us-east-1';
  process.env['AWS_ACCESS_KEY_ID'] = 'test';
  process.env['AWS_SECRET_ACCESS_KEY'] = 'test';
  return {
    mockS3Send: vi.fn().mockResolvedValue({}),
    mockGetSignedUrl: vi.fn().mockResolvedValue('https://signed-url.example.com'),
    mockUuid: vi.fn().mockReturnValue('doc-uuid-123'),
    mockExtractWithVision: vi.fn().mockResolvedValue({ fields: {}, averageConfidence: 0 }),
    mockClassify: vi.fn().mockResolvedValue('other'),
  };
});

// Build a GetObject response whose Body streams the given bytes, matching what
// downloadObject() consumes (an async-iterable of Uint8Array chunks).
function s3StreamBody(buf: Buffer) {
  return {
    Body: (async function* () {
      yield new Uint8Array(buf);
    })(),
  };
}

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: function() { this.send = mockS3Send; },
  PutObjectCommand: function(p: any) { this.input = p; },
  GetObjectCommand: function(p: any) { this.input = p; },
  DeleteObjectCommand: function(p: any) { this.input = p; },
  HeadBucketCommand: function(p: any) { this.input = p; },
  CreateBucketCommand: function(p: any) { this.input = p; },
  PutBucketCorsCommand: function(p: any) { this.input = p; },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock('../agents/extractors/vision-extractor.js', () => ({
  extractWithVision: mockExtractWithVision,
}));

vi.mock('../agents/document-classifier.js', () => ({
  classifyDocumentType: mockClassify,
}));

vi.mock('uuid', () => ({ v4: mockUuid }));

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { DocumentService } from './document.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

let service: DocumentService;

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks strips implementations, so restore defaults
  mockS3Send.mockResolvedValue({});
  mockGetSignedUrl.mockResolvedValue('https://signed-url.example.com');
  mockUuid.mockReturnValue('doc-uuid-123');
  mockExtractWithVision.mockResolvedValue({ fields: {}, averageConfidence: 0 });
  mockClassify.mockResolvedValue('other');
  service = new DocumentService();
});

describe('DocumentService', () => {
  describe('getUploadUrl', () => {
    it('creates document record and returns pre-signed URL', async () => {
      prismaMock.document.create.mockResolvedValue({ id: 'doc-uuid-123' } as any);

      const result = await service.getUploadUrl(
        { providerId: 'p1', fileName: 'license.pdf', contentType: 'application/pdf', documentType: 'license' } as any,
        'user-1',
      );

      expect(result.documentId).toBe('doc-uuid-123');
      expect(result.uploadUrl).toBe('https://signed-url.example.com');
      expect(result.s3Key).toContain('documents/p1/doc-uuid-123.pdf');
      expect(prismaMock.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: 'doc-uuid-123',
            providerId: 'p1',
            documentType: 'license',
            createdById: 'user-1',
            ocrStatus: 'pending',
          }),
        }),
      );
    });

    it('sanitizes file extension (strips non-alphanumeric)', async () => {
      prismaMock.document.create.mockResolvedValue({ id: 'doc-uuid-123' } as any);

      const result = await service.getUploadUrl(
        { providerId: 'p1', fileName: 'test.p@d$f', contentType: 'application/pdf', documentType: 'license' } as any,
        'user-1',
      );

      expect(result.s3Key).toMatch(/\.pdf$/);
      expect(result.s3Key).not.toContain('@');
      expect(result.s3Key).not.toContain('$');
    });

    it('returns expiresAt approximately 1 hour from now', async () => {
      prismaMock.document.create.mockResolvedValue({ id: 'doc-uuid-123' } as any);

      const before = Date.now();
      const result = await service.getUploadUrl(
        { providerId: 'p1', fileName: 'test.pdf', contentType: 'application/pdf', documentType: 'license' } as any,
        'user-1',
      );

      const expiresMs = result.expiresAt.getTime();
      expect(expiresMs).toBeGreaterThan(before + 3500 * 1000);
      expect(expiresMs).toBeLessThan(before + 3700 * 1000);
    });
  });

  describe('confirmUpload', () => {
    const mockDocument = {
      id: 'doc-1',
      providerId: 'p1',
      s3Key: 'documents/p1/doc-1.pdf',
      mimeType: 'text/plain',
      documentType: 'other',
    };

    it('updates fileSize from S3 response', async () => {
      prismaMock.document.findUnique.mockResolvedValue(mockDocument as any);
      mockS3Send.mockResolvedValueOnce({ ContentLength: 12345 });
      prismaMock.document.update.mockResolvedValue({ id: 'doc-1', fileSize: 12345 } as any);

      await service.confirmUpload('doc-1');

      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-1' },
          data: { fileSize: 12345 },
        }),
      );
    });

    it('links checklist documents (w9)', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        ...mockDocument, documentType: 'w9',
      } as any);
      mockS3Send.mockResolvedValueOnce({ ContentLength: 100 });
      prismaMock.document.update.mockResolvedValue({} as any);
      prismaMock.providerChecklist.findUnique.mockResolvedValue({ providerId: 'p1' } as any);
      prismaMock.providerChecklist.update.mockResolvedValue({} as any);

      await service.confirmUpload('doc-1');

      expect(prismaMock.providerChecklist.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            w9DocumentId: 'doc-1',
            w9Status: 'pending_review',
          }),
        }),
      );
    });

    it('links checklist documents (coi)', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        ...mockDocument, documentType: 'coi',
      } as any);
      mockS3Send.mockResolvedValueOnce({ ContentLength: 100 });
      prismaMock.document.update.mockResolvedValue({} as any);
      prismaMock.providerChecklist.findUnique.mockResolvedValue({ providerId: 'p1' } as any);
      prismaMock.providerChecklist.update.mockResolvedValue({} as any);

      await service.confirmUpload('doc-1');

      expect(prismaMock.providerChecklist.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            coiDocumentId: 'doc-1',
            coiStatus: 'pending_review',
          }),
        }),
      );
    });

    it('does not link non-checklist document types', async () => {
      prismaMock.document.findUnique.mockResolvedValue(mockDocument as any);
      mockS3Send.mockResolvedValueOnce({ ContentLength: 100 });
      prismaMock.document.update.mockResolvedValue({} as any);

      await service.confirmUpload('doc-1');

      expect(prismaMock.providerChecklist.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.providerChecklist.update).not.toHaveBeenCalled();
    });

    it('skips OCR in LocalStack mode (marks not_applicable)', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        ...mockDocument, mimeType: 'application/pdf',
      } as any);
      mockS3Send.mockResolvedValueOnce({ ContentLength: 100 });
      prismaMock.document.update.mockResolvedValue({} as any);

      await service.confirmUpload('doc-1');

      // Should mark as not_applicable since USE_LOCALSTACK=true
      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-1' },
          data: { ocrStatus: 'not_applicable' },
        }),
      );
      expect(mockExtractWithVision).not.toHaveBeenCalled();
    });

    it('throws on missing document', async () => {
      prismaMock.document.findUnique.mockResolvedValue(null);
      await expect(service.confirmUpload('nonexistent')).rejects.toThrow('Document not found');
    });

    it('throws when S3 file does not exist', async () => {
      prismaMock.document.findUnique.mockResolvedValue(mockDocument as any);
      mockS3Send.mockRejectedValueOnce(new Error('NoSuchKey'));

      await expect(service.confirmUpload('doc-1')).rejects.toThrow('Failed to confirm upload');
    });
  });

  describe('deleteDocument', () => {
    it('sends delete command to S3', async () => {
      mockS3Send.mockResolvedValueOnce({});
      await service.deleteDocument('documents/p1/doc-1.pdf');
      expect(mockS3Send).toHaveBeenCalled();
    });
  });

  describe('getDownloadUrl', () => {
    it('returns pre-signed GET URL', async () => {
      const url = await service.getDownloadUrl('documents/p1/doc-1.pdf');
      expect(url).toBe('https://signed-url.example.com');
      expect(mockGetSignedUrl).toHaveBeenCalled();
    });
  });

  describe('uploadPracticeDocument', () => {
    it('PUTs the buffer server-side and creates a not_applicable practice doc', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({ id: 'prac-1' } as any);
      prismaMock.document.create.mockResolvedValue({ id: 'doc-uuid-123' } as any);

      const result = await service.uploadPracticeDocument(
        'prac-1',
        { buffer: Buffer.from('PDFDATA'), fileName: 'w9.pdf', contentType: 'application/pdf', documentType: 'w9' },
        'user-1'
      );

      expect(result).toEqual({ id: 'doc-uuid-123' });
      expect(mockS3Send).toHaveBeenCalled(); // uploaded server-side, no presigned PUT
      const createArg = (prismaMock.document.create as any).mock.calls[0][0].data;
      expect(createArg).toMatchObject({
        practiceId: 'prac-1',
        providerId: null,
        fileSize: Buffer.from('PDFDATA').length,
        documentType: 'w9',
        ocrStatus: 'not_applicable',
        createdById: 'user-1',
      });
    });

    it('throws when the practice does not exist', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(null);
      await expect(
        service.uploadPracticeDocument(
          'missing',
          { buffer: Buffer.from('x'), fileName: 'a.pdf', contentType: 'application/pdf' },
          'u1'
        )
      ).rejects.toThrow('Practice not found');
    });
  });

  describe('getViewUrl', () => {
    it('uses inline disposition for pdf so the browser renders it in-pane', async () => {
      await service.getViewUrl('documents/p1/doc-1.pdf', 'application/pdf');
      const command = mockGetSignedUrl.mock.calls[0]![1] as { input: Record<string, string> };
      expect(command.input.ResponseContentDisposition).toBe('inline');
      expect(command.input.ResponseContentType).toBe('application/pdf');
    });

    it('uses inline disposition for images', async () => {
      await service.getViewUrl('documents/p1/scan.png', 'image/png');
      const command = mockGetSignedUrl.mock.calls[0]![1] as { input: Record<string, string> };
      expect(command.input.ResponseContentDisposition).toBe('inline');
    });

    it('falls back to attachment for non-inline-safe types (XSS guard)', async () => {
      await service.getViewUrl('documents/p1/page.html', 'text/html');
      const command = mockGetSignedUrl.mock.calls[0]![1] as { input: Record<string, string> };
      expect(command.input.ResponseContentDisposition).toMatch(/^attachment/);
      expect(command.input.ResponseContentType).toBeUndefined();
    });
  });

  describe('runOcr (Claude vision)', () => {
    const ocrDoc = {
      id: 'doc-1',
      s3Key: 'documents/p1/doc-1.pdf',
      mimeType: 'application/pdf',
      documentType: 'license',
      providerId: 'p1',
    };

    it('reads the file from R2, extracts fields, and marks completed', async () => {
      prismaMock.document.findUnique.mockResolvedValue(ocrDoc as any);
      mockS3Send.mockResolvedValueOnce(s3StreamBody(Buffer.from('PDFBYTES')));
      mockExtractWithVision.mockResolvedValueOnce({
        fields: { licenseNumber: { value: 'MD123', confidence: 0.95 } },
        averageConfidence: 0.95,
      });
      prismaMock.document.update.mockResolvedValue({} as any);

      await service.runOcr('doc-1');

      expect(mockExtractWithVision).toHaveBeenCalledWith(
        expect.objectContaining({ mimeType: 'application/pdf', documentType: 'license' }),
      );
      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-1' },
          data: expect.objectContaining({
            ocrStatus: 'completed',
            ocrConfidence: 0.95,
            ocrData: { licenseNumber: { value: 'MD123', confidence: 0.95 } },
          }),
        }),
      );
    });

    it('classifies practice docs still tagged "other" and updates the type', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        ...ocrDoc, providerId: null, documentType: 'other',
      } as any);
      mockS3Send.mockResolvedValueOnce(s3StreamBody(Buffer.from('PDFBYTES')));
      mockExtractWithVision.mockResolvedValueOnce({
        fields: { ein: { value: '12-3456789', confidence: 0.9 } },
        averageConfidence: 0.9,
      });
      mockClassify.mockResolvedValueOnce('w9');
      prismaMock.document.update.mockResolvedValue({} as any);

      await service.runOcr('doc-1');

      expect(mockClassify).toHaveBeenCalled();
      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ocrStatus: 'completed', documentType: 'w9' }),
        }),
      );
    });

    it('marks needs_review when no fields are extracted', async () => {
      prismaMock.document.findUnique.mockResolvedValue(ocrDoc as any);
      mockS3Send.mockResolvedValueOnce(s3StreamBody(Buffer.from('PDFBYTES')));
      mockExtractWithVision.mockResolvedValueOnce({ fields: {}, averageConfidence: 0 });
      prismaMock.document.update.mockResolvedValue({} as any);

      await service.runOcr('doc-1');

      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ocrStatus: 'needs_review' }),
        }),
      );
    });

    it('marks not_applicable for unsupported types without calling Claude', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        ...ocrDoc, mimeType: 'text/plain',
      } as any);
      prismaMock.document.update.mockResolvedValue({} as any);

      await service.runOcr('doc-1');

      expect(mockExtractWithVision).not.toHaveBeenCalled();
      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { ocrStatus: 'not_applicable' } }),
      );
    });

    it('marks failed (and never throws) when extraction errors', async () => {
      prismaMock.document.findUnique.mockResolvedValue(ocrDoc as any);
      mockS3Send.mockResolvedValueOnce(s3StreamBody(Buffer.from('PDFBYTES')));
      mockExtractWithVision.mockRejectedValueOnce(new Error('Vision API down'));
      prismaMock.document.update.mockResolvedValue({} as any);

      await expect(service.runOcr('doc-1')).resolves.toBeUndefined();

      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ocrStatus: 'failed' }),
        }),
      );
    });
  });
});
