import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../services/api';

// ==========================================
// Types
// ==========================================

export interface ValidatedRow {
  rowNumber: number;
  status: 'valid' | 'warning' | 'error' | 'duplicate';
  data: Record<string, string>;
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
}

export interface ValidationSummary {
  valid: number;
  warnings: number;
  errors: number;
  duplicates: number;
  total: number;
}

export interface ValidationResult {
  rows: ValidatedRow[];
  summary: ValidationSummary;
}

export interface ImportResult {
  importId: string;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  error?: string;
}

export interface ImportStatus {
  id: string;
  practiceId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalRows: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  errorDetails: string | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
}

// ==========================================
// Hooks
// ==========================================

/** Download the CSV template and trigger a browser file download. */
export function useDownloadTemplate() {
  return useMutation({
    mutationFn: async () => {
      const { text, headers } = await api.download('/provider-import/template');

      // Extract filename from Content-Disposition header, or use default
      const disposition = headers.get('content-disposition') || '';
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] || 'lanyard-provider-import-template.csv';

      // Trigger browser download
      const blob = new Blob([text], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || error.message || 'Failed to download template';
      toast.error(message);
    },
  });
}

/** Upload a CSV file for validation (does not create providers). */
export function useValidateFile() {
  return useMutation({
    mutationFn: async (file: File): Promise<ValidationResult> => {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.upload<{ success: boolean; data: ValidationResult }>(
        '/provider-import/validate',
        formData,
      );
      return response.data.data;
    },
    onError: (error: any) => {
      const message = error.response?.data?.error?.message
        || error.response?.data?.error
        || error.message
        || 'Validation failed';
      toast.error(message);
    },
  });
}

/** Execute the import — create providers from validated rows. */
export function useExecuteImport() {
  return useMutation({
    mutationFn: async (rows: ValidatedRow[]): Promise<ImportResult> => {
      const response = await api.post<{ success: boolean; data: ImportResult }>(
        '/provider-import/execute',
        { rows },
      );
      return response.data.data;
    },
    onError: (error: any) => {
      const message = error.response?.data?.error?.message
        || error.response?.data?.error
        || error.message
        || 'Import failed';
      toast.error(message);
    },
  });
}

/** Poll import status by importId. Enabled only when importId is provided. */
export function useImportStatus(importId: string | null) {
  return useQuery({
    queryKey: ['provider-import-status', importId],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: ImportStatus }>(
        `/provider-import/${importId}/status`,
      );
      return data.data;
    },
    enabled: !!importId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Stop polling once completed or failed
      if (status === 'completed' || status === 'failed') return false;
      return 3000; // Poll every 3s while pending/processing
    },
  });
}
