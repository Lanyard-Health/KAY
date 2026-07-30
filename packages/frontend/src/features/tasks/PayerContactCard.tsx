import { useEffect, useState } from 'react';
import { usePayerContactInfo, useSavePayerContactInfo } from '../../hooks/useStaffTasks';
import { notify } from '../../utils/notify';

interface PayerContactCardProps {
  payerId: string;
  payerName: string;
}

// "hours" stays in the API/DB but is deliberately absent from the UI —
// payer hours are standard enough that the field was noise (Kay, 2026-07-20).
const EMPTY_FORM = { phone: '', email: '', bestWay: '', notes: '' };

const FIELD_LABELS: { key: keyof typeof EMPTY_FORM; label: string }[] = [
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'bestWay', label: 'Best way to contact' },
  { key: 'notes', label: 'Notes' },
];

// The contact card (D5, D6, D7): appears when a payer is selected; on-file /
// empty(add form) / edit states share one inline form. Saving is optional —
// a failed save shows a toast, keeps the values, and NEVER affects task
// creation. Shared by NewTaskModal and TaskDetailPanel.
export default function PayerContactCard({ payerId, payerName }: PayerContactCardProps) {
  const { data: info, isLoading } = usePayerContactInfo(payerId);
  const saveMutation = useSavePayerContactInfo();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [announcement, setAnnouncement] = useState('');

  // Announce the card's appearance once per payer (Accessibility Floor).
  useEffect(() => {
    if (isLoading) return;
    setAnnouncement(info
      ? `Contact info on file for ${payerName}`
      : `No contact info on file for ${payerName} ; you can add it below`);
  }, [info, isLoading, payerName]);

  // Seed the form from the row when entering edit mode or switching payers.
  useEffect(() => {
    setEditing(false);
    setForm({
      phone: info?.phone ?? '', email: info?.email ?? '',
      bestWay: info?.bestWay ?? '', notes: info?.notes ?? '',
    });
  }, [info, payerId]);

  const handleSave = () => {
    saveMutation.mutate(
      { payerId, data: form },
      {
        onSuccess: () => {
          setEditing(false);
          setAnnouncement(`Contact info saved for ${payerName}`);
        },
        onError: () => {
          // Entered values are kept (state untouched); creation flow unaffected.
          setAnnouncement(`Couldn't save contact info for ${payerName}`);
          notify.error("Couldn't save contact info", { description: 'Your entries are kept; try again in a moment.' });
        },
      },
    );
  };

  const showForm = editing || (!isLoading && !info);

  return (
    <div className="rounded-xl border border-gray-200/80 bg-[#fafcfb] px-3.5 py-3">
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
      <div className="flex items-center justify-between border-b border-gray-100 pb-2">
        <p className="text-[12.5px] font-semibold text-gray-900">{payerName}</p>
        {isLoading ? (
          <span className="text-[11px] text-gray-500">Loading…</span>
        ) : info ? (
          <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700 ring-1 ring-inset ring-primary-700/20">On file</span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-700/20">Nothing on file</span>
        )}
      </div>

      {isLoading ? null : showForm ? (
        <div className="mt-2 space-y-2">
          {!info && (
            <p className="text-[13px] text-gray-600">Be the first to add it; every teammate after you gets this automatically.</p>
          )}
          {FIELD_LABELS.map(({ key, label }) => (
            <div key={key}>
              {/* Visible labels always — never placeholder-only (Accessibility Floor). */}
              <label htmlFor={`contact-${key}`} className="text-sm font-medium text-gray-600">{label}</label>
              <input
                id={`contact-${key}`}
                className="input mt-0.5"
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                onKeyDown={(e) => {
                  // Inside NewTaskModal the card sits in the task <form>; Enter
                  // here must save the card, never implicitly submit the task.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSave();
                  }
                }}
              />
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={handleSave} disabled={saveMutation.isPending}
              className="rounded-lg border border-primary-200 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-50">
              {saveMutation.isPending ? 'Saving…' : 'Save contact info'}
            </button>
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <dl className="mt-2 grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5 text-[13px]">
          {info?.phone && (
            <>
              <dt className="text-gray-500">Phone</dt>
              <dd>
                <a
                  href={`tel:${info.phone}`}
                  aria-label={`Call ${payerName} credentialing, ${info.phone}`}
                  className="font-semibold text-primary-700 underline decoration-dashed decoration-primary-700/40 underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {info.phone}
                </a>
                <span className="ml-1 text-gray-500">· click to call</span>
              </dd>
            </>
          )}
          {info?.email && (
            <>
              <dt className="text-gray-500">Email</dt>
              <dd>
                <a href={`mailto:${info.email}`} aria-label={`Email ${payerName} credentialing, ${info.email}`}
                  className="font-semibold text-primary-700 underline decoration-dashed decoration-primary-700/40 underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  {info.email}
                </a>
              </dd>
            </>
          )}
          {info?.bestWay && (<><dt className="text-gray-500">Best way</dt><dd className="text-gray-800">{info.bestWay}</dd></>)}
          {info?.notes && (<><dt className="text-gray-500">Notes</dt><dd className="text-gray-800">{info.notes}</dd></>)}
          <dt className="sr-only">Actions</dt>
          <dd className="col-span-2 pt-1">
            <button type="button" onClick={() => setEditing(true)}
              className="text-xs font-semibold text-primary-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              Edit contact info
            </button>
          </dd>
        </dl>
      )}
    </div>
  );
}
