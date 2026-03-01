import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

export function useOcrReviewCount() {
  return useQuery({
    queryKey: ['ocr-review-count'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { count: number } }>('/documents/ocr-review-count');
      return res.data.data.count;
    },
    refetchInterval: 60_000,
  });
}
