import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  MagnifyingGlassIcon,
  PlusIcon,
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  UserGroupIcon,
  FunnelIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import {
  useOpsWorkQueue,
  useCreateWorkItem,
  useBulkAssign,
  useOpsStaff,
  OpsWorkItem,
} from '../../hooks/useOps';

type Status = 'backlog' | 'todo' | 'in_progress' | 'waiting_external' | 'review' | 'done' | 'cancelled';
type Priority = 'urgent' | 'high' | 'normal' | 'low';
type SlaStatus = 'on_track' | 'at_risk' | 'breached';

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting_external', label: 'Waiting (External)' },
  { value: 'review', label: 'Review' },
];

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

const SLA_OPTIONS: { value: SlaStatus; label: string }[] = [
  { value: 'on_track', label: 'On Track' },
  { value: 'at_risk', label: 'At Risk' },
  { value: 'breached', label: 'Breached' },
];

const STATUS_BADGE: Record<string, string> = {
  backlog: 'bg-gray-100 text-gray-700',
  todo: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-indigo-100 text-indigo-700',
  waiting_external: 'bg-amber-100 text-amber-700',
  review: 'bg-purple-100 text-purple-700',
  done: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  normal: 'bg-blue-100 text-blue-700',
  low: 'bg-gray-100 text-gray-600',
};

const SLA_DOT: Record<string, string> = {
  on_track: 'bg-green-500',
  at_risk: 'bg-amber-500',
  breached: 'bg-red-500',
};

const CATEGORY_BADGE = 'bg-primary-50 text-primary-700';
const PAGE_SIZE = 25;

const CATEGORY_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'credentialing', label: 'Credentialing' },
  { value: 'enrollment', label: 'Enrollment' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'document_request', label: 'Document Request' },
];

function formatLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Compute SLA status from slaDeadline and createdAt */
function computeSlaStatus(item: OpsWorkItem): SlaStatus | null {
  if (!item.slaDeadline) return null;
  const now = Date.now();
  const deadline = new Date(item.slaDeadline).getTime();
  if (deadline < now) return 'breached';
  const created = new Date(item.createdAt).getTime();
  const totalDuration = deadline - created;
  const elapsed = now - created;
  if (totalDuration > 0 && elapsed / totalDuration > 0.75) return 'at_risk';
  return 'on_track';
}

