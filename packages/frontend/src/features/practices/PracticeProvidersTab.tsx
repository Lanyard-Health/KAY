import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, Transition } from '@headlessui/react';
import { PlusIcon, TrashIcon, UsersIcon, XMarkIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import {
  usePracticeProviders,
  useUnassignedProviders,
  useAssignProvider,
  useUnassignProvider,
} from '../../hooks/usePractices';

interface PracticeProvidersTabProps {
  practiceId: string;
}

export default function PracticeProvidersTab({ practiceId }: PracticeProvidersTabProps) {
  const { data: providersData, isLoading } = usePracticeProviders(practiceId);
  const unassignMutation = useUnassignProvider();
  const [assignModalOpen, setAssignModalOpen] = useState(false);

  const providers = providersData?.data ?? providersData ?? [];

  const handleUnassign = (provider: any) => {
    if (!window.confirm(`Remove ${provider.firstName} ${provider.lastName} from this practice?`)) {
      return;
    }

    unassignMutation.mutate(
      { providerId: provider.id, practiceId },
      {
        onSuccess: () => toast.success('Provider removed from practice'),
        onError: () => toast.error('Failed to remove provider'),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="card card-body animate-pulse">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-4 w-40 bg-gray-200 rounded" />
                <div className="h-3 w-32 bg-gray-200 rounded" />
              </div>
              <div className="h-6 w-16 bg-gray-200 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">Providers</h3>
        <button onClick={() => setAssignModalOpen(true)} className="btn-primary text-sm">
          <PlusIcon className="-ml-1 mr-1.5 h-4 w-4" />
          Assign Provider
        </button>
      </div>

      {!Array.isArray(providers) || providers.length === 0 ? (
        <div className="text-center py-12">
          <UsersIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No providers assigned</h3>
          <p className="mt-1 text-sm text-gray-500">Assign providers to this practice.</p>
          <button
            onClick={() => setAssignModalOpen(true)}
            className="mt-4 text-sm text-primary-600 hover:text-primary-500"
          >
            Assign your first provider
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  NPI
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Provider Type
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {providers.map((provider: any) => (
                <tr key={provider.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Link
                      to={`/providers/${provider.id}`}
                      className="text-sm font-medium text-primary-600 hover:text-primary-500"
                    >
                      {provider.firstName} {provider.lastName}
                      {provider.suffix && `, ${provider.suffix}`}
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {provider.npi}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={clsx(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize',
                        provider.status === 'active' && 'bg-green-100 text-green-800',
                        provider.status === 'inactive' && 'bg-gray-100 text-gray-600',
                        provider.status === 'pending' && 'bg-yellow-100 text-yellow-800'
                      )}
                    >
                      {provider.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                    {provider.providerType?.replace('_', ' ') || '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <button
                      onClick={() => handleUnassign(provider)}
                      disabled={unassignMutation.isPending}
                      className="text-red-600 hover:text-red-900 disabled:opacity-50"
                      title="Remove from practice"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AssignProviderModal
        isOpen={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        practiceId={practiceId}
      />
    </div>
  );
}

// Inline assign provider modal (simpler than user modal — just a dropdown)
function AssignProviderModal({
  isOpen,
  onClose,
  practiceId,
}: {
  isOpen: boolean;
  onClose: () => void;
  practiceId: string;
}) {
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [search, setSearch] = useState('');
  const { data: unassignedData, isLoading } = useUnassignedProviders();
  const assignMutation = useAssignProvider();

  const unassigned = unassignedData?.data ?? unassignedData ?? [];
  const filtered = Array.isArray(unassigned)
    ? unassigned.filter((p: any) => {
        if (!search) return true;
        const term = search.toLowerCase();
        return (
          p.firstName?.toLowerCase().includes(term) ||
          p.lastName?.toLowerCase().includes(term) ||
          p.npi?.includes(term)
        );
      })
    : [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProviderId) {
      toast.error('Please select a provider');
      return;
    }

    assignMutation.mutate(
      { providerId: selectedProviderId, practiceId },
      {
        onSuccess: () => {
          toast.success('Provider assigned to practice');
          handleClose();
        },
        onError: () => toast.error('Failed to assign provider'),
      }
    );
  };

  const handleClose = () => {
    setSelectedProviderId('');
    setSearch('');
    onClose();
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-md">
                <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      Assign Provider
                    </Dialog.Title>
                    <button onClick={handleClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label className="label">Search Providers</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="Filter by name or NPI..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="label">Select Provider *</label>
                      {isLoading ? (
                        <div className="h-10 bg-gray-100 rounded animate-pulse" />
                      ) : (
                        <select
                          className="input"
                          value={selectedProviderId}
                          onChange={(e) => setSelectedProviderId(e.target.value)}
                          required
                        >
                          <option value="">Choose a provider...</option>
                          {filtered.map((p: any) => (
                            <option key={p.id} value={p.id}>
                              {p.firstName} {p.lastName} — NPI: {p.npi}
                            </option>
                          ))}
                        </select>
                      )}
                      {!isLoading && filtered.length === 0 && (
                        <p className="mt-1 text-sm text-gray-500">
                          {search ? 'No matching unassigned providers found.' : 'All providers are already assigned to a practice.'}
                        </p>
                      )}
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t">
                      <button type="button" onClick={handleClose} className="btn-secondary">
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={assignMutation.isPending || !selectedProviderId}
                        className="btn-primary"
                      >
                        {assignMutation.isPending ? 'Assigning...' : 'Assign Provider'}
                      </button>
                    </div>
                  </form>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
