import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';

export interface ProviderDashboardData {
  success: boolean;
  data: {
    provider: {
      id: string;
      npi: string;
      firstName: string;
      lastName: string;
      middleName?: string | null;
      suffix?: string | null;
      phone?: string | null;
      email?: string | null;
      specialties: string[];
      languages: string[];
      taxonomy?: string | null;
      providerType: string;
      dateOfBirth?: string | null;
      status: string;
      onboardingCompletedAt?: string | null;
      enrollments: Array<{
        id: string;
        status: string;
        payer: { id: string; name: string; payerType: string };
      }>;
      locations: Array<{
        id: string;
        locationName: string;
        city: string;
        state: string;
      }>;
    };
    enrollmentCount: number;
    locationCount: number;
  };
}

export interface CompletenessData {
  success: boolean;
  data: {
    percentage: number;
    sections: Array<{ name: string; complete: boolean }>;
    completedCount: number;
    totalCount: number;
  };
}

export interface OnboardingProgressData {
  success: boolean;
  data: {
    percentage: number;
    steps: Array<{ key: string; label: string; complete: boolean }>;
    isComplete: boolean;
  };
}

export interface PortalDocument {
  id: string;
  fileName: string;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  documentType: string;
  description: string | null;
  reviewStatus: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
  uploadedViaPortal: boolean;
  createdAt: string;
}

export interface PortalLicense {
  id: string;
  state: string | null;
  licenseNumber: string;
  licenseType: string;
  issueDate: string;
  expirationDate: string;
  status: string;
}

export function useCurrentProvider() {
  return useQuery({
    queryKey: ['portal', 'me'],
    queryFn: async () => {
      const response = await api.get<ProviderDashboardData>('/portal/me');
      return response.data;
    },
    staleTime: 30 * 1000,
  });
}

export function useProfileCompleteness() {
  return useQuery({
    queryKey: ['portal', 'completeness'],
    queryFn: async () => {
      const response = await api.get<CompletenessData>('/portal/me/completeness');
      return response.data;
    },
    staleTime: 30 * 1000,
  });
}

export function useOnboardingProgress() {
  return useQuery({
    queryKey: ['portal', 'onboarding', 'progress'],
    queryFn: async () => {
      const response = await api.get<OnboardingProgressData>('/portal/onboarding/progress');
      return response.data;
    },
    staleTime: 15 * 1000,
  });
}

export function usePortalDocuments() {
  return useQuery({
    queryKey: ['portal', 'documents'],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: PortalDocument[] }>('/portal/documents');
      return response.data;
    },
    staleTime: 15 * 1000,
  });
}

export function usePortalLicenses() {
  return useQuery({
    queryKey: ['portal', 'licenses'],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: PortalLicense[] }>('/portal/onboarding/licenses');
      return response.data;
    },
    staleTime: 15 * 1000,
  });
}

export function useUploadDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      file,
      documentType,
    }: {
      file: File;
      documentType: string;
    }) => {
      // Step 1: Get presigned URL
      const urlRes = await api.post<{
        success: boolean;
        data: { uploadUrl: string; documentId: string; s3Key: string };
      }>('/portal/documents/upload-url', {
        fileName: file.name,
        contentType: file.type,
        documentType,
      });

      const { uploadUrl, documentId } = (urlRes.data as any).data;

      // Step 2: Upload to S3
      await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });

      // Step 3: Confirm upload
      await api.post('/portal/documents/confirm', { documentId });

      return { documentId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal', 'documents'] });
      queryClient.invalidateQueries({ queryKey: ['portal', 'onboarding', 'progress'] });
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string) => {
      await api.delete(`/portal/documents/${documentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal', 'documents'] });
      queryClient.invalidateQueries({ queryKey: ['portal', 'onboarding', 'progress'] });
    },
  });
}

export function useCreateLicense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      state: string;
      licenseNumber: string;
      licenseType: string;
      expirationDate: string;
      issueDate?: string;
    }) => {
      const response = await api.post('/portal/onboarding/licenses', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal', 'licenses'] });
      queryClient.invalidateQueries({ queryKey: ['portal', 'onboarding', 'progress'] });
    },
  });
}

export function useCompleteOnboarding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await api.post('/portal/onboarding/complete');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal'] });
    },
  });
}
