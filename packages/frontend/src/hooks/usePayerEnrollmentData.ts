import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

// ==========================================
// Education
// ==========================================

export function useListEducation(providerId: string) {
  return useQuery({
    queryKey: ['education', providerId],
    queryFn: async () => {
      const response = await api.get(`/credentials/education/${providerId}`);
      return response.data.data;
    },
    enabled: !!providerId,
  });
}

export function useCreateEducation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      providerId,
      ...data
    }: {
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.post(`/credentials/education/${providerId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['education', variables.providerId] });
    },
  });
}

export function useUpdateEducation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
      ...data
    }: {
      id: string;
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.put(`/credentials/education/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['education', variables.providerId] });
    },
  });
}

export function useDeleteEducation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
    }: {
      id: string;
      providerId: string;
    }) => {
      await api.delete(`/credentials/education/${id}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['education', variables.providerId] });
    },
  });
}

// ==========================================
// Work History
// ==========================================

export function useListWorkHistory(providerId: string) {
  return useQuery({
    queryKey: ['work-history', providerId],
    queryFn: async () => {
      const response = await api.get(`/credentials/work-history/${providerId}`);
      return response.data.data;
    },
    enabled: !!providerId,
  });
}

export function useCreateWorkHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      providerId,
      ...data
    }: {
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.post(`/credentials/work-history/${providerId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['work-history', variables.providerId] });
    },
  });
}

export function useUpdateWorkHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
      ...data
    }: {
      id: string;
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.put(`/credentials/work-history/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['work-history', variables.providerId] });
    },
  });
}

export function useDeleteWorkHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
    }: {
      id: string;
      providerId: string;
    }) => {
      await api.delete(`/credentials/work-history/${id}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['work-history', variables.providerId] });
    },
  });
}

// ==========================================
// Malpractice Insurance
// ==========================================

export function useListMalpracticeInsurance(providerId: string) {
  return useQuery({
    queryKey: ['malpractice', providerId],
    queryFn: async () => {
      const response = await api.get(`/credentials/malpractice/${providerId}`);
      return response.data.data;
    },
    enabled: !!providerId,
  });
}

export function useCreateMalpracticeInsurance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      providerId,
      ...data
    }: {
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.post(`/credentials/malpractice/${providerId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['malpractice', variables.providerId] });
    },
  });
}

export function useUpdateMalpracticeInsurance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
      ...data
    }: {
      id: string;
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.put(`/credentials/malpractice/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['malpractice', variables.providerId] });
    },
  });
}

export function useDeleteMalpracticeInsurance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
    }: {
      id: string;
      providerId: string;
    }) => {
      await api.delete(`/credentials/malpractice/${id}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['malpractice', variables.providerId] });
    },
  });
}

// ==========================================
// Supervising Physician
// ==========================================

export function useListSupervisingPhysicians(providerId: string) {
  return useQuery({
    queryKey: ['supervising-physicians', providerId],
    queryFn: async () => {
      const response = await api.get(`/credentials/supervising-physicians/${providerId}`);
      return response.data.data;
    },
    enabled: !!providerId,
  });
}

export function useCreateSupervisingPhysician() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      providerId,
      ...data
    }: {
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.post(`/credentials/supervising-physicians/${providerId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['supervising-physicians', variables.providerId] });
    },
  });
}

export function useUpdateSupervisingPhysician() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
      ...data
    }: {
      id: string;
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.put(`/credentials/supervising-physicians/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['supervising-physicians', variables.providerId] });
    },
  });
}

export function useDeleteSupervisingPhysician() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
    }: {
      id: string;
      providerId: string;
    }) => {
      await api.delete(`/credentials/supervising-physicians/${id}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['supervising-physicians', variables.providerId] });
    },
  });
}

// ==========================================
// Malpractice Claims
// ==========================================

export function useListMalpracticeClaims(providerId: string) {
  return useQuery({
    queryKey: ['malpractice-claims', providerId],
    queryFn: async () => {
      const response = await api.get(`/credentials/malpractice-claims/${providerId}`);
      return response.data.data;
    },
    enabled: !!providerId,
  });
}

export function useCreateMalpracticeClaim() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      providerId,
      ...data
    }: {
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.post(`/credentials/malpractice-claims/${providerId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['malpractice-claims', variables.providerId] });
    },
  });
}

export function useUpdateMalpracticeClaim() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
      ...data
    }: {
      id: string;
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.put(`/credentials/malpractice-claims/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['malpractice-claims', variables.providerId] });
    },
  });
}

export function useDeleteMalpracticeClaim() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
    }: {
      id: string;
      providerId: string;
    }) => {
      await api.delete(`/credentials/malpractice-claims/${id}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['malpractice-claims', variables.providerId] });
    },
  });
}

// ==========================================
// Disclosures
// ==========================================

export function useListDisclosures(providerId: string) {
  return useQuery({
    queryKey: ['disclosures', providerId],
    queryFn: async () => {
      const response = await api.get(`/credentials/disclosures/${providerId}`);
      return response.data.data;
    },
    enabled: !!providerId,
  });
}

export function useCreateDisclosure() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      providerId,
      ...data
    }: {
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.post(`/credentials/disclosures/${providerId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['disclosures', variables.providerId] });
    },
  });
}

