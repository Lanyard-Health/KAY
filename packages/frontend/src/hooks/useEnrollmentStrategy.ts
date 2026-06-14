import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../services/api';

// ===========================
// Types
// ===========================

export interface PayerAnalytics {
  payerId: string;
  payerName: string;
  payerType: string | null;
  totalEnrollments: number;
  activeEnrollments: number;
  approvalRate: number | null;
  denialRate: number | null;
  avgDaysToApproval: number | null;
  avgDaysInCurrentStatus: number | null;
  enrollmentsStuckOver60Days: number;
  statusDistribution: Record<string, number>;
  insufficientData: boolean;
}

export interface PayerLeaderboardItem {
  payerId: string;
  payerName: string;
  payerType: string | null;
  difficultyScore: number;
  approvalRate: number | null;
  denialRate: number | null;
  avgDaysToApproval: number | null;
  totalEnrollments: number;
  stuckCount: number;
}

export interface PayerAIInsight {
  riskAssessment: string;
  summary: string;
  strengths: string[];
  risks: string[];
  recommendations: Array<{
    action: string;
    priority: string;
    reasoning: string;
  }>;
  optimalFollowUpStrategy: {
    frequencyDays: number;
    bestApproach: string;
    escalationThreshold: string;
  };
  comparisonInsight: string;
}

export interface PayerInsightRecord {
  id: string;
  type: string;
  status: string;
  title: string;
  content: string;
  reasoning: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ===========================
// Hooks
// ===========================

export function usePayerAnalytics(payerId?: string) {
  return useQuery({
    queryKey: ['payer-analytics', payerId],
    queryFn: async () => {
      const params = payerId ? `?payerId=${payerId}` : '';
      const { data } = await api.get<{ success: boolean; data: PayerAnalytics[] }>(
        `/enrollment-strategy/analytics${params}`
      );
      return data;
    },
    staleTime: 60 * 1000,
  });
}

export function usePayerLeaderboard() {
  return useQuery({
    queryKey: ['payer-leaderboard'],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: PayerLeaderboardItem[] }>(
        '/enrollment-strategy/leaderboard'
      );
      return data;
    },
    staleTime: 60 * 1000,
  });
}

export function useAnalyzePayer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payerId: string) => {
      const { data } = await api.post<{
        success: boolean;
        data: { insight: PayerAIInsight; recommendation: { id: string } };
      }>(`/enrollment-strategy/${payerId}/analyze`);
      return data;
    },
    onSuccess: (_data, payerId) => {
      queryClient.invalidateQueries({ queryKey: ['payer-analytics', payerId] });
      queryClient.invalidateQueries({ queryKey: ['payer-insights', payerId] });
      queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || error.message || 'Failed to analyze payer';
      toast.error(message);
    },
  });
}

export function usePayerInsights(payerId: string | null) {
  return useQuery({
    queryKey: ['payer-insights', payerId],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: PayerInsightRecord[] }>(
        `/enrollment-strategy/${payerId}/insights`
      );
      return data;
    },
    enabled: !!payerId,
    staleTime: 30 * 1000,
  });
}
