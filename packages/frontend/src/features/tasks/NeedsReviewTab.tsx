import { useState } from 'react';
import { useStaffTasks, useReviewStats, useUpdateStaffTask, useAssignees, type StaffTask } from '../../hooks/useStaffTasks';
import TaskGroupPill from './TaskGroupPill';
import EmptyState from '../../components/ui/EmptyState';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import { notify } from '../../utils/notify';

function daysOverdue(dueDate: string): number {
  return Math.max(1, Math.ceil((Date.now() - new Date(dueDate).getTime()) / 86_400_000));
}

// Admin-only Needs review tab (D12, D16, D21, D22): patterns strip + every
// overdue task with its reason and three always-live actions. "Awaiting
// reason" is informational, never blocking. Actions resolve the row out of
// the tab (New deadline clears the reason server-side; Close = SKIPPED).
export default function NeedsReviewTab({ onOpenDetail }: { onOpenDetail: (task: StaffTask) => void }) {
  const { data, isLoading, isError, refetch } = useStaffTasks('needs_review', { status: 'open' });
  const { data: stats } = useReviewStats(true); // this component only renders for admins
  const updateMutation = useUpdateStaffTask();
  const { data: assignees } = useAssignees();
  const [deadlineFor, setDeadlineFor] = useState<string | null>(null);
  const [deadlineValue, setDeadlineValue] = useState('');
  const [reassignFor, setReassignFor] = useState<string | null>(null);

  const tasks: StaffTask[] = data?.data ?? [];

  const act = (taskId: string, patch: Record<string, unknown>) => {
    if (updateMutation.isPending) return; // dedup double-clicks; buttons stay enabled
    updateMutation.mutate(
      { taskId, data: patch },
      { onError: () => notify.error("Couldn't save that change", { description: 'The row is unchanged; try again in a moment.' }) },
    );
  };

  // Earliest pickable "new deadline" is tomorrow: the value maps to noon UTC,
  // so "today" picked after 8am ET is already past — the server's future-only
  // reset rule would silently not fire and the row would stay in the tab.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const statCards = [
    { label: 'Missed · last 30 days', value: String(stats?.missedLast30 ?? '—'), sr: `Missed: ${stats?.missedLast30 ?? 0} tasks in the last 30 days` },
    { label: 'Most missed by', value: stats?.mostMissedBy ? `${stats.mostMissedBy.name} (${stats.mostMissedBy.count})` : '—', sr: stats?.mostMissedBy ? `Most missed by: ${stats.mostMissedBy.name}, ${stats.mostMissedBy.count} missed tasks in the last 30 days` : 'Most missed by: no one yet' },
    { label: 'Slowest payer', value: stats?.slowestPayer ? `${stats.slowestPayer.name} (${stats.slowestPayer.count})` : '—', sr: stats?.slowestPayer ? `Slowest payer: ${stats.slowestPayer.name}, ${stats.slowestPayer.count} missed tasks in the last 30 days` : 'Slowest payer: none yet' },
  ];

  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Missed-deadline patterns">
        {statCards.map((card) => (
          <li key={card.label} aria-label={card.sr} className="rounded-xl border border-gray-200/80 bg-[#fcfcfd] px-3 py-2.5">
            <p aria-hidden="true" className="text-[11px] text-gray-500">{card.label}</p>
            <p aria-hidden="true" className="text-[15px] font-semibold text-gray-900">{card.value}</p>
          </li>
        ))}
      </ul>

      <div className="card divide-y divide-gray-100">
        {isLoading ? (
          <LoadingState label="Loading overdue tasks…" />
        ) : isError ? (
          <ErrorState title="Couldn't load the review list" message="Something went wrong on our end." onRetry={refetch} />
        ) : tasks.length === 0 ? (
          <EmptyState illustration="clipboard" title="Nothing needs review" description="Every task met its deadline. Nothing to review here." />
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="space-y-1.5 px-4 py-3 max-md:space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {task.taskGroup && <TaskGroupPill group={task.taskGroup} />}
                <button type="button" onClick={() => onOpenDetail(task)}
                  className="text-left text-sm font-medium text-gray-900 hover:text-primary-700 hover:underline underline-offset-2">
                  {task.title}
                </button>
                {task.dueDate && (
                  <span className="text-xs font-semibold text-red-600">
                    {daysOverdue(task.dueDate)} {daysOverdue(task.dueDate) === 1 ? 'day' : 'days'} overdue · {task.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}` : 'Unassigned'}
                  </span>
                )}
              </div>

              {/* Reason chip — wraps, never truncates; pending variant at FULL opacity */}
              {task.overdueReason ? (
                <p className="w-fit max-w-full whitespace-normal rounded-2xl bg-amber-50 px-2.5 py-1 text-[12.5px] font-medium text-amber-800 ring-1 ring-inset ring-amber-700/15">
                  Reason: &quot;{task.overdueReason}&quot;
                </p>
              ) : (
                <p className="w-fit rounded-2xl bg-amber-50 px-2.5 py-1 text-[12.5px] font-medium italic text-amber-800 ring-1 ring-inset ring-amber-700/15">
                  Awaiting reason…
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button type="button" aria-label={`New deadline — ${task.title}`}
                  onClick={() => { setDeadlineFor(deadlineFor === task.id ? null : task.id); setDeadlineValue(''); setReassignFor(null); }}
                  className="rounded-lg border border-primary-200 bg-white px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50">
                  New deadline
                </button>
                <button type="button" aria-label={`Reassign — ${task.title}`}
                  onClick={() => { setReassignFor(reassignFor === task.id ? null : task.id); setDeadlineFor(null); }}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  Reassign
                </button>
                <button type="button" aria-label={`Close — ${task.title}`}
                  onClick={() => act(task.id, { status: 'SKIPPED' })}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  Close
                </button>
              </div>

              {deadlineFor === task.id && (
                <div className="flex items-center gap-2 pt-1">
                  <label htmlFor={`deadline-${task.id}`} className="text-xs text-gray-600">New due date</label>
                  <input id={`deadline-${task.id}`} type="date" min={tomorrow} className="input w-40" value={deadlineValue}
                    onChange={(e) => setDeadlineValue(e.target.value)} />
                  <button type="button" disabled={!deadlineValue}
                    onClick={() => { act(task.id, { dueDate: new Date(deadlineValue + 'T12:00:00Z').toISOString() }); setDeadlineFor(null); }}
                    className="btn-primary px-3 py-1 text-xs disabled:opacity-50">
                    Save
                  </button>
                </div>
              )}

              {reassignFor === task.id && (
                <div className="flex items-center gap-2 pt-1">
                  <label htmlFor={`reassign-${task.id}`} className="text-xs text-gray-600">Assign to</label>
                  <select id={`reassign-${task.id}`} className="input w-48" defaultValue=""
                    onChange={(e) => { if (e.target.value) { act(task.id, { assignedToId: e.target.value }); setReassignFor(null); } }}>
                    <option value="" disabled>Pick a teammate…</option>
                    {(assignees ?? []).map((a) => (
                      <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
