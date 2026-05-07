/**
 * Practice-scoped document routes (Phase 3).
 *
 * Mounted at /api/v1/practices/:practiceId/documents — uses mergeParams so
 * `req.params.practiceId` is available inside each handler.
 *
 * These routes operate exclusively on Documents owned by a Practice
 * (practiceId set, providerId NULL). The XOR check constraint on the
 * documents table guarantees this owner shape; all reads filter by
 * practiceId and all writes use DocumentService.getPracticeUploadUrl.
 *
 * Provider-scoped Documents continue to be served by the existing
 * /api/v1/documents routes — see document.routes.ts.
 *
 * NOTE for Phase 4 UI work — `Document.ocrData` is a JSON blob whose key
 * names are Textract's verbatim form-label readings, which are unpredictable
 * across documents (e.g. one W-9 may have key 'EIN', another may have
 * 'Employer identification number', another may have both as separate
 * entries). The UI should render ocrData as a flat key/value table rather
 * than looking up specific fields by exact name.
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ForbiddenError, NotFoundError } from '../middleware/error.middleware.js';
import {
  practiceUploadUrlRequestSchema,
  updatePracticeDocumentSchema,
} from '@credential-management/shared';
import { setAuditContext } from '../middleware/audit.middleware.js';

export const practiceDocumentRoutes = Router({ mergeParams: true });

practiceDocumentRoutes.use(authenticate);
practiceDocumentRoutes.use(
  authorize('admin', 'credentialing_staff', 'practice_admin')
);

// Lazy-load DocumentService (heavy S3/Textract SDKs) on first use.
let _documentService: import('../services/document.service.js').DocumentService | null = null;
async function getDocumentService() {
  if (!_documentService) {
    const { DocumentService } = await import('../services/document.service.js');
    _documentService = new DocumentService();
  }
  return _documentService;
}

/**
 * Practice-scope ACL helper. Mirrors the practice-only branches used elsewhere
 * (e.g. webhook subscriptions): admin bypass, otherwise the practice must be
 * in the user's practice scope.
 *
 * Throws ForbiddenError on miss — callers should let it propagate to the error
 * middleware. We deliberately throw 403 rather than 404 because the caller
 * already knows the practiceId (it's in the URL); leaking existence is not a
 * concern.
 */
async function assertPracticeDocumentAccess(
  req: Request,
  practiceId: string
): Promise<void> {
  if (req.practiceScope?.isSuperAdmin) return;
  const practiceIds = req.practiceScope?.practiceIds ?? [];
  if (!practiceIds.includes(practiceId)) {
    throw new ForbiddenError('Access denied to this practice');
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ──────────────────────────────────────────────
// POST /upload-url — request a presigned S3 PUT URL for a new practice doc
// ──────────────────────────────────────────────
practiceDocumentRoutes.post(
  '/upload-url',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId'];
      if (!practiceId || !UUID_RE.test(practiceId)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid practiceId' },
        });
      }
      await assertPracticeDocumentAccess(req, practiceId);

      const data = practiceUploadUrlRequestSchema.parse(req.body);

      setAuditContext(req, {
        resourceType: 'practice_document',
        action: 'create',
      });

      const result = await (await getDocumentService()).getPracticeUploadUrl(
        practiceId,
        data,
        req.user!.id
      );

      logger.info('Practice document upload URL issued', {
        practiceId,
        documentId: result.documentId,
        userId: req.user?.id,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      if ((error as Error).message === 'Practice not found') {
        return next(new NotFoundError('Practice'));
      }
      next(error);
    }
  }
);

