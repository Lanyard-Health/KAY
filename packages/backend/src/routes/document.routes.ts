import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, requireProviderAccess } from '../middleware/auth.middleware.js';
import { NotFoundError, ForbiddenError } from '../middleware/error.middleware.js';
import { requirePracticeProvider, validateProviderPracticeAccess } from '../middleware/practiceScope.middleware.js';
import { uploadUrlRequestSchema, createDocumentSchema } from '@credential-management/shared';
import { createCredentialFromOcr } from '../services/ocr-credential.service.js';

// Validation schemas for document endpoints
const updateDocumentSchema = z.object({
  documentType: z.string().max(100).optional(),
  description: z.string().max(1000).optional(),
  expirationDate: z.string().datetime({ offset: true }).nullable().optional()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()),
}).strict();

const updateOcrResultsSchema = z.object({
  extractedFields: z.record(z.string(), z.string().max(5000)).refine(
    (obj) => Object.keys(obj).length <= 200,
    { message: 'Too many extracted fields (max 200)' }
  ),
}).strict();

export const documentRoutes = Router();

documentRoutes.use(authenticate);

// Lazy-load DocumentService (heavy S3/Textract SDKs) on first use
let _documentService: import('../services/document.service.js').DocumentService | null = null;
async function getDocumentService() {
  if (!_documentService) {
    const { DocumentService } = await import('../services/document.service.js');
    _documentService = new DocumentService();
  }
  return _documentService;
}

async function assertDocumentAccess(req: Request, document: { providerId: string }): Promise<void> {
  const { role, providerId: userProviderId } = req.user!;
  if (role === 'admin') return;
  if (role === 'credentialing_staff') {
    if (!(await validateProviderPracticeAccess(req, document.providerId))) throw new ForbiddenError('Access denied to this document');
    return;
  }
  if (role === 'provider' && userProviderId === document.providerId) return;
  throw new ForbiddenError('Access denied to this document');
}

