import { TASK_GROUP_LABELS, type TaskGroup } from '@credential-management/shared';

// Indigo = task-group identity only (DESIGN.md); green variant marks
// system-created check-in rows ("Auto · Check-in", D17).
export default function TaskGroupPill({ group }: { group: TaskGroup }) {
  if (group === 'CHECK_IN') {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700 ring-1 ring-inset ring-primary-700/20">
        Auto · Check-in
      </span>
    );
  }
  return (
    <span className="inline-flex w-fit items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-700/10">
      {TASK_GROUP_LABELS[group]}
    </span>
  );
}
