import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import { useAuthStore } from '../stores/auth.store';

// ===========================
// Types
// ===========================

export interface OrganizationType {
  id: string;
  name: string;
  slug: string;
  description: string;
}

export interface Specialty {
  id: string;
  name: string;
  taxonomySection: 'INDIVIDUAL' | 'NON_INDIVIDUAL';
  isActive: boolean;
}

export interface SubSpecialty {
  id: string;
  name: string;
  specialtyId: string;
  isActive: boolean;
  specialty: { id: string; name: string };
}

export interface ServiceCategory {
  id: string;
  name: string;
  slug: string;
  domain: 'BEHAVIORAL_HEALTH' | 'WOMENS_HEALTH' | 'PRIMARY_CARE';
  serviceOfferings: ServiceOffering[];
}

export interface ServiceOffering {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  cptCodes: string[];
  serviceCategoryId: string;
  isActive: boolean;
}

export interface PatientAgeGroup {
  id: string;
  name: string;
  slug: string;
  ageRangeStart: number;
  ageRangeEnd: number | null;
}

export interface PatientGenderIdentity {
  id: string;
  name: string;
  slug: string;
  isConvenienceToggle: boolean;
}

export interface PatientSexualOrientation {
  id: string;
  name: string;
  slug: string;
  isConvenienceToggle: boolean;
}

export interface SpecialPopulation {
  id: string;
  name: string;
  slug: string;
}

// ===========================
// Reference data hooks
// ===========================

export function useOrganizationTypes() {
  return useQuery<OrganizationType[]>({
    queryKey: ['clinical-profile', 'organization-types'],
    queryFn: async () => {
      const response = await api.get('/clinical-profile/organization-types');
      return response.data.data;
    },
    staleTime: Infinity,
  });
}

export function useSpecialties(section: 'INDIVIDUAL' | 'NON_INDIVIDUAL') {
  return useQuery<Specialty[]>({
    queryKey: ['clinical-profile', 'specialties', section],
    queryFn: async () => {
      const response = await api.get(`/clinical-profile/specialties?section=${section}`);
      return response.data.data;
    },
    staleTime: Infinity,
    enabled: !!section,
  });
}

export function useSubSpecialties(specialtyIds: string[]) {
  return useQuery<SubSpecialty[]>({
    queryKey: ['clinical-profile', 'sub-specialties', specialtyIds],
    queryFn: async () => {
      const response = await api.get(`/clinical-profile/sub-specialties?specialtyIds=${specialtyIds.join(',')}`);
      return response.data.data;
    },
    staleTime: Infinity,
    enabled: specialtyIds.length > 0,
  });
}

export function useServices() {
  return useQuery<ServiceCategory[]>({
    queryKey: ['clinical-profile', 'services'],
    queryFn: async () => {
      const response = await api.get('/clinical-profile/services');
      return response.data.data;
    },
    staleTime: Infinity,
  });
}

export function useAgeGroups() {
  return useQuery<PatientAgeGroup[]>({
    queryKey: ['clinical-profile', 'age-groups'],
    queryFn: async () => {
      const response = await api.get('/clinical-profile/age-groups');
      return response.data.data;
    },
    staleTime: Infinity,
  });
}

export function useGenderIdentities() {
  return useQuery<PatientGenderIdentity[]>({
    queryKey: ['clinical-profile', 'gender-identities'],
    queryFn: async () => {
      const response = await api.get('/clinical-profile/gender-identities');
      return response.data.data;
    },
    staleTime: Infinity,
  });
}

export function useSexualOrientations() {
  return useQuery<PatientSexualOrientation[]>({
    queryKey: ['clinical-profile', 'sexual-orientations'],
    queryFn: async () => {
      const response = await api.get('/clinical-profile/sexual-orientations');
      return response.data.data;
    },
    staleTime: Infinity,
  });
}

export function useSpecialPopulations() {
  return useQuery<SpecialPopulation[]>({
    queryKey: ['clinical-profile', 'special-populations'],
    queryFn: async () => {
      const response = await api.get('/clinical-profile/special-populations');
      return response.data.data;
    },
    staleTime: Infinity,
  });
}

// ===========================
// Practice profile hooks
// ===========================

export function usePracticeClinicalProfile(practiceId: string | undefined) {
  return useQuery({
    queryKey: ['clinical-profile', 'practice', practiceId],
    queryFn: async () => {
      const response = await api.get(`/clinical-profile/practices/${practiceId}`);
      return response.data.data;
    },
    enabled: !!practiceId,
  });
}

export function useSaveClinicalProfile() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const practiceId = user?.practices?.[0]?.practiceId;

  return useMutation({
    mutationFn: async (data: {
      organizationTypeId: string;
      specialtyIds: string[];
      subSpecialtyIds: string[];
      serviceOfferingIds: string[];
      customServices: string[];
      patientAgeGroupIds: string[];
      patientGenderIdentityIds: string[];
      patientSexualOrientationIds: string[];
      specialPopulationIds: string[];
    }) => {
      if (!practiceId) throw new Error('No practice found');
      const response = await api.post(`/clinical-profile/practices/${practiceId}`, data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinical-profile', 'practice', practiceId] });
      toast.success('Clinical profile saved');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error?.message || error.message || 'Failed to save clinical profile';
      toast.error(message);
    },
  });
}
