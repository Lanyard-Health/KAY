import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../services/api';

interface DeleteResponse {
  success: boolean;
  data?: { practice: { id: string; name: string }; alreadyDeleted: boolean };
  error?: { code?: string; message: string };
}

interface RestoreResponse {
  success: boolean;
  data?: { practice: { id: string; name: string }; alreadyActive: boolean };
  error?: { code?: string; message: string };
}

/**
 * Soft-delete a practice. The `reason` is sent as a query param (not a body) because
 * some proxies strip DELETE bodies. Success toast includes an Undo that calls restore.
 */
export function useDeletePractice() {
  const queryClient = useQueryClient();
  const restore = useRestorePractice();

  return useMutation({
    mutationFn: async (vars: { practiceId: string; deletionReason: string | null }) => {
      const url = vars.deletionReason
        ? `/practices/${vars.practiceId}?reason=${encodeURIComponent(vars.deletionReason)}`
        : `/practices/${vars.practiceId}`;
      const response = await api.delete<DeleteResponse>(url);
      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.error?.message ?? 'Delete failed');
      }
      return response.data.data;
    },
    onSuccess: (data) => {
      toast.success(
        (t) => (
          <span className="flex items-center gap-3">
            <span>{data.practice.name} was deleted.</span>
            <button
              type="button"
              onClick={() => {
                restore.mutate({ practiceId: data.practice.id });
                toast.dismiss(t.id);
              }}
              className="font-semibold text-primary-700 hover:underline"
            >
              Undo
            </button>
          </span>
        ),
        { duration: 8000 }
      );
      queryClient.invalidateQueries({ queryKey: ['practices'] });
      queryClient.invalidateQueries({ queryKey: ['practice', data.practice.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete practice');
    },
  });
}

export function useRestorePractice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { practiceId: string }) => {
      const response = await api.post<RestoreResponse>(`/practices/${vars.practiceId}/restore`);
      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.error?.message ?? 'Restore failed');
      }
      return response.data.data;
    },
    onSuccess: (data) => {
      toast.success(`${data.practice.name} was restored.`);
      queryClient.invalidateQueries({ queryKey: ['practices'] });
      queryClient.invalidateQueries({ queryKey: ['practice', data.practice.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to restore practice');
    },
  });
}
