import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

// ==========================================
// Types
// ==========================================

export interface UserPracticeAssignment {
  id: string;
  practiceId: string;
  role: string;
  practice: {
    id: string;
    name: string;
    status: string;
  };
}

export interface UserDetail {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: 'admin' | 'lanyard_staff' | 'credentialing_staff' | 'provider';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  providerId: string | null;
  practices: UserPracticeAssignment[];
}

export interface UserFilters {
  search?: string;
  role?: string;
  status?: string;
}

// ==========================================
// Queries
// ==========================================

export function useUsersList(filters?: UserFilters) {
  return useQuery({
    queryKey: ['users-list', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.search) params.set('search', filters.search);
      if (filters?.role) params.set('role', filters.role);
      if (filters?.status) params.set('status', filters.status);
      const qs = params.toString();
      const response = await api.get(`/users${qs ? `?${qs}` : ''}`);
      return response.data.data as UserDetail[];
    },
    staleTime: 30 * 1000,
  });
}

export function useUserDetail(userId: string) {
  return useQuery({
    queryKey: ['user-detail', userId],
    queryFn: async () => {
      const response = await api.get(`/users/${userId}`);
      return response.data.data as UserDetail;
    },
    enabled: !!userId,
  });
}

// ==========================================
// Mutations
// ==========================================

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      role?: string;
    }) => {
      const response = await api.post('/users', data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['practice-users'] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      ...data
    }: {
      userId: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string | null;
      role?: string;
    }) => {
      const response = await api.put(`/users/${userId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user-detail', variables.userId] });
    },
  });
}

export function useDeactivateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await api.put(`/users/${userId}/deactivate`);
      return response.data.data;
    },
    onSuccess: (_data, userId) => {
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user-detail', userId] });
    },
  });
}

export function useActivateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await api.put(`/users/${userId}/activate`);
      return response.data.data;
    },
    onSuccess: (_data, userId) => {
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user-detail', userId] });
    },
  });
}
