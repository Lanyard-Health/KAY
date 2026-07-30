import { useState, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { XMarkIcon } from '@heroicons/react/24/outline';
import PageTransition from '../../components/ui/PageTransition';
import EmptyState from '../../components/ui/EmptyState';
import { useAuditLogs } from './hooks';
import type { AuditLogFilters } from './hooks';
import AuditEntryDetail from './AuditEntryDetail';
import { useUsersList } from '../../hooks/useUserManagement';
import { Pagination } from '../access-review/shared';

const ACTION_BADGE: Record<string, string> = {
  create: 'bg-green-100 text-green-800',
  update: 'bg-blue-100 text-blue-800',
  delete: 'bg-red-100 text-red-800',
  read: 'bg-gray-100 text-gray-600',
};

const ACTION_OPTIONS = ['create', 'update', 'delete', 'read'];

export default function AuditLogPage() {
  // Filters live in the URL so per-user / per-resource drill-downs are linkable.
  const [searchParams, setSearchParams] = useSearchParams();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const page = Number(searchParams.get('page') || '1');
  const userId = searchParams.get('userId') || '';
  const action = searchParams.get('action') || '';
  const resourceType = searchParams.get('resourceType') || '';
  const resourceId = searchParams.get('resourceId') || '';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const filters: AuditLogFilters = {
    page,
    ...(userId && { userId }),
    ...(action && { action }),
    ...(resourceType && { resourceType }),
    ...(resourceId && { resourceId }),
    ...(startDate && { startDate: new Date(startDate).toISOString() }),
    ...(endDate && { endDate: new Date(`${endDate}T23:59:59`).toISOString() }),
  };

  const { data, isLoading } = useAuditLogs(filters);
  const { data: users } = useUsersList();

  const hasFilters = !!(userId || action || resourceType || resourceId || startDate || endDate);

  return (
    <PageTransition>
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="mt-1 text-sm text-gray-500">
            Who did what, when: every recorded change and sensitive read
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6 items-end">
          <div>
            <label className="label">User</label>
            <select className="input w-auto min-w-[180px]" value={userId} onChange={(e) => setParam('userId', e.target.value)}>
              <option value="">All users</option>
              {(users ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Action</label>
            <select className="input w-auto" value={action} onChange={(e) => setParam('action', e.target.value)}>
              <option value="">All actions</option>
              {ACTION_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Resource Type</label>
            <input
              className="input w-40"
              placeholder="e.g. users"
              value={resourceType}
              onChange={(e) => setParam('resourceType', e.target.value)}
            />
          </div>
          <div>
            <label className="label">From</label>
            <input type="date" className="input w-auto" value={startDate} onChange={(e) => setParam('startDate', e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input w-auto" value={endDate} onChange={(e) => setParam('endDate', e.target.value)} />
          </div>
          {hasFilters && (
            <button
              onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
              className="btn-secondary flex items-center"
            >
              <XMarkIcon className="h-4 w-4 mr-1" />
              Clear
            </button>
          )}
        </div>

        {resourceId && (
          <div className="mb-4 text-sm text-gray-600 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
            Showing history for resource <span className="font-mono">{resourceId}</span>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="card card-body animate-pulse">
                <div className="h-5 w-96 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        ) : !data || data.data.length === 0 ? (
          <EmptyState
            illustration="clipboard"
            title="No audit entries"
            description={hasFilters ? 'Try adjusting your filters.' : 'Activity will appear here as users work in the system.'}
          />
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50/80">
                  <tr>
                    {['Time', 'User', 'Action', 'Resource', ''].map((h, i) => (
                      <th key={i} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.data.map((entry) => (
                    <Fragment key={entry.id}>
                      <tr
                        onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-500">
                          {new Date(entry.timestamp).toLocaleString()}
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap text-sm">
                          {entry.user ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); setParam('userId', entry.user!.id); }}
                              className="text-primary-600 hover:text-primary-500 font-medium"
                              title="Filter to this user's history"
                            >
                              {entry.user.firstName} {entry.user.lastName}
                            </button>
                          ) : (
                            <span className="text-gray-400">System</span>
                          )}
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap">
                          <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', ACTION_BADGE[entry.action] || 'bg-gray-100 text-gray-600')}>
                            {entry.action}
                          </span>
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-700">
                          <span className="font-mono text-xs">{entry.resourceType}</span>
                          {entry.resourceId && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const next = new URLSearchParams();
                                next.set('resourceType', entry.resourceType);
                                next.set('resourceId', entry.resourceId!);
                                setSearchParams(next, { replace: true });
                              }}
                              className="ml-2 text-xs text-gray-400 hover:text-primary-600 font-mono"
                              title="Show this resource's full history"
                            >
                              {entry.resourceId.slice(0, 8)}…
                            </button>
                          )}
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap text-right text-xs text-gray-400">
                          {expandedId === entry.id ? 'Hide' : 'Details'}
                        </td>
                      </tr>
                      {expandedId === entry.id && (
                        <tr>
                          <td colSpan={5} className="p-0">
                            <AuditEntryDetail entry={entry} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              onPageChange={(p) => setParam('page', String(p))}
            />
          </div>
        )}
      </div>
    </PageTransition>
  );
}
