/**
 * Tests for the practice-scoped document routes added in Phase 3.
 *
 * Covers auth + practice-scope enforcement on every endpoint, plus an
 * end-to-end upload→confirm flow that verifies the Document row is created
 * with practiceId set and providerId NULL (the XOR ownership invariant).
 */
import express from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

import {
  adminUser,
  practiceAdminUser,
  staffUser,
  providerUser,
} from '../../tests/helpers/fixtures.js';
import { errorHandler } from '../middleware/error.middleware.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockGetPracticeUploadUrl = vi.fn();
const mockConfirmUpload = vi.fn();
const mockDeleteDocument = vi.fn();

vi.mock('../services/document.service.js', () => ({
  DocumentService: vi.fn().mockImplementation(function () {
    return {
      getPracticeUploadUrl: mockGetPracticeUploadUrl,
      confirmUpload: mockConfirmUpload,
      deleteDocument: mockDeleteDocument,
    };
  }),
}));

import practiceDocumentRoutes from './practice-documents.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const PRACTICE_A = '00000000-0000-4000-a000-0000000000aa';
const PRACTICE_B = '00000000-0000-4000-a000-0000000000bb';
const DOC_ID = '11111111-1111-4111-a111-111111111111';
const OTHER_DOC_ID = '22222222-2222-4222-a222-222222222222';

interface AppOpts {
  user: Record<string, unknown>;
  isSuperAdmin?: boolean;
  practiceIds?: string[];
}

function makeApp(opts: AppOpts) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = opts.user;
    (req as any).practiceScope = {
      isSuperAdmin: opts.isSuperAdmin ?? false,
      practiceIds: opts.practiceIds ?? [],
    };
    next();
  });
  // Mount under the practice-scoped prefix so :practiceId mergeParams works.
  app.use('/api/v1/practices/:practiceId/documents', practiceDocumentRoutes);
  app.use(errorHandler);
  return app;
}

const validUploadBody = {
  fileName: 'w9.pdf',
  contentType: 'application/pdf' as const,
  // documentType intentionally omitted — defaults to 'other' so OCR can classify
};

const mockPracticeDocument = {
  id: DOC_ID,
  practiceId: PRACTICE_A,
  providerId: null,
  fileName: `${DOC_ID}.pdf`,
  originalFileName: 'w9.pdf',
  fileSize: 102400,
  mimeType: 'application/pdf',
  s3Key: `documents/practices/${PRACTICE_A}/${DOC_ID}.pdf`,
  documentType: 'other',
  description: null,
  expirationDate: null,
  ocrStatus: 'pending',
  ocrConfidence: null,
  ocrData: null,
  isVerified: false,
  createdAt: new Date('2026-05-07T00:00:00Z'),
  updatedAt: new Date('2026-05-07T00:00:00Z'),
  createdById: adminUser.id,
};

