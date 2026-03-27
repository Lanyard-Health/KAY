import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import toast from 'react-hot-toast';

export interface DenialTriage {
  id: string;
  enrollmentId: string;
  denialReason: string;
  denialDate: string;
  triageReport: string | null;
  identifiedGaps: Array<{ gap: string; severity: string; source?: string }> | null;
  recommendedAction: string | null; // appeal | reapply | abandon | needs_review
  recommendedSteps: Array<{ order: number; action: string; notes?: string }> | null;
  status: string; // pending | reviewed | actioned
  reviewedBy: string;
  reviewedAt: string | null;
  reviewNotes: string | null;
  modelUsed: string | null;
  createdAt: string;
  updatedAt: string;
  enrollment: {
    id: string;
    status: string;
    provider: { id: string; firstName: string; lastName: string; npi: string };
    payer: { id: string; name: string };
    payerTrack?: { id: string; track: string; stateRegion: string } | null;
  };
}

export function useDenialTriages(filters?: { status?: string }) {
  return useQuery({
    queryKey: ['denial-triages', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      const qs = params.toString();
      const { data } = await api.get<{ success: boolean; data: DenialTriage[] }>(
        `/denials${qs ? `?${qs}` : ''}`
      );
      return data.data;
    },
  });
}

export function useDenialTriage(id: string | undefined) {
  return useQuery({
    queryKey: ['denial-triage', id],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: DenialTriage }>(
        `/denials/${id}`
      );
      return data.data;
    },
    enabled: !!id,
  });
}

export function useUpdateDenialTriage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
      reviewNotes,
    }: {
      id: string;
      status: 'reviewed' | 'actioned';
      reviewNotes?: string;
    }) => {
      const { data } = await api.patch(`/denials/${id}`, { status, reviewNotes });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['denial-triages'] });
      queryClient.invalidateQueries({ queryKey: ['denial-triage'] });
      toast.success('Denial triage updated');
    },
    onError: () => {
      toast.error('Failed to update denial triage');
    },
  });
}
