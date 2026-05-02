import { useState, useEffect } from 'react';
import {
  SparklesIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
  ChevronDownIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import {
  useWorkflowsForEnrollment,
  useWorkflowDetail,
  useWorkflowEvents,
  useLaunchWorkflow,
  useCancelWorkflow,
  isUuid,
  isNarrationEvent,
} from '../../hooks/useAgentWorkflows';
import { useDecideApproval } from '../../hooks/useApprovals';
import { useWorkflowSocket } from '../../hooks/useAgentSocket';
import type {
  WorkflowStatus,
  TaskStatus,
  AgentTask,
  AgentEvent,
  WorkflowListItem,
  NarrationEventData,
} from '../../hooks/useAgentWorkflows';

interface AgentWorkflowPanelProps {
  enrollmentId: string;
  providerId: string;
  payerId?: string;
  providerName: string;
  payerName: string;
}

const AGENT_TYPE_LABELS: Record<string, string> = {
  form_filler: 'Form Filling',
  document_gatherer: 'Document Gathering',
  status_checker: 'Status Check',
  follow_up: 'Follow-up',
  data_entry: 'Data Entry',
  verification: 'Verification',
  submission: 'Submission',
  research: 'Research',
};

const TERMINAL_STATUSES: WorkflowStatus[] = ['completed', 'failed', 'cancelled'];

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

function goalLabel(goal: string): string {
  if (goal === 'populate_forms') return 'Auto-fill enrollment forms';
  return goal;
}

function NarrationTimeline({ events }: { events: AgentEvent[] }) {
  const narrations = events.filter(isNarrationEvent);
  if (narrations.length === 0) return null;

  // Order by step (when present), falling back to timestamp/createdAt.
  const sorted = [...narrations].sort((a, b) => {
    const aStep = (a.data as NarrationEventData).step ?? Number.POSITIVE_INFINITY;
    const bStep = (b.data as NarrationEventData).step ?? Number.POSITIVE_INFINITY;
    if (aStep !== bStep) return aStep - bStep;
    const aTs = new Date(a.timestamp || a.createdAt).getTime();
    const bTs = new Date(b.timestamp || b.createdAt).getTime();
    return aTs - bTs;
  });

  return (
    <div className="px-6 py-4 space-y-3 bg-gradient-to-b from-primary-50/40 to-transparent">
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
                <p className="text-sm text-gray-800 whitespace-pre-line leading-relaxed">
                  {data.message}
                </p>
                {data.downloadUrl && (
                  <a
                    href={data.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white text-xs font-medium rounded-md hover:bg-primary-700 transition-colors"
                  >
                    <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                    Download filled PDF
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

function StatusDot({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircleIcon className="h-5 w-5 text-green-500 shrink-0" />;
    case 'active':
      return <ArrowPathIcon className="h-5 w-5 text-blue-500 animate-spin shrink-0" />;
    case 'failed':
      return <XCircleIcon className="h-5 w-5 text-red-500 shrink-0" />;
    case 'skipped':
      return <XMarkIcon className="h-5 w-5 text-gray-400 shrink-0" />;
    default:
      return <ClockIcon className="h-5 w-5 text-gray-300 shrink-0" />;
  }
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

function LevelBadge({ level }: { level: AgentEvent['level'] }) {
  const styles = {
    info: 'bg-gray-100 text-gray-600',
    warn: 'bg-amber-100 text-amber-700',
    error: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${styles[level]}`}>
      {level}
    </span>
  );
}

function WorkflowStatusBadge({ status }: { status: WorkflowStatus }) {
  const styles: Record<WorkflowStatus, string> = {
    planning: 'bg-amber-100 text-amber-700',
    active: 'bg-blue-100 text-blue-700',
    paused: 'bg-yellow-100 text-yellow-800',
    waiting_approval: 'bg-amber-100 text-amber-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

export default function AgentWorkflowPanel({
  enrollmentId,
  providerId,
  payerId,
  providerName,
  payerName,
}: AgentWorkflowPanelProps) {
  const validProvider = isUuid(providerId);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showEvents, setShowEvents] = useState(false);

  const { data: workflows } = useWorkflowsForEnrollment(providerId, enrollmentId);
  const { data: detail } = useWorkflowDetail(selectedWorkflowId);
  const { data: events } = useWorkflowEvents(selectedWorkflowId, detail?.status);
  const launchWorkflow = useLaunchWorkflow();
  const cancelWorkflow = useCancelWorkflow();
  const decideApproval = useDecideApproval();

  // WebSocket for real-time updates
  useWorkflowSocket(selectedWorkflowId);

  // Auto-select most recent active workflow on mount
  useEffect(() => {
    if (!workflows || selectedWorkflowId) return;
    const active = workflows.find((w) => !TERMINAL_STATUSES.includes(w.status));
    if (active) {
      setSelectedWorkflowId(active.id);
    } else if (workflows.length > 0) {
      setSelectedWorkflowId(workflows[0].id);
    }
  }, [workflows, selectedWorkflowId]);

  const handleLaunch = () => {
    // Use the scripted populate_forms goal so the agent runs the
    // narrate→populate→narrate flow defined in the orchestrator system prompt.
    // The friendly label "Auto-fill enrollment forms" is rendered via goalLabel().
    launchWorkflow.mutateAsync({
      goal: 'populate_forms',
      providerId,
      payerId,
      enrollmentId,
    }).then((response) => {
      setSelectedWorkflowId(response.data.id);
    });
  };

  const handleCancel = () => {
    if (!selectedWorkflowId) return;
    cancelWorkflow.mutate(selectedWorkflowId, {
      onSuccess: () => setShowCancelConfirm(false),
    });
  };

  const handleApproval = (approvalId: string, decision: 'approved' | 'denied') => {
    decideApproval.mutate({ id: approvalId, decision });
  };

  const borderColor = (status?: WorkflowStatus) => {
    switch (status) {
      case 'planning':
      case 'waiting_approval':
        return 'border-l-amber-400';
      case 'active':
        return 'border-l-blue-400';
      case 'completed':
        return 'border-l-green-400';
      case 'failed':
        return 'border-l-red-400';
      case 'cancelled':
        return 'border-l-gray-400';
      default:
        return 'border-l-gray-200';
    }
  };

  // Backend requires UUID provider IDs — hide panel for seed/non-UUID providers
  if (!validProvider) return null;

  // No workflows yet — show CTA
  if (!workflows || workflows.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-6 py-8 text-center">
          <SparklesIcon className="h-10 w-10 text-primary-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">AI Agent Workflow</h3>
          <p className="text-sm text-gray-500 mb-4 max-w-md mx-auto">
            Launch an AI agent to auto-fill the enrollment form for{' '}
            <span className="font-medium">{providerName}</span> with{' '}
            <span className="font-medium">{payerName}</span>. The agent narrates each step and produces a downloadable filled PDF.
          </p>
          <button
            onClick={handleLaunch}
            disabled={launchWorkflow.isPending}
            className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
          >
            <SparklesIcon className="h-5 w-5 mr-2" />
            {launchWorkflow.isPending ? 'Launching...' : 'Launch Agent'}
          </button>
        </div>
      </div>
    );
  }

  const pendingApproval = detail?.approvals?.find((a) => a.status === 'pending');

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <SparklesIcon className="h-5 w-5 text-primary-500" />
          AI Agent Workflow
        </h2>
        <div className="flex items-center gap-2">
          {detail && TERMINAL_STATUSES.includes(detail.status) && (
            <button
              onClick={handleLaunch}
              disabled={launchWorkflow.isPending}
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50"
            >
              <SparklesIcon className="h-4 w-4 mr-1.5" />
              {launchWorkflow.isPending ? 'Launching...' : 'Run Again'}
            </button>
          )}
          {detail && !TERMINAL_STATUSES.includes(detail.status) && (
            <>
              {showCancelConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">Cancel workflow?</span>
                  <button
                    onClick={handleCancel}
                    disabled={cancelWorkflow.isPending}
                    className="px-2 py-1 text-xs font-medium text-red-700 bg-red-50 rounded hover:bg-red-100"
                  >
                    {cancelWorkflow.isPending ? 'Cancelling...' : 'Yes, cancel'}
                  </button>
                  <button
                    onClick={() => setShowCancelConfirm(false)}
                    className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  className="px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded"
                >
                  Cancel
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* History — show previous workflows if more than one */}
      {workflows.length > 1 && (
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500">History:</span>
            {workflows.map((w: WorkflowListItem) => (
              <button
                key={w.id}
                onClick={() => setSelectedWorkflowId(w.id)}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                  w.id === selectedWorkflowId
                    ? 'bg-primary-100 text-primary-700 font-medium'
                    : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                <WorkflowStatusBadge status={w.status} />
                <span>{new Date(w.createdAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main content — status-based rendering */}
      {detail && (
        <div className={`border-l-4 ${borderColor(detail.status)}`}>
          {/* AI narration timeline — primary content for populate_forms goal,
              also visible alongside task timelines for any workflow that emits
              narrate() events. */}
          {events && <NarrationTimeline events={events} />}

          {/* Planning */}
          {detail.status === 'planning' && (
            <div className="px-6 py-6">
              <div className="flex items-center gap-3 mb-2">
                <ArrowPathIcon className="h-5 w-5 text-amber-500 animate-spin" />
                <span className="text-sm font-medium text-amber-700">Analyzing requirements...</span>
              </div>
              <p className="text-sm text-gray-500">{goalLabel(detail.goal)}</p>
            </div>
          )}

          {/* Active — task timeline */}
          {detail.status === 'active' && (
            <div className="px-6 py-4">
              <div className="flex items-center gap-2 mb-4">
                <ArrowPathIcon className="h-4 w-4 text-blue-500 animate-spin" />
                <span className="text-sm font-medium text-blue-700">Agent working...</span>
              </div>
              <TaskTimeline tasks={detail.tasks} />
            </div>
          )}

          {/* Waiting approval */}
          {detail.status === 'waiting_approval' && pendingApproval && (
            <div className="px-6 py-4 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <ExclamationTriangleIcon className="h-5 w-5 text-amber-500" />
                <span className="text-sm font-medium text-amber-700">Approval Required</span>
              </div>
              <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
                <p className="text-sm text-gray-700 mb-1">
                  <span className="font-medium">Type:</span> {pendingApproval.type}
                </p>
                {pendingApproval.context && Object.keys(pendingApproval.context).length > 0 && (
                  <div className="text-sm text-gray-600 mb-3">
                    {Object.entries(pendingApproval.context).map(([key, val]) => (
                      <p key={key}>
                        <span className="font-medium">{key}:</span>{' '}
                        {typeof val === 'string' ? val : JSON.stringify(val)}
                      </p>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-500 mb-3">
                  Expires: {new Date(pendingApproval.expiresAt).toLocaleString()}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApproval(pendingApproval.id, 'approved')}
                    disabled={decideApproval.isPending}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleApproval(pendingApproval.id, 'denied')}
                    disabled={decideApproval.isPending}
                    className="px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 rounded hover:bg-red-100 disabled:opacity-50"
                  >
                    Deny
                  </button>
                </div>
              </div>
              <TaskTimeline tasks={detail.tasks} />
            </div>
          )}

          {/* Completed */}
          {detail.status === 'completed' && (
            <div className="px-6 py-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircleIcon className="h-5 w-5 text-green-500" />
                <span className="text-sm font-medium text-green-700">Workflow completed</span>
                {detail.startedAt && (
                  <span className="text-xs text-gray-400 ml-auto">
                    Duration: {formatDuration(detail.startedAt, detail.completedAt)}
                  </span>
                )}
              </div>
              <TaskTimeline tasks={detail.tasks} />
            </div>
          )}

          {/* Failed */}
          {detail.status === 'failed' && (
            <div className="px-6 py-4">
              <div className="flex items-center gap-2 mb-3">
                <XCircleIcon className="h-5 w-5 text-red-500" />
                <span className="text-sm font-medium text-red-700">Workflow failed</span>
              </div>
              {detail.error && (
                <div className="bg-red-50 rounded-lg p-3 border border-red-200 mb-3">
                  <p className="text-sm text-red-700">{detail.error}</p>
                </div>
              )}
              <button
                onClick={handleLaunch}
                disabled={launchWorkflow.isPending}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50 mb-3"
              >
                <ArrowPathIcon className="h-4 w-4 mr-1.5" />
                {launchWorkflow.isPending ? 'Launching...' : 'Retry'}
              </button>
              <TaskTimeline tasks={detail.tasks} />
            </div>
          )}

          {/* Cancelled */}
          {detail.status === 'cancelled' && (
            <div className="px-6 py-4">
              <div className="flex items-center gap-2 mb-3">
                <XMarkIcon className="h-5 w-5 text-gray-400" />
                <span className="text-sm font-medium text-gray-600">Workflow cancelled</span>
              </div>
              <button
                onClick={handleLaunch}
                disabled={launchWorkflow.isPending}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50"
              >
                <SparklesIcon className="h-4 w-4 mr-1.5" />
                {launchWorkflow.isPending ? 'Launching...' : 'Start New'}
              </button>
            </div>
          )}

          {/* Event log — collapsible */}
          {events && events.length > 0 && (
            <div className="px-6 pb-4">
              <button
                onClick={() => setShowEvents(!showEvents)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                <ChevronDownIcon
                  className={`h-3.5 w-3.5 transition-transform ${showEvents ? '' : '-rotate-90'}`}
                />
                Event Log ({events.length})
              </button>
              {showEvents && (
                <div className="mt-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {events.map((event: AgentEvent) => {
                    const ts = event.timestamp || event.createdAt;
                    const narrationMessage =
                      event.action === 'narration' &&
                      typeof (event.data as { message?: unknown })?.message === 'string'
                        ? ((event.data as { message: string }).message)
                        : null;
                    return (
                      <div key={event.id} className="px-3 py-2 text-xs flex items-start gap-2">
                        <span className="text-gray-400 shrink-0 font-mono">
                          {formatTimestamp(ts)}
                        </span>
                        <LevelBadge level={event.level} />
                        {event.agent && (
                          <span className="text-gray-500 shrink-0">[{event.agent}]</span>
                        )}
                        <span className="text-gray-700">
                          {event.action}
                          {narrationMessage ? ` — ${narrationMessage}` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskTimeline({ tasks }: { tasks: AgentTask[] }) {
  if (!tasks || tasks.length === 0) return null;

  return (
    <div className="space-y-0">
      {tasks.map((task, index) => (
        <div key={task.id} className="flex items-start gap-3 relative">
          {/* Vertical connector line */}
          {index < tasks.length - 1 && (
            <div className="absolute left-[9px] top-6 bottom-0 w-px bg-gray-200" />
          )}
          <div className="pt-0.5">
            <StatusDot status={task.status} />
          </div>
          <div className="flex-1 pb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900">
                {AGENT_TYPE_LABELS[task.agentType] || task.agentType}
              </span>
              <TaskStatusBadge status={task.status} />
              {task.startedAt && (
                <span className="text-xs text-gray-400 ml-auto">
                  {formatDuration(task.startedAt, task.completedAt)}
                </span>
              )}
            </div>
            {task.error && (
              <p className="text-xs text-red-600 mt-0.5">{task.error}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
