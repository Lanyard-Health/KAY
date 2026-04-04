import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import { useAuthStore } from '../stores/auth.store';

// ===========================
// Types
// ===========================

export interface PracticeProfile {
  id: string;
  name: string;
  status: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PracticeUser {
  id: string;
  userId: string;
  practiceId: string;
  role: string;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
    lastLoginAt: string | null;
  };
}

export interface NotificationPreferences {
  enrollmentStatusChanges: boolean;
  credentialExpirations: boolean;
  followUpReminders: boolean;
  denialAlerts: boolean;
  weeklySummary: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enrollmentStatusChanges: true,
  credentialExpirations: true,
  followUpReminders: true,
  denialAlerts: true,
  weeklySummary: false,
};

// ===========================
// Practice hooks
// ===========================

export function useCurrentPractice() {
  const user = useAuthStore((s) => s.user);
  const practiceId = user?.practices?.[0]?.practiceId;

  return useQuery({
    queryKey: ['practice', practiceId],
    queryFn: async () => {
      const response = await api.get(`/practices/${practiceId}`);
      return response.data.data as PracticeProfile;
    },
    enabled: !!practiceId,
  });
}

export function useUpdateCurrentPractice() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const practiceId = user?.practices?.[0]?.practiceId;

  return useMutation({
    mutationFn: async (data: Partial<PracticeProfile>) => {
      if (!practiceId) throw new Error('No practice found');
      const response = await api.patch(`/practices/${practiceId}`, data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice', practiceId] });
      queryClient.invalidateQueries({ queryKey: ['practices'] });
      toast.success('Practice profile updated');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || error.message || 'Failed to update practice';
      toast.error(message);
    },
  });
}

// ===========================
// User management hooks
// ===========================

export function useCurrentPracticeUsers() {
  const user = useAuthStore((s) => s.user);
  const practiceId = user?.practices?.[0]?.practiceId;

  return useQuery({
    queryKey: ['practice-users', practiceId],
    queryFn: async () => {
      const response = await api.get(`/practices/${practiceId}/users`);
      return response.data.data as PracticeUser[];
    },
    enabled: !!practiceId,
  });
}

export function useInviteUser() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const practiceId = user?.practices?.[0]?.practiceId;

  return useMutation({
    mutationFn: async (data: {
      firstName: string;
      lastName: string;
      email: string;
      role: string;
    }) => {
      const response = await api.post('/users', data);
      // If practice context, assign to practice
      if (practiceId) {
        await api.post(`/practices/${practiceId}/users`, {
          userId: response.data.data.id,
          role: 'PRACTICE_STAFF',
        });
      }
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice-users'] });
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
      toast.success('User invited successfully');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || error.message || 'Failed to invite user';
      toast.error(message);
    },
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const response = await api.put(`/users/${userId}`, { role });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice-users'] });
      queryClient.invalidateQueries({ queryKey: ['users-list'] });
      toast.success('User role updated');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || error.message || 'Failed to update role';
      toast.error(message);
    },
  });
}

// ===========================
// Notification preferences
// ===========================

const PREFS_STORAGE_KEY = 'notification_preferences';

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async (): Promise<NotificationPreferences> => {
      // Use localStorage as placeholder until backend endpoint exists
      const stored = localStorage.getItem(PREFS_STORAGE_KEY);
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch {
          return DEFAULT_PREFERENCES;
        }
      }
      return DEFAULT_PREFERENCES;
    },
    staleTime: Infinity,
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (prefs: NotificationPreferences) => {
      // Use localStorage as placeholder until backend endpoint exists
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
      return prefs;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      toast.success('Notification preferences saved');
    },
  });
}
