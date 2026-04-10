import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  type: 'AUTOMATED_ONBOARDING' | 'STATIC_ON_DEMAND';
  triggerEvent: string | null;
  isActive: boolean;
  createdAt: string;
}

export function useEmailTemplates(type?: 'AUTOMATED_ONBOARDING' | 'STATIC_ON_DEMAND') {
  return useQuery({
    queryKey: ['email-templates', type],
    queryFn: async () => {
      const params = type ? `?type=${type}` : '';
      const response = await api.get(`/email-templates${params}`);
      return response.data.data as EmailTemplate[];
    },
  });
}
