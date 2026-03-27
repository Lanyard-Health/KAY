import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

// ==========================================
// Types
// ==========================================

export interface PayerContact {
  id: string;
  payerTrackId: string;
  contactType: string;
  phone?: string | null;
  email?: string | null;
  fax?: string | null;
  portalUrl?: string | null;
  hours?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface PayerTimeline {
  id: string;
  payerTrackId: string;
  processType: string;
  minDays?: number | null;
  maxDays?: number | null;
  stateOverrides?: Record<string, unknown> | null;
  notes?: string | null;
  createdAt: string;
}

export interface PayerStateRule {
  id: string;
  payerTrackId: string;
  state: string;
  ruleType: string;
  description: string;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  createdAt: string;
}

export interface PayerForm {
  id: string;
  payerTrackId: string;
  formName: string;
  format: string;
  url?: string | null;
  destination?: string | null;
  isRequired: boolean;
  notes?: string | null;
  createdAt: string;
}

export interface PayerRequirement {
  id: string;
  payerTrackId: string;
  name: string;
  overrideType: string;
  rule: string;
  appliesTo?: string | null;
  isBlocking: boolean;
  source?: string | null;
  createdAt: string;
}

export interface PayerTrack {
  id: string;
  payerName: string;
  parentOrg?: string | null;
  payerType: string;
  stateRegion: string;
  track: string;
  submissionMethod: string;
  enrollmentLink?: string | null;
  portalUrl?: string | null;
  productLines: string[];
  notes?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  contacts?: PayerContact[];
  timelines?: PayerTimeline[];
  stateRules?: PayerStateRule[];
  forms?: PayerForm[];
  requirements?: PayerRequirement[];
  _count?: {
    contacts: number;
    timelines: number;
    stateRules: number;
    forms: number;
    requirements: number;
  };
}

export interface RequirementUniversal {
  id: string;
  name: string;
  description: string;
  appliesTo: string;
  isBlocking: boolean;
  standardMinimum?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface KnowledgeBaseGap {
  payerTrackId: string;
  payerName: string;
  track: string;
  stateRegion: string;
  field: string;
  table: string;
  recordId?: string | null;
}

export interface FilterOptions {
  payerTypes: string[];
  stateRegions: string[];
}

export interface PayerTrackFilters {
  payerType?: string;
  stateRegion?: string;
  track?: string;
  search?: string;
  isActive?: boolean;
}

// ==========================================
// Queries
// ==========================================

export function usePayerTracks(filters?: PayerTrackFilters) {
  return useQuery({
    queryKey: ['payerTracks', filters],
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
      const response = await api.get(`/knowledge-base/payer-tracks${query ? `?${query}` : ''}`);
      return response.data.data as PayerTrack[];
    },
  });
}

export function usePayerTrack(id?: string) {
  return useQuery({
    queryKey: ['payerTrack', id],
    queryFn: async () => {
      const response = await api.get(`/knowledge-base/payer-tracks/${id}`);
      return response.data.data as PayerTrack;
    },
    enabled: !!id,
  });
}

export function useKnowledgeBaseGaps() {
  return useQuery({
    queryKey: ['knowledgeBaseGaps'],
    queryFn: async () => {
      const response = await api.get('/knowledge-base/gaps');
      return response.data.data as { data: KnowledgeBaseGap[]; meta: { totalGaps: number } };
    },
  });
}

export function useFilterOptions() {
  return useQuery({
    queryKey: ['knowledgeBaseFilterOptions'],
    queryFn: async () => {
      const response = await api.get('/knowledge-base/filter-options');
      return response.data.data as FilterOptions;
    },
  });
}

export function useRequirementsUniversal() {
  return useQuery({
    queryKey: ['requirementsUniversal'],
    queryFn: async () => {
      const response = await api.get('/knowledge-base/requirements-universal');
      return response.data.data as RequirementUniversal[];
    },
  });
}

// ==========================================
// Child Mutation Helper
// ==========================================

function useChildMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payerTrack'] });
      queryClient.invalidateQueries({ queryKey: ['knowledgeBaseGaps'] });
    },
  });
}

// ==========================================
// Payer Track Mutations
// ==========================================

export function useCreatePayerTrack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<PayerTrack, 'id' | 'createdAt' | 'updatedAt' | 'contacts' | 'timelines' | 'stateRules' | 'forms' | 'requirements' | '_count'>) => {
      const response = await api.post('/knowledge-base/payer-tracks', data);
      return response.data.data as PayerTrack;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payerTracks'] });
    },
  });
}

export function useUpdatePayerTrack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<Omit<PayerTrack, 'id' | 'createdAt' | 'updatedAt' | 'contacts' | 'timelines' | 'stateRules' | 'forms' | 'requirements' | '_count'>>) => {
      const response = await api.patch(`/knowledge-base/payer-tracks/${id}`, data);
      return response.data.data as PayerTrack;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['payerTracks'] });
      queryClient.invalidateQueries({ queryKey: ['payerTrack', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['knowledgeBaseGaps'] });
    },
  });
}

export function useDeletePayerTrack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/knowledge-base/payer-tracks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payerTracks'] });
      queryClient.invalidateQueries({ queryKey: ['knowledgeBaseGaps'] });
    },
  });
}

// ==========================================
// Contact Mutations
// ==========================================

