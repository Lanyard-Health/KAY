import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

// ── Types ────────────────────────────────────────

export interface OpsDashboardStats {
  totalPractices: number;
  practicesByTier: Record<string, number>;
  totalProviders: number;
  providersByStatus: Record<string, number>;
  totalEnrollments: number;
  enrollmentsByStatus: Record<string, number>;
  slaHealth: { onTrack: number; atRisk: number; breached: number };
  workItems: { total: number; byStatus: Record<string, number> };
}

export interface OpsPractice {
  id: string;
  name: string;
  serviceTier: string;
  slaTargetDays: number;
  providerCount: number;
  enrollmentCount: number;
  primaryOpsStaff: { id: string; firstName: string; lastName: string } | null;
  lastActivity: string | null;
  slaHealth: { atRisk: number; breached: number };
}

export interface OpsStaffMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  openItems: number;
  overdueItems: number;
  completedThisWeek: number;
  avgTurnaroundDays: number;
  assignedPractices: number;
}

export interface OpsSlaSummary {
  totalActive: number;
  onTrack: number;
  atRisk: number;
  breached: number;
  breachedEnrollments: Array<{
    id: string;
    providerName: string;
    payerName: string;
    practiceName: string;
    status: string;
    slaTargetDate: string;
    slaBreachedAt: string;
  }>;
}

export interface OpsWorkItem {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  priority: string;
  practiceId: string | null;
  providerId: string | null;
  enrollmentId: string | null;
  assignedToId: string | null;
  dueDate: string | null;
  slaDeadline: string | null;
  startedAt: string | null;
  completedAt: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  blockerNotes: string | null;
  createdAt: string;
  updatedAt: string;
  practice?: { id: string; name: string } | null;
  provider?: { id: string; firstName: string; lastName: string } | null;
  enrollment?: { id: string; payer: { id: string; name: string } } | null;
  assignedTo?: { id: string; firstName: string; lastName: string } | null;
  comments?: OpsComment[];
}

export interface OpsComment {
  id: string;
  content: string;
  isInternal: boolean;
  createdAt: string;
  author: { id: string; firstName: string; lastName: string };
}

export interface OpsAssignment {
  id: string;
  staffId: string;
  practiceId: string | null;
  providerId: string | null;
  enrollmentId: string | null;
  isPrimary: boolean;
  assignedAt: string;
  staff?: { id: string; firstName: string; lastName: string };
  practice?: { id: string; name: string } | null;
  provider?: { id: string; firstName: string; lastName: string } | null;
}

// ── Query Hooks ──────────────────────────────────

export function useOpsDashboard() {
  return useQuery({
    queryKey: ['ops-dashboard'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: OpsDashboardStats }>('/ops/dashboard');
      return res.data.data;
    },
  });
}

export function useOpsPractices(filters?: { search?: string; serviceTier?: string; page?: number }) {
  return useQuery({
    queryKey: ['ops-practices', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.search) params.set('search', filters.search);
      if (filters?.serviceTier) params.set('serviceTier', filters.serviceTier);
      if (filters?.page) params.set('page', String(filters.page));
      const qs = params.toString();
      const res = await api.get<{ success: boolean; data: { practices: OpsPractice[]; total: number; page: number; limit: number } }>(
        `/ops/practices${qs ? `?${qs}` : ''}`,
      );
      return res.data.data;
    },
  });
}

export function useOpsPractice(id: string) {
  return useQuery({
    queryKey: ['ops-practice', id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: any }>(`/ops/practices/${id}`);
      return res.data.data;
    },
    enabled: !!id,
  });
}

export function useOpsWorkQueue(filters?: {
  assigneeId?: string;
  practiceId?: string;
  status?: string[];
  priority?: string[];
  category?: string[];
  slaStatus?: string;
  search?: string;
  page?: number;
}) {
  return useQuery({
    queryKey: ['ops-work-queue', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.assigneeId) params.set('assigneeId', filters.assigneeId);
      if (filters?.practiceId) params.set('practiceId', filters.practiceId);
      if (filters?.status) filters.status.forEach((s) => params.append('status', s));
      if (filters?.priority) filters.priority.forEach((p) => params.append('priority', p));
      if (filters?.category) filters.category.forEach((c) => params.append('category', c));
      if (filters?.slaStatus) params.set('slaStatus', filters.slaStatus);
      if (filters?.search) params.set('search', filters.search);
      if (filters?.page) params.set('page', String(filters.page));
      const qs = params.toString();
      const res = await api.get<{ success: boolean; data: { items: OpsWorkItem[]; total: number; page: number; limit: number } }>(
        `/ops/work-items${qs ? `?${qs}` : ''}`,
      );
      return res.data.data;
    },
  });
}

export function useMyWorkItems() {
  return useQuery({
    queryKey: ['ops-my-work-items'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: OpsWorkItem[]; total: number } }>('/ops/work-items/my');
      return res.data.data;
    },
  });
}

export function useOpsWorkItem(id: string) {
  return useQuery({
    queryKey: ['ops-work-item', id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: OpsWorkItem }>(`/ops/work-items/${id}`);
      return res.data.data;
    },
    enabled: !!id,
  });
}

export function useOpsStaff() {
  return useQuery({
    queryKey: ['ops-staff'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: OpsStaffMember[] }>('/ops/staff');
      return res.data.data;
    },
  });
}

