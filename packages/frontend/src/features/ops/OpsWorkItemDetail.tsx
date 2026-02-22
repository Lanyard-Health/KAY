import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowLeftIcon,
  UserCircleIcon,
  BuildingOfficeIcon,
  ClockIcon,
  CalendarDaysIcon,
  LinkIcon,
  PaperAirplaneIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useQueryClient } from '@tanstack/react-query';
import {
  useOpsWorkItem,
  useUpdateWorkItemStatus,
  useAssignWorkItem,
  useAddComment,
  useOpsStaff,
  OpsComment,
} from '../../hooks/useOps';
import { api } from '../../services/api';

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

const CATEGORY_BADGE = 'bg-primary-50 text-primary-700';

const SLA_DOT: Record<string, string> = {
  on_track: 'bg-green-500',
  at_risk: 'bg-amber-500',
  breached: 'bg-red-500',
};

type StatusTransition = {
  label: string;
  targetStatus: string;
  variant: 'primary' | 'secondary' | 'warning';
};

const STATUS_TRANSITIONS: Record<string, StatusTransition[]> = {
  backlog: [
    { label: 'Move to To Do', targetStatus: 'todo', variant: 'secondary' },
  ],
  todo: [
    { label: 'Start', targetStatus: 'in_progress', variant: 'primary' },
  ],
  in_progress: [
    { label: 'Submit for Review', targetStatus: 'review', variant: 'primary' },
    { label: 'Mark Waiting', targetStatus: 'waiting_external', variant: 'warning' },
  ],
  waiting_external: [
    { label: 'Resume Work', targetStatus: 'in_progress', variant: 'primary' },
  ],
  review: [
    { label: 'Complete', targetStatus: 'done', variant: 'primary' },
    { label: 'Return to In Progress', targetStatus: 'in_progress', variant: 'secondary' },
  ],
};

