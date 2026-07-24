import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';

// ==========================================
// Types
// ==========================================

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  changes: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: string;
  user?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AuditLogFilters {
  page?: number;
  pageSize?: number;
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
}

// ==========================================
// Queries
// ==========================================

export function useAuditLogs(filters: AuditLogFilters) {
  return useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== '') params.set(key, String(value));
      }
      const qs = params.toString();
      const response = await api.get(`/audit${qs ? `?${qs}` : ''}`);
      return response.data.data as Paginated<AuditLogEntry>;
    },
    staleTime: 15 * 1000,
  });
}

export function useAuditStats() {
  return useQuery({
    queryKey: ['audit-stats'],
    queryFn: async () => {
      const response = await api.get('/audit/stats');
      return response.data.data as {
        byAction: Record<string, number>;
        byResource: Record<string, number>;
        last24Hours: number;
      };
    },
    staleTime: 60 * 1000,
  });
}
