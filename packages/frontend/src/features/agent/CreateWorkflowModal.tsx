import { Fragment, useState, useEffect } from 'react';
import { Dialog, Transition, RadioGroup } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { clsx } from 'clsx';
import { api } from '../../services/api';
import { useLaunchWorkflow } from '../../hooks/useAgentWorkflows';

interface Provider {
  id: string;
  firstName: string;
  lastName: string;
  npi: string;
}

interface Payer {
  id: string;
  name: string;
}

interface Enrollment {
  id: string;
  payer: { id: string; name: string };
  status: string;
}

const GOAL_TEMPLATES = [
  'Check enrollment status',
  'Submit enrollment to portal',
  'Follow up on pending application',
  'Process uploaded documents',
  'Check provider readiness',
];

const PRIORITIES = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-600 ring-gray-200', dotColor: 'bg-gray-400' },
  { value: 'normal', label: 'Normal', color: 'bg-blue-50 text-blue-700 ring-blue-200', dotColor: 'bg-blue-500' },
  { value: 'high', label: 'High', color: 'bg-amber-50 text-amber-700 ring-amber-200', dotColor: 'bg-amber-500' },
  { value: 'urgent', label: 'Urgent', color: 'bg-red-50 text-red-700 ring-red-200', dotColor: 'bg-red-500' },
] as const;

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (workflowId: string) => void;
}

