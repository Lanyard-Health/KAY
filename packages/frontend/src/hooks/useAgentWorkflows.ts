import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import toast from 'react-hot-toast';

// ===========================
// Types
// ===========================

export type WorkflowStatus =
  | 'planning'
  | 'active'
  | 'paused'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped';

export interface AgentTask {
  id: string;
  workflowId: string;
  agentType: string;
  status: TaskStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  /**
   * Per-agent error payload. Each agent writes its own shape — usually
   * `{ message: string }` (portal/document/exception), sometimes a string
   * (older paths). Render via `formatTaskError()` to handle both.
   */
  error: string | { message?: string } | Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface NarrationEventData {
  message: string;
  step?: number;
  downloadUrl?: string;
}

export interface AgentEvent {
  id: string;
  workflowId: string;
  taskId: string | null;
  agent: string | null;
  action: string;
  level: 'info' | 'warn' | 'error';
  /**
   * Per-event payload. Field name mirrors the backend `agent_events.data`
   * column. Shape varies by action; for `action: 'narration'` it's
   * `NarrationEventData`.
   */
  data: Record<string, unknown> | null;
  /** ISO timestamp when the event was created (backend sends `timestamp`). */
  timestamp?: string;
  createdAt: string;
}

/**
 * Extract narration messages emitted by the AI agent (action='narration').
 * The agent's `narrate` tool writes one of these per progress message.
 */
export function isNarrationEvent(
  event: AgentEvent
): event is AgentEvent & { data: NarrationEventData } {
  if (event.action !== 'narration' || !event.data) return false;
  const message = (event.data as { message?: unknown }).message;
  return typeof message === 'string';
}

export interface AgentWorkflow {
  id: string;
  goal: string;
  status: WorkflowStatus;
  priority: number;
  providerId: string | null;
  payerId: string | null;
  enrollmentId: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tasks: AgentTask[];
  approvals: Array<{
    id: string;
    type: string;
    status: string;
    context: Record<string, unknown>;
    requestedAt: string;
    expiresAt: string;
    decidedAt: string | null;
  }>;
  provider: { id: string; firstName: string; lastName: string; npi: string } | null;
  payer: { id: string; name: string } | null;
}

export interface WorkflowListItem {
  id: string;
  goal: string;
  status: WorkflowStatus;
  priority: number;
  providerId: string | null;
  payerId: string | null;
  enrollmentId: string | null;
  createdAt: string;
  updatedAt: string;
  provider: { id: string; firstName: string; lastName: string } | null;
  payer: { id: string; name: string } | null;
}

// ===========================
// Hooks
// ===========================

const TERMINAL_STATUSES: WorkflowStatus[] = ['completed', 'failed', 'cancelled'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function useLaunchWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      goal: string;
      providerId: string;
      payerId?: string;
      enrollmentId?: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
    }) => api.post<AgentWorkflow>('/agent/workflows', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-workflows'] });
      toast.success('Agent workflow launched');
    },
    onError: (error: Error) => {
      toast.error(`Failed to launch workflow: ${error.message}`);
    },
  });
}

export interface AdminWorkflowListItem extends WorkflowListItem {
  _count?: { tasks: number; events: number };
}

export interface AdminWorkflowsFilters {
  status?: WorkflowStatus | '';
  limit?: number;
  offset?: number;
}

/** List ALL workflows (admin/staff scope, no enrollment filter). Used by the
 * /admin/workflows list page. Polls every 10s so live workflows show up
 * without a manual refresh. The list page does its own client-side
 * status grouping (in_flight/completed/failed/cancelled), so we don't
 * pass a status filter through to the backend — keeps the chip switching
 * instant and avoids re-fetching when the user toggles. */
export function useAdminWorkflows(filters: AdminWorkflowsFilters = {}) {
  const { status, limit = 100, offset = 0 } = filters;
  return useQuery<AdminWorkflowListItem[]>({
    queryKey: ['agent-workflows-admin', { status, limit, offset }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      const { data } = await api.get<AdminWorkflowListItem[]>(`/agent/workflows?${params.toString()}`);
      return data;
    },
    refetchInterval: 10_000,
  });
}

export function useWorkflowsForEnrollment(providerId: string, enrollmentId: string) {
  return useQuery<WorkflowListItem[]>({
    queryKey: ['agent-workflows', providerId, enrollmentId],
    queryFn: async () => {
      const { data } = await api.get<WorkflowListItem[]>(
        `/agent/workflows?providerId=${encodeURIComponent(providerId)}&limit=50`,
      );
      // Client-side filter by enrollmentId since backend list doesn't support it
      return data.filter((w) => w.enrollmentId === enrollmentId);
    },
    refetchInterval: 30_000,
    enabled: !!providerId && !!enrollmentId && isUuid(providerId),
  });
}

export function useWorkflowDetail(workflowId: string | null) {
  return useQuery<AgentWorkflow | null>({
    queryKey: ['agent-workflow', workflowId],
    queryFn: async () => {
      if (!workflowId) return null;
      const { data } = await api.get<AgentWorkflow>(`/agent/workflows/${workflowId}`);
      return data;
    },
    enabled: !!workflowId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || TERMINAL_STATUSES.includes(status)) return false;
      return 5_000;
    },
  });
}

export function useWorkflowEvents(workflowId: string | null, workflowStatus?: WorkflowStatus) {
  return useQuery<AgentEvent[]>({
    queryKey: ['agent-workflow-events', workflowId],
    queryFn: async () => {
      if (!workflowId) return [];
      const { data } = await api.get<AgentEvent[]>(`/agent/workflows/${workflowId}/events`);
      return data;
    },
    enabled: !!workflowId,
    refetchInterval: () => {
      if (!workflowStatus || TERMINAL_STATUSES.includes(workflowStatus)) return false;
      return 2_000;
    },
  });
}

export function useCancelWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workflowId: string) =>
      api.patch(`/agent/workflows/${workflowId}`, { action: 'cancel' }),
    onSuccess: (_data, workflowId) => {
      queryClient.invalidateQueries({ queryKey: ['agent-workflows'] });
      queryClient.invalidateQueries({ queryKey: ['agent-workflow', workflowId] });
      toast.success('Workflow cancelled');
    },
    onError: (error: Error) => {
      toast.error(`Failed to cancel workflow: ${error.message}`);
    },
  });
}
