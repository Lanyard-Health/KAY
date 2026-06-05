import { Router, Request, Response } from 'express';
import { authenticate, authorize, requireActiveProviderSelf } from '../middleware/auth.middleware.js';
import { prisma } from '../utils/prisma.js';
import { DocumentService } from '../services/document.service.js';
import { logger } from '../utils/logger.js';
import type { UploadUrlRequestInput } from '@credential-management/shared';

const router = Router();

// Lazy-load document service singleton
let documentService: DocumentService | null = null;
function getDocumentService(): DocumentService {
  if (!documentService) {
    documentService = new DocumentService();
  }
  return documentService;
}

const ALLOWED_DOCUMENT_TYPES = [
  'license', 'board_certification', 'malpractice_certificate', 'diploma',
  'transcript', 'cv_resume', 'photo', 'government_id', 'dea_certificate',
  'cds_certificate', 'cme_certificate', 'hospital_letter', 'reference_letter',
  'w9', 'coi', 'cp575', 'other',
];

/**
 * GET /api/v1/portal/documents
 * List provider's own documents
 */
router.get('/', authenticate, authorize('provider'), async (req: Request, res: Response) => {
  try {
    const providerId = req.user!.providerId;
    if (!providerId) {
      return res.status(404).json({ success: false, error: { message: 'No provider profile linked' } });
    }

    const documents = await prisma.document.findMany({
      where: { providerId },
      select: {
        id: true,
        fileName: true,
        originalFileName: true,
        fileSize: true,
        mimeType: true,
        documentType: true,
        description: true,
        reviewStatus: true,
        reviewNotes: true,
        reviewedAt: true,
        uploadedViaPortal: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: documents });
  } catch (error) {
    logger.error('Error listing portal documents:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to list documents' } });
  }
});

/**
 * POST /api/v1/portal/documents/upload-url
 * Get S3 presigned upload URL
 */
router.post('/upload-url', authenticate, authorize('provider'), requireActiveProviderSelf, async (req: Request, res: Response) => {
  try {
    const providerId = req.user!.providerId;
    if (!providerId) {
      return res.status(404).json({ success: false, error: { message: 'No provider profile linked' } });
    }

    const { fileName, contentType, documentType } = req.body;

    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({ success: false, error: { message: 'fileName is required' } });
    }
    if (!contentType || typeof contentType !== 'string') {
      return res.status(400).json({ success: false, error: { message: 'contentType is required' } });
    }
    if (!documentType || !ALLOWED_DOCUMENT_TYPES.includes(documentType)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid documentType' } });
    }

    const uploadInput: UploadUrlRequestInput = {
      providerId,
      fileName,
      contentType: contentType as UploadUrlRequestInput['contentType'],
      documentType: documentType as UploadUrlRequestInput['documentType'],
    };

    const result = await getDocumentService().getUploadUrl(uploadInput, req.user!.id);

    // Mark the document as uploaded via portal
    await prisma.document.update({
      where: { id: result.documentId },
      data: { uploadedViaPortal: true, reviewStatus: 'pending' },
    });

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Error generating upload URL:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to generate upload URL' } });
  }
});

/**
 * POST /api/v1/portal/documents/confirm
 * Confirm upload completion
 */
router.post('/confirm', authenticate, authorize('provider'), requireActiveProviderSelf, async (req: Request, res: Response) => {
  try {
    const providerId = req.user!.providerId;
    if (!providerId) {
      return res.status(404).json({ success: false, error: { message: 'No provider profile linked' } });
    }

    const { documentId } = req.body;
    if (!documentId || typeof documentId !== 'string') {
      return res.status(400).json({ success: false, error: { message: 'documentId is required' } });
    }

    // Verify the document belongs to this provider
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { providerId: true },
    });

    if (!doc || doc.providerId !== providerId) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }

    const result = await getDocumentService().confirmUpload(documentId);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Error confirming upload:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to confirm upload' } });
  }
});

/**
 * DELETE /api/v1/portal/documents/:id
 * Delete own document (only if not approved)
 */
router.delete('/:id', authenticate, authorize('provider'), requireActiveProviderSelf, async (req: Request, res: Response) => {
  try {
    const providerId = req.user!.providerId;
    if (!providerId) {
      return res.status(404).json({ success: false, error: { message: 'No provider profile linked' } });
    }

    const docId = req.params['id']!;
    const doc = await prisma.document.findUnique({
      where: { id: docId },
      select: { providerId: true, reviewStatus: true, s3Key: true },
    });

    if (!doc || doc.providerId !== providerId) {
      return res.status(404).json({ success: false, error: { message: 'Document not found' } });
    }

    if (doc.reviewStatus === 'approved') {
      return res.status(403).json({ success: false, error: { message: 'Cannot delete an approved document' } });
    }

    // Delete from S3 and database
    await getDocumentService().deleteDocument(doc.s3Key);
    await prisma.document.delete({ where: { id: docId } });

    res.json({ success: true, message: 'Document deleted' });
  } catch (error) {
    logger.error('Error deleting document:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to delete document' } });
  }
});

export default router;
