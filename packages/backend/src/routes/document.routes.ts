import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma.js';
import { authenticate, requireProviderAccess } from '../middleware/auth.middleware.js';
import { NotFoundError, ForbiddenError } from '../middleware/error.middleware.js';
import { DocumentService } from '../services/document.service.js';
import { uploadUrlRequestSchema, createDocumentSchema } from '@credential-management/shared';

export const documentRoutes = Router();

documentRoutes.use(authenticate);

const documentService = new DocumentService();

function assertDocumentAccess(req: Request, document: { providerId: string }): void {
  const { role, providerId: userProviderId } = req.user!;
  if (role === 'admin' || role === 'credentialing_staff') return;
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

      assertDocumentAccess(req, { providerId: data.providerId });

      const result = await documentService.getUploadUrl(data, req.user!.id);

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

      const existing = await prisma.document.findUnique({
        where: { id: documentId },
      });
      if (!existing) throw new NotFoundError('Document');
      assertDocumentAccess(req, existing);

      const document = await documentService.confirmUpload(documentId);

      res.json({ success: true, data: document });
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

      assertDocumentAccess(req, document);

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

      assertDocumentAccess(req, document);

      const downloadUrl = await documentService.getDownloadUrl(document.s3Key);

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

      assertDocumentAccess(req, document);

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
      const { extractedFields } = req.body;

      const existing = await prisma.document.findUnique({
        where: { id: req.params['id'] },
      });
      if (!existing) throw new NotFoundError('Document');
      assertDocumentAccess(req, existing);

      const document = await prisma.document.update({
        where: { id: req.params['id'] },
        data: {
          ocrData: extractedFields,
          ocrReviewedAt: new Date(),
          ocrReviewedBy: req.user?.id,
        },
      });

      res.json({ success: true, data: document });
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
      const { documentType, description, expirationDate } = req.body;

      const document = await prisma.document.findUnique({
        where: { id: req.params['id'] },
      });

      if (!document) {
        throw new NotFoundError('Document');
      }

      assertDocumentAccess(req, document);

      const updatedDocument = await prisma.document.update({
        where: { id: req.params['id'] },
        data: {
          ...(documentType && { documentType }),
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

      assertDocumentAccess(req, document);

      // Delete from S3 (ignore errors for orphaned records)
      try {
        await documentService.deleteDocument(document.s3Key);
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
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const documents = await prisma.document.findMany({
        where: { providerId: req.params['providerId'] },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: documents });
    } catch (error) {
      next(error);
    }
  }
);
