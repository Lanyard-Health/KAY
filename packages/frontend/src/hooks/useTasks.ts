import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

// ==========================================
// TASK HOOKS
// ==========================================

export function useTasks(providerId: string, filters?: { status?: string; type?: string }) {
  return useQuery({
    queryKey: ['tasks', providerId, filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.type) params.set('type', filters.type);
      const qs = params.toString();
      const response = await api.get(`/providers/${providerId}/tasks${qs ? `?${qs}` : ''}`);
      return response.data;
    },
    enabled: !!providerId,
  });
}

export function useTask(taskId: string) {
  return useQuery({
    queryKey: ['task', taskId],
    queryFn: async () => {
      const response = await api.get(`/tasks/${taskId}`);
      return response.data;
    },
    enabled: !!taskId,
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, data }: { taskId: string; data: Record<string, unknown> }) => {
      const response = await api.patch(`/tasks/${taskId}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task'] });
    },
  });
}

// ==========================================
// USER HOOKS (for task assignment)
// ==========================================

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await api.get('/users');
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // cache for 5 minutes
  });
}

// ==========================================
// TERMINATION LETTER HOOKS
// ==========================================

export function useTerminationLetters(providerId: string) {
  return useQuery({
    queryKey: ['termination-letters', providerId],
    queryFn: async () => {
      const response = await api.get(`/providers/${providerId}/termination-letters`);
      return response.data;
    },
    enabled: !!providerId,
  });
}

export function useTerminationLetter(letterId: string) {
  return useQuery({
    queryKey: ['termination-letter', letterId],
    queryFn: async () => {
      const response = await api.get(`/termination-letters/${letterId}`);
      return response.data;
    },
    enabled: !!letterId,
  });
}

export function useGenerateLetter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ providerId, enrollmentId }: { providerId: string; enrollmentId: string }) => {
      const response = await api.post(`/providers/${providerId}/termination-letters/generate`, { enrollmentId });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['termination-letters'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useUpdateLetter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ letterId, data }: { letterId: string; data: Record<string, unknown> }) => {
      const response = await api.patch(`/termination-letters/${letterId}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['termination-letters'] });
      queryClient.invalidateQueries({ queryKey: ['termination-letter'] });
    },
  });
}

export function useSendLetter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (letterId: string) => {
      const response = await api.post(`/termination-letters/${letterId}/send`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['termination-letters'] });
      queryClient.invalidateQueries({ queryKey: ['termination-letter'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
