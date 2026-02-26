import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import PageTransition from '../../components/ui/PageTransition';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  ClipboardDocumentCheckIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import RefreshIndicator from '../../components/RefreshIndicator';
import EmptyState from '../../components/ui/EmptyState';
import ProgressRing from '../../components/ui/ProgressRing';
import { AnimatedList, AnimatedListItem } from '../../components/ui/AnimatedList';
import clsx from 'clsx';
import { useVerifyMedicareBatch } from '../../hooks/useMedicareVerification';

interface Provider {
  id: string;
  npi: string;
  firstName: string;
  lastName: string;
  email: string;
  providerType: string;
  status: 'active' | 'inactive' | 'pending';
  _count: {
    licenses: number;
    boardCertifications: number;
    documents: number;
  };
  medicareVerification?: {
    status: 'ENROLLED' | 'NOT_ENROLLED' | 'UNVERIFIED';
    verifiedAt: string | null;
  } | null;
}

// ProgressRing imported from shared component

// Calculate provider completion percentage
function calculateProgress(provider: Provider): { progress: number; details: string[] } {
  const requirements = [
    { name: 'Documents', met: provider._count.documents > 0, weight: 40 },
    { name: 'Licenses', met: provider._count.licenses > 0, weight: 30 },
    { name: 'Certifications', met: provider._count.boardCertifications > 0, weight: 30 },
  ];

  const progress = requirements.reduce((acc, req) => acc + (req.met ? req.weight : 0), 0);
  const missing = requirements.filter(r => !r.met).map(r => r.name);

  return { progress, details: missing };
}

