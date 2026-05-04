import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClockIcon, SparklesIcon, CheckCircleIcon, XCircleIcon, PauseIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import PageTransition from '../../components/ui/PageTransition';
import EmptyState from '../../components/ui/EmptyState';
import { useAdminWorkflows } from '../../hooks/useAgentWorkflows';
import type { WorkflowStatus, AdminWorkflowListItem } from '../../hooks/useAgentWorkflows';

const STATUS_OPTIONS: Array<{ value: WorkflowStatus | ''; label: string }> = [
  { value: '', label: 'All' },
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'waiting_approval', label: 'Waiting Approval' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_STYLES: Record<WorkflowStatus, { bg: string; text: string; icon: typeof ClockIcon }> = {
  planning: { bg: 'bg-amber-100', text: 'text-amber-700', icon: ClockIcon },
  active: { bg: 'bg-blue-100', text: 'text-blue-700', icon: SparklesIcon },
  waiting_approval: { bg: 'bg-amber-100', text: 'text-amber-700', icon: ClockIcon },
  paused: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: PauseIcon },
  completed: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircleIcon },
  failed: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircleIcon },
  cancelled: { bg: 'bg-gray-100', text: 'text-gray-600', icon: XCircleIcon },
};

function goalLabel(goal: string): string {
  if (goal === 'populate_forms') return 'Auto-fill enrollment forms';
  if (goal === 'submit_to_availity_demo') return 'Submit to Availity (Demo)';
  return goal;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StatusPill({ status }: { status: WorkflowStatus }) {
  const cfg = STATUS_STYLES[status];
  const Icon = cfg.icon;
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.bg, cfg.text)}>
      <Icon className="h-3 w-3" />
      {status.replace('_', ' ')}
    </span>
  );
}

function WorkflowRow({ wf }: { wf: AdminWorkflowListItem }) {
  const providerName = wf.provider ? `${wf.provider.firstName} ${wf.provider.lastName}`.trim() : '—';
  const payerName = wf.payer?.name ?? '—';
  return (
    <Link
      to={`/admin/workflows/${wf.id}`}
      className="grid grid-cols-12 gap-3 items-center px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
    >
      <div className="col-span-3 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{goalLabel(wf.goal)}</p>
        <p className="text-xs text-gray-500 font-mono truncate">{wf.id.slice(0, 8)}</p>
      </div>
      <div className="col-span-3 min-w-0">
        <p className="text-sm text-gray-700 truncate">{providerName}</p>
        <p className="text-xs text-gray-500 truncate">{payerName}</p>
      </div>
      <div className="col-span-2">
        <StatusPill status={wf.status} />
      </div>
      <div className="col-span-2 text-xs text-gray-500">
        {wf._count ? `${wf._count.tasks} tasks · ${wf._count.events} events` : ''}
      </div>
      <div className="col-span-2 text-xs text-gray-500 text-right">
        {relativeTime(wf.createdAt)}
      </div>
    </Link>
  );
}

export default function WorkflowsList() {
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | ''>('');
  const { data: workflows, isLoading } = useAdminWorkflows({ status: statusFilter });

  return (
    <PageTransition>
      <div>
        <div className="sm:flex sm:items-center sm:justify-between mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Agent Workflows</h1>
            {workflows && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                {workflows.length}
              </span>
            )}
          </div>
        </div>

        {/* Status filter chips */}
        <div className="mb-4 flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value || 'all'}
              type="button"
              onClick={() => setStatusFilter(opt.value)}
              className={clsx(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                statusFilter === opt.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="card overflow-hidden">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-4 py-3 border-b border-gray-100 last:border-b-0 animate-pulse">
                <div className="h-4 w-1/3 bg-gray-200 rounded" />
                <div className="h-3 w-1/4 bg-gray-100 rounded mt-2" />
              </div>
            ))}
          </div>
        ) : !workflows || workflows.length === 0 ? (
          <EmptyState
            illustration="search"
            title="No workflows yet"
            description={statusFilter
              ? `No workflows match the ${statusFilter} filter. Try a different status.`
              : 'When an AI agent workflow is launched (from a provider or enrollment page), it will appear here.'}
          />
        ) : (
          <div className="card overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-12 gap-3 items-center px-4 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <div className="col-span-3">Goal</div>
              <div className="col-span-3">Provider · Payer</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Activity</div>
              <div className="col-span-2 text-right">Created</div>
            </div>
            {workflows.map((wf) => (
              <WorkflowRow key={wf.id} wf={wf} />
            ))}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