export default function OpsWorkQueue() {
  const navigate = useNavigate();

  // Filters
  const [search, setSearch] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [statusFilters, setStatusFilters] = useState<Set<Status>>(new Set());
  const [priorityFilter, setPriorityFilter] = useState('');
  const [slaFilter, setSlaFilter] = useState('');
  const [page, setPage] = useState(1);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAssignee, setBulkAssignee] = useState('');

  // New work item inline form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('normal');
  const [newCategory, setNewCategory] = useState('general');

  const filters = useMemo(
    () => ({
      search,
      assigneeId: assigneeFilter || undefined,
      status: statusFilters.size > 0 ? Array.from(statusFilters) : undefined,
      priority: priorityFilter ? [priorityFilter] : undefined,
      slaStatus: slaFilter || undefined,
      page,
    }),
    [search, assigneeFilter, statusFilters, priorityFilter, slaFilter, page],
  );

  const { data, isLoading, isError, error } = useOpsWorkQueue(filters);
  const { data: staff } = useOpsStaff();
  const createWorkItem = useCreateWorkItem();
  const bulkAssign = useBulkAssign();

  const items: OpsWorkItem[] = data?.items ?? [];
  const totalCount = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Handlers
  const toggleStatus = (status: Status) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
    setPage(1);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
  };

  const toggleSelectItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateWorkItem = () => {
    if (!newTitle.trim()) return;
    createWorkItem.mutate(
      { title: newTitle.trim(), priority: newPriority, category: newCategory },
      {
        onSuccess: () => {
          setNewTitle('');
          setNewPriority('normal');
          setNewCategory('general');
          setShowNewForm(false);
        },
      },
    );
  };

  const handleBulkAssign = () => {
    if (!bulkAssignee || selectedIds.size === 0) return;
    bulkAssign.mutate(
      { workItemIds: Array.from(selectedIds), staffId: bulkAssignee },
      {
        onSuccess: () => {
          setSelectedIds(new Set());
          setBulkAssignee('');
        },
      },
    );
  };

  // Skeleton row
  const SkeletonRow = () => (
    <tr className="animate-pulse">
      <td className="px-4 py-3"><div className="h-4 w-4 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-4 w-40 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-4 w-24 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-4 w-20 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-4 w-20 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-4 w-16 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-4 w-16 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-4 w-14 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-4 w-24 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-4 w-20 rounded bg-gray-200" /></td>
      <td className="px-4 py-3"><div className="h-3 w-3 rounded-full bg-gray-200" /></td>
    </tr>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Work Queue</h1>
          <p className="text-sm text-gray-500 mt-1">
            {isLoading ? 'Loading...' : `${totalCount} work item${totalCount !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 transition-colors"
        >
          <PlusIcon className="h-4 w-4" />
          New Work Item
        </button>
      </div>

      {/* New Work Item Inline Form */}
      {showNewForm && (
        <div className="rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Work item title..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateWorkItem()}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
              autoFocus
            />
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value as Priority)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <button
              onClick={handleCreateWorkItem}
              disabled={createWorkItem.isPending || !newTitle.trim()}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {createWorkItem.isPending ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => { setShowNewForm(false); setNewTitle(''); }}
              className="rounded-lg p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="rounded-2xl border border-gray-200/60 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search work items..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
            />
          </div>

          {/* Assignee */}
          <select
            value={assigneeFilter}
            onChange={(e) => { setAssigneeFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
          >
            <option value="">All Assignees</option>
            {(staff ?? []).map((s) => (
              <option key={s.id} value={s.id}>{`${s.firstName} ${s.lastName}`}</option>
            ))}
          </select>

          {/* Priority */}
          <select
            value={priorityFilter}
            onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
          >
            <option value="">All Priorities</option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>

          {/* SLA */}
          <select
            value={slaFilter}
            onChange={(e) => { setSlaFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
          >
            <option value="">All SLA</option>
            {SLA_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          {/* Filter icon indicator */}
          {(search || assigneeFilter || statusFilters.size > 0 || priorityFilter || slaFilter) && (
            <button
              onClick={() => {
                setSearch('');
                setAssigneeFilter('');
                setStatusFilters(new Set());
                setPriorityFilter('');
                setSlaFilter('');
                setPage(1);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <FunnelIcon className="h-4 w-4" />
              Clear filters
            </button>
          )}
        </div>

        {/* Status checkboxes */}
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Status:</span>
          {STATUS_OPTIONS.map((s) => (
            <label key={s.value} className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={statusFilters.has(s.value)}
                onChange={() => toggleStatus(s.value)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5"
              />
              <span className="text-sm text-gray-600">{s.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 shadow-sm flex items-center gap-4">
          <span className="text-sm font-medium text-primary-800">
            {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <UserGroupIcon className="h-4 w-4 text-primary-600" />
            <select
              value={bulkAssignee}
              onChange={(e) => setBulkAssignee(e.target.value)}
              className="rounded-lg border border-primary-300 bg-white px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
            >
              <option value="">Assign to...</option>
              {(staff ?? []).map((s) => (
                <option key={s.id} value={s.id}>{`${s.firstName} ${s.lastName}`}</option>
              ))}
            </select>
            <button
              onClick={handleBulkAssign}
              disabled={!bulkAssignee || bulkAssign.isPending}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {bulkAssign.isPending ? 'Assigning...' : 'Assign'}
            </button>
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-sm text-primary-600 hover:text-primary-800 transition-colors"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700">
            Failed to load work queue{error instanceof Error ? `: ${error.message}` : '.'}
          </p>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl border border-gray-200/60 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && selectedIds.size === items.length}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Title</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Practice</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Provider</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Payer</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Assignee</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Due Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">SLA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-16 text-center">
                    <ClockIcon className="mx-auto h-10 w-10 text-gray-300" />
                    <p className="mt-3 text-sm font-medium text-gray-900">No work items found</p>
                    <p className="mt-1 text-sm text-gray-500">
                      {search || assigneeFilter || statusFilters.size > 0 || priorityFilter || slaFilter
                        ? 'Try adjusting your filters.'
                        : 'Create a new work item to get started.'}
                    </p>
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const slaStatus = computeSlaStatus(item);
                  const providerName = item.provider
                    ? `${item.provider.firstName} ${item.provider.lastName}`
                    : '--';
                  const assigneeName = item.assignedTo
                    ? `${item.assignedTo.firstName} ${item.assignedTo.lastName}`
                    : null;

                  return (
                    <tr
                      key={item.id}
                      onClick={() => navigate(`/ops/work-queue/${item.id}`)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleSelectItem(item.id)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-gray-900 line-clamp-1">{item.title}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{item.practice?.name ?? '--'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{providerName}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{item.enrollment?.payer?.name ?? '--'}</td>
                      <td className="px-4 py-3">
                        {item.category ? (
                          <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', CATEGORY_BADGE)}>
                            {formatLabel(item.category)}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', STATUS_BADGE[item.status] ?? 'bg-gray-100 text-gray-700')}>
                          {formatLabel(item.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', PRIORITY_BADGE[item.priority] ?? 'bg-gray-100 text-gray-600')}>
                          {formatLabel(item.priority)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {assigneeName ?? <span className="text-gray-400 italic">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDate(item.dueDate)}</td>
                      <td className="px-4 py-3">
                        {slaStatus ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className={clsx('h-2.5 w-2.5 rounded-full', SLA_DOT[slaStatus] ?? 'bg-gray-400')} />
                            <span className="text-xs text-gray-500">{formatLabel(slaStatus)}</span>
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">--</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3">
            <p className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeftIcon className="h-4 w-4" />
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
