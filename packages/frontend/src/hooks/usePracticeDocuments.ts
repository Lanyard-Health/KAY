/**
 * React Query hooks for practice-scoped Documents (Phase 4).
 *
 * Backend endpoints these hooks call (live in production after PR #260):
 *   GET    /api/v1/practices/:practiceId/documents
 *   POST   /api/v1/practices/:practiceId/documents/upload-url
 *   POST   /api/v1/practices/:practiceId/documents/:documentId/confirm
 *   PATCH  /api/v1/practices/:practiceId/documents/:documentId
 *
 * The list hook polls every 5 s while any row is in a pending or processing
 * state, then idles. Provider documents have a separate code path
 * (services/api with `/documents/provider/{providerId}`) and are not affected.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { practiceDocumentResponseSchema } from '@credential-management/shared';
import { api } from '../services/api';

export type PracticeDocumentOcrStatus =
  | 'pending'
  | 'processing'
  | 'needs_review'
  | 'completed'
  | 'failed'
  | 'not_applicable';

export interface PracticeDocument {
  id: string;
  practiceId: string;
  providerId: null;
  fileName: string;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  documentType: string;
  description: string | null;
  expirationDate: string | null;
  ocrStatus: PracticeDocumentOcrStatus | null;
  ocrConfidence: number | null;
  // Textract field extractions, keyed by Textract's literal label readings.
  // Phase 4 stores this in cache but does NOT render it — see PracticeDocumentsTab
  // and the comment at the top of practice-documents.routes.ts. A future PR
  // adds the "view extracted fields" UI.
  ocrData: Record<string, { value: string; confidence: number }> | null;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
}

const POLL_INTERVAL_MS = 5000;
const POLLING_STATUSES: ReadonlyArray<PracticeDocumentOcrStatus | null> = [
  'pending',
  'processing',
];

/**
 * List practice documents with smart polling: refetches every 5 s only while
 * at least one row is still in the OCR pipeline. Idle once all rows settle.
 */
export function usePracticeDocuments(practiceId: string) {
  return useQuery({
    queryKey: ['practice-documents', practiceId],
    enabled: !!practiceId,
    queryFn: async () => {
      const response = await api.get(`/practices/${practiceId}/documents`);
      const parsed = practiceDocumentResponseSchema.array().safeParse(response.data?.data);
      if (!parsed.success) {
        console.error('Invalid /practices/:id/documents response shape:', parsed.error);
        return [];
      }
      return parsed.data;
    },
    refetchInterval: (query) => {
      const docs = query.state.data as PracticeDocument[] | undefined;
      if (!docs) return false;
      const anyInFlight = docs.some((d) => POLLING_STATUSES.includes(d.ocrStatus));
      return anyInFlight ? POLL_INTERVAL_MS : false;
    },
  });
}

interface UploadInput {
  file: File;
  /** Optional override. When omitted, the backend defaults to 'other' and OCR auto-classifies. */
  documentType?: string;
  onProgress?: (phase: 'requesting_url' | 'uploading' | 'confirming', percent: number) => void;
}

/**
 * Single-request server-side upload: POST the file (multipart) to our API,
 * which streams it to storage and creates the row. The browser never PUTs to
 * R2 directly, so this isn't subject to R2 CORS or the frontend CSP — the
 * cause of the old presigned-PUT flow spinning forever.
 *
 * Throws on failure with a message suitable for the UI.
 */
export function useUploadPracticeDocument(practiceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UploadInput): Promise<PracticeDocument> => {
      const { file, documentType, onProgress } = input;

      const form = new FormData();
      form.append('file', file);
      if (documentType) {
        form.append('documentType', documentType);
      }

      onProgress?.('uploading', 40);
      const resp = await api.upload(`/practices/${practiceId}/documents/upload`, form);

      onProgress?.('confirming', 100);
      const parsed = practiceDocumentResponseSchema.safeParse(resp.data?.data);
      if (!parsed.success) {
        console.error('Invalid upload response shape:', parsed.error);
        throw new Error('Upload returned an unexpected response. Please refresh and try again.');
      }
      return parsed.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice-documents', practiceId] });
    },
  });
}

interface UpdateTypeInput {
  documentId: string;
  documentType: string;
}

export function useUpdatePracticeDocumentType(practiceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ documentId, documentType }: UpdateTypeInput) => {
      const response = await api.patch(
        `/practices/${practiceId}/documents/${documentId}`,
        { documentType }
      );
      const parsed = practiceDocumentResponseSchema.safeParse(response.data?.data);
      if (!parsed.success) {
        console.error('Invalid patch response shape:', parsed.error);
        throw new Error('Document update returned an unexpected response. Please refresh and try again.');
      }
      return parsed.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice-documents', practiceId] });
    },
  });
}

export function useDeletePracticeDocument(practiceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string) => {
      await api.delete(`/practices/${practiceId}/documents/${documentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice-documents', practiceId] });
    },
  });
}
