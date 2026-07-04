// Staff-surface vocabulary (EXPERIENCE.md two-vocabulary rule): this surface
// says "Delayed", never "Running long" — shop-talk is sanctioned here only.
// Status labels stay universal via STATUS_META.
import { DELAYED_META, fmtDate } from '../practice/statusMeta';

export { STATUS_META, fmtDate, type EnrollmentStatus } from '../practice/statusMeta';

export const STAFF_DELAYED = { label: 'Delayed', chip: DELAYED_META.chip };
export const NEEDS_FOLLOW_UP = { label: 'Needs follow-up', chip: DELAYED_META.chip };

export function dueLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const due = new Date(iso);
  const sameDay =
    due.getUTCFullYear() === now.getUTCFullYear() &&
    due.getUTCMonth() === now.getUTCMonth() &&
    due.getUTCDate() === now.getUTCDate();
  return sameDay ? 'Today' : fmtDate(iso);
}
