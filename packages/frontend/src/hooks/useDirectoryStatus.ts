import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

export interface DirectorySnapshot {
  id: string;
  providerId: string;
  payerId: string;
  status: 'listed' | 'not_found' | 'mismatch' | 'error';
  checkedAt: string;
  listedName?: string;
  listedNpi?: string;
  listedPhone?: string;
  listedSpecialty?: string;
  listedAddress?: string;
  networkNames: string[];
  mismatches?: Array<{ field: string; ours: string; theirs: string }>;
  payer: { id: string; name: string; payerId: string };
}

export interface DirectoryAlert {
  id: string;
  providerId: string;
  payerId: string;
  snapshotId: string;
  alertType: string;
  message: string;
  details?: unknown;
  resolved: boolean;
  createdAt: string;
  payer: { id: string; name: string; payerId: string };
}

export interface DirectoryStatusResponse {
  success: boolean;
  data: {
    snapshots: DirectorySnapshot[];
    alerts: DirectoryAlert[];
    configuredPayers: string[];
    summary: {
      listed: number;
      notFound: number;
      mismatch: number;
      error: number;
      openAlerts: number;
    };
  };
}

export function useDirectoryStatus(providerId: string) {
  return useQuery({
    queryKey: ['directory-status', providerId],
    queryFn: async () => {
      const response = await api.get<DirectoryStatusResponse>(`/provider-directory/${providerId}/status`);
      return response.data;
    },
    enabled: !!providerId,
  });
}

export function useVerifyDirectory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ providerId, payerId }: { providerId: string; payerId: string }) => {
      const response = await api.post(`/provider-directory/${providerId}/verify`, { payerId });
      return response.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['directory-status', variables.providerId],
      });
    },
  });
}

export function useVerifyAllDirectories() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (providerId: string) => {
      const response = await api.post(`/provider-directory/${providerId}/verify-all`);
      return response.data;
    },
    onSuccess: (_data, providerId) => {
      queryClient.invalidateQueries({
        queryKey: ['directory-status', providerId],
      });
    },
  });
}

export function useResolveDirectoryAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ alertId }: { alertId: string; providerId: string }) => {
      const response = await api.post(`/provider-directory/alerts/${alertId}/resolve`, {});
      return response.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['directory-status', variables.providerId],
      });
    },
  });
}

export function getDirectoryStatusLabel(status: string): string {
  switch (status) {
    case 'listed': return 'Listed';
    case 'not_found': return 'Not Found';
    case 'mismatch': return 'Mismatch';
    case 'error': return 'Error';
    default: return 'Unknown';
  }
}

export function getDirectoryStatusColor(status: string): string {
  switch (status) {
    case 'listed': return 'bg-green-100 text-green-800';
    case 'not_found': return 'bg-red-100 text-red-800';
    case 'mismatch': return 'bg-yellow-100 text-yellow-800';
    case 'error': return 'bg-gray-100 text-gray-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}
