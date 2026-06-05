import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useArchivedProviders, useRestoreProvider } from '../../hooks/useProviderSoftDelete';
import { useAuthStore } from '../../stores/auth.store';
import PageTransition from '../../components/ui/PageTransition';
import EmptyState from '../../components/ui/EmptyState';
import { ArrowUturnLeftIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';

/**
 * Admin-only list of soft-deleted providers. Each row carries a Restore button that
 * calls the same `restoreProvider` service used by the toast Undo — there is exactly
 * one restore code path.
 */
export default function ArchivedProvidersView() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data, isLoading, isError } = useArchivedProviders({ page, pageSize });
  const restoreProvider = useRestoreProvider();

  if (user?.role !== 'admin' && user?.role !== 'practice_admin') {
    return (
      <PageTransition>
        <div className="max-w-2xl mx-auto py-12">
          <EmptyState
            illustration="inbox"
            title="Admin access required"
            description="The archived providers view is restricted to administrators."
          />
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="max-w-6xl mx-auto py-6 px-4">
        <button
          onClick={() => navigate('/providers')}
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-3"
        >
          <ArrowLeftIcon className="h-4 w-4 mr-1.5" />
          Back to providers
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Archived providers</h1>
        <p className="text-sm text-gray-600 mb-6">
          Soft-deleted providers retained for our records. Click <strong>Restore</strong> to bring
          one back to active lists immediately.
        </p>

        {isLoading && (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="card card-body animate-pulse h-14" />
            ))}
          </div>
        )}

        {isError && (
          <EmptyState
            illustration="inbox"
            title="Couldn't load archived providers"
            description="Please refresh and try again."
          />
        )}

        {data && data.data.length === 0 && (
          <EmptyState
            illustration="folder"
            title="No archived providers"
            description="Providers you delete will appear here."
          />
        )}

        {data && data.data.length > 0 && (
          <div className="card overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50/80">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">NPI</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Deleted</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.data.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {p.firstName} {p.lastName}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{p.npi}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {p.deletedAt ? format(new Date(p.deletedAt), 'MMM d, yyyy') : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-md truncate" title={p.deletionReason ?? ''}>
                      {p.deletionReason || '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={() => restoreProvider.mutate({ providerId: p.id })}
                        disabled={restoreProvider.isPending}
                        className="inline-flex items-center text-sm font-medium text-primary-700 hover:text-primary-900 disabled:opacity-50"
                      >
                        <ArrowUturnLeftIcon className="h-4 w-4 mr-1" />
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
            <div>Page {page} of {data.totalPages}</div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded border border-gray-200 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page === data.totalPages}
                className="px-3 py-1.5 rounded border border-gray-200 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </PageTransition>
  );
}
