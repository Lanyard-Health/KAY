import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

export interface CaqhCredentialStatus {
  hasCredentials: boolean;
  isValid: boolean | null;
  lastChecked: string | null;
  username: string | null;
  caqhProviderId: string | null;
  caqhStatus: string | null;
  caqhLastSync: string | null;
}

export interface CaqhVerificationResult {
  success: boolean;
  valid: boolean;
  message: string;
  errorType?: 'invalid_credentials' | 'account_locked' | 'mfa_required' | 'timeout' | 'network_error' | 'unknown';
  details?: string;
}

interface CredentialStatusResponse {
  success: boolean;
  data: CaqhCredentialStatus;
}

interface VerificationResponse {
  success: boolean;
  data: CaqhVerificationResult;
}

/**
 * Hook to fetch CAQH credential status for a provider
 */
export function useCaqhCredentialStatus(providerId: string) {
  return useQuery({
    queryKey: ['caqh-credentials', providerId],
    queryFn: async () => {
      const response = await api.get<CredentialStatusResponse>(`/caqh/credentials/${providerId}`);
      return response.data;
    },
    enabled: !!providerId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

interface SaveCredentialsParams {
  providerId: string;
  username: string;
  password: string;
}

/**
 * Hook to save CAQH credentials for a provider
 */
export function useSaveCaqhCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ providerId, username, password }: SaveCredentialsParams) => {
      const response = await api.post(`/caqh/credentials/${providerId}`, { username, password });
      return response.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['caqh-credentials', variables.providerId],
      });
    },
  });
}

/**
 * Hook to verify CAQH credentials for a provider (credentials must be saved first)
 */
export function useVerifyCaqhCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (providerId: string) => {
      const response = await api.post<VerificationResponse>(`/caqh/credentials/${providerId}/verify`);
      return response.data;
    },
    onSuccess: (_data, providerId) => {
      queryClient.invalidateQueries({
        queryKey: ['caqh-credentials', providerId],
      });
    },
  });
}

interface TestCredentialsParams {
  username: string;
  password: string;
}

/**
 * Hook to test CAQH credentials without saving
 */
export function useTestCaqhCredentials() {
  return useMutation({
    mutationFn: async ({ username, password }: TestCredentialsParams) => {
      const response = await api.post<VerificationResponse>('/caqh/credentials/test', { username, password });
      return response.data;
    },
  });
}

/**
 * Get a user-friendly label for credential status
 */
export function getCredentialStatusLabel(status: CaqhCredentialStatus): string {
  if (!status.hasCredentials) {
    return 'Not Configured';
  }
  if (status.isValid === null) {
    return 'Not Verified';
  }
  return status.isValid ? 'Valid' : 'Invalid';
}

/**
 * Get badge color class for credential status
 */
export function getCredentialStatusColor(status: CaqhCredentialStatus): string {
  if (!status.hasCredentials) {
    return 'bg-gray-100 text-gray-800';
  }
  if (status.isValid === null) {
    return 'bg-yellow-100 text-yellow-800';
  }
  return status.isValid ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
}

/**
 * CAQH ProView login URL
 */
export const CAQH_PROVIEW_URL = 'https://proview.caqh.org/Login';
