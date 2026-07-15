import { useEffect, useRef, useState } from 'react';
import { Tab } from '@headlessui/react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { PlusIcon } from '@heroicons/react/24/outline';
import { useStaffTasks, useClaimTask, useUpdateStaffTask, type StaffTask } from '../../hooks/useStaffTasks';
import { api } from '../../services/api';
import TaskRow from './TaskRow';
import EmptyState from '../../components/ui/EmptyState';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import { notify } from '../../utils/notify';

const VIEWS = [
  { key: 'my' as const, label: 'My Tasks' },
  { key: 'pool' as const, label: 'Task Pool' },
  { key: 'all' as const, label: 'All Tasks' },
];

export default function TasksPage() {
  const [tabIndex, setTabIndex] = useState(0);
  const [priority, setPriority] = useState('');
  const [practiceId, setPracticeId] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [limit, setLimit] = useState(50);
  const [selectedTask, setSelectedTask] = useState<StaffTask | null>(null);
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [justClaimed, setJustClaimed] = useState<StaffTask | null>(null);
  const claimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const view = VIEWS[tabIndex].key;
  const status = showCompleted ? 'all' : 'open';
  const { data, isLoading, isError, refetch } = useStaffTasks(
    view,
    { status, priority: priority || undefined, practiceId: practiceId || undefined },
    limit,
  );
  const { data: practices } = useQuery({
    queryKey: ['staff-tasks', 'practice-options'],
    queryFn: async () => (await api.get('/practices')).data.data as { id: string; name: string }[],
    staleTime: 5 * 60_000,
  });
  const claimMutation = useClaimTask();
  const updateMutation = useUpdateStaffTask();
  const tasks: StaffTask[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? 0;

  // deep link: /tasks?taskId=<id> opens the detail panel
  const deepLinkId = searchParams.get('taskId');
  const deepLinkHandled = useRef(false);
  const deepLinkNotFoundHandled = useRef(false);

  // A deep-linked task may live in a tab other than the current one, or be
  // completed/skipped and hidden by the default open-only filter. Force the
  // page into the view that can see everything before searching for it.
  useEffect(() => {
    if (deepLinkId && !deepLinkHandled.current) {
      deepLinkHandled.current = true;
      setTabIndex(2); // All Tasks
      setShowCompleted(true); // include completed/skipped
    }
  }, [deepLinkId]);

  useEffect(() => {
    if (deepLinkId && tasks.length > 0) {
      const t = tasks.find((x) => x.id === deepLinkId);
      if (t) {
        setSelectedTask(t);
        setSearchParams({}, { replace: true });
        return;
      }
    }
    // Only conclude "not found" once the all-view query (which can see every
    // task, including completed ones) has actually loaded.
    if (
      deepLinkId &&
      !isLoading &&
      view === 'all' &&
      showCompleted &&
      !deepLinkNotFoundHandled.current
    ) {
      deepLinkNotFoundHandled.current = true;
      setSearchParams({}, { replace: true });
      notify.error('Task not found', { description: 'It may have been deleted.' });
    }
  }, [deepLinkId, tasks, setSearchParams, isLoading, view, showCompleted]);

  // Clear any pending "claimed" undo timer on unmount.
  useEffect(() => {
    return () => {
      if (claimTimerRef.current) clearTimeout(claimTimerRef.current);
    };
  }, []);

  const handleToggleComplete = (task: StaffTask) => {
    const nowDone = task.status !== 'COMPLETED';
    updateMutation.mutate({ taskId: task.id, data: { status: nowDone ? 'COMPLETED' : 'IN_PROGRESS' } });
  };

  const handleClaim = (task: StaffTask) => {
    claimMutation.mutate(task.id, {
      onSuccess: () => {
        if (claimTimerRef.current) clearTimeout(claimTimerRef.current);
        setJustClaimed(task);
        claimTimerRef.current = setTimeout(() => setJustClaimed(null), 6000);
      },
      onError: (error: any) => {
        if (error?.response?.status === 409) notify.error('Someone else claimed this one first', { description: 'The list has been refreshed.' });
        else notify.error('Could not claim the task', { description: 'Try again in a moment.' });
      },
    });
  };

  const handleUndoClaim = () => {
    if (!justClaimed) return;
    updateMutation.mutate({ taskId: justClaimed.id, data: { assignedToId: null, status: 'PENDING' } });
    if (claimTimerRef.current) clearTimeout(claimTimerRef.current);
    setJustClaimed(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tasks</h1>
          <p className="text-sm text-gray-500">Everything the team is working on, across every practice.</p>
        </div>
        <button type="button" onClick={() => setIsNewTaskOpen(true)} className="btn-primary">
          <PlusIcon className="mr-1.5 h-4 w-4" /> New Task
        </button>
      </div>

      <Tab.Group selectedIndex={tabIndex} onChange={setTabIndex}>
        <Tab.List className="flex space-x-1 border-b border-gray-200">
          {VIEWS.map((v) => (
            <Tab
              key={v.key}
              className={({ selected }) =>
                clsx(
                  'border-b-2 px-4 py-2.5 text-sm font-medium outline-none transition-colors',
                  selected ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
                )
              }
            >
              {v.label}
            </Tab>
          ))}
        </Tab.List>
      </Tab.Group>

      <div className="flex flex-wrap items-center gap-2">
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="input w-40" aria-label="Filter by priority">
          <option value="">Priority: Any</option>
          <option value="URGENT">Urgent</option>
          <option value="HIGH">High</option>
          <option value="NORMAL">Normal</option>
          <option value="LOW">Low</option>
        </select>
        <select value={practiceId} onChange={(e) => setPracticeId(e.target.value)} className="input w-48" aria-label="Filter by practice">
          <option value="">Practice: All</option>
          {(practices ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
          Show completed
        </label>
      </div>

      {justClaimed && (
        <div className="flex items-center gap-3 rounded-xl border border-primary-100 bg-primary-50/60 px-4 py-2.5 text-sm">
          <span className="font-semibold text-primary-900">Claimed ✓</span>
          <span className="truncate text-gray-700">{justClaimed.title}</span>
          <button type="button" className="ml-auto font-semibold text-primary-700 underline underline-offset-2" onClick={handleUndoClaim}>
            Undo
          </button>
        </div>
      )}

      <div className="card divide-y divide-gray-100">
        {isLoading ? (
          <LoadingState label="Loading tasks…" />
        ) : isError ? (
          <ErrorState title="Couldn't load tasks" message="Something went wrong on our end." onRetry={refetch} />
        ) : tasks.length === 0 ? (
          view === 'pool' ? (
            <EmptyState illustration="inbox" title="Nothing waiting to be claimed" description="Every task has an owner. New unassigned work lands here." />
          ) : view === 'my' ? (
            <EmptyState
              illustration="clipboard"
              title="You're all caught up"
              description="Nothing is assigned to you right now. If you've got room, grab something from the Task Pool."
              action={{ label: 'Browse Task Pool', onClick: () => setTabIndex(1) }}
            />
          ) : (
            <EmptyState illustration="search" title="No tasks match" description="Try clearing the filters." />
          )
        ) : (
          <>
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                view={view}
                onOpenDetail={setSelectedTask}
                onToggleComplete={handleToggleComplete}
                onClaim={handleClaim}
                claimPending={claimMutation.isPending}
              />
            ))}
            {tasks.length < total && (
              <button type="button" className="w-full py-2.5 text-sm font-semibold text-primary-700 hover:bg-gray-50" onClick={() => setLimit((l) => l + 50)}>
                Load more ({total - tasks.length} more)
              </button>
            )}
          </>
        )}
      </div>
      {isNewTaskOpen && null /* Task 8 mounts <NewTaskModal isOpen={isNewTaskOpen} onClose={...} /> here */}
      {selectedTask && null /* Task 9 mounts <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} /> here */}
    </div>
  );
}