export function useOpsStaffWorkload(staffId: string) {
  return useQuery({
    queryKey: ['ops-staff-workload', staffId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: OpsStaffMember }>(`/ops/staff/${staffId}/workload`);
      return res.data.data;
    },
    enabled: !!staffId,
  });
}

export function useOpsSla(filters?: { practiceId?: string; payerId?: string }) {
  return useQuery({
    queryKey: ['ops-sla', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.practiceId) params.set('practiceId', filters.practiceId);
      if (filters?.payerId) params.set('payerId', filters.payerId);
      const qs = params.toString();
      const res = await api.get<{ success: boolean; data: OpsSlaSummary }>(
        `/ops/sla${qs ? `?${qs}` : ''}`,
      );
      return res.data.data;
    },
  });
}

export function useOpsAssignments(filters?: { staffId?: string; practiceId?: string }) {
  return useQuery({
    queryKey: ['ops-assignments', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.staffId) params.set('staffId', filters.staffId);
      if (filters?.practiceId) params.set('practiceId', filters.practiceId);
      const qs = params.toString();
      const res = await api.get<{ success: boolean; data: OpsAssignment[] }>(
        `/ops/assignments${qs ? `?${qs}` : ''}`,
      );
      return res.data.data;
    },
  });
}

export function useMyWorkItemCount() {
  return useQuery({
    queryKey: ['ops-my-work-items-count'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: OpsWorkItem[]; total: number } }>('/ops/work-items/my');
      return res.data.data.total;
    },
    refetchInterval: 60_000,
  });
}

export function useSlaSummary() {
  return useQuery({
    queryKey: ['ops-sla-summary'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: OpsSlaSummary }>('/ops/sla');
      return res.data.data;
    },
  });
}

// ── Mutation Hooks ───────────────────────────────

export function useCreateWorkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      title: string;
      description?: string;
      category: string;
      priority?: string;
      practiceId?: string;
      providerId?: string;
      enrollmentId?: string;
      assignedToId?: string;
      dueDate?: string;
      estimatedMinutes?: number;
    }) => {
      const res = await api.post<{ success: boolean; data: OpsWorkItem }>('/ops/work-items', data);
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ops-work-queue'] });
      qc.invalidateQueries({ queryKey: ['ops-my-work-items'] });
      qc.invalidateQueries({ queryKey: ['ops-dashboard'] });
    },
  });
}

export function useUpdateWorkItemStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: string; notes?: string }) => {
      const res = await api.patch<{ success: boolean; data: OpsWorkItem }>(`/ops/work-items/${id}`, { status, notes });
      return res.data.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['ops-work-item', vars.id] });
      qc.invalidateQueries({ queryKey: ['ops-work-queue'] });
      qc.invalidateQueries({ queryKey: ['ops-my-work-items'] });
      qc.invalidateQueries({ queryKey: ['ops-dashboard'] });
    },
  });
}

export function useAssignWorkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, staffId }: { id: string; staffId: string }) => {
      const res = await api.post<{ success: boolean; data: OpsWorkItem }>(`/ops/work-items/${id}/assign`, { staffId });
      return res.data.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['ops-work-item', vars.id] });
      qc.invalidateQueries({ queryKey: ['ops-work-queue'] });
      qc.invalidateQueries({ queryKey: ['ops-my-work-items'] });
    },
  });
}

export function useBulkAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workItemIds, staffId }: { workItemIds: string[]; staffId: string }) => {
      const res = await api.post<{ success: boolean; data: { count: number } }>('/ops/work-items/bulk-assign', { workItemIds, staffId });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ops-work-queue'] });
      qc.invalidateQueries({ queryKey: ['ops-my-work-items'] });
    },
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workItemId, content }: { workItemId: string; content: string }) => {
      const res = await api.post<{ success: boolean; data: OpsComment }>(`/ops/work-items/${workItemId}/comments`, { content });
      return res.data.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['ops-work-item', vars.workItemId] });
    },
  });
}

export function useCreateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { staffId: string; practiceId?: string; providerId?: string; enrollmentId?: string }) => {
      const res = await api.post<{ success: boolean; data: OpsAssignment }>('/ops/assignments', data);
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ops-assignments'] });
      qc.invalidateQueries({ queryKey: ['ops-staff'] });
    },
  });
}

export function useRemoveAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const res = await api.delete<{ success: boolean }>(`/ops/assignments/${assignmentId}`);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ops-assignments'] });
      qc.invalidateQueries({ queryKey: ['ops-staff'] });
    },
  });
}

export function useTransferAssignments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ fromStaffId, toStaffId }: { fromStaffId: string; toStaffId: string }) => {
      const res = await api.post<{ success: boolean; data: { assignments: number; workItems: number } }>(
        '/ops/assignments/transfer',
        { fromStaffId, toStaffId },
      );
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ops-assignments'] });
      qc.invalidateQueries({ queryKey: ['ops-staff'] });
      qc.invalidateQueries({ queryKey: ['ops-work-queue'] });
    },
  });
}

export function useUpdateServiceTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ practiceId, tier }: { practiceId: string; tier: string }) => {
      const res = await api.patch<{ success: boolean; data: any }>(`/ops/practices/${practiceId}/service-tier`, { tier });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ops-practices'] });
      qc.invalidateQueries({ queryKey: ['ops-dashboard'] });
    },
  });
}
