import clsx from 'clsx';
import { CheckIcon } from '@heroicons/react/24/outline';
import StatusBadge from '../../components/ui/StatusBadge';
import type { StaffTask } from '../../hooks/useStaffTasks';

export const PRIORITY_STYLES: Record<StaffTask['priority'], string> = {
  URGENT: 'bg-red-50 text-red-700 ring-red-600/30',
  HIGH: 'bg-amber-50 text-amber-700 ring-amber-600/30',
  NORMAL: 'bg-gray-50 text-gray-600 ring-gray-400/40',
  LOW: 'bg-white text-gray-500 ring-gray-300',
};
const PRIORITY_LABELS: Record<StaffTask['priority'], string> = { URGENT: 'Urgent', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };
const STATUS_VARIANT: Record<StaffTask['status'], 'info' | 'neutral' | 'success'> = { IN_PROGRESS: 'info', PENDING: 'neutral', COMPLETED: 'success', SKIPPED: 'neutral' };
const STATUS_LABEL: Record<StaffTask['status'], string> = { IN_PROGRESS: 'In progress', PENDING: 'Pending', COMPLETED: 'Completed', SKIPPED: 'Skipped' };

export function isOverdue(task: StaffTask): boolean {
  return !!task.dueDate && task.status !== 'COMPLETED' && task.status !== 'SKIPPED' && new Date(task.dueDate).getTime() < Date.now();
}
export function linkedRecordLabel(task: StaffTask): string | null {
  if (task.provider) return `${task.provider.firstName} ${task.provider.lastName}`;
  if (task.practice) return task.practice.name;
  if (task.enrollment) return task.enrollment.payer?.name ?? 'Enrollment';
  return null;
}
export function linkedRecordHref(task: StaffTask): string | null {
  if (task.provider) return `/providers/${task.provider.id}`;
  if (task.practice) return `/practices/${task.practice.id}`;
  if (task.enrollment) return `/enrollments?enrollmentId=${task.enrollment.id}`; // verify the enrollments page's deep-link param before shipping
  return null;
}

function poolAgeLabel(task: StaffTask): string {
  const days = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / 86_400_000);
  return days === 0 ? 'Added today' : `Added ${days} day${days > 1 ? 's' : ''} ago`;
}

interface TaskRowProps {
  task: StaffTask;
  view: 'my' | 'pool' | 'all';
  onOpenDetail: (task: StaffTask) => void;
  onToggleComplete: (task: StaffTask) => void;
  onClaim: (task: StaffTask) => void;
  claimPending: boolean;
}

export default function TaskRow({ task, view, onOpenDetail, onToggleComplete, onClaim, claimPending }: TaskRowProps) {
  const overdue = isOverdue(task);
  const done = task.status === 'COMPLETED';
  const record = linkedRecordLabel(task);
  return (
    <div className="grid grid-cols-[26px_minmax(0,1fr)_92px_150px_150px] items-center gap-3 px-4 py-3 hover:bg-gray-50/60 max-md:flex max-md:flex-wrap">
      <button
        type="button"
        aria-pressed={done}
        aria-label={`${done ? 'Completed' : 'Mark complete'}: ${task.title}`}
        onClick={() => onToggleComplete(task)}
        className={clsx(
          'flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors',
          done ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300 bg-white text-transparent hover:border-primary-500 hover:text-primary-200',
        )}
      >
        <CheckIcon className="h-3 w-3" strokeWidth={3} />
      </button>
      <div className="min-w-0 max-md:order-first max-md:w-full">
        <button
          type="button"
          onClick={() => onOpenDetail(task)}
          className={clsx('block max-w-full truncate text-left text-sm font-medium hover:text-primary-700 hover:underline underline-offset-2', done ? 'text-gray-500 line-through' : 'text-gray-900')}
          title={task.title}
        >
          {task.title}
        </button>
        {record ? (
          <span className="mt-0.5 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{record}</span>
        ) : (
          <span className="text-[11px] text-gray-500">No linked record</span>
        )}
        {view === 'pool' && <span className="mt-0.5 block text-[11px] text-gray-500">{poolAgeLabel(task)}</span>}
      </div>
      <span className={clsx('inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', PRIORITY_STYLES[task.priority])}>{PRIORITY_LABELS[task.priority]}</span>
      <span className={clsx('text-xs tabular-nums', overdue ? 'font-semibold text-red-600' : 'text-gray-500')}>
        {task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
        {overdue && <span className="block text-[11px] font-medium">overdue</span>}
      </span>
      {view === 'pool' || (view === 'all' && !task.assignedTo) ? (
        <button type="button" disabled={claimPending} onClick={() => onClaim(task)} className="justify-self-end rounded-lg border border-primary-200 bg-white px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-50">
          Claim
        </button>
      ) : view === 'all' ? (
        <span className="text-xs text-gray-600">{task.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}` : 'Unassigned'}</span>
      ) : (
        <StatusBadge label={STATUS_LABEL[task.status]} variant={STATUS_VARIANT[task.status]} />
      )}
    </div>
  );
}
