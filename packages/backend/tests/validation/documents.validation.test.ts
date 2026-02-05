import { describe, it, expect } from 'vitest';
import {
  documentTypeSchema,
  createDocumentSchema,
  uploadUrlRequestSchema,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
} from '@credential-management/shared';

describe('Document Validation Schemas', () => {
  describe('documentTypeSchema', () => {
    const validTypes = [
      'license', 'board_certification', 'malpractice_certificate',
      'diploma', 'transcript', 'cv_resume', 'photo', 'government_id',
      'dea_certificate', 'cds_certificate', 'cme_certificate',
      'hospital_letter', 'reference_letter', 'w9', 'coi', 'cp575', 'other',
    ];

    it.each(validTypes)('accepts "%s"', (val) => {
      expect(documentTypeSchema.parse(val)).toBe(val);
    });

    it('rejects invalid document type', () => {
      expect(() => documentTypeSchema.parse('spreadsheet')).toThrow();
    });
  });

  describe('createDocumentSchema', () => {
    const validDoc = {
      providerId: '550e8400-e29b-41d4-a716-446655440000',
      fileName: 'license.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf' as const,
      documentType: 'license' as const,
    };

    it('accepts valid document input', () => {
      const result = createDocumentSchema.parse(validDoc);
      expect(result.fileName).toBe('license.pdf');
    });

    it('rejects file size exceeding 25MB', () => {
      expect(() =>
        createDocumentSchema.parse({ ...validDoc, fileSize: MAX_FILE_SIZE + 1 })
      ).toThrow();
    });

    it('rejects invalid mime type', () => {
      expect(() =>
        createDocumentSchema.parse({ ...validDoc, mimeType: 'text/plain' })
      ).toThrow();
    });

    it('requires UUID format for providerId', () => {
      expect(() =>
        createDocumentSchema.parse({ ...validDoc, providerId: 'not-a-uuid' })
      ).toThrow();
    });

    it('accepts all allowed mime types', () => {
      for (const mimeType of ALLOWED_MIME_TYPES) {
        expect(() =>
          createDocumentSchema.parse({ ...validDoc, mimeType })
        ).not.toThrow();
      }
    });
  });

  describe('uploadUrlRequestSchema', () => {
    it('validates contentType against allowed mime types', () => {
      expect(() =>
        uploadUrlRequestSchema.parse({
          providerId: '550e8400-e29b-41d4-a716-446655440000',
          fileName: 'doc.pdf',
          contentType: 'application/pdf',
          documentType: 'license',
        })
      ).not.toThrow();
    });

    it('rejects disallowed content type', () => {
      expect(() =>
        uploadUrlRequestSchema.parse({
          providerId: '550e8400-e29b-41d4-a716-446655440000',
          fileName: 'doc.exe',
          contentType: 'application/octet-stream',
          documentType: 'other',
        })
      ).toThrow();
    });
  });
});
