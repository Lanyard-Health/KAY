import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

// ===========================
// Types
// ===========================

export interface StaffTask {
  id: string;
  title: string;
  description?: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  dueDate?: string | null;
  createdAt: string;
  completedAt?: string | null;
  assignedTo?: { id: string; firstName: string; lastName: string } | null;
  createdBy?: { id: string; firstName: string; lastName: string } | null;
  completedBy?: { id: string; firstName: string; lastName: string } | null;
  provider?: { id: string; firstName: string; lastName: string } | null;
  practice?: { id: string; name: string } | null;
  enrollment?: { id: string; payer?: { name: string } } | null;
}

// ===========================
// Hooks
// ===========================

export function useStaffTasks(
  view: 'my' | 'pool' | 'all',
  filters?: { status?: string; priority?: string; practiceId?: string },
  limit: number = 50
) {
  return useQuery({
    queryKey: ['staff-tasks', view, filters, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ view, limit: limit.toString() });
      if (filters?.status) params.set('status', filters.status);
      if (filters?.priority) params.set('priority', filters.priority);
      if (filters?.practiceId) params.set('practiceId', filters.practiceId);
      const response = await api.get(`/tasks?${params.toString()}`);
      return response.data; // { success, data: StaffTask[], meta: { total } }
    },
  });
}

export function useTaskCounts(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['staff-tasks', 'counts'],
    queryFn: async () => (await api.get('/tasks/counts')).data.data as { open: number; overdue: number },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    enabled: options?.enabled ?? true, // Layout passes false for practice roles (403 otherwise)
  });
}

export function useAssignees() {
  return useQuery({
    queryKey: ['staff-tasks', 'assignees'],
    queryFn: async () =>
      (await api.get('/tasks/assignees')).data.data as { id: string; firstName: string; lastName: string; role: string }[],
    staleTime: 5 * 60_000,
  });
}

function useInvalidateTasks() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['staff-tasks'] });
}

export function useCreateStaffTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) =>
      (await api.post('/tasks', data)).data.data as StaffTask,
    onSuccess: invalidate,
  });
}

export function useClaimTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: async (taskId: string) => (await api.post(`/tasks/${taskId}/claim`)).data,
    onSettled: invalidate, // refetch even on 409 so the stolen task disappears
  });
}

export function useUpdateStaffTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: async ({ taskId, data }: { taskId: string; data: Record<string, unknown> }) =>
      (await api.patch(`/tasks/${taskId}`, data)).data.data as StaffTask,
    onSuccess: invalidate,
  });
}

export function useDeleteTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: async (taskId: string) => api.delete(`/tasks/${taskId}`),
    onSuccess: invalidate,
  });
}
