import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

export interface RosterColumn {
  fieldKey: string;
  label: string;
}

export interface RosterTemplate {
  id: string;
  name: string;
  description?: string;
  columns: RosterColumn[];
  isShared: boolean;
  createdById: string;
}

export function useRosterPreview(columns: RosterColumn[], page: number) {
  return useQuery({
    queryKey: ['roster-preview', columns.map(c => c.fieldKey), page],
    queryFn: async () => {
      const { data } = await api.post('/roster/preview', {
        columns: columns.map(c => c.fieldKey),
        page,
      });
      return data.data as {
        headers: string[];
        rows: string[][];
        total: number;
        page: number;
        totalPages: number;
      };
    },
    enabled: columns.length > 0,
  });
}

export function useRosterTemplates() {
  return useQuery<RosterTemplate[]>({
    queryKey: ['roster-templates'],
    queryFn: async () => {
      const { data } = await api.get('/roster/templates');
      return data.data ?? [];
    },
  });
}

export function useCreateRosterTemplate() {
  return { mutateAsync: async (_data: any) => ({} as RosterTemplate), isPending: false };
}

export function useUpdateRosterTemplate() {
  return { mutateAsync: async (_data: any) => ({} as RosterTemplate), isPending: false };
}

export function useDeleteRosterTemplate() {
  return { mutateAsync: async (_id: string) => {}, isPending: false };
}

export async function exportRosterToExcel(columns: RosterColumn[], _filename: string) {
  const { data } = await api.post('/roster/export', {
    columns: columns.map(c => c.fieldKey),
  });

  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${_filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
