import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import { useMemo } from 'react';

// ===========================
// Types
// ===========================

export interface FollowUpTemplateStep {
  id: string;
  stepOrder: number;
  name: string;
  channel: string; // email | phone_call
  triggerDaysAfterPrev: number;
  escalationLevel: number;
  emailSubject: string | null;
  emailTone: string | null;
  requiresApproval: boolean;
}

export interface FollowUpRunItem {
  id: string;
  enrollmentId: string;
  templateId: string;
  status: string; // active | paused | completed | cancelled
  currentStepOrder: number;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  enrollment: {
    id: string;
    provider: {
      id: string;
      firstName: string;
      lastName: string;
      practiceId: string | null;
    };
    payer: {
      id: string;
      name: string;
    };
  };
  template: {
    id: string;
    name: string;
    steps: FollowUpTemplateStep[];
  };
  _count: {
    callLogs: number;
  };
}

export interface FollowUpMonitorFilters {
  status?: string;
  search?: string;
}

// ===========================
// Hooks
// ===========================

export function useFollowUpRuns(filters?: FollowUpMonitorFilters) {
  return useQuery({
    queryKey: ['follow-up-runs', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.search) params.set('search', filters.search);
      const qs = params.toString();
      const { data } = await api.get<{ success: boolean; data: FollowUpRunItem[] }>(
        `/follow-up/runs${qs ? `?${qs}` : ''}`
      );
      return data.data;
    },
    staleTime: 30 * 1000,
  });
}

export function useFollowUpDue() {
  return useQuery({
    queryKey: ['follow-up-due'],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: unknown[]; count: number }>(
        '/follow-up/due'
      );
      return data;
    },
    staleTime: 60 * 1000,
  });
}

export function usePauseResumeRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ runId, status }: { runId: string; status: 'active' | 'paused' }) => {
      const { data } = await api.patch<{ success: boolean; data: unknown }>(
        `/follow-up/runs/${runId}`,
        { status }
      );
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['follow-up-runs'] });
      toast.success(variables.status === 'paused' ? 'Run paused' : 'Run resumed');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || error.message || 'Failed to update run';
      toast.error(message);
    },
  });
}

export function useTriggerFollowUps() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ success: boolean; data: unknown }>('/follow-up/run');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['follow-up-runs'] });
      queryClient.invalidateQueries({ queryKey: ['follow-up-due'] });
      toast.success('Follow-up processing triggered');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || error.message || 'Failed to trigger follow-ups';
      toast.error(message);
    },
  });
}

export function useFollowUpStats(runs?: FollowUpRunItem[]) {
  return useMemo(() => {
    if (!runs) return { active: 0, dueToday: 0, sentThisWeek: 0, failed: 0 };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const active = runs.filter((r) => r.status === 'active').length;
    const failed = runs.filter((r) => r.status === 'cancelled').length;

    // Due today: active runs where the next step date is today or past
    const dueToday = runs.filter((r) => {
      if (r.status !== 'active') return false;
      const nextDate = computeNextActionDate(r);
      return nextDate && nextDate <= now;
    }).length;

    // Sent this week: completed runs or runs updated this week
    const sentThisWeek = runs.filter((r) => {
      const updated = new Date(r.updatedAt);
      return updated >= weekAgo && (r.status === 'completed' || r._count.callLogs > 0);
    }).length;

    return { active, dueToday, sentThisWeek, failed };
  }, [runs]);
}

// Compute next action date from run's startedAt + cumulative step delays
export function computeNextActionDate(run: FollowUpRunItem): Date | null {
  if (!run.template?.steps?.length) return null;
  const steps = run.template.steps;
  let cumulativeDays = 0;
  for (const step of steps) {
    cumulativeDays += step.triggerDaysAfterPrev;
    if (step.stepOrder >= run.currentStepOrder) break;
  }
  const startDate = new Date(run.startedAt);
  return new Date(startDate.getTime() + cumulativeDays * 24 * 60 * 60 * 1000);
}