const TRANSITION_BUTTON_STYLES: Record<string, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700',
  secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50',
  warning: 'bg-amber-500 text-white hover:bg-amber-600',
};

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

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function OpsWorkItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: item, isLoading, isError, error } = useOpsWorkItem(id!);
  const { data: staff } = useOpsStaff();
  const updateStatus = useUpdateWorkItemStatus();
  const assignItem = useAssignWorkItem();
  const addComment = useAddComment();

  const [blockerNotes, setBlockerNotes] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [reassigneeId, setReassigneeId] = useState('');

  // Initialize blocker notes from item data
  const currentBlockerNotes = blockerNotes ?? item?.blockerNotes ?? '';

  const handleStatusTransition = (targetStatus: string) => {
    if (!id) return;
    updateStatus.mutate({ id, status: targetStatus });
  };

  const handleAssign = (assigneeId: string) => {
    if (!id || !assigneeId) return;
    assignItem.mutate({ id, staffId: assigneeId });
    setReassigneeId('');
  };

  const handleAddComment = () => {
    if (!id || !commentText.trim()) return;
    addComment.mutate(
      { workItemId: id, content: commentText.trim() },
      { onSuccess: () => setCommentText('') },
    );
  };

  const queryClient = useQueryClient();

  const handleBlockerBlur = async () => {
    if (!id || blockerNotes === null) return;
    await api.patch(`/ops/work-items/${id}`, { blockerNotes });
    queryClient.invalidateQueries({ queryKey: ['ops-work-item', id] });
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 rounded bg-gray-200" />
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-8 space-y-4">
            <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
              <div className="h-4 w-full rounded bg-gray-200 mb-3" />
              <div className="h-4 w-3/4 rounded bg-gray-200 mb-3" />
              <div className="h-4 w-1/2 rounded bg-gray-200" />
            </div>
            <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
              <div className="h-4 w-32 rounded bg-gray-200 mb-4" />
              <div className="h-20 w-full rounded bg-gray-200" />
            </div>
          </div>
          <div className="col-span-4">
            <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}>
                  <div className="h-3 w-20 rounded bg-gray-200 mb-2" />
                  <div className="h-4 w-32 rounded bg-gray-200" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
        <ExclamationTriangleIcon className="mx-auto h-10 w-10 text-red-400" />
        <p className="mt-3 text-sm font-medium text-red-800">
          Failed to load work item{error instanceof Error ? `: ${error.message}` : '.'}
        </p>
        <button
          onClick={() => navigate('/ops/work-queue')}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-red-600 hover:text-red-800 transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Work Queue
        </button>
      </div>
    );
  }

  // 404 state
  if (!item) {
    return (
      <div className="rounded-2xl border border-gray-200/60 bg-white p-8 text-center shadow-sm">
        <ClockIcon className="mx-auto h-10 w-10 text-gray-300" />
        <p className="mt-3 text-sm font-medium text-gray-900">Work item not found</p>
        <p className="mt-1 text-sm text-gray-500">The item may have been deleted or the ID is invalid.</p>
        <button
          onClick={() => navigate('/ops/work-queue')}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-800 transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Work Queue
        </button>
      </div>
    );
  }

  const transitions = STATUS_TRANSITIONS[item.status] ?? [];
  const comments: OpsComment[] = item.comments ?? [];

  // Compute SLA status from slaDeadline
  const slaStatus: string | null = (() => {
    if (!item.slaDeadline) return null;
    const now = Date.now();
    const deadline = new Date(item.slaDeadline).getTime();
    if (deadline < now) return 'breached';
    const created = new Date(item.createdAt).getTime();
    const totalDuration = deadline - created;
    const elapsed = now - created;
    if (totalDuration > 0 && elapsed / totalDuration > 0.75) return 'at_risk';
    return 'on_track';
  })();

  return (
    <div className="space-y-6">
      {/* Back link + Header */}
      <div>
        <button
          onClick={() => navigate('/ops/work-queue')}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-4"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Work Queue
        </button>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{item.title}</h1>
          <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_BADGE[item.status] ?? 'bg-gray-100 text-gray-700')}>
            {formatLabel(item.status)}
          </span>
          <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', PRIORITY_BADGE[item.priority] ?? 'bg-gray-100 text-gray-600')}>
            {formatLabel(item.priority)}
          </span>
          {item.category && (
            <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', CATEGORY_BADGE)}>
              {formatLabel(item.category)}
            </span>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left column */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          {/* Description */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Description</h2>
            {item.description ? (
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{item.description}</p>
            ) : (
              <p className="text-sm text-gray-400 italic">No description provided.</p>
            )}
          </div>

          {/* Blocker Notes */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Blocker Notes</h2>
            <textarea
              value={currentBlockerNotes}
              onChange={(e) => setBlockerNotes(e.target.value)}
              onBlur={handleBlockerBlur}
              placeholder="Add any blocking issues or dependencies..."
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none resize-none placeholder:text-gray-400"
            />
          </div>

          {/* Status Transitions */}
          {transitions.length > 0 && (
            <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Actions</h2>
              <div className="flex flex-wrap gap-3">
                {transitions.map((t) => (
                  <button
                    key={t.targetStatus}
                    onClick={() => handleStatusTransition(t.targetStatus)}
                    disabled={updateStatus.isPending}
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors disabled:opacity-50',
                      TRANSITION_BUTTON_STYLES[t.variant],
                    )}
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">
              Comments {comments.length > 0 && <span className="text-gray-400 font-normal">({comments.length})</span>}
            </h2>

            {comments.length === 0 ? (
              <p className="text-sm text-gray-400 italic mb-4">No comments yet.</p>
            ) : (
              <div className="space-y-4 mb-6">
                {comments.map((comment) => (
                  <div key={comment.id} className="border-l-2 border-gray-200 pl-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-900">{`${comment.author.firstName} ${comment.author.lastName}`}</span>
                      <span className="text-xs text-gray-400">{formatTimestamp(comment.createdAt)}</span>
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{comment.content}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Add comment form */}
            <div className="flex gap-3">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a comment..."
                rows={2}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none resize-none placeholder:text-gray-400"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddComment();
                }}
              />
              <button
                onClick={handleAddComment}
                disabled={addComment.isPending || !commentText.trim()}
                className="self-end inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                <PaperAirplaneIcon className="h-4 w-4" />
                {addComment.isPending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="col-span-12 lg:col-span-4">
          <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm space-y-5 sticky top-6">
            {/* Assigned to */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Assigned to</p>
              <div className="flex items-center gap-2 mb-2">
                <UserCircleIcon className="h-5 w-5 text-gray-400" />
                <span className="text-sm font-medium text-gray-900">
                  {item.assignedTo ? `${item.assignedTo.firstName} ${item.assignedTo.lastName}` : <span className="text-gray-400 italic">Unassigned</span>}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={reassigneeId}
                  onChange={(e) => {
                    setReassigneeId(e.target.value);
                    if (e.target.value) handleAssign(e.target.value);
                  }}
                  className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
                >
                  <option value="">Reassign...</option>
                  {(staff ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{`${s.firstName} ${s.lastName}`}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Practice */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Practice</p>
              {item.practiceId ? (
                <Link
                  to={`/ops/practices/${item.practiceId}`}
                  className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-800 font-medium transition-colors"
                >
                  <BuildingOfficeIcon className="h-4 w-4" />
                  {item.practice?.name ?? 'View Practice'}
                </Link>
              ) : (
                <span className="text-sm text-gray-400">--</span>
              )}
            </div>

            {/* Provider */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Provider</p>
              {item.providerId ? (
                <Link
                  to={`/providers/${item.providerId}`}
                  className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-800 font-medium transition-colors"
                >
                  <UserCircleIcon className="h-4 w-4" />
                  {item.provider ? `${item.provider.firstName} ${item.provider.lastName}` : 'View Provider'}
                </Link>
              ) : (
                <span className="text-sm text-gray-400">--</span>
              )}
            </div>

            {/* Enrollment */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Enrollment</p>
              {item.enrollmentId ? (
                <Link
                  to={`/enrollments/${item.enrollmentId}`}
                  className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-800 font-medium transition-colors"
                >
                  <LinkIcon className="h-4 w-4" />
                  View Enrollment
                </Link>
              ) : (
                <span className="text-sm text-gray-400">Not linked</span>
              )}
            </div>

            {/* Due Date */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Due Date</p>
              <div className="flex items-center gap-1.5">
                <CalendarDaysIcon className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-700">{formatDate(item.dueDate)}</span>
              </div>
            </div>

            {/* SLA Deadline */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">SLA Deadline</p>
              <div className="flex items-center gap-2">
                {slaStatus && (
                  <span className={clsx('h-2.5 w-2.5 rounded-full', SLA_DOT[slaStatus] ?? 'bg-gray-400')} />
                )}
                <span className="text-sm text-gray-700">{formatDate(item.slaDeadline)}</span>
                {slaStatus && (
                  <span className="text-xs text-gray-500">({formatLabel(slaStatus)})</span>
                )}
              </div>
            </div>

            {/* Time tracking */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Time</p>
              <div className="flex items-center gap-1.5">
                <ClockIcon className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-700">
                  {item.actualMinutes ?? 0}m
                  {item.estimatedMinutes != null && (
                    <span className="text-gray-400"> / {item.estimatedMinutes}m est.</span>
                  )}
                </span>
              </div>
              {item.estimatedMinutes != null && item.estimatedMinutes > 0 && (
                <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-full transition-all',
                      (item.actualMinutes ?? 0) > item.estimatedMinutes
                        ? 'bg-red-400'
                        : 'bg-primary-400',
                    )}
                    style={{
                      width: `${Math.min(100, ((item.actualMinutes ?? 0) / item.estimatedMinutes) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