// ──────────────────────────────────────────────
// POST /:documentId/confirm — confirm S3 upload, trigger OCR
// ──────────────────────────────────────────────
practiceDocumentRoutes.post(
  '/:documentId/confirm',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId'];
      const documentId = req.params['documentId'];
      if (!practiceId || !UUID_RE.test(practiceId)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid practiceId' },
        });
      }
      if (!documentId || !UUID_RE.test(documentId)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid documentId' },
        });
      }
      await assertPracticeDocumentAccess(req, practiceId);

      const existing = await prisma.document.findUnique({
        where: { id: documentId },
        select: { id: true, practiceId: true, providerId: true },
      });
      if (!existing || existing.practiceId !== practiceId) {
        // 404 (not 403) when the document is not in this practice — same
        // existence-leak protection used by webhook subscriptions.
        throw new NotFoundError('Document');
      }

      setAuditContext(req, {
        resourceType: 'practice_document',
        resourceId: documentId,
        action: 'update',
      });

      const document = await (await getDocumentService()).confirmUpload(documentId);
      res.json({ success: true, data: document });
    } catch (error) {
      next(error);
    }
  }
);

// ──────────────────────────────────────────────
// GET / — list practice-scoped documents
// ──────────────────────────────────────────────
practiceDocumentRoutes.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId'];
      if (!practiceId || !UUID_RE.test(practiceId)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid practiceId' },
        });
      }
      await assertPracticeDocumentAccess(req, practiceId);

      const documents = await prisma.document.findMany({
        where: { practiceId },
        select: {
          id: true,
          practiceId: true,
          providerId: true,
          fileName: true,
          originalFileName: true,
          fileSize: true,
          mimeType: true,
          documentType: true,
          description: true,
          expirationDate: true,
          ocrStatus: true,
          ocrConfidence: true,
          ocrData: true,
          isVerified: true,
          createdAt: true,
          updatedAt: true,
          createdById: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: documents });
    } catch (error) {
      next(error);
    }
  }
);

// ──────────────────────────────────────────────
// PATCH /:documentId — edit OCR classification (documentType only)
// ──────────────────────────────────────────────
practiceDocumentRoutes.patch(
  '/:documentId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId'];
      const documentId = req.params['documentId'];
      if (!practiceId || !UUID_RE.test(practiceId)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid practiceId' },
        });
      }
      if (!documentId || !UUID_RE.test(documentId)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid documentId' },
        });
      }
      await assertPracticeDocumentAccess(req, practiceId);

      const existing = await prisma.document.findUnique({
        where: { id: documentId },
        select: { id: true, practiceId: true },
      });
      if (!existing || existing.practiceId !== practiceId) {
        throw new NotFoundError('Document');
      }

      const data = updatePracticeDocumentSchema.parse(req.body);

      setAuditContext(req, {
        resourceType: 'practice_document',
        resourceId: documentId,
        action: 'update',
      });

      const updated = await prisma.document.update({
        where: { id: documentId },
        data: { documentType: data.documentType },
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

// ──────────────────────────────────────────────
// DELETE /:documentId — hard delete (matches existing /api/v1/documents/:id)
// ──────────────────────────────────────────────
practiceDocumentRoutes.delete(
  '/:documentId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const practiceId = req.params['practiceId'];
      const documentId = req.params['documentId'];
      if (!practiceId || !UUID_RE.test(practiceId)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid practiceId' },
        });
      }
      if (!documentId || !UUID_RE.test(documentId)) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid documentId' },
        });
      }
      await assertPracticeDocumentAccess(req, practiceId);

      const existing = await prisma.document.findUnique({
        where: { id: documentId },
        select: { id: true, practiceId: true, s3Key: true },
      });
      if (!existing || existing.practiceId !== practiceId) {
        throw new NotFoundError('Document');
      }

      setAuditContext(req, {
        resourceType: 'practice_document',
        resourceId: documentId,
        action: 'delete',
      });

      // Mirror the provider-document DELETE: best-effort S3 cleanup, then DB row.
      try {
        await (await getDocumentService()).deleteDocument(existing.s3Key);
      } catch {
        // S3 object may not exist if upload never completed; proceed with DB cleanup.
      }
      await prisma.document.delete({ where: { id: documentId } });

      res.json({ success: true, message: 'Document deleted' });
    } catch (error) {
      next(error);
    }
  }
);

export default practiceDocumentRoutes;
