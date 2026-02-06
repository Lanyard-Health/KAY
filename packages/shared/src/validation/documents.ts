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
  providerId: z.string().min(1),
  fileName: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_MIME_TYPES),
  documentType: documentTypeSchema,
});

export const createDocumentSchema = z.object({
  providerId: z.string().min(1),
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

export type UploadUrlRequestInput = z.infer<typeof uploadUrlRequestSchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateOcrResultInput = z.infer<typeof updateOcrResultSchema>;

export { MAX_FILE_SIZE, ALLOWED_MIME_TYPES };
