import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import toast from 'react-hot-toast';

// ===========================
// Types
// ===========================

export interface ApprovalWorkflow {
  id: string;
  goal: string;
  status: string;
  provider: { id: string; firstName: string; lastName: string; npi: string } | null;
  payer: { id: string; name: string } | null;
}

export interface Approval {
  id: string;
  workflowId: string;
  taskId: string;
  type: string;
  status: 'pending' | 'approved' | 'denied';
  context: Record<string, unknown>;
  requestedAt: string;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
  // Null for follow-up outreach approvals (which carry `followUpRun`
  // on the backend, not a workflow). Workflow-step approvals always
  // populate this. Consumers MUST guard before reading nested fields.
  workflow: ApprovalWorkflow | null;
}

// ===========================
// Hooks
// ===========================

export function useApprovals(status?: string) {
  const endpoint = status
    ? `/agent/approvals?status=${encodeURIComponent(status)}`
    : '/agent/approvals';

  return useQuery<Approval[]>({
    queryKey: ['approvals', status ?? 'all'],
    queryFn: async () => {
      const { data } = await api.get<Approval[]>(endpoint);
      // Guard against backend returning null / non-array — downstream callers
      // do `approvals?.filter(...)` which crashes on a truthy non-array value.
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 60_000, // Fallback polling; WebSocket handles real-time updates
  });
}

export function useApprovalDetail(id: string | null) {
  return useQuery<Approval | null>({
    queryKey: ['approval', id],
    queryFn: async () => {
      if (!id) return null;
      const { data } = await api.get<Approval>(`/agent/approvals/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useDecideApproval() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      decision,
      notes,
    }: {
      id: string;
      decision: 'approved' | 'denied';
      notes?: string;
    }) => api.post(`/agent/approvals/${id}/decide`, { decision, notes }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['approval', variables.id] });
      toast.success(
        `Approval ${variables.decision === 'approved' ? 'approved' : 'denied'} successfully`,
      );
    },
    onError: (error: Error) => {
      toast.error(`Decision failed: ${error.message}`);
    },
  });
}

export function useBulkDecideApprovals() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      ids,
      decision,
      notes,
    }: {
      ids: string[];
      decision: 'approved' | 'denied';
      notes?: string;
    }) => api.post<{ succeeded: string[]; failed: { id: string; error: string }[] }>(
      '/agent/approvals/bulk-decide',
      { ids, decision, notes },
    ),
    onSuccess: (response, variables) => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      const { succeeded, failed } = response.data;
      if (succeeded.length > 0) {
        toast.success(
          `${succeeded.length} approval${succeeded.length > 1 ? 's' : ''} ${variables.decision}`,
        );
      }
      if (failed.length > 0) {
        toast.error(`${failed.length} failed: ${failed[0]?.error ?? 'Unknown error'}`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Bulk decision failed: ${error.message}`);
    },
  });
}
