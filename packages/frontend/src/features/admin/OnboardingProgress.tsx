import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, XMarkIcon, EyeIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { api } from '../../services/api';

type FilterTab = 'all' | 'completed' | 'in_progress' | 'not_started';

interface ProviderOnboarding {
  id: string;
  name: string;
  npi: string;
  providerType: string;
  approvedAt: string;
  onboardingCompletedAt: string | null;
  onboardingProgress: {
    percentage: number;
    steps: Array<{ key: string; label: string; complete: boolean }>;
    isComplete: boolean;
  };
}

interface DocumentForReview {
  id: string;
  originalFileName: string;
  documentType: string;
  reviewStatus: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

export default function OnboardingProgress() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>('all');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [reviewDocId, setReviewDocId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'onboarding-providers'],
    queryFn: async () => {
      const response = await api.get('/portal/admin/onboarding/providers');
      return (response.data as any).data;
    },
  });

  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: ['admin', 'provider-documents', selectedProvider],
    queryFn: async () => {
      const response = await api.get(`/portal/admin/onboarding/providers/${selectedProvider}/documents`);
      return (response.data as any).data;
    },
    enabled: !!selectedProvider,
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ docId, status, notes }: { docId: string; status: string; notes?: string }) => {
      await api.put(`/portal/admin/onboarding/providers/${selectedProvider}/documents/${docId}/review`, {
        status,
        notes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'provider-documents', selectedProvider] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'onboarding-providers'] });
      setReviewDocId(null);
      setReviewNotes('');
      toast.success('Document reviewed');
    },
    onError: () => {
      toast.error('Failed to review document');
    },
  });

  const providers: ProviderOnboarding[] = data?.providers ?? [];
  const summary = data?.summary ?? { total: 0, completed: 0, inProgress: 0, notStarted: 0 };

  const filteredProviders = providers.filter((p) => {
    if (filter === 'completed') return p.onboardingCompletedAt;
    if (filter === 'in_progress') return !p.onboardingCompletedAt && p.onboardingProgress.percentage > 0;
    if (filter === 'not_started') return !p.onboardingCompletedAt && p.onboardingProgress.percentage === 0;
    return true;
  });

  const documents: DocumentForReview[] = docsData ?? [];

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: summary.total },
    { key: 'completed', label: 'Complete', count: summary.completed },
    { key: 'in_progress', label: 'In Progress', count: summary.inProgress },
    { key: 'not_started', label: 'Not Started', count: summary.notStarted },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Provider Onboarding</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track and manage provider onboarding progress
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Approved', value: summary.total, color: 'bg-blue-50 text-blue-700' },
          { label: 'Onboarding Complete', value: summary.completed, color: 'bg-green-50 text-green-700' },
          { label: 'In Progress', value: summary.inProgress, color: 'bg-yellow-50 text-yellow-700' },
          { label: 'Not Started', value: summary.notStarted, color: 'bg-gray-50 text-gray-700' },
        ].map((card) => (
          <div key={card.label} className={clsx('rounded-lg p-4', card.color)}>
            <p className="text-sm font-medium">{card.label}</p>
            <p className="text-2xl font-bold mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={clsx(
                'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm',
                filter === tab.key
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              {tab.label}
              <span className="ml-2 bg-gray-100 text-gray-600 py-0.5 px-2 rounded-full text-xs">
                {tab.count}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* Providers Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-primary-600" />
        </div>
      ) : filteredProviders.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500">No providers found.</p>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">NPI</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Progress</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredProviders.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{p.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{p.npi}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 capitalize">
                    {p.providerType.replace(/_/g, ' ')}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-24 bg-gray-200 rounded-full h-2">
                        <div
                          className={clsx(
                            'h-2 rounded-full',
                            p.onboardingProgress.percentage === 100 ? 'bg-green-500' : 'bg-primary-500'
                          )}
                          style={{ width: `${p.onboardingProgress.percentage}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{p.onboardingProgress.percentage}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={clsx(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                        p.onboardingCompletedAt
                          ? 'bg-green-100 text-green-800'
                          : p.onboardingProgress.percentage > 0
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-800'
                      )}
                    >
                      {p.onboardingCompletedAt
                        ? 'Complete'
                        : p.onboardingProgress.percentage > 0
                        ? 'In Progress'
                        : 'Not Started'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => setSelectedProvider(selectedProvider === p.id ? null : p.id)}
                      className="text-primary-600 hover:text-primary-800"
                    >
                      <EyeIcon className="h-5 w-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Document Review Modal */}
      {selectedProvider && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setSelectedProvider(null)} />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Portal Documents — {providers.find(p => p.id === selectedProvider)?.name}
                </h3>
                <button onClick={() => setSelectedProvider(null)} className="text-gray-400 hover:text-gray-600">
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>

              {docsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-primary-600" />
                </div>
              ) : documents.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">No portal-uploaded documents.</p>
              ) : (
                <div className="space-y-3">
                  {documents.map((doc) => (
                    <div key={doc.id} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{doc.originalFileName}</p>
                          <p className="text-xs text-gray-500 capitalize">
                            {doc.documentType.replace(/_/g, ' ')} — {new Date(doc.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={clsx(
                              'px-2.5 py-0.5 rounded-full text-xs font-medium capitalize',
                              doc.reviewStatus === 'approved' && 'bg-green-100 text-green-800',
                              doc.reviewStatus === 'rejected' && 'bg-red-100 text-red-800',
                              (!doc.reviewStatus || doc.reviewStatus === 'pending') && 'bg-yellow-100 text-yellow-800'
                            )}
                          >
                            {doc.reviewStatus || 'pending'}
                          </span>
                          {doc.reviewStatus !== 'approved' && (
                            <>
                              <button
                                onClick={() => reviewMutation.mutate({ docId: doc.id, status: 'approved' })}
                                disabled={reviewMutation.isPending}
                                className="p-1 text-green-600 hover:bg-green-50 rounded"
                                title="Approve"
                              >
                                <CheckIcon className="h-5 w-5" />
                              </button>
                              <button
                                onClick={() => setReviewDocId(reviewDocId === doc.id ? null : doc.id)}
                                className="p-1 text-red-600 hover:bg-red-50 rounded"
                                title="Reject"
                              >
                                <XMarkIcon className="h-5 w-5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {reviewDocId === doc.id && (
                        <div className="mt-3 flex gap-2">
                          <input
                            type="text"
                            value={reviewNotes}
                            onChange={(e) => setReviewNotes(e.target.value)}
                            placeholder="Rejection notes..."
                            className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                          />
                          <button
                            onClick={() => reviewMutation.mutate({ docId: doc.id, status: 'rejected', notes: reviewNotes })}
                            disabled={reviewMutation.isPending}
                            className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      {doc.reviewNotes && (
                        <p className="mt-2 text-xs text-gray-500">Notes: {doc.reviewNotes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