export default function CreateWorkflowModal({ open, onClose, onCreated }: Props) {
  const [goal, setGoal] = useState('');
  const [providerId, setProviderId] = useState('');
  const [payerId, setPayerId] = useState('');
  const [enrollmentId, setEnrollmentId] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');

  const [providers, setProviders] = useState<Provider[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [providerSearch, setProviderSearch] = useState('');

  const launchWorkflow = useLaunchWorkflow();

  // Load providers
  useEffect(() => {
    if (!open) return;
    api.get<{ success: boolean; data: { data: Provider[] } }>('/providers?pageSize=100')
      .then((res) => setProviders(res.data?.data?.data ?? res.data?.data ?? []))
      .catch(() => {});
  }, [open]);

  // Load payers
  useEffect(() => {
    if (!open) return;
    api.get<{ success: boolean; data: Payer[] }>('/enrollments/payers')
      .then((res) => setPayers(res.data?.data ?? []))
      .catch(() => {});
  }, [open]);

  // Load enrollments when provider selected
  useEffect(() => {
    if (!providerId) {
      setEnrollments([]);
      return;
    }
    api.get<{ success: boolean; data: { data: Enrollment[] } }>(
      `/enrollments?providerId=${providerId}&pageSize=50`,
    )
      .then((res) => setEnrollments(res.data?.data?.data ?? res.data?.data ?? []))
      .catch(() => setEnrollments([]));
  }, [providerId]);

  const reset = () => {
    setGoal('');
    setProviderId('');
    setPayerId('');
    setEnrollmentId('');
    setPriority('normal');
    setProviderSearch('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    if (!goal.trim() || !providerId) return;
    launchWorkflow.mutate(
      {
        goal: goal.trim(),
        providerId,
        payerId: payerId || undefined,
        enrollmentId: enrollmentId || undefined,
        priority,
      },
      {
        onSuccess: (res) => {
          const wf = res.data;
          reset();
          onCreated(wf.id);
        },
      },
    );
  };

  const filteredProviders = providerSearch
    ? providers.filter(
        (p) =>
          `${p.firstName} ${p.lastName}`.toLowerCase().includes(providerSearch.toLowerCase()) ||
          p.npi.includes(providerSearch),
      )
    : providers;

  const selectedProvider = providers.find((p) => p.id === providerId);

  return (
    <Transition show={open} as={Fragment}>
      <Dialog onClose={handleClose} className="relative z-50">
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30" />
        </Transition.Child>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="mx-auto w-full max-w-lg rounded-2xl bg-white shadow-xl ring-1 ring-gray-200/60 overflow-hidden">
              {/* Gradient Header */}
              <div className="bg-gradient-to-r from-primary-600 to-primary-700 px-6 py-5">
                <div className="flex items-center justify-between">
                  <div>
                    <Dialog.Title className="text-lg font-semibold text-white">
                      New Workflow
                    </Dialog.Title>
                    <p className="mt-0.5 text-sm text-primary-100">
                      Launch an AI agent to automate a credentialing task.
                    </p>
                  </div>
                  <button
                    onClick={handleClose}
                    className="rounded-lg text-primary-200 hover:text-white hover:bg-primary-500/30 p-1 transition-colors"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="space-y-5 px-6 py-5">
                {/* Goal */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Goal</label>
                  {/* Template chips */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {GOAL_TEMPLATES.map((template) => (
                      <button
                        key={template}
                        type="button"
                        onClick={() => setGoal(template)}
                        className={clsx(
                          'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                          goal === template
                            ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-200'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700',
                        )}
                      >
                        {template}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    maxLength={200}
                    rows={2}
                    placeholder="e.g., Enroll Dr. Smith with Aetna"
                    className="block w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
                  />
                  <p className="mt-1 text-xs text-gray-400">{goal.length}/200</p>
                </div>

                {/* Provider */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
                  {selectedProvider && !providerSearch ? (
                    <div className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-200 text-primary-700">
                        <span className="text-xs font-semibold">
                          {getInitials(selectedProvider.firstName, selectedProvider.lastName)}
                        </span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {selectedProvider.firstName} {selectedProvider.lastName}
                        </p>
                        <p className="text-xs text-gray-500">NPI: {selectedProvider.npi}</p>
                      </div>
                      <button
                        onClick={() => {
                          setProviderId('');
                          setProviderSearch('');
                          setEnrollmentId('');
                        }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={providerSearch}
                        onChange={(e) => setProviderSearch(e.target.value)}
                        placeholder="Search by name or NPI..."
                        className="block w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
                      />
                      {(providerSearch || !providerId) && (
                        <div className="mt-1 max-h-36 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                          {filteredProviders.slice(0, 10).map((p) => (
                            <button
                              key={p.id}
                              onClick={() => {
                                setProviderId(p.id);
                                setProviderSearch('');
                                setEnrollmentId('');
                              }}
                              className={clsx(
                                'flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors',
                                providerId === p.id && 'bg-primary-50',
                              )}
                            >
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                                <span className="text-[10px] font-semibold">
                                  {getInitials(p.firstName, p.lastName)}
                                </span>
                              </div>
                              <div>
                                <p className="text-sm text-gray-900">
                                  {p.firstName} {p.lastName}
                                </p>
                                <p className="text-xs text-gray-400">NPI: {p.npi}</p>
                              </div>
                            </button>
                          ))}
                          {filteredProviders.length === 0 && (
                            <p className="px-3 py-3 text-sm text-gray-400">No providers found</p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Payer (optional) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payer <span className="text-gray-400">(optional)</span>
                  </label>
                  <select
                    value={payerId}
                    onChange={(e) => setPayerId(e.target.value)}
                    className="block w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
                  >
                    <option value="">Select payer...</option>
                    {payers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Enrollment (optional, shown when provider selected) */}
                {providerId && enrollments.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Enrollment <span className="text-gray-400">(optional)</span>
                    </label>
                    <select
                      value={enrollmentId}
                      onChange={(e) => setEnrollmentId(e.target.value)}
                      className="block w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
                    >
                      <option value="">Select enrollment...</option>
                      {enrollments.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.payer?.name ?? 'Unknown'} — {e.status.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Priority */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
                  <RadioGroup value={priority} onChange={setPriority} className="grid grid-cols-4 gap-2">
                    {PRIORITIES.map((p) => (
                      <RadioGroup.Option
                        key={p.value}
                        value={p.value}
                        className={({ checked }) =>
                          clsx(
                            'cursor-pointer rounded-lg px-3 py-2.5 text-center text-sm font-medium transition-all',
                            checked
                              ? clsx(p.color, 'ring-1')
                              : 'bg-gray-50 text-gray-500 hover:bg-gray-100 ring-1 ring-gray-200',
                          )
                        }
                      >
                        {({ checked }) => (
                          <div className="flex flex-col items-center gap-1">
                            <div
                              className={clsx(
                                'h-2 w-2 rounded-full',
                                checked ? p.dotColor : 'bg-gray-300',
                              )}
                            />
                            <span>{p.label}</span>
                          </div>
                        )}
                      </RadioGroup.Option>
                    ))}
                  </RadioGroup>
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4 bg-gray-50/50">
                <button
                  onClick={handleClose}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!goal.trim() || !providerId || launchWorkflow.isPending}
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {launchWorkflow.isPending ? 'Launching...' : 'Launch Workflow'}
                </button>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
