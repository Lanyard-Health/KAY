import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { STATUS_META, STAFF_DELAYED, NEEDS_FOLLOW_UP, dueLabel, type EnrollmentStatus } from './staffMeta';

export interface QueueItemView {
  enrollmentId: string;
  providerName: string;
  payerName: string;
  practiceName: string | null;
  status: EnrollmentStatus;
  daysInStatus: number;
  isDelayed: boolean;
  needsFollowUp: boolean;
  nextAction: string;
  dueDate: string | null;
}

const EMPTY_COPY = 'Queue clear. Nothing is delayed and no follow-ups are due.';

function FlagChips({ item }: { item: QueueItemView }) {
  return (
    <>
      {item.isDelayed && (
        <span className={clsx('rounded-lg px-2 py-0.5 text-xs font-semibold', STAFF_DELAYED.chip)}>{STAFF_DELAYED.label}</span>
      )}
      {item.needsFollowUp && (
        <span className={clsx('rounded-lg px-2 py-0.5 text-xs font-semibold', NEEDS_FOLLOW_UP.chip)}>{NEEDS_FOLLOW_UP.label}</span>
      )}
    </>
  );
}

export default function WorkQueue({ items }: { items: QueueItemView[] }) {
  const navigate = useNavigate();
  const now = new Date();
  const open = (id: string) => navigate(`/enrollments/${id}`);

  return (
    <div id="queue" className="rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Work queue, sorted by urgency</h2>

      {items.length === 0 ? (
        <p className="mt-4 text-sm font-semibold text-[#15803D]">{EMPTY_COPY}</p>
      ) : (
        <>
          {/* Desktop table */}
          <table className="mt-3 hidden w-full border-collapse text-sm lg:table">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-2 py-2">Provider / Payer</th>
                <th className="px-2 py-2">Practice</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2 text-right">Days in status</th>
                <th className="px-2 py-2">Next action</th>
                <th className="px-2 py-2">Due</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const due = dueLabel(item.dueDate, now);
                return (
                  <tr
                    key={item.enrollmentId}
                    onClick={() => open(item.enrollmentId)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(item.enrollmentId); } }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open ${item.providerName} — ${item.payerName}`}
                    className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
                  >
                    <td className="px-2 py-2.5">
                      <span className="font-semibold text-gray-900">{item.providerName}</span>
                      <span className="text-gray-500"> — {item.payerName}</span>
                    </td>
                    <td className="px-2 py-2.5 text-gray-700">{item.practiceName ?? '—'}</td>
                    <td className="px-2 py-2.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className={clsx('rounded-lg px-2 py-0.5 text-xs font-semibold', STATUS_META[item.status].chip)}>
                          {STATUS_META[item.status].label}
                        </span>
                        <FlagChips item={item} />
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right text-gray-700 tabular-nums">{item.daysInStatus}</td>
                    <td className="px-2 py-2.5 text-gray-700">{item.nextAction}</td>
                    <td className={clsx('px-2 py-2.5 tabular-nums', due === 'Today' ? 'font-bold text-gray-900' : 'text-gray-700')}>
                      {due || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Small screens: one card per row, same fields */}
          <ul className="mt-3 space-y-3 lg:hidden">
            {items.map((item) => {
              const due = dueLabel(item.dueDate, now);
              return (
                <li key={item.enrollmentId}>
                  <button
                    type="button"
                    onClick={() => open(item.enrollmentId)}
                    className="w-full rounded-xl border border-gray-200/60 p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                  >
                    <p className="text-sm font-semibold text-gray-900">
                      {item.providerName} <span className="font-normal text-gray-500">— {item.payerName}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">{item.practiceName ?? '—'}</p>
                    <p className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className={clsx('rounded-lg px-2 py-0.5 text-xs font-semibold', STATUS_META[item.status].chip)}>
                        {STATUS_META[item.status].label}
                      </span>
                      <FlagChips item={item} />
                    </p>
                    <p className="mt-2 text-sm text-gray-700">{item.nextAction}</p>
                    <p className="mt-1 text-xs text-gray-500 tabular-nums">
                      Day {item.daysInStatus}
                      {due ? <span className={due === 'Today' ? 'font-bold text-gray-900' : ''}> · due {due}</span> : null}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
