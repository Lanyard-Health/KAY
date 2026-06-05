import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../services/api';

// Backend response shapes — kept minimal, only the fields the UI actually reads.
interface DeleteResponse {
  success: boolean;
  data?: { provider: { id: string; firstName: string; lastName: string }; alreadyDeleted: boolean };
  error?: { code?: string; message: string };
}

interface RestoreResponse {
  success: boolean;
  data?: { provider: { id: string; firstName: string; lastName: string }; alreadyActive: boolean };
  error?: { code?: string; message: string };
}

interface ArchivedProvider {
  id: string;
  npi: string;
  firstName: string;
  lastName: string;
  email: string;
  deletedAt: string;
  deletedBy: string | null;
  deletionReason: string | null;
}

interface ArchivedListResponse {
  data: ArchivedProvider[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function providerName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

/**
 * Soft-delete a provider. The `reason` is sent as a query param (not a body) because
 * some proxies strip DELETE bodies — see plan amendment. Showing a success toast with
 * an inline Undo that calls the restore endpoint is part of the contract.
 */
export function useDeleteProvider() {
  const queryClient = useQueryClient();
  const restore = useRestoreProvider();

  return useMutation({
    mutationFn: async (vars: { providerId: string; deletionReason: string | null }) => {
      const url = vars.deletionReason
        ? `/providers/${vars.providerId}?reason=${encodeURIComponent(vars.deletionReason)}`
        : `/providers/${vars.providerId}`;
      const response = await api.delete<DeleteResponse>(url);
      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.error?.message ?? 'Delete failed');
      }
      return response.data.data;
    },
    onSuccess: (data) => {
      const name = providerName(data.provider);
      toast.success(
        (t) => (
          <span className="flex items-center gap-3">
            <span>{name} was deleted.</span>
            <button
              type="button"
              onClick={() => {
                restore.mutate({ providerId: data.provider.id });
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
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['practices'] });
      queryClient.invalidateQueries({ queryKey: ['archived-providers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete provider');
    },
  });
}

/**
 * Restore a soft-deleted provider. Single canonical hook — used by the Undo toast,
 * the archived view's Restore button, and the "restore instead?" collision flow.
 */
export function useRestoreProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { providerId: string }) => {
      const response = await api.post<RestoreResponse>(`/providers/${vars.providerId}/restore`);
      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.error?.message ?? 'Restore failed');
      }
      return response.data.data;
    },
    onSuccess: (data) => {
      toast.success(`${providerName(data.provider)} was restored.`);
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['practices'] });
      queryClient.invalidateQueries({ queryKey: ['archived-providers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to restore provider');
    },
  });
}

/**
 * Paginated archived providers list — admin-only on the API; the UI also hides the
 * nav entry from non-admins (cosmetic; the 403 is what enforces).
 */
export function useArchivedProviders(params: { page: number; pageSize: number }) {
  return useQuery<ArchivedListResponse>({
    queryKey: ['archived-providers', params],
    queryFn: async () => {
      const qs = new URLSearchParams({
        status: 'archived',
        page: String(params.page),
        pageSize: String(params.pageSize),
      });
      const response = await api.get(`/providers?${qs}`);
      return response.data.data;
    },
  });
}

export type { ArchivedProvider, ArchivedListResponse };
