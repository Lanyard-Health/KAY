import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../services/api';

// ===========================
// Types
// ===========================

export interface FollowUpSettings {
  id: string;
  followUpEnabled: boolean;
  followUpEmail: string | null;
  followUpFrequencyDays: number;
  lastFollowUpSentAt: string | null;
  nextFollowUpDate: string | null;
  lastFollowUpDate: string | null;
}

export interface FollowUpNotification {
  id: string;
  type: string;
  recipientEmail: string;
  subject: string;
  status: string;
  error: string | null;
  createdAt: string;
}

export interface SendFollowUpParams {
  enrollmentId: string;
  email: string;
  customMessage?: string;
  attachment?: File;
}

// ===========================
// Hooks
// ===========================

export function useFollowUpSettings(enrollmentId: string | null) {
  return useQuery({
    queryKey: ['follow-up-settings', enrollmentId],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: FollowUpSettings }>(
        `/follow-up/enrollment/${enrollmentId}/settings`
      );
      return data;
    },
    enabled: !!enrollmentId,
    staleTime: 30 * 1000,
  });
}

export function useUpdateFollowUpSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ enrollmentId, enabled, email, frequencyDays }: {
      enrollmentId: string;
      enabled: boolean;
      email?: string;
      frequencyDays?: number;
    }) => {
      const { data } = await api.put<{ success: boolean; data: unknown }>(
        `/follow-up/enrollment/${enrollmentId}/settings`,
        { enabled, email, frequencyDays }
      );
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['follow-up-settings', variables.enrollmentId] });
      queryClient.invalidateQueries({ queryKey: ['enrollments'] });
      toast.success('Follow-up settings saved');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || error.message || 'Failed to update settings';
      toast.error(message);
    },
  });
}

export function useSendFollowUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ enrollmentId, email, customMessage, attachment }: SendFollowUpParams) => {
      const formData = new FormData();
      formData.append('email', email);
      if (customMessage) formData.append('customMessage', customMessage);
      if (attachment) formData.append('attachment', attachment);

      // Use raw fetch for FormData — api.post JSON-stringifies the body
      const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';
      const response = await fetch(`${API_BASE}/follow-up/enrollment/${enrollmentId}/send`, {
        method: 'POST',
        body: formData,
        // Let browser set Content-Type with multipart boundary
      });

      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.error || 'Failed to send email') as Error & {
          response?: { data: any; status: number };
        };
        error.response = { data, status: response.status };
        throw error;
      }
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['follow-up-settings', variables.enrollmentId] });
      queryClient.invalidateQueries({ queryKey: ['follow-up-history', variables.enrollmentId] });
      queryClient.invalidateQueries({ queryKey: ['enrollments'] });
      toast.success('Follow-up email sent');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || error.message || 'Failed to send email';
      toast.error(message);
    },
  });
}

export function useFollowUpHistory(enrollmentId: string | null) {
  return useQuery({
    queryKey: ['follow-up-history', enrollmentId],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: FollowUpNotification[] }>(
        `/follow-up/enrollment/${enrollmentId}/history`
      );
      return data;
    },
    enabled: !!enrollmentId,
    staleTime: 30 * 1000,
  });
}
