import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

interface OcrQueueItem {
  id: string;
  originalFileName: string;
  documentType: string;
  mimeType: string;
  ocrStatus: string;
  ocrConfidence: number | null;
  createdAt: string;
  provider: {
    id: string;
    firstName: string;
    lastName: string;
    npi: string;
  };
}

interface OcrQueueResponse {
  items: OcrQueueItem[];
  total: number;
  page: number;
  pageSize: number;
}

export function useOcrReviewQueue(page: number, pageSize: number) {
  return useQuery({
    queryKey: ['ocr-review-queue', page, pageSize],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: OcrQueueResponse }>(
        `/documents/ocr-review-queue?page=${page}&pageSize=${pageSize}`
      );
      return res.data.data;
    },
  });
}
