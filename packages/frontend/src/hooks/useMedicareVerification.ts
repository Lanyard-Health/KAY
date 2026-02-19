import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import toast from 'react-hot-toast';

export function useVerifyMedicare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (providerId: string) => {
      const response = await api.post(`/pecos/verify/${providerId}`);
      return response.data.data;
    },
    onSuccess: (_data, providerId) => {
      queryClient.invalidateQueries({ queryKey: ['provider', providerId] });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      toast.success('Medicare verification updated');
    },
    onError: () => {
      toast.error('Failed to verify Medicare enrollment');
    },
  });
}

export function useVerifyMedicareBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (providerIds: string[]) => {
      const response = await api.post('/pecos/verify-batch', { providerIds });
      return response.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      toast.success(
        `Verified ${data.verified} providers: ${data.enrolled} enrolled, ${data.notEnrolled} not enrolled` +
        (data.errors > 0 ? `, ${data.errors} errors` : ''),
      );
    },
    onError: () => {
      toast.error('Failed to verify Medicare enrollment batch');
    },
  });
}
