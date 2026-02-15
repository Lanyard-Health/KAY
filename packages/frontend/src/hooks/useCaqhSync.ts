import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

interface SyncHistoryEntry {
  id: string;
  providerId: string;
  direction: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  changesApplied: Record<string, any> | null;
  durationMs: number | null;
}

interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface CaqhConfig {
  configured: boolean;
  syncSchedule: string;
  lastSyncAt: string | null;
}

/**
 * Hook to fetch paginated CAQH sync history for a provider
 */
export function useCaqhSyncHistory(providerId: string, page = 1, limit = 10) {
  return useQuery({
    queryKey: ['caqh-sync-history', providerId, page, limit],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<SyncHistoryEntry>>(
        `/caqh/sync-history/${providerId}?page=${page}&limit=${limit}`
      );
      return response.data;
    },
    enabled: !!providerId,
    staleTime: 30 * 1000,
  });
}

/**
 * Hook to fetch CAQH integration config status
 */
export function useCaqhConfig() {
  return useQuery({
    queryKey: ['caqh-config'],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: CaqhConfig }>('/caqh/config');
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to add a provider to the CAQH roster
 */
export function useAddToRoster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (providerId: string) => {
      const response = await api.post('/caqh/roster', { providerId });
      return response.data;
    },
    onSuccess: (_data, providerId) => {
      queryClient.invalidateQueries({ queryKey: ['caqh-credentials', providerId] });
      queryClient.invalidateQueries({ queryKey: ['provider', providerId] });
    },
  });
}

/**
 * Hook to remove a provider from the CAQH roster
 */
export function useRemoveFromRoster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (providerId: string) => {
      const response = await api.delete(`/caqh/roster/${providerId}`);
      return response.data;
    },
    onSuccess: (_data, providerId) => {
      queryClient.invalidateQueries({ queryKey: ['caqh-credentials', providerId] });
      queryClient.invalidateQueries({ queryKey: ['provider', providerId] });
    },
  });
}
