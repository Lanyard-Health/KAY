import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

export interface DefactoPlanRecord {
  id: string;
  carrierName: string | null;
  carrierOrPlanName: string;
  lob: string | null;
  organizationName: string | null;
  organizationNpi: string | null;
  locationCity: string | null;
  locationState: string | null;
}

export interface DefactoSnapshot {
  id: string;
  npi: string;
  fetchedAt: string;
  status: 'found' | 'not_found' | 'error';
  errorMessage: string | null;
  planRecords: DefactoPlanRecord[];
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

/** Latest stored Defacto snapshot for a provider (null = never checked). Internal roles only. */
export function useDefactoSnapshot(providerId: string) {
  return useQuery({
    queryKey: ['defacto', providerId],
    queryFn: async () => {
      const response = await api.get<Envelope<DefactoSnapshot | null>>(
        `/admin/providers/${providerId}/defacto`
      );
      return response.data.data;
    },
    enabled: !!providerId,
    staleTime: 30 * 1000,
  });
}

/** Run a fresh Defacto network participation check (stores a new snapshot). */
export function useDefactoCheck(providerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await api.post<Envelope<DefactoSnapshot>>(
        `/admin/providers/${providerId}/defacto-check`,
        {}
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['defacto', providerId] });
    },
  });
}
