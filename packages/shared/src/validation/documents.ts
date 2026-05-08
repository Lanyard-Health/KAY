import { z } from 'zod';

export const documentTypeSchema = z.enum([
  'license',
  'board_certification',
  'malpractice_certificate',
  'diploma',
  'transcript',
  'cv_resume',
  'photo',
  'government_id',
  'dea_certificate',
  'cds_certificate',
  'cme_certificate',
  'hospital_letter',
  'reference_letter',
  'w9',
  'coi',
  'cp575',
  'other',
]);

export const linkedEntityTypeSchema = z.enum([
  'license',
  'certification',
  'insurance',
  'education',
]);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
] as const;

export const uploadUrlRequestSchema = z.object({
  providerId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_MIME_TYPES),
  documentType: documentTypeSchema,
});

// Practice-scoped uploads. documentType is optional — when omitted, the OCR
// pipeline classifies the document and writes the resulting type back.
export const practiceUploadUrlRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_MIME_TYPES),
  documentType: documentTypeSchema.optional(),
});

// Response shape for the practice-scoped upload-URL endpoint. The hook only
// destructures uploadUrl + documentId today, but s3Key and expiresAt are part
// of the contract and validated here so contract drift is caught early.
// expiresAt is a string because the API serializes Date as ISO over the wire.
export const practiceUploadUrlResponseSchema = z.object({
  uploadUrl: z.string(),
  documentId: z.string(),
  s3Key: z.string(),
  expiresAt: z.string(),
});

export const updatePracticeDocumentSchema = z.object({
  documentType: documentTypeSchema,
});

export const createDocumentSchema = z.object({
  providerId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE, 'File size exceeds 25MB limit'),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  documentType: documentTypeSchema,
  description: z.string().max(500).optional(),
  linkedEntityType: linkedEntityTypeSchema.optional(),
  linkedEntityId: z.string().min(1).optional(),
  expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateOcrResultSchema = z.object({
  extractedFields: z.record(z.object({
    value: z.string(),
    confidence: z.number().min(0).max(1),
    verified: z.boolean().optional(),
  })),
});

export const practiceDocumentOcrStatusSchema = z.enum([
  'pending',
  'processing',
  'needs_review',
  'completed',
  'failed',
  'not_applicable',
]);

// Response shape for practice-scoped document records returned by the
// practice documents API. Permissive on documentType (z.string() rather than
// the documentTypeSchema enum) because the backend may return values not yet
// mirrored in the frontend enum; the UI handles unknown types via a fallback
// label. Used by usePracticeDocuments to validate API responses at runtime.
export const practiceDocumentResponseSchema = z.object({
  id: z.string(),
  practiceId: z.string(),
  providerId: z.null(),
  fileName: z.string(),
  originalFileName: z.string(),
  fileSize: z.number(),
  mimeType: z.string(),
  documentType: z.string(),
  description: z.string().nullable(),
  expirationDate: z.string().nullable(),
  ocrStatus: practiceDocumentOcrStatusSchema.nullable(),
  ocrConfidence: z.number().nullable(),
  ocrData: z.record(z.object({
    value: z.string(),
    confidence: z.number(),
  })).nullable(),
  isVerified: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdById: z.string().nullable(),
});

export type UploadUrlRequestInput = z.infer<typeof uploadUrlRequestSchema>;
export type PracticeUploadUrlRequestInput = z.infer<typeof practiceUploadUrlRequestSchema>;
export type PracticeUploadUrlResponse = z.infer<typeof practiceUploadUrlResponseSchema>;
export type UpdatePracticeDocumentInput = z.infer<typeof updatePracticeDocumentSchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateOcrResultInput = z.infer<typeof updateOcrResultSchema>;
export type PracticeDocumentResponse = z.infer<typeof practiceDocumentResponseSchema>;

export { MAX_FILE_SIZE, ALLOWED_MIME_TYPES };
