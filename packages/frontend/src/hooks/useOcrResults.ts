import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import toast from 'react-hot-toast';

interface OcrField {
  value: string;
  confidence: number;
}

interface OcrResultsData {
  id: string;
  providerId: string;
  ocrStatus: string | null;
  ocrData: Record<string, OcrField> | null;
  ocrConfidence: number | null;
  ocrReviewedAt: string | null;
}

export function useOcrResults(documentId: string | null) {
  return useQuery({
    queryKey: ['ocr-results', documentId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: OcrResultsData }>(
        `/documents/${documentId}/ocr-results`
      );
      return res.data.data;
    },
    enabled: !!documentId,
  });
}

export function useUpdateOcrResults() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ documentId, extractedFields }: { documentId: string; extractedFields: Record<string, OcrField> }) => {
      const res = await api.put(`/documents/${documentId}/ocr-results`, { extractedFields });
      return res.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['ocr-results', variables.documentId] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['ocr-review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['ocr-review-count'] });
      toast.success('OCR results approved and saved');
    },
    onError: () => {
      toast.error('Failed to save OCR results');
    },
  });
}