export function useCreateContact() {
  return useChildMutation(async ({ trackId, ...data }: { trackId: string } & Omit<PayerContact, 'id' | 'payerTrackId' | 'createdAt'>) => {
    const response = await api.post(`/knowledge-base/payer-tracks/${trackId}/contacts`, data);
    return response.data.data as PayerContact;
  });
}

export function useUpdateContact() {
  return useChildMutation(async ({ id, ...data }: { id: string } & Partial<Omit<PayerContact, 'id' | 'payerTrackId' | 'createdAt'>>) => {
    const response = await api.patch(`/knowledge-base/contacts/${id}`, data);
    return response.data.data as PayerContact;
  });
}

export function useDeleteContact() {
  return useChildMutation(async (id: string) => {
    await api.delete(`/knowledge-base/contacts/${id}`);
  });
}

// ==========================================
// Timeline Mutations
// ==========================================

export function useCreateTimeline() {
  return useChildMutation(async ({ trackId, ...data }: { trackId: string } & Omit<PayerTimeline, 'id' | 'payerTrackId' | 'createdAt'>) => {
    const response = await api.post(`/knowledge-base/payer-tracks/${trackId}/timelines`, data);
    return response.data.data as PayerTimeline;
  });
}

export function useUpdateTimeline() {
  return useChildMutation(async ({ id, ...data }: { id: string } & Partial<Omit<PayerTimeline, 'id' | 'payerTrackId' | 'createdAt'>>) => {
    const response = await api.patch(`/knowledge-base/timelines/${id}`, data);
    return response.data.data as PayerTimeline;
  });
}

export function useDeleteTimeline() {
  return useChildMutation(async (id: string) => {
    await api.delete(`/knowledge-base/timelines/${id}`);
  });
}

// ==========================================
// State Rule Mutations
// ==========================================

export function useCreateStateRule() {
  return useChildMutation(async ({ trackId, ...data }: { trackId: string } & Omit<PayerStateRule, 'id' | 'payerTrackId' | 'createdAt'>) => {
    const response = await api.post(`/knowledge-base/payer-tracks/${trackId}/state-rules`, data);
    return response.data.data as PayerStateRule;
  });
}

export function useUpdateStateRule() {
  return useChildMutation(async ({ id, ...data }: { id: string } & Partial<Omit<PayerStateRule, 'id' | 'payerTrackId' | 'createdAt'>>) => {
    const response = await api.patch(`/knowledge-base/state-rules/${id}`, data);
    return response.data.data as PayerStateRule;
  });
}

export function useDeleteStateRule() {
  return useChildMutation(async (id: string) => {
    await api.delete(`/knowledge-base/state-rules/${id}`);
  });
}

// ==========================================
// Form Mutations
// ==========================================

export function useCreateForm() {
  return useChildMutation(async ({ trackId, ...data }: { trackId: string } & Omit<PayerForm, 'id' | 'payerTrackId' | 'createdAt'>) => {
    const response = await api.post(`/knowledge-base/payer-tracks/${trackId}/forms`, data);
    return response.data.data as PayerForm;
  });
}

export function useUpdateForm() {
  return useChildMutation(async ({ id, ...data }: { id: string } & Partial<Omit<PayerForm, 'id' | 'payerTrackId' | 'createdAt'>>) => {
    const response = await api.patch(`/knowledge-base/forms/${id}`, data);
    return response.data.data as PayerForm;
  });
}

export function useDeleteForm() {
  return useChildMutation(async (id: string) => {
    await api.delete(`/knowledge-base/forms/${id}`);
  });
}

// ==========================================
// Requirement Mutations
// ==========================================

export function useCreateRequirement() {
  return useChildMutation(async ({ trackId, ...data }: { trackId: string } & Omit<PayerRequirement, 'id' | 'payerTrackId' | 'createdAt'>) => {
    const response = await api.post(`/knowledge-base/payer-tracks/${trackId}/requirements`, data);
    return response.data.data as PayerRequirement;
  });
}

export function useUpdateRequirement() {
  return useChildMutation(async ({ id, ...data }: { id: string } & Partial<Omit<PayerRequirement, 'id' | 'payerTrackId' | 'createdAt'>>) => {
    const response = await api.patch(`/knowledge-base/requirements/${id}`, data);
    return response.data.data as PayerRequirement;
  });
}

export function useDeleteRequirement() {
  return useChildMutation(async (id: string) => {
    await api.delete(`/knowledge-base/requirements/${id}`);
  });
}

// ==========================================
// Universal Requirement Mutations
// ==========================================

export function useCreateRequirementUniversal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<RequirementUniversal, 'id' | 'createdAt'>) => {
      const response = await api.post('/knowledge-base/requirements-universal', data);
      return response.data.data as RequirementUniversal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requirementsUniversal'] });
      queryClient.invalidateQueries({ queryKey: ['knowledgeBaseGaps'] });
    },
  });
}

export function useUpdateRequirementUniversal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<Omit<RequirementUniversal, 'id' | 'createdAt'>>) => {
      const response = await api.patch(`/knowledge-base/requirements-universal/${id}`, data);
      return response.data.data as RequirementUniversal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requirementsUniversal'] });
      queryClient.invalidateQueries({ queryKey: ['knowledgeBaseGaps'] });
    },
  });
}

export function useDeleteRequirementUniversal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/knowledge-base/requirements-universal/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requirementsUniversal'] });
      queryClient.invalidateQueries({ queryKey: ['knowledgeBaseGaps'] });
    },
  });
}
