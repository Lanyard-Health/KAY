import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

export interface RosterColumn {
  fieldKey: string;
  label: string;
  width?: number;
}

export interface RosterTemplate {
  id: string;
  name: string;
  description: string | null;
  columns: RosterColumn[];
  filters: any;
  sortConfig: any;
  isShared: boolean;
  createdById: string;
  createdBy?: { firstName: string; lastName: string };
  createdAt: string;
  updatedAt: string;
}

interface PreviewResponse {
  success: boolean;
  data: {
    headers: string[];
    rows: string[][];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

interface TemplateListResponse {
  success: boolean;
  data: RosterTemplate[];
}

interface TemplateResponse {
  success: boolean;
  data: RosterTemplate;
}

/**
 * List saved roster templates (own + shared)
 */
export function useRosterTemplates() {
  return useQuery({
    queryKey: ['roster-templates'],
    queryFn: async () => {
      const response = await api.get<TemplateListResponse>('/roster');
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Preview data with selected columns
 */
export function useRosterPreview(
  columns: RosterColumn[],
  page: number = 1,
  pageSize: number = 25
) {
  return useQuery({
    queryKey: ['roster-preview', columns, page, pageSize],
    queryFn: async () => {
      const response = await api.post<PreviewResponse>('/roster/preview', {
        columns,
        page,
        pageSize,
      });
      return response.data.data;
    },
    enabled: columns.length > 0,
    staleTime: 30 * 1000,
  });
}

/**
 * Create a new roster template
 */
export function useCreateRosterTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      columns: RosterColumn[];
      isShared?: boolean;
    }) => {
      const response = await api.post<TemplateResponse>('/roster', data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roster-templates'] });
    },
  });
}

/**
 * Update an existing roster template
 */
export function useUpdateRosterTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      description?: string;
      columns?: RosterColumn[];
      isShared?: boolean;
    }) => {
      const response = await api.put<TemplateResponse>(`/roster/${id}`, data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roster-templates'] });
    },
  });
}

/**
 * Delete a roster template
 */
export function useDeleteRosterTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/roster/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roster-templates'] });
    },
  });
}

/**
 * Export roster to Excel (returns blob download)
 */
export async function exportRosterToExcel(
  columns: RosterColumn[],
  reportName: string
) {
  const API_BASE_URL = '/api/v1';

  // We need to use native fetch for binary response
  const isDev = import.meta.env.DEV;
  const devBypass = import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';

  let token: string | null = null;
  if (isDev && devBypass) {
    const devSession = localStorage.getItem('dev_session');
    token = devSession ? 'dev-token' : null;
  } else {
    try {
      const { fetchAuthSession } = await import('aws-amplify/auth');
      const session = await fetchAuthSession();
      token = session.tokens?.accessToken?.toString() || null;
    } catch {
      token = null;
    }
  }

  const response = await fetch(`${API_BASE_URL}/roster/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ columns, reportName }),
  });

  if (!response.ok) {
    throw new Error('Export failed');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${reportName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
