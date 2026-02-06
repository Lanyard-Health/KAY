import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, providerUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  requireProviderAccess: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock the DocumentService lazy-load import
const mockGetUploadUrl = vi.fn();
const mockConfirmUpload = vi.fn();
const mockGetDownloadUrl = vi.fn();
const mockDeleteDocument = vi.fn();

vi.mock('../services/document.service.js', () => ({
  DocumentService: vi.fn().mockImplementation(() => ({
    getUploadUrl: mockGetUploadUrl,
    confirmUpload: mockConfirmUpload,
    getDownloadUrl: mockGetDownloadUrl,
    deleteDocument: mockDeleteDocument,
  })),
}));

import { documentRoutes } from './document.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const mockDocument = {
  id: 'doc-1-id',
  providerId: 'provider-1-id',
  fileName: 'abc123.pdf',
  originalFileName: 'license.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
  s3Key: 'documents/provider-1-id/abc123.pdf',
  documentType: 'license',
  description: null,
  ocrStatus: 'completed',
  ocrData: null,
  ocrConfidence: null,
  ocrReviewedAt: null,
  ocrReviewedBy: null,
  createdById: 'admin-user-id',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const validUploadUrlRequest = {
  providerId: 'provider-1-id',
  fileName: 'license.pdf',
  contentType: 'application/pdf',
  documentType: 'license',
};