// POST /api/v1/documents/upload-url - Get pre-signed upload URL
documentRoutes.post(
  '/upload-url',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = uploadUrlRequestSchema.parse(req.body);

      // Verify provider access
      const provider = await prisma.provider.findUnique({
        where: { id: data.providerId },
      });

      if (!provider) {
        throw new NotFoundError('Provider');
      }

      await assertDocumentAccess(req, { providerId: data.providerId });

      const result = await (await getDocumentService()).getUploadUrl(data, req.user!.id);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/documents/confirm-upload - Confirm upload and trigger OCR
documentRoutes.post(
  '/confirm-upload',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.body;

      if (!documentId || typeof documentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId)) {
        return res.status(400).json({ success: false, error: 'Valid documentId is required' });
      }

      const existing = await prisma.document.findUnique({
        where: { id: documentId },
      });
      if (!existing) throw new NotFoundError('Document');
      await assertDocumentAccess(req, existing);

      const document = await (await getDocumentService()).confirmUpload(documentId);

      res.json({ success: true, data: document });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/documents/ocr-review-count - Count documents needing OCR review
documentRoutes.get(
  '/ocr-review-count',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { role } = req.user!;
      if (role !== 'admin' && role !== 'credentialing_staff' && role !== 'practice_admin') {
        return res.json({ success: true, data: { count: 0 } });
      }

      const count = await prisma.document.count({
        where: { ocrStatus: 'needs_review' },
      });

      res.json({ success: true, data: { count } });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/documents/ocr-review-queue - Paginated queue of all needs_review documents
documentRoutes.get(
  '/ocr-review-queue',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { role } = req.user!;
      if (role !== 'admin' && role !== 'credentialing_staff' && role !== 'practice_admin') {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }

      const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query['pageSize'] as string) || 25));

      const where = { ocrStatus: 'needs_review' as const };

      const [items, total] = await Promise.all([
        prisma.document.findMany({
          where,
          select: {
            id: true,
            originalFileName: true,
            documentType: true,
            mimeType: true,
            ocrStatus: true,
            ocrConfidence: true,
            createdAt: true,
            provider: {
              select: { id: true, firstName: true, lastName: true, npi: true },
            },
          },
          orderBy: { createdAt: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.document.count({ where }),
      ]);

      res.json({ success: true, data: { items, total, page, pageSize } });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/documents/:id - Get document metadata
documentRoutes.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const document = await prisma.document.findUnique({
        where: { id: req.params['id'] },
        include: {
          provider: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });

      if (!document) {
        throw new NotFoundError('Document');
      }

      await assertDocumentAccess(req, document);

      res.json({ success: true, data: document });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/documents/:id/download-url - Get pre-signed download URL
documentRoutes.get(
  '/:id/download-url',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const document = await prisma.document.findUnique({
        where: { id: req.params['id'] },
      });

      if (!document) {
        throw new NotFoundError('Document');
      }

      await assertDocumentAccess(req, document);

      const downloadUrl = await (await getDocumentService()).getDownloadUrl(document.s3Key);

      res.json({ success: true, data: { downloadUrl, expiresIn: 3600 } });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/documents/:id/ocr-results - Get OCR extraction results
documentRoutes.get(
  '/:id/ocr-results',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const document = await prisma.document.findUnique({
        where: { id: req.params['id'] },
        select: {
          id: true,
          providerId: true,
          ocrStatus: true,
          ocrData: true,
          ocrConfidence: true,
          ocrReviewedAt: true,
        },
      });

      if (!document) {
        throw new NotFoundError('Document');
      }

      await assertDocumentAccess(req, document);

      res.json({ success: true, data: document });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/documents/:id/ocr-results - Update OCR results after review
documentRoutes.put(
  '/:id/ocr-results',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { extractedFields } = updateOcrResultsSchema.parse(req.body);

      const existing = await prisma.document.findUnique({
        where: { id: req.params['id'] },
      });
      if (!existing) throw new NotFoundError('Document');
      await assertDocumentAccess(req, existing);

      const document = await prisma.document.update({
        where: { id: req.params['id'] },
        data: {
          ocrData: extractedFields,
          ocrStatus: 'completed',
          ocrReviewedAt: new Date(),
          ocrReviewedBy: req.user?.id,
        },
      });

      // Auto-create credential from approved OCR data
      let credentialId: string | null = null;
      try {
        // Convert flat string values to ExtractedField objects for the credential service
      const fieldsForCredential = Object.fromEntries(
        Object.entries(extractedFields).map(([k, v]) => [k, { value: v, confidence: 1 }])
      );
      credentialId = await createCredentialFromOcr(
          existing.id,
          existing.providerId,
          existing.documentType,
          fieldsForCredential,
        );
      } catch (err) {
        // Log but don't fail the review — OCR data is already saved
        const { logger } = await import('../utils/logger.js');
        logger.error('Failed to auto-create credential from OCR review', {
          error: (err as Error).message,
          documentId: existing.id,
        });
      }

      res.json({ success: true, data: { ...document, credentialId } });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/v1/documents/:id - Update document metadata
documentRoutes.put(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentType, description, expirationDate } = updateDocumentSchema.parse(req.body);

      const document = await prisma.document.findUnique({
        where: { id: req.params['id'] },
      });

      if (!document) {
        throw new NotFoundError('Document');
      }

      await assertDocumentAccess(req, document);

      const updatedDocument = await prisma.document.update({
        where: { id: req.params['id'] },
        data: {
          ...(documentType && { documentType: documentType as import('@prisma/client').DocumentType }),
          description: description !== undefined ? description : document.description,
          expirationDate: expirationDate ? new Date(expirationDate) : null,
          updatedAt: new Date(),
        },
      });

      res.json({ success: true, data: updatedDocument });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/v1/documents/:id - Delete document
documentRoutes.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const document = await prisma.document.findUnique({
        where: { id: req.params['id'] },
      });

      if (!document) {
        throw new NotFoundError('Document');
      }

      await assertDocumentAccess(req, document);

      // Delete from S3 (ignore errors for orphaned records)
      try {
        await (await getDocumentService()).deleteDocument(document.s3Key);
      } catch {
        // File may not exist in S3 if upload failed — proceed with DB cleanup
      }

      // Delete from database
      await prisma.document.delete({
        where: { id: req.params['id'] },
      });

      res.json({ success: true, message: 'Document deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/documents/provider/:providerId - List documents for a provider
documentRoutes.get(
  '/provider/:providerId',
  requireProviderAccess, requirePracticeProvider,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const documents = await prisma.document.findMany({
        where: { providerId: req.params['providerId'] },
        select: {
          id: true,
          providerId: true,
          fileName: true,
          originalFileName: true,
          fileSize: true,
          mimeType: true,
          documentType: true,
          description: true,
          linkedLicenseId: true,
          linkedBoardCertificationId: true,
          linkedMalpracticeInsuranceId: true,
          linkedEducationId: true,
          linkedContinuingEducationId: true,
          expirationDate: true,
          isVerified: true,
          verifiedAt: true,
          verifiedBy: true,
          reviewStatus: true,
          reviewedById: true,
          reviewedAt: true,
          reviewNotes: true,
          uploadedViaPortal: true,
          createdAt: true,
          updatedAt: true,
          createdById: true,
          ocrStatus: true,
          ocrConfidence: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: documents });
    } catch (error) {
      next(error);
    }
  }
);
