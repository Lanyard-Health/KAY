import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

export function useOcrReviewCount() {
  return useQuery({
    queryKey: ['ocr-review-count'],
    queryFn: async () => {
      try {
        const res = await api.get('/documents/ocr-review-count');
        return (res.data.data?.count ?? 0) as number;
      } catch {
        return 0;
      }
    },
    staleTime: 60_000,
  });
}
