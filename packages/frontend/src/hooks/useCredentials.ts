import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

// ==========================================
// License Mutations
// ==========================================

export function useCreateLicense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      providerId,
      ...data
    }: {
      providerId: string;
      licenseType: string;
      licenseNumber: string;
      state?: string;
      issueDate: string;
      expirationDate: string;
      notes?: string;
    }) => {
      const response = await api.post(`/credentials/licenses/${providerId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
    },
  });
}

export function useUpdateLicense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      licenseId,
      providerId: _providerId,
      ...data
    }: {
      licenseId: string;
      providerId: string;
      licenseType?: string;
      licenseNumber?: string;
      state?: string;
      issueDate?: string;
      expirationDate?: string;
      notes?: string;
    }) => {
      const response = await api.put(`/credentials/licenses/${licenseId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
    },
  });
}

export function useDeleteLicense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      licenseId,
      providerId: _providerId,
    }: {
      licenseId: string;
      providerId: string;
    }) => {
      await api.delete(`/credentials/licenses/${licenseId}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
    },
  });
}

// ==========================================
// Board Certification Mutations
// ==========================================

export function useCreateCertification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      providerId,
      ...data
    }: {
      providerId: string;
      boardType: string;
      boardName: string;
      certificationNumber?: string;
      specialty: string;
      initialCertificationDate: string;
      expirationDate?: string;
      isBoardEligible?: boolean;
      notes?: string;
    }) => {
      const response = await api.post(`/credentials/certifications/${providerId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
    },
  });
}

export function useUpdateCertification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      certificationId,
      providerId: _providerId,
      ...data
    }: {
      certificationId: string;
      providerId: string;
      boardType?: string;
      boardName?: string;
      certificationNumber?: string;
      specialty?: string;
      initialCertificationDate?: string;
      expirationDate?: string;
      isBoardEligible?: boolean;
      notes?: string;
    }) => {
      const response = await api.put(`/credentials/certifications/${certificationId}`, data);
      return response.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
    },
  });
}

export function useDeleteCertification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      certificationId,
      providerId: _providerId,
    }: {
      certificationId: string;
      providerId: string;
    }) => {
      await api.delete(`/credentials/certifications/${certificationId}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['provider', variables.providerId] });
    },
  });
}
