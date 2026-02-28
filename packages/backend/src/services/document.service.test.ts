import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockS3Send, mockTextractSend, mockGetSignedUrl, mockUuid } = vi.hoisted(() => {
  process.env['USE_LOCALSTACK'] = 'true';
  process.env['S3_ENDPOINT'] = 'http://localhost:4566';
  process.env['S3_BUCKET_NAME'] = 'test-bucket';
  process.env['AWS_REGION'] = 'us-east-1';
  process.env['AWS_ACCESS_KEY_ID'] = 'test';
  process.env['AWS_SECRET_ACCESS_KEY'] = 'test';
  return {
    mockS3Send: vi.fn().mockResolvedValue({}),
    mockTextractSend: vi.fn().mockResolvedValue({}),
    mockGetSignedUrl: vi.fn().mockResolvedValue('https://signed-url.example.com'),
    mockUuid: vi.fn().mockReturnValue('doc-uuid-123'),
  };
});

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

vi.mock('@aws-sdk/client-textract', () => ({
  TextractClient: function() { this.send = mockTextractSend; },
  StartDocumentAnalysisCommand: function(p: any) { this.input = p; },
  GetDocumentAnalysisCommand: function(p: any) { this.input = p; },
}));

vi.mock('uuid', () => ({ v4: mockUuid }));

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
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
  mockTextractSend.mockResolvedValue({});
  mockGetSignedUrl.mockResolvedValue('https://signed-url.example.com');
  mockUuid.mockReturnValue('doc-uuid-123');
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

    it('returns expiresAt approximately 15 minutes from now', async () => {
      prismaMock.document.create.mockResolvedValue({ id: 'doc-uuid-123' } as any);

      const before = Date.now();
      const result = await service.getUploadUrl(
        { providerId: 'p1', fileName: 'test.pdf', contentType: 'application/pdf', documentType: 'license' } as any,
        'user-1',
      );

      const expiresMs = result.expiresAt.getTime();
      expect(expiresMs).toBeGreaterThan(before + 850 * 1000);
      expect(expiresMs).toBeLessThan(before + 950 * 1000);
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
      expect(mockTextractSend).not.toHaveBeenCalled();
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

  describe('handleOcrNotification', () => {
    it('processes completed OCR job', async () => {
      prismaMock.document.findMany.mockResolvedValue([{ id: 'doc-1' }] as any);
      mockTextractSend.mockResolvedValueOnce({
        JobStatus: 'SUCCEEDED',
        Blocks: [],
      });
      prismaMock.document.update.mockResolvedValue({} as any);

      await service.handleOcrNotification('job-123');

      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-1' },
          data: expect.objectContaining({ ocrStatus: 'completed' }),
        }),
      );
    });

    it('marks document failed when OCR job fails', async () => {
      prismaMock.document.findMany.mockResolvedValue([{ id: 'doc-1' }] as any);
      mockTextractSend.mockResolvedValueOnce({ JobStatus: 'FAILED' });
      prismaMock.document.update.mockResolvedValue({} as any);

      await service.handleOcrNotification('job-456');

      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { ocrStatus: 'failed' },
        }),
      );
    });

    it('does nothing when no document found for job', async () => {
      prismaMock.document.findMany.mockResolvedValue([]);
      await service.handleOcrNotification('job-999');
      expect(mockTextractSend).not.toHaveBeenCalled();
    });
  });
});
