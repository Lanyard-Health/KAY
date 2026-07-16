import { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Link } from 'react-router-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useUpdateStaffTask, useDeleteTask, useAssignees, type StaffTask } from '../../hooks/useStaffTasks';
import { PRIORITY_STYLES, isOverdue, linkedRecordLabel, linkedRecordHref } from './TaskRow';
import { notify } from '../../utils/notify';

const PRIORITY_LABELS: Record<StaffTask['priority'], string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  NORMAL: 'Normal',
  LOW: 'Low',
};

const STATUS_OPTIONS: { value: StaffTask['status']; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'SKIPPED', label: 'Skipped' },
];

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface TaskDetailPanelProps {
  task: StaffTask | null;
  onClose: () => void;
}

// task may be null (panel closed). Rather than an early `if (!task) return
// null` — which would break the Headless UI leave animation — we keep
// `Transition.Root show={!!task}` driving the slide, and gate the panel's
// *content* on `task &&`. On close the content unmounts immediately while
// the (now empty) panel finishes sliding out; this is the simple, accepted
// tradeoff over tracking a `lastTask` ref just to keep stale content visible
// during the ~200ms leave transition.
export default function TaskDetailPanel({ task, onClose }: TaskDetailPanelProps) {
  const updateMutation = useUpdateStaffTask();
  const deleteMutation = useDeleteTask();
  const { data: assignees } = useAssignees();

  // Local mirror of the two editable fields. Selects read from this state,
  // not directly off `task` — `task` is a snapshot from the parent's list
  // state, and re-asserting it on every render (e.g. while isPending flips)
  // would snap a just-made selection back to the stale value. Re-seeded
  // whenever a *different* task opens (task.id changes) or fresh server
  // data replaces the prop object (TasksPage swaps `selectedTask` once the
  // list refetches) — both are covered by keying on the `task` object
  // identity itself.
  const [localStatus, setLocalStatus] = useState<StaffTask['status'] | undefined>(task?.status);
  const [localAssigneeId, setLocalAssigneeId] = useState<string>(task?.assignedTo?.id ?? '');

  useEffect(() => {
    setLocalStatus(task?.status);
    setLocalAssigneeId(task?.assignedTo?.id ?? '');
  }, [task]);

  const handleMutationError = (error: any) =>
    notify.error('Could not update the task', {
      description: error?.response?.data?.error?.message,
    });

  return (
    <Transition.Root show={!!task} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-hidden">
          <Transition.Child
            as={Fragment}
            enter="transform transition ease-in-out duration-300"
            enterFrom="translate-x-full"
            enterTo="translate-x-0"
            leave="transform transition ease-in-out duration-300"
            leaveFrom="translate-x-0"
            leaveTo="translate-x-full"
          >
            <Dialog.Panel className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-gray-200/60 bg-white shadow-xl">
              {task && (
                <>
                  <div className="flex items-start justify-between gap-3 border-b border-gray-200/60 px-5 py-4">
                    <Dialog.Title as="h2" className="break-words text-base font-semibold text-gray-900">
                      {task.title}
                    </Dialog.Title>
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label="Close details"
                      className="shrink-0 text-gray-400 hover:text-gray-500"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={clsx(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                          PRIORITY_STYLES[task.priority],
                        )}
                      >
                        {PRIORITY_LABELS[task.priority]}
                      </span>
                      {task.dueDate && (
                        <span className={clsx('text-xs tabular-nums', isOverdue(task) ? 'font-semibold text-red-600' : 'text-gray-500')}>
                          Due {formatDate(task.dueDate)}
                          {isOverdue(task) &&
                            ` · ${Math.ceil((Date.now() - new Date(task.dueDate).getTime()) / 86_400_000)} day${
                              Math.ceil((Date.now() - new Date(task.dueDate).getTime()) / 86_400_000) === 1 ? '' : 's'
                            } overdue`}
                        </span>
                      )}
                    </div>

                    <div>
                      <label htmlFor="task-detail-status" className="label">
                        Status
                      </label>
                      <select
                        id="task-detail-status"
                        value={localStatus}
                        onChange={(e) => {
                          const next = e.target.value as StaffTask['status'];
                          setLocalStatus(next);
                          updateMutation.mutate(
                            { taskId: task.id, data: { status: next } },
                            {
                              onError: (error) => {
                                setLocalStatus(task.status);
                                handleMutationError(error);
                              },
                            },
                          );
                        }}
                        className="input"
                      >
                        {STATUS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-500">
                        Set automatically when a task is claimed or assigned. Change it here any time.
                      </p>
                    </div>

                    <div>
                      <h3 className="label">Description</h3>
                      {task.description ? (
                        <p className="whitespace-pre-wrap text-sm text-gray-700">{task.description}</p>
                      ) : (
                        <p className="text-sm text-gray-400">No description</p>
                      )}
                    </div>

                    {linkedRecordLabel(task) && linkedRecordHref(task) && (
                      <div>
                        <h3 className="label">Linked record</h3>
                        <Link
                          to={linkedRecordHref(task) as string}
                          className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
                        >
                          {linkedRecordLabel(task)}
                        </Link>
                      </div>
                    )}

                    <div>
                      <label htmlFor="task-detail-assignee" className="label">
                        Assigned to
                      </label>
                      <select
                        id="task-detail-assignee"
                        value={localAssigneeId}
                        onChange={(e) => {
                          const next = e.target.value;
                          setLocalAssigneeId(next);
                          updateMutation.mutate(
                            { taskId: task.id, data: { assignedToId: next || null } },
                            {
                              onError: (error) => {
                                setLocalAssigneeId(task.assignedTo?.id ?? '');
                                handleMutationError(error);
                              },
                            },
                          );
                        }}
                        className="input"
                      >
                        {task.assignedTo && !(assignees ?? []).some((a) => a.id === task.assignedTo!.id) && (
                          <option value={task.assignedTo.id} disabled>
                            {task.assignedTo.firstName} {task.assignedTo.lastName} (unavailable)
                          </option>
                        )}
                        {(assignees ?? []).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.firstName} {a.lastName}
                          </option>
                        ))}
                        <option value="">Back to Task Pool</option>
                      </select>
                    </div>

                    <div>
                      <h3 className="label">Activity</h3>
                      <ul className="space-y-1 text-xs text-gray-500">
                        <li>
                          Created by {task.createdBy ? `${task.createdBy.firstName} ${task.createdBy.lastName}` : 'Unknown'} ·{' '}
                          {formatDate(task.createdAt)}
                        </li>
                        {task.completedAt && (
                          <li>
                            Completed by {task.completedBy ? `${task.completedBy.firstName} ${task.completedBy.lastName}` : 'Unknown'} ·{' '}
                            {formatDate(task.completedAt)}
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-gray-200/60 px-5 py-4">
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm("Delete this task? This can't be undone.")) return;
                        deleteMutation.mutate(task.id, {
                          onSuccess: () => {
                            notify.success('Task deleted');
                            onClose();
                          },
                          onError: handleMutationError,
                        });
                      }}
                      className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      Delete…
                    </button>
                    {localStatus !== 'COMPLETED' && (
                      <button
                        type="button"
                        onClick={() => {
                          setLocalStatus('COMPLETED');
                          updateMutation.mutate(
                            { taskId: task.id, data: { status: 'COMPLETED' } },
                            {
                              onError: (error) => {
                                setLocalStatus(task.status);
                                handleMutationError(error);
                              },
                            },
                          );
                        }}
                        className="btn-primary"
                      >
                        Mark complete
                      </button>
                    )}
                  </div>
                </>
              )}
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