describe('Document Routes', () => {
  const app = createTestApp(documentRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /upload-url', () => {
    it('generates upload URL when provider exists', async () => {
      prismaMock.provider.findUnique.mockResolvedValue({ id: 'provider-1-id', providerId: 'provider-1-id' } as any);
      mockGetUploadUrl.mockResolvedValue({
        uploadUrl: 'https://s3.example.com/presigned-url',
        documentId: 'new-doc-id',
        s3Key: 'documents/provider-1-id/new-doc-id.pdf',
        expiresAt: new Date(),
      });

      const res = await request(app)
        .post('/upload-url')
        .send(validUploadUrlRequest);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.uploadUrl).toBeDefined();
    });

    it('returns 404 when provider not found', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/upload-url')
        .send(validUploadUrlRequest);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 403 for provider user accessing other provider docs', async () => {
      const providerApp = createTestApp(documentRoutes, providerUser);
      prismaMock.provider.findUnique.mockResolvedValue({ id: 'other-provider-id' } as any);

      const res = await request(providerApp)
        .post('/upload-url')
        .send({ ...validUploadUrlRequest, providerId: 'other-provider-id' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('returns error on validation failure', async () => {
      const res = await request(app)
        .post('/upload-url')
        .send({ providerId: 'p1' }); // missing required fields

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('POST /confirm-upload', () => {
    it('confirms upload and returns document', async () => {
      prismaMock.document.findUnique.mockResolvedValue(mockDocument as any);
      mockConfirmUpload.mockResolvedValue(mockDocument);

      const res = await request(app)
        .post('/confirm-upload')
        .send({ documentId: 'doc-1-id' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when document not found', async () => {
      prismaMock.document.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/confirm-upload')
        .send({ documentId: 'nonexistent-id' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 403 when provider user accesses other provider document', async () => {
      const providerApp = createTestApp(documentRoutes, providerUser);
      prismaMock.document.findUnique.mockResolvedValue({
        ...mockDocument,
        providerId: 'other-provider-id',
      } as any);

      const res = await request(providerApp)
        .post('/confirm-upload')
        .send({ documentId: 'doc-1-id' });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /:id', () => {
    it('returns document with provider info', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        ...mockDocument,
        provider: { id: 'provider-1-id', firstName: 'Jane', lastName: 'Doe' },
      } as any);

      const res = await request(app).get('/doc-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('doc-1-id');
    });

    it('returns 404 when document not found', async () => {
      prismaMock.document.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 403 for wrong provider access', async () => {
      const providerApp = createTestApp(documentRoutes, providerUser);
      prismaMock.document.findUnique.mockResolvedValue({
        ...mockDocument,
        providerId: 'other-provider-id',
        provider: { id: 'other-provider-id', firstName: 'Other', lastName: 'Provider' },
      } as any);

      const res = await request(providerApp).get('/doc-1-id');

      expect(res.status).toBe(403);
    });
  });

  describe('GET /:id/download-url', () => {
    it('returns download URL', async () => {
      prismaMock.document.findUnique.mockResolvedValue(mockDocument as any);
      mockGetDownloadUrl.mockResolvedValue('https://s3.example.com/download-url');

      const res = await request(app).get('/doc-1-id/download-url');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBe('https://s3.example.com/download-url');
      expect(res.body.data.expiresIn).toBe(3600);
    });

    it('returns 404 when document not found', async () => {
      prismaMock.document.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/nonexistent-id/download-url');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /:id/ocr-results', () => {
    it('returns OCR data', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        id: 'doc-1-id',
        providerId: 'provider-1-id',
        ocrStatus: 'completed',
        ocrData: { name: { value: 'Jane Doe', confidence: 0.95 } },
        ocrConfidence: 0.95,
        ocrReviewedAt: null,
      } as any);

      const res = await request(app).get('/doc-1-id/ocr-results');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ocrStatus).toBe('completed');
    });

    it('returns 404 when document not found', async () => {
      prismaMock.document.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/nonexistent-id/ocr-results');

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /:id/ocr-results', () => {
    it('updates OCR results with reviewer info', async () => {
      prismaMock.document.findUnique.mockResolvedValue(mockDocument as any);
      prismaMock.document.update.mockResolvedValue({
        ...mockDocument,
        ocrData: { name: { value: 'Jane Doe', confidence: 0.99 } },
        ocrReviewedBy: 'admin-user-id',
      } as any);

      const res = await request(app)
        .put('/doc-1-id/ocr-results')
        .send({ extractedFields: { name: { value: 'Jane Doe', confidence: 0.99 } } });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ocrReviewedBy: 'admin-user-id',
            ocrReviewedAt: expect.any(Date),
          }),
        })
      );
    });

    it('returns 404 when document not found', async () => {
      prismaMock.document.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/nonexistent-id/ocr-results')
        .send({ extractedFields: {} });

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /:id', () => {
    it('updates document metadata', async () => {
      prismaMock.document.findUnique.mockResolvedValue(mockDocument as any);
      prismaMock.document.update.mockResolvedValue({
        ...mockDocument,
        documentType: 'board_certification',
        description: 'Updated description',
      } as any);

      const res = await request(app)
        .put('/doc-1-id')
        .send({ documentType: 'board_certification', description: 'Updated description' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when document not found', async () => {
      prismaMock.document.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/nonexistent-id')
        .send({ documentType: 'license' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:id', () => {
    it('deletes document from S3 and DB', async () => {
      prismaMock.document.findUnique.mockResolvedValue(mockDocument as any);
      mockDeleteDocument.mockResolvedValue(undefined);
      prismaMock.document.delete.mockResolvedValue(mockDocument as any);

      const res = await request(app).delete('/doc-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Document deleted');
      expect(mockDeleteDocument).toHaveBeenCalledWith(mockDocument.s3Key);
      expect(prismaMock.document.delete).toHaveBeenCalledWith({
        where: { id: 'doc-1-id' },
      });
    });

    it('still deletes from DB if S3 delete fails', async () => {
      prismaMock.document.findUnique.mockResolvedValue(mockDocument as any);
      mockDeleteDocument.mockRejectedValue(new Error('S3 error'));
      prismaMock.document.delete.mockResolvedValue(mockDocument as any);

      const res = await request(app).delete('/doc-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prismaMock.document.delete).toHaveBeenCalled();
    });

    it('returns 404 when document not found', async () => {
      prismaMock.document.findUnique.mockResolvedValue(null);

      const res = await request(app).delete('/nonexistent-id');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /provider/:providerId', () => {
    it('returns documents for a provider', async () => {
      prismaMock.document.findMany.mockResolvedValue([mockDocument] as any);

      const res = await request(app).get('/provider/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(prismaMock.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'provider-1-id' },
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('returns empty array when no documents', async () => {
      prismaMock.document.findMany.mockResolvedValue([]);

      const res = await request(app).get('/provider/provider-1-id');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });
});
