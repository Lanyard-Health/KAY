import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { clsx } from 'clsx';
import {
  useWorkflows,
  useCancelWorkflow,
  useDeleteWorkflow,
  type WorkflowStatus,
  type WorkflowListItem,
} from '../../hooks/useAgentWorkflows';
import CreateWorkflowModal from './CreateWorkflowModal';
import StatCard from '../../components/ui/StatCard';
import AnimatedCard from '../../components/ui/AnimatedCard';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import ProgressRing from '../../components/ui/ProgressRing';
import PageTransition from '../../components/ui/PageTransition';
import {
  getStatusVariant,
  getStatusLabel,
  getPriorityConfig,
  getElapsedTime,
} from '../../utils/workflowHumanize';

const STATUS_FILTERS: Array<{ label: string; value: string }> = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Planning', value: 'planning' },
  { label: 'Waiting Approval', value: 'waiting_approval' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Cancelled', value: 'cancelled' },
];

const TERMINAL_STATUSES: WorkflowStatus[] = ['completed', 'failed', 'cancelled'];
const ACTIVE_STATUSES: WorkflowStatus[] = ['planning', 'active', 'waiting_approval'];

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function formatRelativeTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 60_000) return 'Just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AgentWorkflowsPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: workflows, isLoading } = useWorkflows(
    statusFilter === 'all' ? undefined : { status: statusFilter },
  );
  const cancelWorkflow = useCancelWorkflow();
  const deleteWorkflow = useDeleteWorkflow();

  // Compute stats from all workflows (unfiltered count based on current data)
  const stats = useMemo(() => {
    if (!workflows) return { active: 0, waiting: 0, completed: 0, failed: 0 };
    return {
      active: workflows.filter((w) => ACTIVE_STATUSES.includes(w.status)).length,
      waiting: workflows.filter((w) => w.status === 'waiting_approval').length,
      completed: workflows.filter((w) => w.status === 'completed').length,
      failed: workflows.filter((w) => w.status === 'failed').length,
    };
  }, [workflows]);

  const handleCancel = (e: React.MouseEvent, wf: WorkflowListItem) => {
    e.stopPropagation();
    if (cancellingId === wf.id) {
      cancelWorkflow.mutate(wf.id, { onSettled: () => setCancellingId(null) });
    } else {
      setCancellingId(wf.id);
      setDeletingId(null);
    }
  };

  const handleDelete = (e: React.MouseEvent, wf: WorkflowListItem) => {
    e.stopPropagation();
    if (deletingId === wf.id) {
      deleteWorkflow.mutate(wf.id, { onSettled: () => setDeletingId(null) });
    } else {
      setDeletingId(wf.id);
      setCancellingId(null);
    }
  };

  return (
    <PageTransition>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
            <p className="mt-1 text-sm text-gray-500">
              Track and manage AI credentialing automation.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 transition-colors"
          >
            <PlusIcon className="h-4 w-4" />
            New Workflow
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Active"
            value={stats.active}
            icon={
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50">
                <div className="h-3 w-3 rounded-full bg-green-500 animate-pulse" />
              </div>
            }
          />
          <StatCard
            label="Waiting Approval"
            value={stats.waiting}
            icon={
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
                <div className="h-3 w-3 rounded-full bg-amber-500" />
              </div>
            }
          />
          <StatCard
            label="Completed"
            value={stats.completed}
            icon={
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <div className="h-3 w-3 rounded-full bg-blue-500" />
              </div>
            }
          />
          <StatCard
            label="Failed"
            value={stats.failed}
            icon={
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50">
                <div className="h-3 w-3 rounded-full bg-red-500" />
              </div>
            }
          />
        </div>

        {/* Status Filter Pills */}
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={clsx(
                'rounded-full px-3 py-1 text-sm font-medium transition-colors',
                statusFilter === f.value
                  ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : !workflows || workflows.length === 0 ? (
          <EmptyState
            illustration="clipboard"
            title="No workflows yet"
            description="Create a workflow to start automating credentialing tasks with AI."
            action={{ label: 'New Workflow', onClick: () => setShowCreate(true) }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {workflows.map((wf, index) => {
              const priorityConfig = getPriorityConfig(wf.priority);
              const isActive = ACTIVE_STATUSES.includes(wf.status);
              const isTerminal = TERMINAL_STATUSES.includes(wf.status);

              return (
                <AnimatedCard
                  key={wf.id}
                  index={index}
                  onClick={() => navigate(`/agent/workflows/${wf.id}`)}
                  className={clsx(
                    'cursor-pointer rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow border-l-4',
                    priorityConfig.borderColor,
                  )}
                >
                  <div className="p-4 space-y-3">
                    {/* Top: Status + Priority */}
                    <div className="flex items-center justify-between">
                      <StatusBadge
                        label={getStatusLabel(wf.status)}
                        variant={getStatusVariant(wf.status)}
                        dot={wf.status === 'active'}
                      />
                      <span
                        className={clsx(
                          'text-xs font-medium',
                          priorityConfig.color,
                        )}
                      >
                        {priorityConfig.label}
                      </span>
                    </div>

                    {/* Goal */}
                    <p className="text-sm font-medium text-gray-900 line-clamp-2 leading-snug">
                      {wf.goal}
                    </p>

                    {/* Provider + Payer */}
                    <div className="flex items-center gap-2">
                      {wf.provider && (
                        <div className="flex items-center gap-1.5">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                            <span className="text-[10px] font-semibold">
                              {getInitials(wf.provider.firstName, wf.provider.lastName)}
                            </span>
                          </div>
                          <span className="text-xs text-gray-700">
                            {wf.provider.firstName} {wf.provider.lastName}
                          </span>
                        </div>
                      )}
                      {wf.payer && (
                        <>
                          <span className="text-gray-300">|</span>
                          <span className="text-xs text-gray-500">{wf.payer.name}</span>
                        </>
                      )}
                    </div>

                    {/* Progress + Time */}
                    <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                      <div className="flex items-center gap-2">
                        {isActive && (
                          <ProgressRing value={30} size={24} strokeWidth={3} showLabel={false} />
                        )}
                        <span className="text-xs text-gray-400">
                          {isActive
                            ? getElapsedTime(wf.createdAt)
                            : formatRelativeTime(wf.updatedAt)}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {!isTerminal && (
                          <button
                            onClick={(e) => handleCancel(e, wf)}
                            className={clsx(
                              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                              cancellingId === wf.id
                                ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                : 'text-gray-400 hover:text-red-600 hover:bg-red-50',
                            )}
                          >
                            <XMarkIcon className="h-3.5 w-3.5" />
                            {cancellingId === wf.id ? 'Confirm?' : 'Cancel'}
                          </button>
                        )}
                        {isTerminal && (
                          <button
                            onClick={(e) => handleDelete(e, wf)}
                            className={clsx(
                              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                              deletingId === wf.id
                                ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                : 'text-gray-400 hover:text-red-600 hover:bg-red-50',
                            )}
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                            {deletingId === wf.id ? 'Confirm?' : 'Delete'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </AnimatedCard>
              );
            })}
          </div>
        )}

        {/* Create Modal */}
        <CreateWorkflowModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            navigate(`/agent/workflows/${id}`);
          }}
        />
      </div>
    </PageTransition>
  );
}