export default function ProviderList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('cards');
  const status = searchParams.get('status') || '';
  const medicareStatus = searchParams.get('medicareStatus') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const verifyBatchMutation = useVerifyMedicareBatch();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['providers', { search, status, medicareStatus, page }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (medicareStatus) params.set('medicareStatus', medicareStatus);
      params.set('page', String(page));
      params.set('pageSize', '20');

      const response = await api.get(`/providers?${params}`);
      return response.data.data;
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams((prev) => {
      if (search) prev.set('search', search);
      else prev.delete('search');
      prev.set('page', '1');
      return prev;
    });
  };

  const statusColors = {
    active: 'bg-green-100 text-green-800 border-green-200',
    inactive: 'bg-gray-100 text-gray-800 border-gray-200',
    pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  };

  const statusIcons = {
    active: CheckCircleIcon,
    inactive: ExclamationCircleIcon,
    pending: ClipboardDocumentCheckIcon,
  };

  return (
    <PageTransition>
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Providers</h1>
            <RefreshIndicator isFetching={isFetching && !isLoading} />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Manage healthcare provider credentials and information
          </p>
        </div>
        <div className="mt-4 sm:mt-0">
          <Link to="/providers/new" className="btn-primary">
            <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
            Add Provider
          </Link>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <form onSubmit={handleSearch} className="flex-1 flex gap-4">
            <div className="flex-1">
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name, NPI, or email..."
                  className="input pl-10"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <select
              className="input w-40"
              value={status}
              onChange={(e) => {
                setSearchParams((prev) => {
                  if (e.target.value) prev.set('status', e.target.value);
                  else prev.delete('status');
                  return prev;
                });
              }}
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="pending">Pending</option>
            </select>
            <select
              className="input w-44"
              value={medicareStatus}
              onChange={(e) => {
                setSearchParams((prev) => {
                  if (e.target.value) prev.set('medicareStatus', e.target.value);
                  else prev.delete('medicareStatus');
                  prev.set('page', '1');
                  return prev;
                });
              }}
            >
              <option value="">All Medicare</option>
              <option value="ENROLLED">Enrolled</option>
              <option value="NOT_ENROLLED">Not Enrolled</option>
              <option value="UNVERIFIED">Unverified</option>
            </select>
            <button type="submit" className="btn-secondary">
              Search
            </button>
            <button
              type="button"
              onClick={() => {
                const ids = data?.data?.map((p: Provider) => p.id) || [];
                if (ids.length > 0) verifyBatchMutation.mutate(ids);
              }}
              disabled={verifyBatchMutation.isPending || !data?.data?.length}
              className="btn-secondary whitespace-nowrap"
            >
              {verifyBatchMutation.isPending ? 'Verifying...' : 'Verify All'}
            </button>
          </form>

          {/* View Toggle */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('cards')}
              className={clsx(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                viewMode === 'cards' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}
            >
              Cards
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={clsx(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                viewMode === 'table' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 animate-pulse">
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 bg-gray-200 rounded-full"></div>
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : data?.data?.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 py-12">
          <EmptyState
            illustration="people"
            title="No providers found"
            description={search || status || medicareStatus ? 'Try adjusting your search or filters.' : 'Get started by adding a new provider.'}
            action={!search && !status && !medicareStatus ? { label: 'Add Provider', onClick: () => window.location.href = '/providers/new' } : undefined}
          />
        </div>
      ) : viewMode === 'cards' ? (
        /* Cards View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data?.data?.map((provider: Provider) => {
            const { progress, details } = calculateProgress(provider);
            const StatusIcon = statusIcons[provider.status];

            return (
              <Link
                key={provider.id}
                to={`/providers/${provider.id}`}
                className="bg-white rounded-2xl shadow-sm border border-gray-200/60 hover:shadow-md transition-all hover:scale-[1.01] overflow-hidden"
              >
                {/* Progress Bar at Top */}
                <div className="h-1.5 bg-gray-100">
                  <div
                    className={clsx(
                      'h-full transition-all',
                      progress >= 80 ? 'bg-green-500' : progress >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                    )}
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 flex-shrink-0 rounded-full bg-primary-100 flex items-center justify-center">
                        <span className="text-primary-600 font-semibold text-lg">
                          {provider.firstName[0]}{provider.lastName[0]}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {provider.firstName} {provider.lastName}
                        </h3>
                        <p className="text-sm text-gray-500">NPI: {provider.npi}</p>
                      </div>
                    </div>
                    <ProgressRing value={progress} size={44} strokeWidth={4} />
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <span
                      className={clsx(
                        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium capitalize border',
                        statusColors[provider.status]
                      )}
                    >
                      <StatusIcon className="h-3.5 w-3.5" />
                      {provider.status}
                    </span>
                    {provider.medicareVerification ? (
                      <span className={clsx(
                        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                        provider.medicareVerification.status === 'ENROLLED' ? 'bg-green-100 text-green-800' :
                        provider.medicareVerification.status === 'NOT_ENROLLED' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-600',
                      )}>
                        {provider.medicareVerification.status === 'ENROLLED' ? 'Medicare' :
                         provider.medicareVerification.status === 'NOT_ENROLLED' ? 'No Medicare' : 'Unverified'}
                      </span>
                    ) : null}
                    <span className="text-sm text-gray-500 capitalize">
                      {provider.providerType.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Stats Row */}
                  <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-lg font-semibold text-gray-900">{provider._count.documents}</p>
                      <p className="text-xs text-gray-500">Documents</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-gray-900">{provider._count.licenses}</p>
                      <p className="text-xs text-gray-500">Licenses</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-gray-900">{provider._count.boardCertifications}</p>
                      <p className="text-xs text-gray-500">Certs</p>
                    </div>
                  </div>

                  {/* Missing Items */}
                  {details.length > 0 && (
                    <div className="mt-3 flex items-center gap-1 text-xs text-amber-600">
                      <ExclamationCircleIcon className="h-4 w-4" />
                      <span>Missing: {details.join(', ')}</span>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  NPI
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Medicare
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Progress
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <AnimatedList as="tbody" className="bg-white divide-y divide-gray-200">
              {data?.data?.map((provider: Provider, index: number) => {
                const { progress } = calculateProgress(provider);
                const StatusIcon = statusIcons[provider.status];

                return (
                  <AnimatedListItem itemKey={provider.id} index={index} as="tr" className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="h-10 w-10 flex-shrink-0 rounded-full bg-primary-100 flex items-center justify-center">
                          <span className="text-primary-600 font-medium">
                            {provider.firstName[0]}{provider.lastName[0]}
                          </span>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {provider.firstName} {provider.lastName}
                          </div>
                          <div className="text-sm text-gray-500">{provider.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {provider.npi}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                      {provider.providerType.replace('_', ' ')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={clsx(
                          'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium capitalize border',
                          statusColors[provider.status]
                        )}
                      >
                        <StatusIcon className="h-3.5 w-3.5" />
                        {provider.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={clsx(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                        provider.medicareVerification?.status === 'ENROLLED' ? 'bg-green-100 text-green-800' :
                        provider.medicareVerification?.status === 'NOT_ENROLLED' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-600',
                      )}>
                        {provider.medicareVerification?.status === 'ENROLLED' ? 'Enrolled' :
                         provider.medicareVerification?.status === 'NOT_ENROLLED' ? 'Not Enrolled' : 'Unverified'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <ProgressRing value={progress} size={36} strokeWidth={3} />
                        <div className="text-xs text-gray-500">
                          <div>{provider._count.documents} docs</div>
                          <div>{provider._count.licenses} lic</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <Link
                        to={`/providers/${provider.id}`}
                        className="text-primary-600 hover:text-primary-900"
                      >
                        View
                      </Link>
                    </td>
                  </AnimatedListItem>
                );
              })}
            </AnimatedList>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data?.totalPages > 1 && (
        <div className="mt-6 bg-white px-4 py-3 flex items-center justify-between border border-gray-200/60 rounded-2xl sm:px-6">
          <div className="flex-1 flex justify-between sm:hidden">
            <button
              onClick={() =>
                setSearchParams((prev) => {
                  prev.set('page', String(Math.max(1, page - 1)));
                  return prev;
                })
              }
              disabled={page <= 1}
              className="btn-secondary"
            >
              Previous
            </button>
            <button
              onClick={() =>
                setSearchParams((prev) => {
                  prev.set('page', String(page + 1));
                  return prev;
                })
              }
              disabled={page >= data.totalPages}
              className="btn-secondary"
            >
              Next
            </button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <p className="text-sm text-gray-700">
              Showing page <span className="font-medium">{page}</span> of{' '}
              <span className="font-medium">{data.totalPages}</span>
            </p>
            <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
              <button
                onClick={() =>
                  setSearchParams((prev) => {
                    prev.set('page', String(Math.max(1, page - 1)));
                    return prev;
                  })
                }
                disabled={page <= 1}
                className="relative inline-flex items-center px-4 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() =>
                  setSearchParams((prev) => {
                    prev.set('page', String(page + 1));
                    return prev;
                  })
                }
                disabled={page >= data.totalPages}
                className="relative inline-flex items-center px-4 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
              >
                Next
              </button>
            </nav>
          </div>
        </div>
      )}
    </div>
    </PageTransition>
  );
}
