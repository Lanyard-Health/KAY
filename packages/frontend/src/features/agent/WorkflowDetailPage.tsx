import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MinusCircleIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  BellAlertIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import {
  useWorkflowDetail,
  useWorkflowEvents,
  useCancelWorkflow,
  useDeleteWorkflow,
  type WorkflowStatus,
  type TaskStatus,
  type AgentTask,
  type AgentEvent,
} from '../../hooks/useAgentWorkflows';
import { useWorkflowSocket } from '../../hooks/useAgentSocket';
import { useDecideApproval } from '../../hooks/useApprovals';
import StatusBadge from '../../components/ui/StatusBadge';
import ProgressRing from '../../components/ui/ProgressRing';
import PageTransition from '../../components/ui/PageTransition';
import {
  getStatusVariant,
  getStatusLabel,
  getPriorityConfig,
  getElapsedTime,
  formatDurationBetween,
  getWorkflowProgressPercent,
  getTaskStepLabel,
  summarizeTaskInput,
  summarizeTaskOutput,
  humanizeEventAction,
  humanizeApprovalTitle,
  humanizeApprovalContext,
} from '../../utils/workflowHumanize';

const TERMINAL_STATUSES: WorkflowStatus[] = ['completed', 'failed', 'cancelled'];

function taskStatusIcon(status: TaskStatus) {
  switch (status) {
    case 'pending':
    case 'queued':
      return <div className="h-6 w-6 rounded-full border-2 border-gray-300 bg-white" />;
    case 'active':
    case 'in_progress':
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100">
          <ArrowPathIcon className="h-4 w-4 text-blue-600 animate-spin" />
        </div>
      );
    case 'completed':
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100">
          <CheckCircleIcon className="h-4 w-4 text-green-600" />
        </div>
      );
    case 'failed':
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100">
          <XCircleIcon className="h-4 w-4 text-red-600" />
        </div>
      );
    case 'skipped':
    case 'cancelled':
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100">
          <MinusCircleIcon className="h-4 w-4 text-gray-400" />
        </div>
      );
    default:
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100">
          <ClockIcon className="h-4 w-4 text-gray-400" />
        </div>
      );
  }
}

