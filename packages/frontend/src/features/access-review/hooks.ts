import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';

// ==========================================
// Types
// ==========================================

export interface EntitlementPractice {
  practiceId: string;
  role: string;
  practice: { id: string; name: string; status: string };
}

export interface EntitlementRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  practices: EntitlementPractice[];
  effectivePermissions: string[];
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface EntitlementFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: string;
  status?: string;
  permission?: string;
}

export interface PermissionCatalogEntry {
  permission: string;
  roles: string[];
}

// ==========================================
// Queries
// ==========================================

function toQueryString(filters: EntitlementFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.search) params.set('search', filters.search);
  if (filters.role) params.set('role', filters.role);
  if (filters.status) params.set('status', filters.status);
  if (filters.permission) params.set('permission', filters.permission);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useEntitlements(filters: EntitlementFilters) {
  return useQuery({
    queryKey: ['access-review-entitlements', filters],
    queryFn: async () => {
      const response = await api.get(`/access-review/entitlements${toQueryString(filters)}`);
      return response.data.data as Paginated<EntitlementRow>;
    },
    staleTime: 30 * 1000,
  });
}

export function usePermissionCatalog() {
  return useQuery({
    queryKey: ['access-review-permission-catalog'],
    queryFn: async () => {
      const response = await api.get('/access-review/permissions');
      return response.data.data as PermissionCatalogEntry[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function usePermissionUsers(permission: string, page: number) {
  return useQuery({
    queryKey: ['access-review-permission-users', permission, page],
    queryFn: async () => {
      const response = await api.get(
        `/access-review/permissions/${encodeURIComponent(permission)}/users?page=${page}&pageSize=25`
      );
      return response.data.data as Paginated<EntitlementRow> & {
        permission: string;
        grantedByRoles: string[];
      };
    },
    enabled: !!permission,
    staleTime: 30 * 1000,
  });
}

// ==========================================
// CSV export
// ==========================================

export async function downloadEntitlementsCsv(filters: EntitlementFilters): Promise<void> {
  const { page: _p, pageSize: _ps, ...rest } = filters;
  const { text, headers } = await api.download(
    `/access-review/entitlements/export.csv${toQueryString(rest)}`
  );
  const disposition = headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] || 'access-review.csv';
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
