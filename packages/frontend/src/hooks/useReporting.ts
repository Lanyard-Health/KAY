import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

const STALE_TIME = 5 * 60 * 1000; // 5 minutes

// ==========================================
// Types
// ==========================================

export interface EnrollmentPipelineResult {
  byPayer: Array<{
    payerName: string;
    payerId: string;
    statuses: Record<string, number>;
  }>;
  total: Record<string, number>;
}

export interface ExpirationItem {
  providerId: string;
  providerName: string;
  credentialType: 'license' | 'board_certification' | 'malpractice_insurance';
  credentialName: string;
  expirationDate: string;
  daysRemaining: number;
}

export interface ExpirationForecastResult {
  buckets: {
    critical: ExpirationItem[];
    warning: ExpirationItem[];
    upcoming: ExpirationItem[];
  };
  counts: {
    critical: number;
    warning: number;
    upcoming: number;
  };
}

export interface ProviderReadinessResult {
  providers: Array<{
    providerId: string;
    providerName: string;
    hasActiveLicense: boolean;
    hasMalpractice: boolean;
    hasActiveEnrollment: boolean;
    readinessScore: number;
  }>;
  summary: {
    fullyReady: number;
    partiallyReady: number;
    notReady: number;
  };
}

export interface GettingStartedResult {
  providerCount: number;
  documentCount: number;
  enrollmentCount: number;
  isOnboarded: boolean;
}

// ==========================================
// Hooks
// ==========================================

export function useEnrollmentPipeline(
  practiceId: string,
  startDate?: string,
  endDate?: string,
) {
  const params = new URLSearchParams({ practiceId });
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);

  return useQuery({
    queryKey: ['reporting-enrollment-pipeline', practiceId, startDate, endDate],
    queryFn: async () => {
      const response = await api.get(`/reporting/enrollment-pipeline?${params}`);
      return response.data.data as EnrollmentPipelineResult;
    },
    staleTime: STALE_TIME,
    enabled: !!practiceId,
  });
}

export function useExpirationForecast(practiceId: string, days?: number) {
  const params = new URLSearchParams({ practiceId });
  if (days !== undefined) params.set('days', String(days));

  return useQuery({
    queryKey: ['reporting-expiration-forecast', practiceId, days],
    queryFn: async () => {
      const response = await api.get(`/reporting/expiration-forecast?${params}`);
      return response.data.data as ExpirationForecastResult;
    },
    staleTime: STALE_TIME,
    enabled: !!practiceId,
  });
}

export function useProviderReadiness(practiceId: string) {
  return useQuery({
    queryKey: ['reporting-provider-readiness', practiceId],
    queryFn: async () => {
      const response = await api.get(
        `/reporting/provider-readiness?practiceId=${practiceId}`,
      );
      return response.data.data as ProviderReadinessResult;
    },
    staleTime: STALE_TIME,
    enabled: !!practiceId,
  });
}

export function useGettingStarted(practiceId: string) {
  return useQuery({
    queryKey: ['reporting-getting-started', practiceId],
    queryFn: async () => {
      const response = await api.get(
        `/reporting/getting-started?practiceId=${practiceId}`,
      );
      return response.data.data as GettingStartedResult;
    },
    staleTime: STALE_TIME,
    enabled: !!practiceId,
  });
}