function eventIcon(action: string, level: string) {
  if (level === 'error') return <XCircleIcon className="h-4 w-4 text-red-500" />;
  if (level === 'warn') return <ExclamationTriangleIcon className="h-4 w-4 text-amber-500" />;
  if (action.includes('completed') || action.includes('success'))
    return <CheckCircleIcon className="h-4 w-4 text-green-500" />;
  if (action.includes('dispatched') || action.includes('started'))
    return <ArrowPathIcon className="h-4 w-4 text-blue-500" />;
  if (action.includes('approval'))
    return <BellAlertIcon className="h-4 w-4 text-amber-500" />;
  return <ClockIcon className="h-4 w-4 text-gray-400" />;
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

// ────────────────────────────────────
// Task Step (Stepper Item)
// ────────────────────────────────────

function TaskStep({
  task,
  stepNumber,
  isLast,
}: {
  task: AgentTask;
  stepNumber: number;
  isLast: boolean;
}) {
  const [showTechnical, setShowTechnical] = useState(false);
  const duration = formatDurationBetween(task.startedAt, task.completedAt);
  const humanInput = summarizeTaskInput(task.agentType, task.input);
  const humanOutput = summarizeTaskOutput(task.agentType, task.output);

  return (
    <div className="relative flex gap-4">
      {/* Timeline connector */}
      {!isLast && (
        <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-gray-200" />
      )}

      {/* Step number + icon */}
      <div className="flex-shrink-0 relative z-10">{taskStatusIcon(task.status)}</div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-400">Step {stepNumber}</span>
          <span className="text-sm font-medium text-gray-900">
            {getTaskStepLabel(task.agentType)}
          </span>
          <StatusBadge
            label={
              task.status === 'active' || task.status === 'in_progress'
                ? 'In Progress'
                : task.status === 'queued'
                  ? 'Queued'
                  : task.status
            }
            variant={
              task.status === 'completed'
                ? 'success'
                : task.status === 'failed'
                  ? 'danger'
                  : task.status === 'active' || task.status === 'in_progress'
                    ? 'info'
                    : task.status === 'queued'
                      ? 'neutral'
                      : 'neutral'
            }
          />
          {duration && <span className="text-xs text-gray-400">{duration}</span>}
        </div>

        <p className="mt-1 text-sm text-gray-500">{humanInput}</p>

        {humanOutput && (
          <p className="mt-1 text-sm text-gray-700 bg-gray-50 rounded-md px-3 py-2">
            {humanOutput}
          </p>
        )}

        {task.error && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">
              {typeof task.error === 'string'
                ? task.error
                : (task.error as Record<string, unknown>)?.message
                  ? String((task.error as Record<string, unknown>).message)
                  : JSON.stringify(task.error)}
            </p>
          </div>
        )}

        {/* Technical Details Toggle */}
        <button
          onClick={() => setShowTechnical(!showTechnical)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ChevronDownIcon
            className={clsx('h-3 w-3 transition-transform', showTechnical && 'rotate-180')}
          />
          Technical Details
        </button>

        {showTechnical && (
          <div className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
            <div className="flex gap-4 text-xs text-gray-400">
              <span>Agent: <span className="text-gray-600 font-mono">{task.agentType}</span></span>
              <span>ID: <span className="text-gray-600 font-mono">{task.id.slice(0, 8)}</span></span>
            </div>
            <div>
              <span className="text-[10px] font-medium uppercase text-gray-400">Input</span>
              <pre className="mt-0.5 rounded bg-white p-2 text-xs text-gray-700 overflow-x-auto max-h-32 border border-gray-200">
                {JSON.stringify(task.input, null, 2)}
              </pre>
            </div>
            {task.output && (
              <div>
                <span className="text-[10px] font-medium uppercase text-gray-400">Output</span>
                <pre className="mt-0.5 rounded bg-white p-2 text-xs text-gray-700 overflow-x-auto max-h-32 border border-gray-200">
                  {JSON.stringify(task.output, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────
// Main Page
// ────────────────────────────────────

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showTechnicalLog, setShowTechnicalLog] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: workflow, isLoading } = useWorkflowDetail(id ?? null);
  const { data: events } = useWorkflowEvents(id ?? null);
  const cancelWorkflow = useCancelWorkflow();
  const deleteWorkflowMutation = useDeleteWorkflow();
  const decideApproval = useDecideApproval();

  useWorkflowSocket(id ?? null);

  if (isLoading || !id) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="text-center py-24">
        <p className="text-gray-500">Workflow not found.</p>
        <Link
          to="/agent/workflows"
          className="mt-2 text-sm text-primary-600 hover:text-primary-700"
        >
          Back to workflows
        </Link>
      </div>
    );
  }

  const isTerminal = TERMINAL_STATUSES.includes(workflow.status);
  const pendingApprovals = workflow.approvals?.filter((a) => a.status === 'pending') ?? [];
  const sortedTasks = [...(workflow.tasks ?? [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const progressPercent = getWorkflowProgressPercent(sortedTasks);
  const priorityConfig = getPriorityConfig(workflow.priority);

  const handleApprovalDecision = (approvalId: string, decision: 'approved' | 'denied') => {
    decideApproval.mutate(
      { id: approvalId, decision, notes: approvalNotes || undefined },
      { onSuccess: () => setApprovalNotes('') },
    );
  };

  const handleDelete = () => {
    if (confirmDelete) {
      deleteWorkflowMutation.mutate(id, {
        onSuccess: () => navigate('/agent/workflows'),
      });
    } else {
      setConfirmDelete(true);
    }
  };

  return (
    <PageTransition>
      <div className="space-y-6">
        {/* Back */}
        <button
          onClick={() => navigate('/agent/workflows')}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to workflows
        </button>

        {/* Header Card */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="space-y-3 flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900">{workflow.goal}</h1>
                <StatusBadge
                  label={getStatusLabel(workflow.status)}
                  variant={getStatusVariant(workflow.status)}
                  dot={workflow.status === 'active'}
                />
              </div>

              <div className="flex items-center gap-4 flex-wrap text-sm">
                <span className={clsx('font-medium', priorityConfig.color)}>
                  {priorityConfig.label} priority
                </span>
                {workflow.provider && (
                  <Link
                    to={`/providers/${workflow.provider.id}`}
                    className="text-primary-600 hover:text-primary-700"
                  >
                    Dr. {workflow.provider.firstName} {workflow.provider.lastName}
                  </Link>
                )}
                {workflow.payer && (
                  <span className="text-gray-500">{workflow.payer.name}</span>
                )}
              </div>

              <div className="flex gap-4 text-xs text-gray-400">
                {workflow.startedAt && (
                  <span>Started {getElapsedTime(workflow.startedAt)}</span>
                )}
                {workflow.completedAt && (
                  <span>
                    Completed in{' '}
                    {formatDurationBetween(workflow.startedAt, workflow.completedAt)}
                  </span>
                )}
                {!workflow.completedAt && workflow.startedAt && !isTerminal && (
                  <span>Running for {getElapsedTime(workflow.startedAt)}</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 ml-4">
              {!isTerminal && (
                <button
                  onClick={() => cancelWorkflow.mutate(id)}
                  disabled={cancelWorkflow.isPending}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              )}
              {isTerminal && (
                <button
                  onClick={handleDelete}
                  disabled={deleteWorkflowMutation.isPending}
                  className={clsx(
                    'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
                    confirmDelete
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'border border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-200',
                  )}
                >
                  <TrashIcon className="h-4 w-4" />
                  {confirmDelete ? 'Confirm Delete' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Error Banner */}
        {workflow.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex gap-3">
            <ExclamationTriangleIcon className="h-5 w-5 text-red-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-800">Workflow failed</p>
              <p className="text-sm text-red-700 mt-1">
                {typeof workflow.error === 'string'
                  ? workflow.error
                  : (workflow.error as Record<string, unknown>)?.message
                    ? String((workflow.error as Record<string, unknown>).message)
                    : JSON.stringify(workflow.error)}
              </p>
            </div>
          </div>
        )}

        {/* Approval Banner */}
        {pendingApprovals.length > 0 && (
          <div className="rounded-xl bg-gradient-to-r from-amber-50 to-amber-100/80 border border-amber-200 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-200">
                <BellAlertIcon className="h-5 w-5 text-amber-700" />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-amber-900">
                    Approval Required ({pendingApprovals.length})
                  </h3>
                  <p className="mt-0.5 text-sm text-amber-700">
                    {workflow.provider
                      ? `The AI agent wants to proceed with Dr. ${workflow.provider.firstName} ${workflow.provider.lastName}'s ${workflow.payer?.name ?? 'enrollment'} workflow.`
                      : 'The AI agent is waiting for your approval to continue.'}
                  </p>
                </div>
                {pendingApprovals.map((approval) => {
                  const ctx = (approval.context ?? {}) as Record<string, unknown>;
                  const title = humanizeApprovalTitle(approval.type, ctx);
                  const fields = humanizeApprovalContext(ctx);

                  return (
                    <div
                      key={approval.id}
                      className="rounded-lg bg-white p-4 border border-amber-200 space-y-3"
                    >
                      <p className="text-sm font-semibold text-gray-900">{title}</p>

                      {fields.length > 0 && (
                        <div className="space-y-2">
                          {fields.map(({ label, value }, i) => (
                            <div key={i} className="text-sm">
                              <span className="font-medium text-gray-500">{label}:</span>{' '}
                              <span className="text-gray-700">{value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <textarea
                        value={approvalNotes}
                        onChange={(e) => setApprovalNotes(e.target.value)}
                        placeholder="Add notes (optional)..."
                        rows={2}
                        className="block w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprovalDecision(approval.id, 'approved')}
                          disabled={decideApproval.isPending}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          <CheckCircleIcon className="h-4 w-4" />
                          Approve
                        </button>
                        <button
                          onClick={() => handleApprovalDecision(approval.id, 'denied')}
                          disabled={decideApproval.isPending}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                          <XCircleIcon className="h-4 w-4" />
                          Deny
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column (2/3) — Progress + Activity */}
          <div className="lg:col-span-2 space-y-6">
            {/* Progress Stepper */}
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                  Progress
                </h2>
                <div className="flex items-center gap-2">
                  <ProgressRing value={progressPercent} size={28} strokeWidth={3} />
                  <span className="text-xs text-gray-500">{progressPercent}% complete</span>
                </div>
              </div>

              {/* Animated progress bar */}
              <div className="h-1.5 rounded-full bg-gray-100 mb-6 overflow-hidden">
                <motion.div
                  className={clsx(
                    'h-full rounded-full',
                    workflow.status === 'failed'
                      ? 'bg-red-500'
                      : workflow.status === 'completed'
                        ? 'bg-green-500'
                        : 'bg-primary-500',
                  )}
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>

              {sortedTasks.length === 0 ? (
                <div className="flex items-center gap-3 py-4">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
                  <p className="text-sm text-gray-500">
                    The AI agent is planning the steps for this workflow...
                  </p>
                </div>
              ) : (
                <div>
                  {sortedTasks.map((task, i) => (
                    <TaskStep
                      key={task.id}
                      task={task}
                      stepNumber={i + 1}
                      isLast={i === sortedTasks.length - 1}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Activity Feed */}
            <div className="rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                  Activity
                </h2>
                {events && events.length > 0 && (
                  <button
                    onClick={() => setShowTechnicalLog(!showTechnicalLog)}
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showTechnicalLog ? 'Simple View' : 'Technical Log'}
                  </button>
                )}
              </div>

              {!events || events.length === 0 ? (
                <p className="px-6 py-4 text-sm text-gray-400">No activity yet.</p>
              ) : showTechnicalLog ? (
                /* Technical Log Table */
                <div className="max-h-64 overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-100 text-xs">
                    <thead className="bg-gray-50/80 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-500">Time</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-500">Agent</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-500">Action</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-500">Level</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {events.map((evt: AgentEvent) => (
                        <tr key={evt.id}>
                          <td className="px-4 py-1.5 text-gray-400 whitespace-nowrap">
                            {formatRelativeTime(evt.timestamp)}
                          </td>
                          <td className="px-4 py-1.5 text-gray-700 font-mono">{evt.agent ?? '—'}</td>
                          <td className="px-4 py-1.5 text-gray-700 font-mono">{evt.action}</td>
                          <td
                            className={clsx(
                              'px-4 py-1.5 capitalize',
                              evt.level === 'error'
                                ? 'text-red-600'
                                : evt.level === 'warn'
                                  ? 'text-amber-600'
                                  : 'text-gray-500',
                            )}
                          >
                            {evt.level}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* Human-readable Activity Feed */
                <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
                  {events.map((evt: AgentEvent) => (
                    <div key={evt.id} className="flex items-center gap-3 px-6 py-3">
                      {eventIcon(evt.action, evt.level)}
                      <span className="flex-1 text-sm text-gray-700">
                        {humanizeEventAction(evt.action)}
                      </span>
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {formatRelativeTime(evt.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column (1/3) — Approvals + Metadata */}
          <div className="space-y-6">
            {/* Pending Approvals Card (if any not in banner) */}
            {pendingApprovals.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h2 className="text-sm font-semibold text-amber-800 mb-2">
                  {pendingApprovals.length} Pending Approval{pendingApprovals.length !== 1 ? 's' : ''}
                </h2>
                <p className="text-xs text-amber-700">
                  Review the approval request above to continue this workflow.
                </p>
              </div>
            )}

            {/* Metadata */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
                Details
              </h2>
              <dl className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-400">ID</dt>
                  <dd className="text-gray-700 font-mono text-xs">{workflow.id.slice(0, 8)}...</dd>
                </div>
                {workflow.provider && (
                  <div className="flex justify-between">
                    <dt className="text-gray-400">Provider</dt>
                    <dd className="text-gray-700">
                      {workflow.provider.firstName} {workflow.provider.lastName}
                    </dd>
                  </div>
                )}
                {workflow.provider?.npi && (
                  <div className="flex justify-between">
                    <dt className="text-gray-400">NPI</dt>
                    <dd className="text-gray-700 font-mono text-xs">{workflow.provider.npi}</dd>
                  </div>
                )}
                {workflow.payer && (
                  <div className="flex justify-between">
                    <dt className="text-gray-400">Payer</dt>
                    <dd className="text-gray-700">{workflow.payer.name}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-gray-400">Priority</dt>
                  <dd className={clsx('font-medium', priorityConfig.color)}>
                    {priorityConfig.label}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Created</dt>
                  <dd className="text-gray-700 text-xs">
                    {new Date(workflow.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Approval History */}
            {workflow.approvals && workflow.approvals.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
                  Approval History
                </h2>
                <div className="space-y-2">
                  {workflow.approvals.map((a) => {
                    const aCtx = (a.context ?? {}) as Record<string, unknown>;
                    return (
                      <div
                        key={a.id}
                        className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
                      >
                        <div>
                          <p className="text-sm text-gray-900">
                            {humanizeApprovalTitle(a.type, aCtx)}
                          </p>
                          <p className="text-xs text-gray-400">
                            {formatRelativeTime(a.requestedAt)}
                          </p>
                        </div>
                        <StatusBadge
                          label={a.status}
                          variant={
                            a.status === 'approved'
                              ? 'success'
                              : a.status === 'denied'
                                ? 'danger'
                                : 'warning'
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
