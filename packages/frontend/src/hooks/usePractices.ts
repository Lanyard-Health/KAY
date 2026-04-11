import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

// ==========================================
// Types
// ==========================================

export interface Practice {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  phone: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  targetPayerIds: string[];
  createdAt: string;
  updatedAt: string;
  enrollmentCount?: number;
  _count?: {
    users: number;
    providers: number;
    practiceLocations: number;
  };
}

export interface PracticeUserAssignment {
  id: string;
  userId: string;
  practiceId: string;
  role: 'SUPER_ADMIN' | 'PRACTICE_ADMIN' | 'PRACTICE_STAFF' | 'PROVIDER';
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
  };
}

// ==========================================
// Queries
// ==========================================

export function usePractices() {
  return useQuery({
    queryKey: ['practices'],
    queryFn: async () => {
      const response = await api.get('/practices');
      return response.data.data as Practice[];
    },
  });
}

export function usePractice(practiceId: string) {
  return useQuery({
    queryKey: ['practice', practiceId],
    queryFn: async () => {
      const response = await api.get(`/practices/${practiceId}`);
      return response.data.data as Practice;
    },
    enabled: !!practiceId,
  });
}

export function usePracticeUsers(practiceId: string) {
  return useQuery({
    queryKey: ['practice-users', practiceId],
    queryFn: async () => {
      const response = await api.get(`/practices/${practiceId}/users`);
      return response.data.data as PracticeUserAssignment[];
    },
    enabled: !!practiceId,
  });
}

export function usePracticeProviders(practiceId: string) {
  return useQuery({
    queryKey: ['practice-providers', practiceId],
    queryFn: async () => {
      const response = await api.get(`/providers?practiceId=${practiceId}&pageSize=100`);
      return response.data.data;
    },
    enabled: !!practiceId,
  });
}

export function useUnassignedProviders() {
  return useQuery({
    queryKey: ['providers', 'unassigned'],
    queryFn: async () => {
      const response = await api.get('/providers?practiceId=null&pageSize=100');
      return response.data.data;
    },
    staleTime: 30 * 1000,
  });
}

// ==========================================
// Mutations
// ==========================================

export function useCreatePractice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      phone?: string;
      email?: string;
      website?: string;
      notes?: string;
    }) => {
      const response = await api.post('/practices', data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practices'] });
    },
  });
}

export function useUpdatePractice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      practiceId,
      ...data
    }: {
      practiceId: string;
      name?: string;
      status?: 'ACTIVE' | 'INACTIVE';
      phone?: string;
      email?: string;
      website?: string;
      notes?: string;
    }) => {
      const response = await api.patch(`/practices/${practiceId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['practices'] });
      queryClient.invalidateQueries({ queryKey: ['practice', variables.practiceId] });
    },
  });
}

export function useAssignUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      practiceId,
      userId,
      role,
    }: {
      practiceId: string;
      userId: string;
      role: 'SUPER_ADMIN' | 'PRACTICE_ADMIN' | 'PRACTICE_STAFF' | 'PROVIDER';
    }) => {
      const response = await api.post(`/practices/${practiceId}/users`, { userId, role });
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['practice-users', variables.practiceId] });
      queryClient.invalidateQueries({ queryKey: ['practices'] });
    },
  });
}

export function useRemoveUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      practiceId,
      userId,
    }: {
      practiceId: string;
      userId: string;
    }) => {
      await api.delete(`/practices/${practiceId}/users/${userId}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['practice-users', variables.practiceId] });
      queryClient.invalidateQueries({ queryKey: ['practices'] });
    },
  });
}

export function useAssignProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      providerId,
      practiceId,
    }: {
      providerId: string;
      practiceId: string;
    }) => {
      const response = await api.put(`/providers/${providerId}`, { practiceId });
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['provider'] });
      queryClient.invalidateQueries({ queryKey: ['practice-providers', variables.practiceId] });
      queryClient.invalidateQueries({ queryKey: ['practices'] });
    },
  });
}

export function useUnassignProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: {
      providerId: string;
      practiceId: string;
    }) => {
      const response = await api.put(`/providers/${variables.providerId}`, { practiceId: null });
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['provider'] });
      queryClient.invalidateQueries({ queryKey: ['practice-providers', variables.practiceId] });
      queryClient.invalidateQueries({ queryKey: ['practices'] });
    },
  });
}
