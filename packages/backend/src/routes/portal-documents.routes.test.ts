import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { providerUser as baseProviderUser } from '../../tests/helpers/fixtures.js';

// Override providerId with a UUID since uploadUrlRequestSchema validates it
const providerUser = { ...baseProviderUser, providerId: 'd0000000-0000-4000-a000-000000000001' };

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { mockGetUploadUrl, mockConfirmUpload, mockDeleteDocument } = vi.hoisted(() => ({
  mockGetUploadUrl: vi.fn(),
  mockConfirmUpload: vi.fn(),
  mockDeleteDocument: vi.fn(),
}));

vi.mock('../services/document.service.js', () => ({
  DocumentService: vi.fn().mockImplementation(function () { return {
    getUploadUrl: mockGetUploadUrl,
    confirmUpload: mockConfirmUpload,
    deleteDocument: mockDeleteDocument,
  }; }),
}));

import portalDocumentsRouter from './portal-documents.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { DocumentService } from '../services/document.service.js';

describe('Portal Documents Routes', () => {
  const app = createTestApp(portalDocumentsRouter, providerUser);

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply constructor implementation after clearAllMocks wipes it
    vi.mocked(DocumentService).mockImplementation(function () { return {
      getUploadUrl: mockGetUploadUrl,
      confirmUpload: mockConfirmUpload,
      deleteDocument: mockDeleteDocument,
    } as any; });
  });

  describe('GET /', () => {
    it('returns documents for provider', async () => {
      const mockDocs = [
        { id: 'doc-1', originalFileName: 'w9.pdf', documentType: 'w9', reviewStatus: 'pending' },
      ];
      prismaMock.document.findMany.mockResolvedValue(mockDocs as any);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(prismaMock.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId: 'd0000000-0000-4000-a000-000000000001' },
        })
      );
    });

    it('returns 404 when user has no providerId', async () => {
      const noProviderUser = { ...providerUser, providerId: undefined };
      const appNoProvider = createTestApp(portalDocumentsRouter, noProviderUser);

      const res = await request(appNoProvider).get('/');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /upload-url', () => {
    const validUpload = {
      fileName: 'w9.pdf',
      contentType: 'application/pdf',
      documentType: 'w9',
    };

    it('returns presigned URL and marks document as portal upload', async () => {
      mockGetUploadUrl.mockResolvedValue({
        uploadUrl: 'https://s3.example.com/presigned',
        documentId: 'doc-new-id',
        s3Key: 'docs/w9.pdf',
      });
      prismaMock.document.update.mockResolvedValue({} as any);

      const res = await request(app).post('/upload-url').send(validUpload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-new-id' },
          data: { uploadedViaPortal: true, reviewStatus: 'pending' },
        })
      );
    });

    it('returns 400 when fileName is missing', async () => {
      const res = await request(app)
        .post('/upload-url')
        .send({ contentType: 'application/pdf', documentType: 'w9' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('fileName');
    });

    it('returns 400 when contentType is missing', async () => {
      const res = await request(app)
        .post('/upload-url')
        .send({ fileName: 'w9.pdf', documentType: 'w9' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('contentType');
    });

    it('returns 400 for invalid documentType', async () => {
      const res = await request(app)
        .post('/upload-url')
        .send({ ...validUpload, documentType: 'invalid_type' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('documentType');
    });

    it('returns structured Zod error with field path for invalid contentType', async () => {
      const res = await request(app)
        .post('/upload-url')
        .send({ fileName: 'test.exe', contentType: 'application/exe', documentType: 'w9' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      // Error should reference the invalid field
      expect(res.body.error).toContain('contentType');
    });

    it('accepts all valid document types', async () => {
      const validTypes = [
        'license', 'board_certification', 'malpractice_certificate', 'diploma',
        'transcript', 'cv_resume', 'photo', 'government_id', 'dea_certificate',
        'cds_certificate', 'cme_certificate', 'hospital_letter', 'reference_letter',
        'w9', 'coi', 'cp575', 'other',
      ];

      for (const documentType of validTypes) {
        mockGetUploadUrl.mockResolvedValue({
          uploadUrl: 'https://s3.example.com/presigned',
          documentId: 'doc-id',
          s3Key: 'key',
        });
        prismaMock.document.update.mockResolvedValue({} as any);

        const res = await request(app)
          .post('/upload-url')
          .send({ ...validUpload, documentType });

        expect(res.status).toBe(200);
      }
    });
  });

  describe('POST /confirm', () => {
    it('confirms upload when document belongs to provider', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        providerId: 'd0000000-0000-4000-a000-000000000001',
      } as any);
      mockConfirmUpload.mockResolvedValue({ id: 'doc-1', status: 'uploaded' });

      const res = await request(app)
        .post('/confirm')
        .send({ documentId: 'doc-1' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockConfirmUpload).toHaveBeenCalledWith('doc-1');
    });

    it('returns 400 when documentId is missing', async () => {
      const res = await request(app).post('/confirm').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('documentId');
    });

    it('returns 404 when document not found', async () => {
      prismaMock.document.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/confirm')
        .send({ documentId: 'nonexistent' });

      expect(res.status).toBe(404);
    });

    it('returns 404 when document belongs to another provider', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        providerId: 'other-provider-id',
      } as any);

      const res = await request(app)
        .post('/confirm')
        .send({ documentId: 'doc-1' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:id', () => {
    it('deletes document when it belongs to provider and is not approved', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        providerId: 'd0000000-0000-4000-a000-000000000001',
        reviewStatus: 'pending',
        s3Key: 'docs/w9.pdf',
      } as any);
      mockDeleteDocument.mockResolvedValue(undefined);
      prismaMock.document.delete.mockResolvedValue({} as any);

      const res = await request(app).delete('/doc-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockDeleteDocument).toHaveBeenCalledWith('docs/w9.pdf');
      expect(prismaMock.document.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'doc-1' } })
      );
    });

    it('returns 403 when document is approved', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        providerId: 'd0000000-0000-4000-a000-000000000001',
        reviewStatus: 'approved',
        s3Key: 'docs/w9.pdf',
      } as any);

      const res = await request(app).delete('/doc-1');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('approved');
    });

    it('returns 404 when document not found', async () => {
      prismaMock.document.findUnique.mockResolvedValue(null);

      const res = await request(app).delete('/nonexistent');

      expect(res.status).toBe(404);
    });

    it('returns 404 when document belongs to another provider', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        providerId: 'other-provider-id',
        reviewStatus: 'pending',
        s3Key: 'docs/w9.pdf',
      } as any);

      const res = await request(app).delete('/doc-1');

      expect(res.status).toBe(404);
    });

    it('allows deletion of rejected documents', async () => {
      prismaMock.document.findUnique.mockResolvedValue({
        providerId: 'd0000000-0000-4000-a000-000000000001',
        reviewStatus: 'rejected',
        s3Key: 'docs/w9.pdf',
      } as any);
      mockDeleteDocument.mockResolvedValue(undefined);
      prismaMock.document.delete.mockResolvedValue({} as any);

      const res = await request(app).delete('/doc-1');

      expect(res.status).toBe(200);
    });
  });
});
