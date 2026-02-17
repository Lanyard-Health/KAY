import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

export interface PdmAttestationStatus {
  enrollmentId: string;
  payerName: string;
  payerId: string;
  lastAttestedAt: string | null;
  daysUntilDue: number | null;
  status: 'current' | 'due_soon' | 'overdue' | 'never_attested';
  needsUpdate: boolean;
}

export interface PdmSummary {
  current: number;
  dueSoon: number;
  overdue: number;
  neverAttested: number;
  needsUpdate: number;
  nextDueDate: string | null;
  daysUntilNextDue: number | null;
}

export interface PdmStatusResponse {
  success: boolean;
  data: {
    statuses: PdmAttestationStatus[];
    summary: PdmSummary;
  };
}

export interface PdmAlertsResponse {
  success: boolean;
  data: {
    alerts: PdmAttestationStatus[];
    count: number;
  };
}

/**
 * Hook to fetch PDM attestation status for a provider
 */
export function usePdmStatus(providerId: string) {
  return useQuery({
    queryKey: ['pdm-status', providerId],
    queryFn: async () => {
      const response = await api.get<PdmStatusResponse>(`/pdm/provider/${providerId}/status`);
      return response.data;
    },
    enabled: !!providerId,
  });
}

/**
 * Hook to fetch PDM alerts (enrollments needing attention)
 */
export function usePdmAlerts(providerId: string, warningDays?: number) {
  return useQuery({
    queryKey: ['pdm-alerts', providerId, warningDays],
    queryFn: async () => {
      const params = warningDays !== undefined ? `?warningDays=${warningDays}` : '';
      const response = await api.get<PdmAlertsResponse>(`/pdm/provider/${providerId}/alerts${params}`);
      return response.data;
    },
    enabled: !!providerId,
  });
}

interface AttestationParams {
  providerId: string;
  enrollmentIds: string[];
  attestedBy?: string;
}

/**
 * Hook to record PDM attestation
 */
export function usePdmAttestation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ providerId, enrollmentIds, attestedBy }: AttestationParams) => {
      const response = await api.post(`/pdm/provider/${providerId}/attest`, { enrollmentIds, attestedBy });
      return response.data;
    },
    onSuccess: (_data, variables) => {
      // Invalidate related queries to refetch updated data
      queryClient.invalidateQueries({
        queryKey: ['pdm-status', variables.providerId],
      });
      queryClient.invalidateQueries({
        queryKey: ['pdm-alerts', variables.providerId],
      });
      queryClient.invalidateQueries({
        queryKey: ['enrollments', variables.providerId],
      });
    },
  });
}

/**
 * Utility to get status label for display
 */
export function getPdmStatusLabel(status: PdmAttestationStatus['status']): string {
  switch (status) {
    case 'current':
      return 'Current';
    case 'due_soon':
      return 'Due Soon';
    case 'overdue':
      return 'Overdue';
    case 'never_attested':
      return 'Never Attested';
    default:
      return 'Unknown';
  }
}

/**
 * Get Availity PDM deep link URL
 */
export const AVAILITY_PDM_URL = 'https://apps.availity.com/web/pdm/pdm-ui/';
