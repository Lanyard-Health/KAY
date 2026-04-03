import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

export interface PayerTrackOption {
  id: string;
  payerName: string;
  track: string;
  stateRegion: string;
  payerType: string;
  submissionMethod: string;
}

export function usePayerTrackOptions(search: string) {
  return useQuery({
    queryKey: ['payer-track-options', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      const res = await api.get<{ success: boolean; data: PayerTrackOption[] }>(
        `/enrollments/payer-track-options?${params}`
      );
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
