import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeftIcon,
  SparklesIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ChevronDownIcon,
  ArrowDownTrayIcon,
  PauseIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import PageTransition from '../../components/ui/PageTransition';
import {
  useWorkflowDetail,
  useWorkflowEvents,
  useCancelWorkflow,
  isNarrationEvent,
} from '../../hooks/useAgentWorkflows';
import { useWorkflowSocket } from '../../hooks/useAgentSocket';
import type {
  WorkflowStatus,
  TaskStatus,
  AgentTask,
  AgentEvent,
  NarrationEventData,
} from '../../hooks/useAgentWorkflows';

const TERMINAL_STATUSES: WorkflowStatus[] = ['completed', 'failed', 'cancelled'];

function goalLabel(goal: string): string {
  if (goal === 'populate_forms') return 'Auto-fill enrollment forms';
  if (goal === 'submit_to_availity_demo') return 'Submit to Availity (Demo)';
  return goal;
}

function formatDuration(startDate: string | null, endDate: string | null): string {
  if (!startDate) return '';
  const start = new Date(startDate).getTime();
  const end = endDate ? new Date(endDate).getTime() : Date.now();
  const diffMs = end - start;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTaskError(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    try { return JSON.stringify(err); } catch { return String(err); }
  }
  return String(err);
}

const STATUS_STYLES: Record<WorkflowStatus, { bg: string; text: string; icon: typeof ClockIcon; border: string }> = {
  planning: { bg: 'bg-amber-100', text: 'text-amber-700', icon: ClockIcon, border: 'border-l-amber-400' },
  active: { bg: 'bg-blue-100', text: 'text-blue-700', icon: SparklesIcon, border: 'border-l-blue-400' },
  waiting_approval: { bg: 'bg-amber-100', text: 'text-amber-700', icon: ClockIcon, border: 'border-l-amber-400' },
  paused: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: PauseIcon, border: 'border-l-yellow-400' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircleIcon, border: 'border-l-green-400' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircleIcon, border: 'border-l-red-400' },
  cancelled: { bg: 'bg-gray-100', text: 'text-gray-600', icon: XCircleIcon, border: 'border-l-gray-400' },
};

