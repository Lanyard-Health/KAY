import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import toast from 'react-hot-toast';

interface ReadinessResult {
  ready: boolean;
  pages: Array<{
    page: number;
    title: string;
    ready: boolean;
    missing: Array<{ field: string; label: string; fixPath: string }>;
  }>;
}

interface AetnaRunStatus {
  id: string;
  status: string;
  aetnaRequestId: string | null;
  screenshotUrls: string[];
  automationLog: string | null;
  errorMessage: string | null;
  errorPage: number | null;
  startedAt: string | null;
  reviewExpiresAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  confirmationPdfUrl: string | null;
}

export function useAetnaReadiness(enrollmentId: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ success: boolean; data: ReadinessResult }>(
        `/enrollments/${enrollmentId}/aetna/readiness`
      );
      return res.data.data;
    },
  });
}

export function useStartAetnaEnrollment(enrollmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ success: boolean; data: { runId: string; status: string } }>(
        `/enrollments/${enrollmentId}/aetna/start`
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['aetna-run', data.runId] });
      toast.success('Aetna enrollment started');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error?.message || 'Failed to start enrollment');
    },
  });
}

export function useAetnaRunStatus(runId: string | null, enrollmentId: string) {
  return useQuery({
    queryKey: ['aetna-run', runId],
    queryFn: async () => {
      if (!runId) return null;
      const res = await api.get<{ success: boolean; data: AetnaRunStatus }>(
        `/enrollments/${enrollmentId}/aetna/runs/${runId}`
      );
      return res.data.data;
    },
    enabled: !!runId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll every 3s while filling, stop when done
      if (status === 'filling' || status === 'pending' || status === 'submitting') return 3000;
      return false;
    },
  });
}

export function useApproveAetnaRun(enrollmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const res = await api.post(`/enrollments/${enrollmentId}/aetna/runs/${runId}/approve`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aetna-run'] });
      toast.success('Submission approved — submitting to Aetna');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error?.message || 'Failed to approve');
    },
  });
}

export function useRejectAetnaRun(enrollmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const res = await api.post(`/enrollments/${enrollmentId}/aetna/runs/${runId}/reject`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aetna-run'] });
      toast.success('Submission rejected');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error?.message || 'Failed to reject');
    },
  });
}

export function useRetryAetnaRun(enrollmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const res = await api.post(`/enrollments/${enrollmentId}/aetna/runs/${runId}/retry`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aetna-run'] });
      toast.success('Retrying enrollment');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error?.message || 'Failed to retry');
    },
  });
}
