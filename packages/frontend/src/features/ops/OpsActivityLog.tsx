import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FunnelIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { api } from '../../services/api';

interface AuditLogEntry {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  changes: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

interface ActivityResponse {
  success: boolean;
  data: {
    items: AuditLogEntry[];
    total: number;
    page: number;
    limit: number;
  };
}

const ACTION_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'login', label: 'Login' },
  { value: 'assign', label: 'Assign' },
  { value: 'approve', label: 'Approve' },
];

const ACTION_BADGE: Record<string, string> = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  login: 'bg-gray-100 text-gray-700',
  assign: 'bg-purple-100 text-purple-700',
  approve: 'bg-emerald-100 text-emerald-700',
};

const PAGE_SIZE = 50;

export default function OpsActivityLog() {
  const [filters, setFilters] = useState({
    staffId: '',
    startDate: '',
    endDate: '',
    actionType: '',
    practiceId: '',
    page: 1,
  });

  const { data, isLoading } = useQuery<ActivityResponse>({
    queryKey: ['ops-activity', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.staffId) params.set('staffId', filters.staffId);
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (filters.actionType) params.set('actionType', filters.actionType);
      if (filters.practiceId) params.set('practiceId', filters.practiceId);
      params.set('page', String(filters.page));
      params.set('limit', String(PAGE_SIZE));
      const qs = params.toString();
      const { data } = await api.get<ActivityResponse>(`/ops/activity${qs ? `?${qs}` : ''}`);
      return data;
    },
  });

  const items = data?.data?.items ?? [];
  const total = data?.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function updateFilter(key: string, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  }

  function formatTimestamp(iso: string) {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  }

  function formatDetails(changes: Record<string, unknown> | null) {
    if (!changes) return '--';
    const keys = Object.keys(changes);
    if (keys.length === 0) return '--';
    if (keys.length <= 3) return keys.join(', ');
    return `${keys.slice(0, 3).join(', ')} +${keys.length - 3} more`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Activity Log</h1>
        <p className="mt-1 text-sm text-gray-500">
          Audit trail of all staff actions across the platform.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <FunnelIcon className="h-5 w-5 text-gray-400 shrink-0 self-center" />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Staff ID</label>
          <input
            type="text"
            placeholder="Filter by user ID..."
            value={filters.staffId}
            onChange={(e) => updateFilter('staffId', e.target.value)}
            className="h-9 w-52 rounded-md border border-gray-300 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Start Date</label>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => updateFilter('startDate', e.target.value)}
            className="h-9 rounded-md border border-gray-300 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">End Date</label>
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => updateFilter('endDate', e.target.value)}
            className="h-9 rounded-md border border-gray-300 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Action</label>
          <select
            value={filters.actionType}
            onChange={(e) => updateFilter('actionType', e.target.value)}
            className="h-9 rounded-md border border-gray-300 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Practice ID</label>
          <input
            type="text"
            placeholder="Filter by practice..."
            value={filters.practiceId}
            onChange={(e) => updateFilter('practiceId', e.target.value)}
            className="h-9 w-52 rounded-md border border-gray-300 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {isLoading ? (
          <div className="divide-y divide-gray-200">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <div className="h-4 w-36 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-28 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-20 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-40 animate-pulse rounded bg-gray-200" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <ClockIcon className="h-10 w-10 mb-2" />
            <p className="text-sm font-medium">No activity found</p>
            <p className="text-xs mt-1">Try adjusting your filters.</p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Timestamp
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Staff
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Action
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Resource Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Resource ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {items.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-600">
                    {formatTimestamp(entry.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-900">
                    {entry.user
                      ? `${entry.user.firstName} ${entry.user.lastName}`
                      : 'System'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm">
                    <span
                      className={clsx(
                        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                        ACTION_BADGE[entry.action] || 'bg-gray-100 text-gray-700'
                      )}
                    >
                      {entry.action}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-600">
                    {entry.resourceType || '--'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500 font-mono text-xs">
                    {entry.resourceId
                      ? entry.resourceId.length > 12
                        ? `${entry.resourceId.slice(0, 8)}...`
                        : entry.resourceId
                      : '--'}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500 max-w-xs truncate">
                    {formatDetails(entry.changes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-3">
            <p className="text-sm text-gray-500">
              Showing {(filters.page - 1) * PAGE_SIZE + 1}
              {' - '}
              {Math.min(filters.page * PAGE_SIZE, total)} of {total} entries
            </p>
            <div className="flex items-center gap-2">
              <button
                disabled={filters.page <= 1}
                onClick={() => setFilters((p) => ({ ...p, page: p.page - 1 }))}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeftIcon className="h-4 w-4" />
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {filters.page} of {totalPages}
              </span>
              <button
                disabled={filters.page >= totalPages}
                onClick={() => setFilters((p) => ({ ...p, page: p.page + 1 }))}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
