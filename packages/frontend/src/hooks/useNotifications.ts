import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

interface InAppNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  readAt?: string | null;
}

interface NotificationsResponse {
  success: boolean;
  data: {
    notifications: InAppNotification[];
    totalCount: number;
    unreadCount: number;
  };
}

interface UnreadCountResponse {
  success: boolean;
  data: {
    unreadCount: number;
  };
}

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const response = await api.get<UnreadCountResponse>('/notifications/unread-count');
      return response.data.data.unreadCount;
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useNotifications(options?: { unreadOnly?: boolean; limit?: number; offset?: number }) {
  const { unreadOnly = false, limit = 20, offset = 0 } = options || {};

  return useQuery({
    queryKey: ['notifications', 'list', { unreadOnly, limit, offset }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (unreadOnly) params.set('unreadOnly', 'true');
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      const response = await api.get<NotificationsResponse>(`/notifications?${params.toString()}`);
      return response.data.data;
    },
    // Poll alongside the unread-count badge so newly-created notifications
    // appear in the dropdown without requiring the user to navigate away
    // and back. Without this, the badge updates every 30s but the dropdown
    // body stays cached at its first-fetch state.
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationIds?: string[]) => {
      const response = await api.post('/notifications/mark-read', {
        notificationIds,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export type { InAppNotification };
