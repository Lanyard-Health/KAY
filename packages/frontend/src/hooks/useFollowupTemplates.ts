import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import type { PayerTrack } from './useKnowledgeBase';

// ==========================================
// Types
// ==========================================

export interface FollowUpTemplateStep {
  id: string;
  templateId: string;
  stepOrder: number;
  name: string;
  channel: string;
  triggerDaysAfterPrev: number;
  escalationLevel: number;
  emailSubject?: string | null;
  emailBodyTemplate?: string | null;
  emailTone?: string | null;
  retellScriptTemplate?: string | null;
  retellAgentId?: string | null;
  requiresApproval: boolean;
  createdAt: string;
}

export interface FollowUpTemplate {
  id: string;
  payerTrackId: string;
  name: string;
  version: number;
  status: string;
  description?: string | null;
  createdBy: string;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  payerTrack?: PayerTrack;
  steps?: FollowUpTemplateStep[];
  _count?: {
    steps: number;
  };
}

export interface FollowUpTemplateFilters {
  status?: string;
  payerTrackId?: string;
}

// ==========================================
// Queries
// ==========================================

export function useFollowUpTemplates(filters?: FollowUpTemplateFilters) {
  return useQuery({
    queryKey: ['followUpTemplates', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== '') {
            params.append(key, String(value));
          }
        });
      }
      const query = params.toString();
      const response = await api.get(`/followup-templates${query ? `?${query}` : ''}`);
      return response.data.data as FollowUpTemplate[];
    },
  });
}

export function useFollowUpTemplate(id?: string) {
  return useQuery({
    queryKey: ['followUpTemplate', id],
    queryFn: async () => {
      const response = await api.get(`/followup-templates/${id}`);
      return response.data.data as FollowUpTemplate;
    },
    enabled: !!id,
  });
}

// ==========================================
// Template Mutations
// ==========================================

export function useCreateFollowUpTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<FollowUpTemplate, 'id' | 'version' | 'publishedAt' | 'createdAt' | 'updatedAt' | 'payerTrack' | 'steps' | '_count'>) => {
      const response = await api.post('/followup-templates', data);
      return response.data.data as FollowUpTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['followUpTemplates'] });
    },
  });
}

export function useUpdateFollowUpTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<Omit<FollowUpTemplate, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'payerTrack' | 'steps' | '_count'>>) => {
      const response = await api.patch(`/followup-templates/${id}`, data);
      return response.data.data as FollowUpTemplate;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['followUpTemplates'] });
      queryClient.invalidateQueries({ queryKey: ['followUpTemplate', variables.id] });
    },
  });
}

export function useDeleteFollowUpTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/followup-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['followUpTemplates'] });
    },
  });
}

// ==========================================
// Step Mutations
// ==========================================

export function useCreateFollowUpStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, ...data }: { templateId: string } & Omit<FollowUpTemplateStep, 'id' | 'templateId' | 'createdAt'>) => {
      const response = await api.post(`/followup-templates/${templateId}/steps`, data);
      return response.data.data as FollowUpTemplateStep;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['followUpTemplate'] });
    },
  });
}

export function useUpdateFollowUpStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<Omit<FollowUpTemplateStep, 'id' | 'templateId' | 'createdAt'>>) => {
      const response = await api.patch(`/knowledge-base/followup-templates/steps/${id}`, data);
      return response.data.data as FollowUpTemplateStep;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['followUpTemplate'] });
    },
  });
}

export function useDeleteFollowUpStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/knowledge-base/followup-templates/steps/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['followUpTemplate'] });
    },
  });
}

export function useReorderFollowUpSteps() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, order }: { templateId: string; order: { id: string; stepOrder: number }[] }) => {
      await api.put(`/followup-templates/${templateId}/steps/reorder`, { order });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['followUpTemplate'] });
    },
  });
}
