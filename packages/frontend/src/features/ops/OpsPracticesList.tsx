import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageTransition from '../../components/ui/PageTransition';
import {
  BuildingOffice2Icon,
  MagnifyingGlassIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useOpsPractices, type OpsPractice } from '../../hooks/useOps';

const TIER_OPTIONS = [
  { value: '', label: 'All Tiers' },
  { value: 'full_service', label: 'Full Service' },
  { value: 'white_glove', label: 'White Glove' },
  { value: 'self_serve', label: 'Self-Serve' },
];

const TIER_BADGE: Record<string, { label: string; className: string }> = {
  full_service: { label: 'Full Service', className: 'bg-purple-100 text-purple-800' },
  white_glove: { label: 'White Glove', className: 'bg-blue-100 text-blue-800' },
  self_serve: { label: 'Self-Serve', className: 'bg-gray-100 text-gray-600' },
};

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function OpsPracticesList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useOpsPractices({
    search: search || undefined,
    serviceTier: tierFilter || undefined,
    page,
  });

  const practices = data?.practices ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? 25;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Loading skeleton
  if (isLoading) {
    return (
      <div>
        <div className="sm:flex sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">All Practices</h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage practices across all service tiers
            </p>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
          <div className="p-4 border-b border-gray-200/60 flex gap-4">
            <div className="h-10 w-64 bg-gray-200 rounded-lg animate-pulse" />
            <div className="h-10 w-40 bg-gray-200 rounded-lg animate-pulse" />
          </div>
          <div className="divide-y divide-gray-200/60">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                <div className="h-10 w-10 bg-gray-200 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 bg-gray-200 rounded" />
                  <div className="h-3 w-32 bg-gray-200 rounded" />
                </div>
                <div className="h-6 w-20 bg-gray-200 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div>
        <div className="sm:flex sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">All Practices</h1>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-12 text-center">
          <p className="text-sm text-red-600">
            Failed to load practices. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  return (
    <PageTransition>
    <div>
      {/* Header */}
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Practices</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage practices across all service tiers
          </p>
        </div>
      </div>

      {/* Filters + Table Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
        {/* Search + Filter Bar */}
        <div className="p-4 border-b border-gray-200/60 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-sm">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search practices..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <select
            value={tierFilter}
            onChange={(e) => {
              setTierFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
          >
            {TIER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        {practices.length === 0 ? (
          <div className="text-center py-16">
            <BuildingOffice2Icon className="mx-auto h-12 w-12 text-gray-300" />
            <h3 className="mt-3 text-sm font-medium text-gray-900">No practices found</h3>
            <p className="mt-1 text-sm text-gray-500">
              {search || tierFilter
                ? 'Try adjusting your search or filter criteria.'
                : 'No practices have been added yet.'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200/60">
                <thead className="bg-gray-50/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Practice Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Service Tier
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Providers
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Enrollments
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Primary Staff
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      SLA Health
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Activity
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200/60">
                  {practices.map((practice: OpsPractice) => {
                    const badge = TIER_BADGE[practice.serviceTier] ?? {
                      label: practice.serviceTier,
                      className: 'bg-gray-100 text-gray-600',
                    };

                    return (
                      <tr
                        key={practice.id}
                        onClick={() => navigate(`/ops/practices/${practice.id}`)}
                        className="hover:bg-gray-50/50 cursor-pointer transition-colors"
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="h-9 w-9 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
                              <BuildingOffice2Icon className="h-4 w-4 text-primary-600" />
                            </div>
                            <span className="ml-3 text-sm font-medium text-gray-900">
                              {practice.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={clsx(
                              'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                              badge.className,
                            )}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {practice.providerCount}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {practice.enrollmentCount}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {practice.primaryOpsStaff
                            ? `${practice.primaryOpsStaff.firstName} ${practice.primaryOpsStaff.lastName}`
                            : '—'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-3 text-xs">
                            {practice.slaHealth.atRisk > 0 && (
                              <span className="flex items-center gap-1 text-amber-700">
                                <span className="h-2 w-2 rounded-full bg-amber-400" />
                                {practice.slaHealth.atRisk}
                              </span>
                            )}
                            {practice.slaHealth.breached > 0 && (
                              <span className="flex items-center gap-1 text-red-700">
                                <span className="h-2 w-2 rounded-full bg-red-500" />
                                {practice.slaHealth.breached}
                              </span>
                            )}
                            {practice.slaHealth.atRisk === 0 &&
                              practice.slaHealth.breached === 0 && (
                                <span className="flex items-center gap-1 text-green-700">
                                  <span className="h-2 w-2 rounded-full bg-green-500" />
                                  OK
                                </span>
                              )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatRelativeDate(practice.lastActivity)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200/60 bg-gray-50/30">
              <p className="text-sm text-gray-500">
                Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}{' '}
                practices
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className={clsx(
                    'inline-flex items-center px-3 py-1.5 text-sm rounded-lg border transition-colors',
                    page <= 1
                      ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-100',
                  )}
                >
                  <ChevronLeftIcon className="h-4 w-4 mr-1" />
                  Prev
                </button>
                <span className="text-sm text-gray-600">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className={clsx(
                    'inline-flex items-center px-3 py-1.5 text-sm rounded-lg border transition-colors',
                    page >= totalPages
                      ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-100',
                  )}
                >
                  Next
                  <ChevronRightIcon className="h-4 w-4 ml-1" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
    </PageTransition>
  );
}