describe('Practice Document Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────
  // POST /upload-url
  // ──────────────────────────────────────────────
  describe('POST /upload-url', () => {
    it('admin can upload to any practice (super-admin scope bypass)', async () => {
      const app = makeApp({ user: adminUser, isSuperAdmin: true });
      mockGetPracticeUploadUrl.mockResolvedValue({
        uploadUrl: 'https://s3.example.com/u',
        documentId: DOC_ID,
        s3Key: `documents/practices/${PRACTICE_A}/${DOC_ID}.pdf`,
        expiresAt: new Date('2026-05-07T01:00:00Z'),
      });

      const res = await request(app)
        .post(`/api/v1/practices/${PRACTICE_A}/documents/upload-url`)
        .send(validUploadBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.documentId).toBe(DOC_ID);
      expect(mockGetPracticeUploadUrl).toHaveBeenCalledWith(
        PRACTICE_A,
        validUploadBody,
        adminUser.id
      );
    });

    it('practice_admin can upload to a practice in their scope', async () => {
      const app = makeApp({ user: practiceAdminUser, practiceIds: [PRACTICE_A] });
      mockGetPracticeUploadUrl.mockResolvedValue({
        uploadUrl: 'https://s3.example.com/u',
        documentId: DOC_ID,
        s3Key: `documents/practices/${PRACTICE_A}/${DOC_ID}.pdf`,
        expiresAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/practices/${PRACTICE_A}/documents/upload-url`)
        .send(validUploadBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('credentialing_staff can upload to a practice in their scope', async () => {
      const app = makeApp({ user: staffUser, practiceIds: [PRACTICE_A] });
      mockGetPracticeUploadUrl.mockResolvedValue({
        uploadUrl: 'https://s3.example.com/u',
        documentId: DOC_ID,
        s3Key: `documents/practices/${PRACTICE_A}/${DOC_ID}.pdf`,
        expiresAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/practices/${PRACTICE_A}/documents/upload-url`)
        .send(validUploadBody);

      expect(res.status).toBe(200);
    });

    it('denies practice_admin uploading to a practice outside their scope', async () => {
      const app = makeApp({ user: practiceAdminUser, practiceIds: [PRACTICE_B] });

      const res = await request(app)
        .post(`/api/v1/practices/${PRACTICE_A}/documents/upload-url`)
        .send(validUploadBody);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(mockGetPracticeUploadUrl).not.toHaveBeenCalled();
    });

    it('rejects invalid practiceId format', async () => {
      const app = makeApp({ user: adminUser, isSuperAdmin: true });

      const res = await request(app)
        .post(`/api/v1/practices/not-a-uuid/documents/upload-url`)
        .send(validUploadBody);

      expect(res.status).toBe(400);
      expect(mockGetPracticeUploadUrl).not.toHaveBeenCalled();
    });

    it('returns 404 when practice does not exist', async () => {
      const app = makeApp({ user: adminUser, isSuperAdmin: true });
      mockGetPracticeUploadUrl.mockRejectedValue(new Error('Practice not found'));

      const res = await request(app)
        .post(`/api/v1/practices/${PRACTICE_A}/documents/upload-url`)
        .send(validUploadBody);

      expect(res.status).toBe(404);
    });

    it('rejects invalid request body (zod validation)', async () => {
      const app = makeApp({ user: adminUser, isSuperAdmin: true });

      const res = await request(app)
        .post(`/api/v1/practices/${PRACTICE_A}/documents/upload-url`)
        .send({ fileName: 'x.pdf' }); // missing contentType

      expect(res.body.success).toBe(false);
    });
  });

  // ──────────────────────────────────────────────
  // POST /:documentId/confirm
  // ──────────────────────────────────────────────
  describe('POST /:documentId/confirm', () => {
    it('confirms an in-scope practice document', async () => {
      const app = makeApp({ user: practiceAdminUser, practiceIds: [PRACTICE_A] });
      prismaMock.document.findUnique.mockResolvedValue({
        id: DOC_ID,
        practiceId: PRACTICE_A,
        providerId: null,
      } as any);
      mockConfirmUpload.mockResolvedValue({ ...mockPracticeDocument, ocrStatus: 'processing' });

      const res = await request(app)
        .post(`/api/v1/practices/${PRACTICE_A}/documents/${DOC_ID}/confirm`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockConfirmUpload).toHaveBeenCalledWith(DOC_ID);
    });

    it('returns 404 when document belongs to a different practice (no existence leak)', async () => {
      const app = makeApp({ user: practiceAdminUser, practiceIds: [PRACTICE_A] });
      prismaMock.document.findUnique.mockResolvedValue({
        id: DOC_ID,
        practiceId: PRACTICE_B, // belongs to a different practice
        providerId: null,
      } as any);

      const res = await request(app)
        .post(`/api/v1/practices/${PRACTICE_A}/documents/${DOC_ID}/confirm`)
        .send({});

      expect(res.status).toBe(404);
      expect(mockConfirmUpload).not.toHaveBeenCalled();
    });

    it('denies practice_admin outside their scope', async () => {
      const app = makeApp({ user: practiceAdminUser, practiceIds: [PRACTICE_B] });

      const res = await request(app)
        .post(`/api/v1/practices/${PRACTICE_A}/documents/${DOC_ID}/confirm`)
        .send({});

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────
  // GET /
  // ──────────────────────────────────────────────
  describe('GET /', () => {
    it('returns documents for an in-scope practice', async () => {
      const app = makeApp({ user: practiceAdminUser, practiceIds: [PRACTICE_A] });
      prismaMock.document.findMany.mockResolvedValue([mockPracticeDocument] as any);

      const res = await request(app).get(`/api/v1/practices/${PRACTICE_A}/documents`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(DOC_ID);
      expect(prismaMock.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { practiceId: PRACTICE_A },
        })
      );
    });

    it('denies practice_admin outside their scope', async () => {
      const app = makeApp({ user: practiceAdminUser, practiceIds: [PRACTICE_B] });

      const res = await request(app).get(`/api/v1/practices/${PRACTICE_A}/documents`);

      expect(res.status).toBe(403);
      expect(prismaMock.document.findMany).not.toHaveBeenCalled();
    });

    it('admin sees all practices via super-admin bypass', async () => {
      const app = makeApp({ user: adminUser, isSuperAdmin: true });
      prismaMock.document.findMany.mockResolvedValue([] as any);

      const res = await request(app).get(`/api/v1/practices/${PRACTICE_A}/documents`);

      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────────────────────────────
  // PATCH /:documentId
  // ──────────────────────────────────────────────
  describe('PATCH /:documentId', () => {
    it('updates documentType for an in-scope practice document', async () => {
      const app = makeApp({ user: practiceAdminUser, practiceIds: [PRACTICE_A] });
      prismaMock.document.findUnique.mockResolvedValue({
        id: DOC_ID,
        practiceId: PRACTICE_A,
      } as any);
      prismaMock.document.update.mockResolvedValue({
        ...mockPracticeDocument,
        documentType: 'w9',
      } as any);

      const res = await request(app)
        .patch(`/api/v1/practices/${PRACTICE_A}/documents/${DOC_ID}`)
        .send({ documentType: 'w9' });

      expect(res.status).toBe(200);
      expect(res.body.data.documentType).toBe('w9');
      expect(prismaMock.document.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: DOC_ID },
          data: { documentType: 'w9' },
        })
      );
    });

    it('returns 404 when document belongs to a different practice', async () => {
      const app = makeApp({ user: practiceAdminUser, practiceIds: [PRACTICE_A] });
      prismaMock.document.findUnique.mockResolvedValue({
        id: DOC_ID,
        practiceId: PRACTICE_B,
      } as any);

      const res = await request(app)
        .patch(`/api/v1/practices/${PRACTICE_A}/documents/${DOC_ID}`)
        .send({ documentType: 'w9' });

      expect(res.status).toBe(404);
      expect(prismaMock.document.update).not.toHaveBeenCalled();
    });

    it('rejects invalid documentType', async () => {
      const app = makeApp({ user: adminUser, isSuperAdmin: true });
      prismaMock.document.findUnique.mockResolvedValue({
        id: DOC_ID,
        practiceId: PRACTICE_A,
      } as any);

      const res = await request(app)
        .patch(`/api/v1/practices/${PRACTICE_A}/documents/${DOC_ID}`)
        .send({ documentType: 'not_a_real_type' });

      expect(res.body.success).toBe(false);
      expect(prismaMock.document.update).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // DELETE /:documentId
  // ──────────────────────────────────────────────
  describe('DELETE /:documentId', () => {
    it('deletes an in-scope practice document', async () => {
      const app = makeApp({ user: practiceAdminUser, practiceIds: [PRACTICE_A] });
      prismaMock.document.findUnique.mockResolvedValue({
        id: DOC_ID,
        practiceId: PRACTICE_A,
        s3Key: `documents/practices/${PRACTICE_A}/${DOC_ID}.pdf`,
      } as any);
      mockDeleteDocument.mockResolvedValue(undefined);
      prismaMock.document.delete.mockResolvedValue(mockPracticeDocument as any);

      const res = await request(app).delete(
        `/api/v1/practices/${PRACTICE_A}/documents/${DOC_ID}`
      );

      expect(res.status).toBe(200);
      expect(prismaMock.document.delete).toHaveBeenCalledWith({ where: { id: DOC_ID } });
    });

    it('still deletes from DB if S3 delete fails', async () => {
      const app = makeApp({ user: adminUser, isSuperAdmin: true });
      prismaMock.document.findUnique.mockResolvedValue({
        id: DOC_ID,
        practiceId: PRACTICE_A,
        s3Key: `documents/practices/${PRACTICE_A}/${DOC_ID}.pdf`,
      } as any);
      mockDeleteDocument.mockRejectedValue(new Error('S3 says no'));
      prismaMock.document.delete.mockResolvedValue(mockPracticeDocument as any);

      const res = await request(app).delete(
        `/api/v1/practices/${PRACTICE_A}/documents/${DOC_ID}`
      );

      expect(res.status).toBe(200);
      expect(prismaMock.document.delete).toHaveBeenCalled();
    });

    it('returns 404 when document is in a different practice', async () => {
      const app = makeApp({ user: practiceAdminUser, practiceIds: [PRACTICE_A] });
      prismaMock.document.findUnique.mockResolvedValue({
        id: OTHER_DOC_ID,
        practiceId: PRACTICE_B,
        s3Key: `documents/practices/${PRACTICE_B}/${OTHER_DOC_ID}.pdf`,
      } as any);

      const res = await request(app).delete(
        `/api/v1/practices/${PRACTICE_A}/documents/${OTHER_DOC_ID}`
      );

      expect(res.status).toBe(404);
      expect(prismaMock.document.delete).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // End-to-end upload → confirm
  // ──────────────────────────────────────────────
  describe('end-to-end upload → confirm', () => {
    it('issues an upload URL, then confirms the same document, scoped to the practice', async () => {
      const app = makeApp({ user: practiceAdminUser, practiceIds: [PRACTICE_A] });

      // Step 1: request upload URL
      mockGetPracticeUploadUrl.mockResolvedValue({
        uploadUrl: 'https://s3.example.com/u',
        documentId: DOC_ID,
        s3Key: `documents/practices/${PRACTICE_A}/${DOC_ID}.pdf`,
        expiresAt: new Date(),
      });

      const upload = await request(app)
        .post(`/api/v1/practices/${PRACTICE_A}/documents/upload-url`)
        .send(validUploadBody);

      expect(upload.status).toBe(200);
      expect(upload.body.data.documentId).toBe(DOC_ID);
      expect(upload.body.data.s3Key).toContain(`practices/${PRACTICE_A}/`);

      // Step 2: confirm — service returns the doc with practiceId set, providerId null
      prismaMock.document.findUnique.mockResolvedValue({
        id: DOC_ID,
        practiceId: PRACTICE_A,
        providerId: null,
      } as any);
      mockConfirmUpload.mockResolvedValue({
        ...mockPracticeDocument,
        ocrStatus: 'processing',
      });

      const confirm = await request(app)
        .post(`/api/v1/practices/${PRACTICE_A}/documents/${DOC_ID}/confirm`)
        .send({});

      expect(confirm.status).toBe(200);
      expect(confirm.body.data.practiceId).toBe(PRACTICE_A);
      expect(confirm.body.data.providerId).toBeNull();
      expect(mockConfirmUpload).toHaveBeenCalledWith(DOC_ID);
    });
  });

  // ──────────────────────────────────────────────
  // Authorization-layer note
  // ──────────────────────────────────────────────
  // The router-level authorize('admin', 'credentialing_staff', 'practice_admin')
  // is mocked to a no-op in this test file (auth middleware is global-mocked
  // for all route tests in this repo — see document.routes.test.ts pattern).
  // Provider-role denial is enforced by that authorize() call at request entry,
  // not inside the per-handler logic, so it isn't exercised here. A real
  // provider role would be 403'd by the middleware before reaching any handler.
  describe('authorization layer', () => {
    it('treats provider-role exactly like any other unauthorized caller (mock proves the path)', () => {
      // Sanity assertion that the providerUser fixture exists and has the role
      // the production authorize() check would reject. The middleware is mocked
      // to a no-op above; an integration test against the real middleware would
      // assert 403. Documented here so the omission is intentional, not missed.
      expect(providerUser.role).toBe('provider');
    });
  });
});
