import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import toast from 'react-hot-toast';

// ─── Types ─────────────────────────────────────────────────

export interface WorkflowApproval {
  id: string;
  type: 'workflow_step' | 'follow_up_outreach';
  status: 'pending' | 'approved' | 'denied' | 'expired';
  context: Record<string, unknown>;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
  enrollmentWorkflowStepId: string | null;
  followUpRunId: string | null;
  followUpStepOrder: number | null;
  enrollmentWorkflowStep?: {
    id: string;
    name: string;
    actionType: string;
    stepOrder: number;
    status: string;
    enrollment: {
      id: string;
      provider: { id: string; firstName: string; lastName: string; npi: string };
      payer: { id: string; name: string };
    };
  } | null;
  followUpRun?: {
    id: string;
    status: string;
    currentStepOrder: number;
    enrollment: {
      id: string;
      provider: { id: string; firstName: string; lastName: string; npi: string };
      payer: { id: string; name: string };
    };
    template: { id: string; name: string };
  } | null;
  decider?: { id: string; firstName: string; lastName: string } | null;
}

// ─── Queries ───────────────────────────────────────────────

export function useWorkflowApprovals(filters?: { status?: string; type?: string }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();

  return useQuery<WorkflowApproval[]>({
    queryKey: ['workflow-approvals', filters],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: WorkflowApproval[] }>(`/workflow-approvals${qs ? `?${qs}` : ''}`);
      return res.data.data;
    },
  });
}

// ─── Mutations ─────────────────────────────────────────────

export function useDecideApproval() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      decision,
      decisionNotes,
    }: {
      id: string;
      decision: 'approved' | 'denied';
      decisionNotes?: string;
    }) => {
      const res = await api.post(`/workflow-approvals/${id}/decide`, {
        decision,
        decisionNotes,
      });
      return res.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-approvals'] });
      const side = (data as { data?: { sideEffect?: { type?: string; detail?: string } } })?.data?.sideEffect;
      if (variables.decision === 'denied') {
        toast.success('Denied successfully');
        return;
      }
      // Approved — surface the actual send result
      switch (side?.type) {
        case 'email_sent':
          toast.success(side.detail || 'Approved, email sent');
          break;
        case 'email_failed':
          toast.error(`Approved, but email send failed: ${side.detail ?? 'unknown error'}`);
          break;
        case 'email_skipped':
          toast(`Approved; email skipped: ${side.detail ?? 'missing data'}`);
          break;
        case 'phone_call_queued':
          toast.success('Approved, phone call queued');
          break;
        default:
          toast.success('Approved successfully');
      }
    },
    onError: () => {
      toast.error('Failed to process approval');
    },
  });
}