export function useUpdateDisclosure() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
      ...data
    }: {
      id: string;
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.put(`/credentials/disclosures/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['disclosures', variables.providerId] });
    },
  });
}

export function useDeleteDisclosure() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
    }: {
      id: string;
      providerId: string;
    }) => {
      await api.delete(`/credentials/disclosures/${id}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['disclosures', variables.providerId] });
    },
  });
}

// ==========================================
// DEA Registrations
// ==========================================

export function useListDeaRegistrations(providerId: string) {
  return useQuery({
    queryKey: ['dea-registrations', providerId],
    queryFn: async () => {
      const response = await api.get(`/credentials/dea-registrations/${providerId}`);
      return response.data.data;
    },
    enabled: !!providerId,
  });
}

export function useCreateDeaRegistration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      providerId,
      ...data
    }: {
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.post(`/credentials/dea-registrations/${providerId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['dea-registrations', variables.providerId] });
    },
  });
}

export function useUpdateDeaRegistration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
      ...data
    }: {
      id: string;
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.put(`/credentials/dea-registrations/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['dea-registrations', variables.providerId] });
    },
  });
}

export function useDeleteDeaRegistration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
    }: {
      id: string;
      providerId: string;
    }) => {
      await api.delete(`/credentials/dea-registrations/${id}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['dea-registrations', variables.providerId] });
    },
  });
}

// ==========================================
// Provider Identifiers
// ==========================================

export function useListProviderIdentifiers(providerId: string) {
  return useQuery({
    queryKey: ['identifiers', providerId],
    queryFn: async () => {
      const response = await api.get(`/credentials/identifiers/${providerId}`);
      return response.data.data;
    },
    enabled: !!providerId,
  });
}

export function useCreateProviderIdentifier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      providerId,
      ...data
    }: {
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.post(`/credentials/identifiers/${providerId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['identifiers', variables.providerId] });
    },
  });
}

export function useUpdateProviderIdentifier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
      ...data
    }: {
      id: string;
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.put(`/credentials/identifiers/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['identifiers', variables.providerId] });
    },
  });
}

export function useDeleteProviderIdentifier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
    }: {
      id: string;
      providerId: string;
    }) => {
      await api.delete(`/credentials/identifiers/${id}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['identifiers', variables.providerId] });
    },
  });
}

// ==========================================
// Banking
// ==========================================

export function useListBanking(providerId: string) {
  return useQuery({
    queryKey: ['banking', providerId],
    queryFn: async () => {
      const response = await api.get(`/credentials/banking/${providerId}`);
      return response.data.data;
    },
    enabled: !!providerId,
  });
}

export function useCreateBanking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      providerId,
      ...data
    }: {
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.post(`/credentials/banking/${providerId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['banking', variables.providerId] });
    },
  });
}

export function useUpdateBanking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
      ...data
    }: {
      id: string;
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.put(`/credentials/banking/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['banking', variables.providerId] });
    },
  });
}

export function useDeleteBanking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      providerId: _providerId,
    }: {
      id: string;
      providerId: string;
    }) => {
      await api.delete(`/credentials/banking/${id}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['banking', variables.providerId] });
    },
  });
}

// ==========================================
// Demographics (singleton per provider - upsert pattern)
// ==========================================

export function useGetDemographics(providerId: string) {
  return useQuery({
    queryKey: ['demographics', providerId],
    queryFn: async () => {
      const response = await api.get(`/credentials/demographics/${providerId}`);
      return response.data.data;
    },
    enabled: !!providerId,
  });
}

export function useUpsertDemographics() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      providerId,
      ...data
    }: {
      providerId: string;
    } & Record<string, any>) => {
      const response = await api.put(`/credentials/demographics/${providerId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
      queryClient.invalidateQueries({ queryKey: ['demographics', variables.providerId] });
    },
  });
}

// ==========================================
// Hospital Affiliations (read-only list)
// ==========================================

export function useListHospitalAffiliations(providerId: string) {
  return useQuery({
    queryKey: ['hospital-affiliations', providerId],
    queryFn: async () => {
      const response = await api.get(`/credentials/hospital-affiliations/provider/${providerId}`);
      return response.data.data;
    },
    enabled: !!providerId,
  });
}

// ==========================================
// Professional References (read-only list)
// ==========================================

export function useListProfessionalReferences(providerId: string) {
  return useQuery({
    queryKey: ['professional-references', providerId],
    queryFn: async () => {
      const response = await api.get(`/credentials/professional-references/provider/${providerId}`);
      return response.data.data;
    },
    enabled: !!providerId,
  });
}

// ==========================================
// Covering Colleagues (read-only list)
// ==========================================

export function useListCoveringColleagues(providerId: string) {
  return useQuery({
    queryKey: ['covering-colleagues', providerId],
    queryFn: async () => {
      const response = await api.get(`/credentials/covering-colleagues/provider/${providerId}`);
      return response.data.data;
    },
    enabled: !!providerId,
  });
}
