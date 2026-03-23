import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import type { PayerTrack } from './useKnowledgeBase';

// ==========================================
// Types
// ==========================================

export interface WorkflowTemplateStep {
  id: string;
  templateId: string;
  stepOrder: number;
  name: string;
  description?: string | null;
  stepType: string;
  owner: string;
  requiredDocuments: string[];
  triggerDaysAfterPrev?: number | null;
  isBlocking: boolean;
  reviewerInstructions?: string | null;
  createdAt: string;
}

export interface WorkflowTemplateCondition {
  id: string;
  templateId: string;
  conditionType: string;
  conditionValue: string;
  action: string;
  targetStepOrder?: number | null;
  stepDefinition?: Record<string, unknown> | null;
  createdAt: string;
}

export interface WorkflowTemplate {
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
  steps?: WorkflowTemplateStep[];
  conditions?: WorkflowTemplateCondition[];
  _count?: {
    steps: number;
    conditions: number;
    enrollments: number;
  };
}

export interface WorkflowTemplateFilters {
  status?: string;
  payerTrackId?: string;
}

// ==========================================
// Queries
// ==========================================

export function useWorkflowTemplates(filters?: WorkflowTemplateFilters) {
  return useQuery({
    queryKey: ['workflowTemplates', filters],
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
      const response = await api.get(`/knowledge-base/workflow-templates${query ? `?${query}` : ''}`);
      return response.data.data as WorkflowTemplate[];
    },
  });
}

export function useWorkflowTemplate(id?: string) {
  return useQuery({
    queryKey: ['workflowTemplate', id],
    queryFn: async () => {
      const response = await api.get(`/knowledge-base/workflow-templates/${id}`);
      return response.data.data as WorkflowTemplate;
    },
    enabled: !!id,
  });
}

// ==========================================
// Template Mutations
// ==========================================

export function useCreateWorkflowTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<WorkflowTemplate, 'id' | 'version' | 'publishedAt' | 'createdAt' | 'updatedAt' | 'payerTrack' | 'steps' | 'conditions' | '_count'>) => {
      const response = await api.post('/knowledge-base/workflow-templates', data);
      return response.data.data as WorkflowTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflowTemplates'] });
    },
  });
}

export function useUpdateWorkflowTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<Omit<WorkflowTemplate, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'payerTrack' | 'steps' | 'conditions' | '_count'>>) => {
      const response = await api.patch(`/knowledge-base/workflow-templates/${id}`, data);
      return response.data.data as WorkflowTemplate;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workflowTemplates'] });
      queryClient.invalidateQueries({ queryKey: ['workflowTemplate', variables.id] });
    },
  });
}

export function useDeleteWorkflowTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/knowledge-base/workflow-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflowTemplates'] });
    },
  });
}

// ==========================================
// Step Mutations
// ==========================================

export function useCreateWorkflowStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, ...data }: { templateId: string } & Omit<WorkflowTemplateStep, 'id' | 'templateId' | 'createdAt'>) => {
      const response = await api.post(`/knowledge-base/workflow-templates/${templateId}/steps`, data);
      return response.data.data as WorkflowTemplateStep;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflowTemplate'] });
    },
  });
}

export function useUpdateWorkflowStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<Omit<WorkflowTemplateStep, 'id' | 'templateId' | 'createdAt'>>) => {
      const response = await api.patch(`/knowledge-base/workflow-template-steps/${id}`, data);
      return response.data.data as WorkflowTemplateStep;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflowTemplate'] });
    },
  });
}

export function useDeleteWorkflowStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/knowledge-base/workflow-template-steps/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflowTemplate'] });
    },
  });
}

export function useReorderWorkflowSteps() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, order }: { templateId: string; order: { id: string; stepOrder: number }[] }) => {
      const response = await api.put(`/knowledge-base/workflow-templates/${templateId}/steps/reorder`, { order });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflowTemplate'] });
    },
  });
}

// ==========================================
// Condition Mutations
// ==========================================

export function useCreateWorkflowCondition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, ...data }: { templateId: string } & Omit<WorkflowTemplateCondition, 'id' | 'templateId' | 'createdAt'>) => {
      const response = await api.post(`/knowledge-base/workflow-templates/${templateId}/conditions`, data);
      return response.data.data as WorkflowTemplateCondition;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflowTemplate'] });
    },
  });
}

export function useDeleteWorkflowCondition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/knowledge-base/workflow-template-conditions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflowTemplate'] });
    },
  });
}