function StatusPill({ status }: { status: WorkflowStatus }) {
  const cfg = STATUS_STYLES[status];
  const Icon = cfg.icon;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium', cfg.bg, cfg.text)}>
      <Icon className={clsx('h-3.5 w-3.5', status === 'active' && 'animate-spin')} />
      {status.replace('_', ' ')}
    </span>
  );
}

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const styles: Record<TaskStatus, string> = {
    pending: 'bg-gray-100 text-gray-600',
    active: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    skipped: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function NarrationTimeline({ events }: { events: AgentEvent[] }) {
  const narrations = events.filter(isNarrationEvent);
  if (narrations.length === 0) return null;
  const sorted = [...narrations].sort((a, b) => {
    const aStep = (a.data as NarrationEventData).step ?? Number.POSITIVE_INFINITY;
    const bStep = (b.data as NarrationEventData).step ?? Number.POSITIVE_INFINITY;
    if (aStep !== bStep) return aStep - bStep;
    const aTs = new Date(a.timestamp || a.createdAt).getTime();
    const bTs = new Date(b.timestamp || b.createdAt).getTime();
    return aTs - bTs;
  });

  return (
    <div className="space-y-3 bg-gradient-to-b from-primary-50/40 to-transparent px-6 py-4 rounded-lg border border-primary-100">
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <SparklesIcon className="h-4 w-4 text-primary-500" />
        Live narration
      </h3>
      {sorted.map((event) => {
        const data = event.data as NarrationEventData;
        return (
          <div key={event.id} className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5">
              <div className="h-7 w-7 rounded-full bg-primary-100 flex items-center justify-center ring-2 ring-white">
                <SparklesIcon className="h-4 w-4 text-primary-600" />
              </div>
            </div>
            <div className="flex-1 max-w-[92%]">
              <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2.5 border border-gray-200 shadow-sm">
                <p className="text-sm text-gray-800 whitespace-pre-line leading-relaxed">{data.message}</p>
                {data.downloadUrl && (
                  <a
                    href={data.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white text-xs font-medium rounded-md hover:bg-primary-700 transition-colors"
                  >
                    <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                    Download artifact
                  </a>
                )}
              </div>
              <div className="text-[10px] text-gray-400 mt-1 ml-1 font-mono">
                {formatTimestamp(event.timestamp || event.createdAt)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskTimeline({ tasks }: { tasks: AgentTask[] }) {
  if (!tasks || tasks.length === 0) return null;
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 uppercase tracking-wider">
        Tasks ({tasks.length})
      </div>
      <ul className="divide-y divide-gray-100">
        {tasks.map((task) => (
          <li key={task.id} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900">{task.agentType}</span>
              <TaskStatusBadge status={task.status} />
              {task.startedAt && (
                <span className="text-xs text-gray-400 ml-auto">
                  {formatDuration(task.startedAt, task.completedAt)}
                </span>
              )}
            </div>
            {task.error && (
              <p className="text-xs text-red-600 mt-0.5">{formatTaskError(task.error)}</p>
            )}
            {task.output && (
              <details className="mt-1">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">Output</summary>
                <pre className="mt-1 p-2 bg-gray-50 rounded text-[10px] text-gray-600 overflow-x-auto">
                  {JSON.stringify(task.output, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ExceptionAnalysis {
  category?: string;
  severity?: 'low' | 'medium' | 'high';
  rootCause?: string;
  autoRemediable?: boolean;
  steps?: Array<{ action: string; description: string }>;
}

function ExceptionPanel({ events }: { events: AgentEvent[] }) {
  // Find the latest exception:analyzed event with full analysis context
  const exceptionEvents = events.filter((e) => e.action === 'exception_analyzed' || e.agent === 'exception');
  if (exceptionEvents.length === 0) return null;
  const latest = exceptionEvents[exceptionEvents.length - 1];
  const data = (latest.data ?? {}) as Record<string, unknown>;
  // exception agent writes summary fields directly + full analysis lives on
  // the failed AgentTask.output. We surface what we have at event level:
  const analysis: ExceptionAnalysis = {
    category: typeof data['category'] === 'string' ? data['category'] : undefined,
    severity: typeof data['severity'] === 'string' ? (data['severity'] as 'low' | 'medium' | 'high') : undefined,
    rootCause: typeof data['rootCause'] === 'string' ? data['rootCause'] : undefined,
    autoRemediable: typeof data['autoRemediable'] === 'boolean' ? data['autoRemediable'] : undefined,
  };

  if (!analysis.category && !analysis.rootCause) return null;

  const severityStyle =
    analysis.severity === 'high' ? 'bg-red-50 border-red-300 text-red-700'
    : analysis.severity === 'medium' ? 'bg-amber-50 border-amber-300 text-amber-700'
    : 'bg-yellow-50 border-yellow-200 text-yellow-700';

  return (
    <div className={clsx('rounded-lg border-l-4 p-4', severityStyle)}>
      <div className="flex items-start gap-3">
        <ExclamationTriangleIcon className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">Exception analyzed</h3>
            {analysis.category && (
              <span className="text-xs px-2 py-0.5 bg-white/60 rounded font-mono">{analysis.category}</span>
            )}
            {analysis.severity && (
              <span className="text-xs px-2 py-0.5 bg-white/60 rounded uppercase tracking-wider">{analysis.severity}</span>
            )}
            {analysis.autoRemediable !== undefined && (
              <span className="text-xs px-2 py-0.5 bg-white/60 rounded">
                {analysis.autoRemediable ? 'Auto-remediable' : 'Needs human review'}
              </span>
            )}
          </div>
          {analysis.rootCause && (
            <p className="text-sm mt-2 text-gray-800 whitespace-pre-line">{analysis.rootCause}</p>
          )}
          <p className="text-[10px] text-gray-500 mt-2 font-mono">
            {formatTimestamp(latest.timestamp || latest.createdAt)}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Action names that count as "important" — surfaced by default in the event
 * log so most users see the high-signal stream without 100+ HTTP-poll noise. */
const IMPORTANT_EVENT_ACTIONS = new Set([
  'workflow_created',
  'task_dispatched',
  'task_completed',
  'task_failed',
  'task_callback_enqueued',
  'narration',
  'kb_search',
  'exception_analyzed',
  'approval_requested',
  'approval_decided',
  'approval_auto_denied',
  'orchestrator_turn_complete',
  'replan_limit_reached',
  'token_budget_exceeded',
  'monitor_stalled',
  'portal_submission_completed',
  'portal_job_failed',
]);

function isImportantEvent(event: AgentEvent): boolean {
  if (event.level === 'error' || event.level === 'warn') return true;
  return IMPORTANT_EVENT_ACTIONS.has(event.action);
}

function EventLog({ events }: { events: AgentEvent[] }) {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  if (events.length === 0) return null;

  const importantEvents = events.filter(isImportantEvent);
  const displayed = showAll ? events : importantEvents;
  const hiddenCount = events.length - importantEvents.length;

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200 hover:bg-gray-100 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
          Event log ({displayed.length}{hiddenCount > 0 && !showAll ? ` of ${events.length}` : ''})
        </span>
        <ChevronDownIcon className={clsx('h-4 w-4 text-gray-500 transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <>
          {hiddenCount > 0 && (
            <div className="px-4 py-2 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
              <span className="text-[11px] text-gray-500">
                {showAll
                  ? `Showing all ${events.length} events`
                  : `Hiding ${hiddenCount} routine event${hiddenCount === 1 ? '' : 's'} (HTTP polls, low-signal logs)`}
              </span>
              <button
                type="button"
                onClick={() => setShowAll(!showAll)}
                className="text-[11px] font-medium text-primary-600 hover:text-primary-700"
              >
                {showAll ? 'Show only important' : 'Show all events'}
              </button>
            </div>
          )}
          <div className="max-h-96 overflow-y-auto divide-y divide-gray-100">
            {displayed.map((event) => {
              const ts = event.timestamp || event.createdAt;
              const narrationMessage =
                event.action === 'narration' && typeof (event.data as { message?: unknown })?.message === 'string'
                  ? ((event.data as { message: string }).message)
                  : null;
              return (
                <div key={event.id} className="px-3 py-2 text-xs flex items-start gap-2">
                  <span className="text-gray-400 shrink-0 font-mono w-20">{formatTimestamp(ts)}</span>
                  <span className={clsx(
                    'shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium',
                    event.level === 'error' ? 'bg-red-100 text-red-700'
                    : event.level === 'warn' ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-600',
                  )}>
                    {event.level}
                  </span>
                  {event.agent && <span className="text-gray-500 shrink-0">[{event.agent}]</span>}
                  <span className="text-gray-700">
                    {event.action}
                    {narrationMessage ? ` — ${narrationMessage}` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

type DetailTab = 'overview' | 'tasks' | 'events';

export default function WorkflowDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: detail, isLoading, error } = useWorkflowDetail(id ?? null);
  const { data: events = [] } = useWorkflowEvents(id ?? null, detail?.status);
  const cancelWorkflow = useCancelWorkflow();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');

  // Live updates while running
  useWorkflowSocket(id ?? null);

  if (!id) return null;

  if (isLoading) {
    return (
      <PageTransition>
        <div className="animate-pulse">
          <div className="h-8 w-1/3 bg-gray-200 rounded mb-4" />
          <div className="h-32 w-full bg-gray-100 rounded" />
        </div>
      </PageTransition>
    );
  }

  if (error || !detail) {
    return (
      <PageTransition>
        <div>
          <Link to="/admin/workflows" className="text-sm text-primary-600 hover:text-primary-700 inline-flex items-center gap-1 mb-4">
            <ArrowLeftIcon className="h-4 w-4" /> Back to workflows
          </Link>
          <div className="card card-body text-center py-10">
            <XCircleIcon className="mx-auto h-10 w-10 text-red-400" />
            <p className="mt-2 text-sm font-medium text-gray-700">Workflow not found</p>
            <p className="text-xs text-gray-500">It may have been deleted or you don't have access.</p>
          </div>
        </div>
      </PageTransition>
    );
  }

  const providerName = detail.provider ? `${detail.provider.firstName} ${detail.provider.lastName}`.trim() : '—';
  const payerName = detail.payer?.name ?? '—';
  const isTerminal = TERMINAL_STATUSES.includes(detail.status);
  const isCancellable = !isTerminal;

  return (
    <PageTransition>
      <div className="space-y-4">
        <Link to="/admin/workflows" className="text-sm text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">
          <ArrowLeftIcon className="h-4 w-4" /> Back to workflows
        </Link>

        {/* Header */}
        <div className={clsx('card card-body border-l-4', STATUS_STYLES[detail.status].border)}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-gray-900 mb-1">{goalLabel(detail.goal)}</h1>
              <p className="text-sm text-gray-600">
                <span className="font-medium">{providerName}</span>
                <span className="text-gray-400 mx-1.5">·</span>
                <span>{payerName}</span>
              </p>
              <p className="text-xs text-gray-400 font-mono mt-1">{detail.id}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusPill status={detail.status} />
              {isCancellable && (
                showCancelConfirm ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => cancelWorkflow.mutate(detail.id, { onSuccess: () => setShowCancelConfirm(false) })}
                      disabled={cancelWorkflow.isPending}
                      className="px-2 py-1 text-xs font-medium text-red-700 bg-red-50 rounded hover:bg-red-100"
                    >
                      {cancelWorkflow.isPending ? 'Cancelling…' : 'Confirm cancel'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCancelConfirm(false)}
                      className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-50 rounded hover:bg-gray-100"
                    >
                      Keep running
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(true)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Cancel workflow
                  </button>
                )
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-100">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Created</dt>
              <dd className="text-sm text-gray-900 mt-0.5">{new Date(detail.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Completed</dt>
              <dd className="text-sm text-gray-900 mt-0.5">
                {detail.completedAt ? new Date(detail.completedAt).toLocaleString() : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Tasks</dt>
              <dd className="text-sm text-gray-900 mt-0.5">{detail.tasks.length}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Approvals</dt>
              <dd className="text-sm text-gray-900 mt-0.5">{detail.approvals.length}</dd>
            </div>
          </dl>

          {detail.enrollmentId && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <Link
                to={`/enrollments/${detail.enrollmentId}`}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium"
              >
                Open enrollment →
              </Link>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex gap-6" aria-label="Workflow sections">
            {([
              { key: 'overview' as const, label: 'Overview' },
              { key: 'tasks' as const, label: `Tasks (${detail.tasks.length})` },
              { key: 'events' as const, label: `Events (${events.length})` },
            ]).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={clsx(
                  'whitespace-nowrap border-b-2 py-2 px-1 text-sm font-medium transition-colors',
                  activeTab === tab.key
                    ? 'border-primary-500 text-primary-700'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Pending approvals — surface at top of overview since it's the action item */}
            {detail.approvals.some((a) => a.status === 'pending') && (
              <div className="card card-body bg-amber-50 border border-amber-200">
                <div className="flex items-center gap-2">
                  <ExclamationTriangleIcon className="h-5 w-5 text-amber-600" />
                  <p className="text-sm font-medium text-amber-900">
                    This workflow is waiting on human approval.
                  </p>
                </div>
                <Link to="/workflow-queue" className="mt-2 inline-block text-xs font-medium text-amber-700 hover:text-amber-900">
                  Decide in the Workflow Queue →
                </Link>
              </div>
            )}

            {/* Exception analysis (Gap E) */}
            <ExceptionPanel events={events} />

            {/* Live narration */}
            {events.length > 0 && events.some(isNarrationEvent) ? (
              <NarrationTimeline events={events} />
            ) : (
              <div className="card card-body text-center py-8 text-sm text-gray-500">
                No agent narration yet. Narration appears here as the agent reports progress.
              </div>
            )}
          </div>
        )}

        {activeTab === 'tasks' && (
          <div>
            {detail.tasks.length === 0 ? (
              <div className="card card-body text-center py-8 text-sm text-gray-500">
                No tasks dispatched yet.
              </div>
            ) : (
              <TaskTimeline tasks={detail.tasks} />
            )}
          </div>
        )}

        {activeTab === 'events' && <EventLog events={events} />}
      </div>
    </PageTransition>
  );
}
