import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, RadioGroup, Transition } from '@headlessui/react';
import { XMarkIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { composeTaskTitle, HUMAN_TASK_GROUPS, TASK_GROUP_LABELS, type HumanTaskGroup } from '@credential-management/shared';
import { useCreateStaffTask, useAssignees } from '../../hooks/useStaffTasks';
import PayerCombobox, { type PayerOption } from './PayerCombobox';
import AutoTitlePreview from './AutoTitlePreview';
import PayerContactCard from './PayerContactCard';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { notify } from '../../utils/notify';

type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const PRIORITY_LABELS: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

interface ProviderOption { id: string; firstName: string; lastName: string; }
interface PracticeOption { id: string; name: string; }

interface NewTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Guided creation (D1-D7): field order Task Group → Payer (+contact card) →
// Practice → Provider (filtered) → Note, then Priority / Due date / Assign-to
// unchanged from v1. No free-text title exists anywhere; "Other" + Note is the
// escape hatch. v1 behaviors carry over: dirty-close guard, validation keeps
// the modal open.
export default function NewTaskModal({ isOpen, onClose }: NewTaskModalProps) {
  const user = useAuthStore((s) => s.user);
  const createMutation = useCreateStaffTask();
  const { data: assignees } = useAssignees();

  const [taskGroup, setTaskGroup] = useState<HumanTaskGroup | ''>('');
  const [groupError, setGroupError] = useState('');
  const [payer, setPayer] = useState<PayerOption | null>(null);
  const [practiceId, setPracticeId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [note, setNote] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [dueDate, setDueDate] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [cascadeAnnouncement, setCascadeAnnouncement] = useState('');
  const providerLabelRef = useRef('');

  const { data: practiceOptions } = useQuery({
    queryKey: ['staff-tasks', 'practice-options'],
    queryFn: async () => (await api.get('/practices')).data.data as PracticeOption[],
    staleTime: 5 * 60_000,
  });

  // Provider list, filtered to the selected practice when one is chosen.
  // providersLoaded distinguishes "still loading" from "this practice has no
  // providers" — the cascade rule below must only judge settled data.
  const { data: providerOptions = [], isSuccess: providersLoaded } = useQuery({
    queryKey: ['staff-tasks', 'provider-options', practiceId],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '100' });
      if (practiceId) params.set('practiceId', practiceId);
      const response = await api.get(`/providers?${params.toString()}`);
      return (response.data as { data: { data: ProviderOption[] } }).data.data;
    },
    staleTime: 60_000,
  });

  const practiceName = practiceOptions?.find((p) => p.id === practiceId)?.name;

  // Assign To defaults to the signed-in user (Kay, 2026-07-20: "I created a
  // task and expected it to be mine"); "Leave in Task Pool" stays available.
  const defaultAssigneeId = user?.id ?? '';

  const isDirty = !!(taskGroup || payer || practiceId || providerId || note || dueDate || assignedToId !== defaultAssigneeId || priority !== 'NORMAL');

  // Clean slate on every open (modal stays mounted between opens).
  useEffect(() => {
    if (isOpen) {
      setTaskGroup(''); setGroupError(''); setPayer(null); setPracticeId('');
      setProviderId(''); setNote(''); setPriority('NORMAL'); setDueDate('');
      setAssignedToId(defaultAssigneeId); setCascadeAnnouncement('');
      providerLabelRef.current = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultAssigneeId]);

  // Cascade rule (3.2.2): changing Practice clears an incompatible Provider
  // selection and announces it — never a silent mutation of an untouched field.
  useEffect(() => {
    if (!providerId || !providersLoaded) return; // judge on settled data only
    if (!providerOptions.some((p) => p.id === providerId)) {
      setProviderId('');
      setCascadeAnnouncement(`Provider cleared: ${providerLabelRef.current} isn't at ${practiceName ?? 'the selected practice'}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerOptions, providersLoaded, practiceName]);

  const guardedClose = () => {
    if (isDirty && !window.confirm('Discard this task?')) return;
    onClose();
  };

  // Backdrop clicks are a no-op (stray clicks around a small modal kept
  // triggering the discard prompt on staging). Only explicit intents close:
  // Cancel, the X, and Escape — each still confirms when fields are filled.
  // Dialog's own onClose (backdrop + its Esc handling) is therefore inert,
  // and Escape is handled here instead. PayerCombobox stops Esc propagation
  // while its listbox is open, so that Esc never reaches this listener.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') guardedClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isDirty]);

  const composedTitle = useMemo(
    () => (taskGroup ? composeTaskTitle(taskGroup, payer?.name, practiceName) : ''),
    [taskGroup, payer, practiceName],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskGroup) {
      setGroupError("Pick a task group; it's the only required field.");
      return; // validation keeps the modal open (v1 behavior)
    }
    createMutation.mutate(
      {
        taskGroup,
        note: note.trim() || undefined,
        priority,
        dueDate: dueDate ? new Date(dueDate + 'T12:00:00Z').toISOString() : undefined,
        assignedToId: assignedToId || undefined,
        payerId: payer?.id || undefined,
        practiceId: practiceId || undefined,
        providerId: providerId || undefined,
      },
      {
        onSuccess: () => {
          // Create-success toast repeats the final title (Accessibility Floor).
          notify.success('Task created', { description: composedTitle });
          onClose();
        },
        onError: (error: any) =>
          notify.error('Could not create the task', {
            description: error?.response?.data?.error?.message ?? 'Try again in a moment.',
          }),
      },
    );
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={() => { /* backdrop no-op; see Escape listener above */ }}>
        <Transition.Child as={Fragment}
          enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child as={Fragment}
              enter="ease-out duration-300" enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95" enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200" leaveFrom="opacity-100 translate-y-0 sm:scale-100" leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95">
              <Dialog.Panel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
                <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
                  <div className="mb-4 flex items-center justify-between">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">New Task</Dialog.Title>
                    <button type="button" onClick={guardedClose} className="text-gray-400 hover:text-gray-500" aria-label="Close">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4 text-left">
                    <div>
                      <label htmlFor="task-group" className="label">Task group *</label>
                      <select
                        id="task-group"
                        className="input"
                        value={taskGroup}
                        onChange={(e) => { setTaskGroup(e.target.value as HumanTaskGroup | ''); setGroupError(''); }}
                      >
                        <option value="">Pick a task group…</option>
                        {HUMAN_TASK_GROUPS.map((g) => (
                          <option key={g} value={g}>{TASK_GROUP_LABELS[g]}</option>
                        ))}
                      </select>
                      {groupError && <p className="mt-1 text-xs text-red-600">{groupError}</p>}
                    </div>

                    <div>
                      <label htmlFor="task-payer" className="label">Payer <span className="text-gray-500">· optional</span></label>
                      <PayerCombobox value={payer} onChange={setPayer} />
                      {payer && <div className="mt-2"><PayerContactCard payerId={payer.id} payerName={payer.name} /></div>}
                    </div>

                    <div>
                      <label htmlFor="task-practice" className="label">Practice <span className="text-gray-500">· optional</span></label>
                      <select id="task-practice" className="input" value={practiceId} onChange={(e) => setPracticeId(e.target.value)}>
                        <option value="">None</option>
                        {(practiceOptions ?? []).map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="task-provider" className="label">Provider <span className="text-gray-500">· optional</span></label>
                      <select
                        id="task-provider"
                        className="input"
                        value={providerId}
                        onChange={(e) => {
                          setProviderId(e.target.value);
                          const chosen = providerOptions.find((p) => p.id === e.target.value);
                          providerLabelRef.current = chosen ? `${chosen.firstName} ${chosen.lastName}` : '';
                        }}
                      >
                        <option value="">None</option>
                        {providerOptions.map((p) => (
                          <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                        ))}
                      </select>
                      {practiceId && (
                        <p className="mt-1 text-xs text-gray-500">Filtered to providers at the selected practice</p>
                      )}
                      <div role="status" aria-live="polite" data-testid="cascade-announcement" className="sr-only">
                        {cascadeAnnouncement}
                      </div>
                    </div>

                    <AutoTitlePreview group={taskGroup} payerName={payer?.name} practiceName={practiceName} />

                    <div>
                      <label htmlFor="task-note" className="label">Note <span className="text-gray-500">· optional</span></label>
                      <textarea id="task-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                    </div>

                    <div>
                      <RadioGroup value={priority} onChange={setPriority}>
                        <RadioGroup.Label className="label">Priority</RadioGroup.Label>
                        <div className="flex gap-2">
                          {PRIORITIES.map((p) => (
                            <RadioGroup.Option key={p} value={p} className={({ checked }) => clsx(
                              'flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                              checked ? 'border-primary-200 bg-primary-50 font-semibold text-primary-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                            )}>
                              {({ checked }) => (
                                <>
                                  {/* non-color selected cue (Accessibility Floor) */}
                                  {checked && <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />}
                                  {PRIORITY_LABELS[p]}
                                </>
                              )}
                            </RadioGroup.Option>
                          ))}
                        </div>
                      </RadioGroup>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="task-due-date" className="label">Due Date</label>
                        <input id="task-due-date" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                      </div>
                      <div>
                        <label htmlFor="task-assignee" className="label">Assign To</label>
                        <select id="task-assignee" className="input" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
                          <option value="">Leave in Task Pool</option>
                          {(assignees ?? []).map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.firstName} {a.lastName}{a.id === user?.id ? ' (you)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex justify-end gap-3 border-t pt-4">
                      <button type="button" onClick={guardedClose} className="btn-secondary">Cancel</button>
                      <button type="submit" disabled={createMutation.isPending} className="btn-primary">
                        {createMutation.isPending ? 'Creating…' : 'Create task'}
                      </button>
                    </div>
                  </form>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
