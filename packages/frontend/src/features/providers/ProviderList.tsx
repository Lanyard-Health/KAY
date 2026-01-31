import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  DocumentTextIcon,
  ClipboardDocumentCheckIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import clsx from 'clsx';

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
}

// Circular progress component
function ProgressRing({ progress, size = 40, strokeWidth = 4 }: { progress: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  const getColor = (progress: number) => {
    if (progress >= 80) return { stroke: '#10B981', bg: '#D1FAE5' }; // green
    if (progress >= 40) return { stroke: '#F59E0B', bg: '#FEF3C7' }; // yellow
    return { stroke: '#EF4444', bg: '#FEE2E2' }; // red
  };

  const colors = getColor(progress);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.bg}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-semibold" style={{ color: colors.stroke }}>
          {Math.round(progress)}%
        </span>
      </div>
    </div>
  );
}

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
  const page = parseInt(searchParams.get('page') || '1');

  const { data, isLoading } = useQuery({
    queryKey: ['providers', { search, status, page }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (status) params.set('status', status);
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
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Providers</h1>
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
      <div className="card card-body mb-6">
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
            <button type="submit" className="btn-secondary">
              Search
            </button>
          </form>

          {/* View Toggle */}
          <div className="flex border border-gray-300 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('cards')}
              className={clsx(
                'px-3 py-2 text-sm font-medium',
                viewMode === 'cards' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              )}
            >
              Cards
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={clsx(
                'px-3 py-2 text-sm font-medium',
                viewMode === 'table' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
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
            <div key={i} className="bg-white rounded-lg shadow p-6 animate-pulse">
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
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <DocumentTextIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No providers found</h3>
          <p className="mt-1 text-sm text-gray-500">Get started by adding a new provider.</p>
          <div className="mt-6">
            <Link to="/providers/new" className="btn-primary">
              <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
              Add Provider
            </Link>
          </div>
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
                className="bg-white rounded-lg shadow hover:shadow-lg transition-all hover:scale-[1.02] overflow-hidden"
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
                    <ProgressRing progress={progress} size={44} strokeWidth={4} />
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
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
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
                  Progress
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data?.data?.map((provider: Provider) => {
                const { progress, details } = calculateProgress(provider);
                const StatusIcon = statusIcons[provider.status];

                return (
                  <tr key={provider.id} className="hover:bg-gray-50">
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
                      <div className="flex items-center gap-3">
                        <ProgressRing progress={progress} size={36} strokeWidth={3} />
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data?.totalPages > 1 && (
        <div className="mt-6 bg-white px-4 py-3 flex items-center justify-between border border-gray-200 rounded-lg sm:px-6">
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
  );
}
