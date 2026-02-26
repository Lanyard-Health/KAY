import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, XMarkIcon, EyeIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import ConfirmDialog from '../../components/ConfirmDialog';

interface ProviderApplication {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  npi: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  suffix: string | null;
  email: string;
  phone: string;
  providerType: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
  previousApplicationId: string | null;
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

export default function PendingProviders() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [selectedApp, setSelectedApp] = useState<ProviderApplication | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');
  const [approveConfirm, setApproveConfirm] = useState<{ isOpen: boolean; app: ProviderApplication | null }>({ isOpen: false, app: null });

  const { data, isLoading } = useQuery({
    queryKey: ['applications', statusFilter],
    queryFn: async () => {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const response = await api.get(`/portal/admin/applications${params}`);
      return response.data.data;
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/portal/admin/applications/${id}/approve`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast.success('Application approved');
    },
    onError: () => {
      toast.error('Failed to approve application');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const response = await api.post(`/portal/admin/applications/${id}/reject`, { notes });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      setRejectModalOpen(false);
      setRejectNotes('');
      setSelectedApp(null);
      toast.success('Application rejected');
    },
    onError: () => {
      toast.error('Failed to reject application');
    },
  });

  const handleApprove = (app: ProviderApplication) => {
    setApproveConfirm({ isOpen: true, app });
  };

  const handleRejectClick = (app: ProviderApplication) => {
    setSelectedApp(app);
    setRejectModalOpen(true);
  };

  const handleRejectSubmit = () => {
    if (selectedApp && rejectNotes.trim()) {
      rejectMutation.mutate({ id: selectedApp.id, notes: rejectNotes });
    }
  };

  const tabs = [
    { key: 'pending' as const, label: 'Pending', count: data?.pendingCount },
    { key: 'approved' as const, label: 'Approved', count: undefined },
    { key: 'rejected' as const, label: 'Rejected', count: undefined },
    { key: 'all' as const, label: 'All', count: undefined },
  ];

  return (
    <div>
      {/* Header */}
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pending Applications</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review and manage provider registration applications
          </p>
        </div>
        {data?.pendingCount > 0 && (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
            {data.pendingCount} pending
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={clsx(
              'whitespace-nowrap px-4 py-2 rounded-lg font-medium text-sm transition-all',
              statusFilter === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-2 bg-primary-100 text-primary-600 py-0.5 px-2 rounded-full text-xs">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Applications List */}
      {isLoading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden animate-pulse">
          <div className="bg-gray-50/80 px-6 py-3 flex gap-8">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-3 w-20 bg-gray-200 rounded" />
            ))}
          </div>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="px-6 py-4 flex gap-8 border-t border-gray-100">
              <div className="h-4 w-40 bg-gray-200 rounded" />
              <div className="h-4 w-32 bg-gray-200 rounded" />
              <div className="h-4 w-20 bg-gray-200 rounded" />
              <div className="h-4 w-16 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      ) : data?.applications?.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl shadow-sm border border-gray-200/60">
          <p className="text-gray-500">No {statusFilter !== 'all' ? statusFilter : ''} applications found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contact
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Submitted
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data?.applications?.map((app: ProviderApplication) => (
                <tr key={app.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {app.firstName} {app.lastName}
                        {app.suffix && `, ${app.suffix}`}
                        {app.previousApplicationId && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                            Re-application
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500">NPI: {app.npi}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{app.email}</div>
                    <div className="text-sm text-gray-500">{app.phone}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {format(new Date(app.submittedAt), 'MMM d, yyyy')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={clsx(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize',
                        app.status === 'pending' && 'bg-yellow-100 text-yellow-800',
                        app.status === 'approved' && 'bg-green-100 text-green-800',
                        app.status === 'rejected' && 'bg-red-100 text-red-800'
                      )}
                    >
                      {app.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {app.status === 'pending' ? (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleApprove(app)}
                          disabled={approveMutation.isPending}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-xl text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                        >
                          <CheckIcon className="h-4 w-4 mr-1" />
                          Approve
                        </button>
                        <button
                          onClick={() => handleRejectClick(app)}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-xl text-white bg-red-600 hover:bg-red-700"
                        >
                          <XMarkIcon className="h-4 w-4 mr-1" />
                          Reject
                        </button>
                      </div>
                    ) : (
                      <button className="text-primary-600 hover:text-primary-900">
                        <EyeIcon className="h-5 w-5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModalOpen && selectedApp && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setRejectModalOpen(false)} />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
              <h3 className="text-lg font-medium text-gray-900">Reject Application</h3>
              <p className="mt-2 text-sm text-gray-500">
                Rejecting application for {selectedApp.firstName} {selectedApp.lastName}
              </p>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={4}
                placeholder="Enter rejection reason (required)..."
                className="mt-4 block w-full rounded-xl border-gray-300 shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 sm:text-sm"
              />
              <div className="mt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setRejectModalOpen(false);
                    setRejectNotes('');
                    setSelectedApp(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRejectSubmit}
                  disabled={!rejectNotes.trim() || rejectMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-xl hover:bg-red-700 disabled:opacity-50"
                >
                  {rejectMutation.isPending ? 'Rejecting...' : 'Reject Application'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={approveConfirm.isOpen}
        onClose={() => setApproveConfirm({ isOpen: false, app: null })}
        onConfirm={() => {
          if (approveConfirm.app) approveMutation.mutate(approveConfirm.app.id);
          setApproveConfirm({ isOpen: false, app: null });
        }}
        title="Approve Application"
        message={`Approve application for ${approveConfirm.app?.firstName} ${approveConfirm.app?.lastName}? This will create their provider account.`}
        confirmLabel="Approve"
        variant="info"
        isLoading={approveMutation.isPending}
      />
    </div>
  );
}
