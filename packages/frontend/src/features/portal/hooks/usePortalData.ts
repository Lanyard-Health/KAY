import { useQuery } from '@tanstack/react-query';
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
