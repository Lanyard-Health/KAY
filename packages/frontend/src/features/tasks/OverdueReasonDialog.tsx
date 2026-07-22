import { Fragment, useRef, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import clsx from 'clsx';
import { useUpdateStaffTask, type OverdueTaskItem } from '../../hooks/useStaffTasks';

export const QUICK_REASONS = [
  "Payer hasn't responded",
  'Portal was down',
  'Ran out of time',
  'Waiting on documents',
] as const;

interface OverdueReasonDialogProps {
  tasks: OverdueTaskItem[];
  onClose: (outcome: 'saved' | 'deferred') => void;
}

function daysOverdue(dueDate: string): number {
  return Math.max(1, Math.ceil((Date.now() - new Date(dueDate).getTime()) / 86_400_000));
}

// Prompt-on-arrival reason dialog (D18, D24). Deferrable, never a trap: Esc,
// backdrop, and the visible "I'll answer later" button are the SAME deferral;
// a failed save can never block passage; every button stays usable always.
export default function OverdueReasonDialog({ tasks, onClose }: OverdueReasonDialogProps) {
  const updateMutation = useUpdateStaffTask();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, boolean>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, boolean>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [saving, setSaving] = useState(false);

  const n = tasks.length;
  const heading = n === 1
    ? 'Before you dive in — 1 task missed its deadline'
    : `Before you dive in — ${n} tasks missed their deadlines`;

  const setDraft = (taskId: string, value: string) => {
    setDrafts((d) => ({ ...d, [taskId]: value }));
    setValidationErrors((e) => ({ ...e, [taskId]: false }));
  };

  const handleSave = async () => {
    if (saving) return; // dedup a double-click without disabling the button (D24)
    const pending = tasks.filter((t) => !savedIds.has(t.id));
    const missing = pending.filter((t) => !(drafts[t.id] ?? '').trim());
    if (missing.length > 0) {
      setValidationErrors(Object.fromEntries(missing.map((t) => [t.id, true])));
      setAnnouncement(`${missing.length} reason${missing.length === 1 ? '' : 's'} still needed`);
      document.getElementById(`reason-${missing[0]!.id}`)?.focus();
      return;
    }
    setSaving(true);
    const results = await Promise.allSettled(
      pending.map((t) => updateMutation.mutateAsync({ taskId: t.id, data: { overdueReason: drafts[t.id]!.trim() } })),
    );
    setSaving(false);
    const failed = pending.filter((_t, i) => results[i]!.status === 'rejected');
    const succeeded = pending.filter((_t, i) => results[i]!.status === 'fulfilled');
    if (succeeded.length > 0) setSavedIds((s) => new Set([...s, ...succeeded.map((t) => t.id)]));
    if (failed.length === 0) {
      onClose('saved');
      return;
    }
    // Per-field inline errors; entered text retained; retry available (D24).
    setSaveErrors(Object.fromEntries(failed.map((t) => [t.id, true])));
    setAnnouncement(`${failed.length} reason${failed.length === 1 ? '' : 's'} couldn't be saved — your text is kept, try again`);
  };

  return (
    <Transition.Root show as={Fragment}>
      {/* role=alertdialog per the Accessibility Floor; Esc/backdrop hit
          Dialog onClose → the SAME deferral as the footer button. No ✕ glyph. */}
      <Dialog
        as="div"
        role="alertdialog"
        aria-labelledby="reason-dialog-heading"
        aria-describedby="reason-dialog-desc"
        className="relative z-50"
        initialFocus={headingRef}
        onClose={() => onClose('deferred')}
      >
        <Transition.Child as={Fragment}
          enter="ease-out duration-200 motion-reduce:duration-0" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150 motion-reduce:duration-0" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            {/* No transform animation — the auto-firing dialog appears without motion (reduced-motion rule). */}
            <Dialog.Panel className="w-full max-w-xl rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_32px_rgba(17,24,39,.08)]">
              <div className="border-b border-gray-100 px-5 py-4">
                <h2 id="reason-dialog-heading" ref={headingRef} tabIndex={-1} className="text-[15px] font-semibold text-gray-900 outline-none">
                  {heading}
                </h2>
                <p id="reason-dialog-desc" className="mt-1 text-sm text-gray-600">
                  A quick reason for each helps Kay review them. You can defer, but it&apos;ll ask again next time.
                </p>
              </div>

              <div role="status" aria-live="polite" data-testid="dialog-announcer" className="sr-only">{announcement}</div>

              <div className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto px-5">
                {tasks.map((task) => (
                  <div key={task.id} className="py-4">
                    <p className="text-[13.5px] font-semibold text-gray-900">{task.title}</p>
                    <p className="mt-0.5 text-[13px] text-gray-500">
                      Due {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {daysOverdue(task.dueDate)} day{daysOverdue(task.dueDate) === 1 ? '' : 's'} overdue
                      {task.description ? ` · ${task.description}` : ''}
                    </p>
                    {savedIds.has(task.id) ? (
                      <p className="mt-2 text-xs font-semibold text-primary-700">Saved</p>
                    ) : (
                      <>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {QUICK_REASONS.map((reason) => (
                            <button key={reason} type="button" onClick={() => setDraft(task.id, reason)}
                              className={clsx(
                                'rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                                (drafts[task.id] ?? '') === reason
                                  ? 'border-primary-200 bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-700/20'
                                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                              )}>
                              {reason}
                            </button>
                          ))}
                        </div>
                        <label htmlFor={`reason-${task.id}`} className="mt-2 block text-sm font-medium text-gray-600">
                          What got in the way? One line is plenty.
                        </label>
                        <input
                          id={`reason-${task.id}`}
                          aria-label={`What got in the way? — ${task.title}`}
                          aria-invalid={validationErrors[task.id] ? 'true' : undefined}
                          aria-describedby={validationErrors[task.id] || saveErrors[task.id] ? `reason-error-${task.id}` : undefined}
                          className="input mt-1"
                          value={drafts[task.id] ?? ''}
                          onChange={(e) => setDraft(task.id, e.target.value)}
                        />
                        {validationErrors[task.id] && (
                          <p id={`reason-error-${task.id}`} className="mt-1 text-[12.5px] text-red-600">Add a one-line reason</p>
                        )}
                        {saveErrors[task.id] && !validationErrors[task.id] && (
                          <p id={`reason-error-${task.id}`} className="mt-1 text-[12.5px] text-red-600">
                            Couldn&apos;t save this reason — check your connection and try again. Your text is kept.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-5 py-4">
                {/* Both buttons always enabled — errors never disable anything (D24). */}
                <button type="button" onClick={() => onClose('deferred')} className="btn-secondary">
                  I&apos;ll answer later
                </button>
                <button type="button" onClick={handleSave} className="btn-primary">
                  {saving ? 'Saving…' : 'Save reasons'}
                </button>
              </div>
            </Dialog.Panel>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
