import { useState } from 'react';
import {
  ViewColumnsIcon,
  TableCellsIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useCommandCenterMatrix } from '../../hooks/useCommandCenter';
import MatrixView from './MatrixView';
import KanbanView from './KanbanView';

type ViewMode = 'matrix' | 'kanban';

const statusOptions = [
  { value: 'all', label: 'All Statuses' },
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
];

export default function CommandCenter() {
  const [viewMode, setViewMode] = useState<ViewMode>('matrix');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  const { data, isLoading, error } = useCommandCenterMatrix();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Command Center</h1>
          <p className="text-sm text-gray-500 mt-1">
            {data ? `${data.totals.total} enrollment${data.totals.total !== 1 ? 's' : ''} across ${data.payers.length} payer${data.payers.length !== 1 ? 's' : ''}` : 'Loading...'}
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('matrix')}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
              viewMode === 'matrix'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <TableCellsIcon className="h-4 w-4" />
            Matrix
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
              viewMode === 'kanban'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <ViewColumnsIcon className="h-4 w-4" />
            Kanban
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search providers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
          />
        </div>
        <div className="relative">
          <FunnelIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="pl-9 pr-8 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 bg-white appearance-none"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Status summary pills */}
        {data && (
          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(data.totals.byStatus).map(([status, count]) => (
              <button
                key={status}
                onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
                className={clsx(
                  'text-xs font-medium px-2.5 py-1 rounded-full transition-all',
                  statusFilter === status
                    ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-300'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                )}
              >
                {status.replace('_', ' ')} ({count})
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
        {isLoading ? (
          <div className="p-8">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-gray-100 rounded w-full" />
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 bg-gray-50 rounded w-full" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-red-600 font-medium">Failed to load command center data</p>
            <p className="text-sm text-gray-500 mt-1">Please try again later</p>
          </div>
        ) : data ? (
          viewMode === 'matrix' ? (
            <MatrixView data={data} statusFilter={statusFilter} searchTerm={searchTerm} />
          ) : (
            <div className="p-4">
              <KanbanView data={data} statusFilter={statusFilter} searchTerm={searchTerm} />
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
