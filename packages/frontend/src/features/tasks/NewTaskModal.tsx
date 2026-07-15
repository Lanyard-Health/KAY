import { Fragment, useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useCreateStaffTask, useAssignees } from '../../hooks/useStaffTasks';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { notify } from '../../utils/notify';

type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const PRIORITY_LABELS: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

interface ProviderOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface PracticeOption {
  id: string;
  name: string;
}

interface FormValues {
  title: string;
  description?: string;
  priority: Priority;
  dueDate?: string;
  assignedToId?: string;
  linkType: 'none' | 'provider' | 'practice';
  providerId?: string;
  practiceId?: string;
}

interface NewTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_VALUES: FormValues = {
  title: '',
  description: '',
  priority: 'NORMAL',
  dueDate: '',
  assignedToId: '',
  linkType: 'none',
  providerId: '',
  practiceId: '',
};

export default function NewTaskModal({ isOpen, onClose }: NewTaskModalProps) {
  const user = useAuthStore((s) => s.user);
  const createMutation = useCreateStaffTask();
  const { data: assignees } = useAssignees();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ defaultValues: DEFAULT_VALUES });

  const priority = watch('priority');
  const linkType = watch('linkType');

  const [providerQuery, setProviderQuery] = useState('');
  const [providerResults, setProviderResults] = useState<ProviderOption[]>([]);
  const [providerSearchLoading, setProviderSearchLoading] = useState(false);
  const [selectedProviderLabel, setSelectedProviderLabel] = useState('');

  // Reuse the same queryKey TasksPage's practice filter uses so the cache is shared.
  const { data: practiceOptions } = useQuery({
    queryKey: ['staff-tasks', 'practice-options'],
    queryFn: async () => (await api.get('/practices')).data.data as PracticeOption[],
    staleTime: 5 * 60_000,
    enabled: linkType === 'practice',
  });

  // Start every open on a clean slate rather than whatever was left over
  // from a discarded draft (the modal stays mounted between opens).
  useEffect(() => {
    if (isOpen) {
      reset(DEFAULT_VALUES);
      setProviderQuery('');
      setProviderResults([]);
      setSelectedProviderLabel('');
    }
  }, [isOpen, reset]);

  // Debounced provider search, only while the provider link path is active.
  useEffect(() => {
    if (linkType !== 'provider' || providerQuery.trim().length === 0) {
      setProviderResults([]);
      return;
    }
    setProviderSearchLoading(true);
    const handle = setTimeout(() => {
      api
        .get(`/providers?search=${encodeURIComponent(providerQuery.trim())}&pageSize=10`)
        .then((response) => {
          const providers = (response.data as { data: { data: ProviderOption[] } }).data.data;
          setProviderResults(providers);
        })
        .catch(() => setProviderResults([]))
        .finally(() => setProviderSearchLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [providerQuery, linkType]);

  const guardedClose = () => {
    if (isDirty && !window.confirm('Discard this task?')) return;
    reset(DEFAULT_VALUES);
    onClose();
  };

  const linkTypeField = register('linkType');

  const handleLinkTypeChange = (e: ChangeEvent<HTMLSelectElement>) => {
    linkTypeField.onChange(e);
    setValue('providerId', '');
    setValue('practiceId', '');
    setProviderQuery('');
    setProviderResults([]);
    setSelectedProviderLabel('');
  };

  const onSubmit = (values: FormValues) => {
    createMutation.mutate(
      {
        title: values.title.trim(),
        description: values.description?.trim() || undefined,
        priority: values.priority,
        dueDate: values.dueDate ? new Date(values.dueDate + 'T12:00:00Z').toISOString() : undefined,
        assignedToId: values.assignedToId || undefined,
        providerId: values.linkType === 'provider' ? values.providerId || undefined : undefined,
        practiceId: values.linkType === 'practice' ? values.practiceId || undefined : undefined,
        // enrollment linking arrives with the enrollment-page "create task" affordance
      },
      {
        onSuccess: () => {
          notify.success('Task created');
          reset(DEFAULT_VALUES);
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
      <Dialog as="div" className="relative z-50" onClose={guardedClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
                <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
                  <div className="mb-4 flex items-center justify-between">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      New Task
                    </Dialog.Title>
                    <button type="button" onClick={guardedClose} className="text-gray-400 hover:text-gray-500" aria-label="Close">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 text-left">
                    <div>
                      <label htmlFor="task-title" className="label">Title *</label>
                      <input
                        id="task-title"
                        {...register('title', { required: 'Give the task a title so the team knows what it is.' })}
                        className="input"
                        placeholder="e.g. Chase W-9 from Dr. Smith"
                      />
                      {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
                    </div>

                    <div>
                      <label htmlFor="task-description" className="label">Description</label>
                      <textarea id="task-description" {...register('description')} className="input" rows={2} />
                    </div>

                    <div>
                      <span className="label">Priority</span>
                      <div className="flex gap-2">
                        {PRIORITIES.map((p) => (
                          <button
                            key={p}
                            type="button"
                            aria-pressed={priority === p}
                            onClick={() => setValue('priority', p, { shouldDirty: true })}
                            className={clsx(
                              'flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                              priority === p
                                ? 'border-primary-200 bg-primary-50 font-semibold text-primary-800'
                                : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                            )}
                          >
                            {PRIORITY_LABELS[p]}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label htmlFor="task-due-date" className="label">Due Date</label>
                      <input id="task-due-date" type="date" {...register('dueDate')} className="input" />
                    </div>

                    <div>
                      <label htmlFor="task-assignee" className="label">Assign To</label>
                      <select id="task-assignee" {...register('assignedToId')} className="input">
                        <option value="">Leave in Task Pool</option>
                        {(assignees ?? []).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.firstName} {a.lastName}
                            {a.id === user?.id ? ' (you)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="task-link-type" className="label">Link to record</label>
                      <select id="task-link-type" {...linkTypeField} onChange={handleLinkTypeChange} className="input">
                        <option value="none">None</option>
                        <option value="provider">Provider</option>
                        <option value="practice">Practice</option>
                      </select>
                      {/* enrollment linking arrives with the enrollment-page "create task" affordance */}
                    </div>

                    {linkType === 'provider' && (
                      <div>
                        <label htmlFor="task-provider-search" className="label">Search providers</label>
                        <input
                          id="task-provider-search"
                          type="text"
                          className="input"
                          placeholder="Search by name…"
                          value={providerQuery}
                          onChange={(e) => setProviderQuery(e.target.value)}
                        />
                        {providerSearchLoading && <p className="mt-1 text-xs text-gray-500">Searching…</p>}
                        {selectedProviderLabel && !providerSearchLoading && (
                          <p className="mt-1 text-xs text-gray-600">Selected: {selectedProviderLabel}</p>
                        )}
                        {providerResults.length > 0 && (
                          <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200">
                            {providerResults.map((p) => (
                              <li key={p.id}>
                                <button
                                  type="button"
                                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                                  onClick={() => {
                                    setValue('providerId', p.id, { shouldDirty: true });
                                    setSelectedProviderLabel(`${p.firstName} ${p.lastName}`);
                                    setProviderQuery(`${p.firstName} ${p.lastName}`);
                                    setProviderResults([]);
                                  }}
                                >
                                  {p.firstName} {p.lastName}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {linkType === 'practice' && (
                      <div>
                        <label htmlFor="task-practice" className="label">Practice</label>
                        <select id="task-practice" {...register('practiceId')} className="input">
                          <option value="">Select a practice</option>
                          {(practiceOptions ?? []).map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="flex justify-end gap-3 border-t pt-4">
                      <button type="button" onClick={guardedClose} className="btn-secondary">
                        Cancel
                      </button>
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
