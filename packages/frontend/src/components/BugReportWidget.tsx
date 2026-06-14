import { Fragment, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { BugAntIcon, XMarkIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { api } from '../services/api';
import { notify } from '../utils/notify';
import { useAuthStore } from '../stores/auth.store';
import { appCommit } from '../config';

type Severity = 'fyi' | 'annoying' | 'blocked';

const SEVERITIES: { value: Severity; label: string; hint: string }[] = [
  { value: 'fyi', label: 'FYI', hint: 'Just letting you know' },
  { value: 'annoying', label: 'Annoying', hint: 'Gets in my way' },
  { value: 'blocked', label: 'Blocked', hint: "Can't continue" },
];

// Beta "Report a bug" widget. Staging-only (mounted in main.tsx behind
// `isStaging`). The tester types one sentence; the server-side AI writer turns
// it + the context we attach here into a structured Linear ticket.
export default function BugReportWidget() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('annoying');
  const [submitting, setSubmitting] = useState(false);
  const user = useAuthStore((s) => s.user);

  const reset = () => {
    setDescription('');
    setSeverity('annoying');
  };

  const close = () => {
    if (submitting) return;
    setOpen(false);
  };

  const submit = async () => {
    const text = description.trim();
    if (!text) {
      notify.error('Please describe what happened first');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/bugs/user-report', {
        description: text,
        severity,
        context: {
          route: window.location.pathname,
          url: window.location.href,
          userAgent: navigator.userAgent,
          appCommit,
          role: user?.role ?? 'unknown',
        },
      });
      notify.success('Thanks — sent to the team');
      reset();
      setOpen(false);
    } catch {
      notify.error('Could not send the report — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-primary-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-primary-600"
        aria-label="Report a bug"
      >
        <BugAntIcon className="h-4 w-4" />
        Report a bug
      </button>

      <Transition appear show={open} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={close}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 sm:items-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 translate-y-4 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:scale-95"
              >
                <Dialog.Panel className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                  <div className="mb-4 flex items-center justify-between">
                    <Dialog.Title className="text-lg font-semibold text-gray-900">Report a bug</Dialog.Title>
                    <button onClick={close} className="text-gray-400 hover:text-gray-500" aria-label="Close">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <label className="label">What happened?</label>
                  <textarea
                    autoFocus
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={5000}
                    placeholder="e.g. I clicked Save on a provider and nothing happened"
                    className="input w-full"
                  />

                  <div className="mt-4">
                    <label className="label">How much is it blocking you?</label>
                    <div className="mt-1 grid grid-cols-3 gap-2">
                      {SEVERITIES.map((s) => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => setSeverity(s.value)}
                          title={s.hint}
                          className={clsx(
                            'rounded-lg border px-2 py-2 text-xs font-medium transition',
                            severity === s.value
                              ? 'border-primary-500 bg-primary-50 text-primary-700'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300',
                          )}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <p className="mt-3 text-[11px] text-gray-400">
                    We attach the page you're on and your browser automatically. Don't include real patient or provider
                    information — this is a test environment.
                  </p>

                  <div className="mt-5 flex justify-end gap-3">
                    <button type="button" onClick={close} className="btn-secondary" disabled={submitting}>
                      Cancel
                    </button>
                    <button type="button" onClick={submit} className="btn-primary" disabled={submitting}>
                      {submitting ? 'Sending…' : 'Send report'}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}
