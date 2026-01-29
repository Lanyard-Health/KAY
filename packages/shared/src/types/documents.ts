import type { UUID, AuditInfo } from './common.js';

export type DocumentType =
  | 'license'
  | 'board_certification'
  | 'malpractice_certificate'
  | 'diploma'
  | 'transcript'
  | 'cv_resume'
  | 'photo'
  | 'government_id'
  | 'dea_certificate'
  | 'cds_certificate'
  | 'cme_certificate'
  | 'hospital_letter'
  | 'reference_letter'
  | 'other';

export type OcrStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'not_applicable';

export interface Document extends AuditInfo {
  id: UUID;
  providerId: UUID;

  // File info
  fileName: string;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  s3Key: string;

  // Classification
  documentType: DocumentType;
  description?: string;

  // Linked credential (if applicable)
  linkedEntityType?: 'license' | 'certification' | 'insurance' | 'education';
  linkedEntityId?: UUID;

  // Expiration
  expirationDate?: Date;

  // OCR
  ocrStatus: OcrStatus;
  ocrData?: Record<string, unknown>;
  ocrConfidence?: number;
  ocrReviewedAt?: Date;
  ocrReviewedBy?: UUID;

  // Status
  isVerified: boolean;
  verifiedAt?: Date;
  verifiedBy?: UUID;
}

export interface CreateDocumentDto {
  providerId: UUID;
  fileName: string;
  fileSize: number;
  mimeType: string;
  documentType: DocumentType;
  description?: string;
  linkedEntityType?: 'license' | 'certification' | 'insurance' | 'education';
  linkedEntityId?: UUID;
  expirationDate?: string;
}

export interface UploadUrlRequest {
  providerId: UUID;
  fileName: string;
  contentType: string;
  documentType: DocumentType;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  documentId: UUID;
  s3Key: string;
  expiresAt: Date;
}

export interface OcrExtractionResult {
  documentId: UUID;
  status: OcrStatus;
  extractedFields: Record<string, {
    value: string;
    confidence: number;
    boundingBox?: {
      top: number;
      left: number;
      width: number;
      height: number;
    };
  }>;
  rawText?: string;
  processedAt: Date;
}
