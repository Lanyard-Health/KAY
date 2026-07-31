import { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { notify } from '../../utils/notify';
import { useAuthStore } from '../../stores/auth.store';
import ConfirmDialog from '../../components/ConfirmDialog';
import PayerCombobox, { type PayerOption } from '../tasks/PayerCombobox';
import { isPracticeEnrollment } from './enrollmentSubject';

// Mirrors ProviderEnrollments.tsx (module-private there; duplicating a few
// constants beats refactoring a 1,500-line file).
const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'terminated', label: 'Terminated' },
];

const PRODUCT_TYPE_OPTIONS = [
  'Commercial',
  'Medicare',
  'Medicaid',
  'Medicare Advantage',
  'Managed Medicaid',
  'EAP',
  'Tricare',
  'Workers Comp',
];

// Mirrors backend validateStatusTransition (enrollment.service.ts): forward-only
// by rank; denied/terminated reachable from any non-terminal state; terminal is
// final (corrections go through the status-correction endpoint instead).
const STATUS_RANK: Record<string, number> = {
  not_started: 0,
  in_progress: 1,
  submitted: 2,
  pending_review: 3,
  approved: 4,
  denied: 5,
  terminated: 6,
};
const TERMINAL_STATUSES = ['denied', 'terminated'];
const CONFIRM_STATUSES = ['approved', 'denied', 'terminated'];
const CORRECTION_ROLES = ['admin', 'lanyard_staff', 'credentialing_staff'];
// Mirrors the backend gate: payer/subject reassignment only before submission.
const REASSIGNABLE_STATUSES = ['not_started', 'in_progress'];

function allowedStatusValues(current: string): string[] {
  if (TERMINAL_STATUSES.includes(current)) return [current];
  return STATUS_OPTIONS.map((o) => o.value).filter(
    (v) =>
      v === current ||
      v === 'denied' ||
      v === 'terminated' ||
      (STATUS_RANK[v] ?? 0) > (STATUS_RANK[current] ?? 0),
  );
}

function statusLabel(value: string): string {
  return STATUS_OPTIONS.find((o) => o.value === value)?.label || value;
}

function confirmCopy(status: string): { title: string; message: string; variant: 'warning' | 'danger' } {
  if (status === 'approved') {
    return {
      title: 'Mark as Approved?',
      message:
        'This records the approval and notifies your team (first time only). If this enrollment was not actually approved, cancel now.',
      variant: 'warning',
    };
  }
  const label = statusLabel(status);
  return {
    title: `Mark as ${label}?`,
    message: `This is a final status: remaining workflow steps will be skipped${
      status === 'denied' ? ' and your team will be notified (first time only)' : ''
    }. A mistake here needs a staff status correction to undo.`,
    variant: 'danger',
  };
}

interface EnrollmentEditFormData {
  status: string;
  productTypes: string[];
  applicationDate: string;
  effectiveDate: string;
  terminationDate: string;
  dateContractReceived: string;
  dateContractSigned: string;
  lastFollowUpDate: string;
  recredentialingDate: string;
  providerNumber: string;
  groupNumber: string;
}

const DATE_FIELDS: Array<{ key: keyof EnrollmentEditFormData; label: string }> = [
  { key: 'applicationDate', label: 'Application Submission Date' },
  { key: 'effectiveDate', label: 'Effective Date' },
  { key: 'terminationDate', label: 'Termination Date' },
  { key: 'dateContractReceived', label: 'Contract Received' },
  { key: 'dateContractSigned', label: 'Contract Signed' },
  { key: 'lastFollowUpDate', label: 'Last Follow-up' },
  { key: 'recredentialingDate', label: 'Recredentialing' },
];

interface EnrollmentEditModalProps {
  enrollment: any;
  isOpen: boolean;
  onClose: () => void;
}

export default function EnrollmentEditModal({ enrollment, isOpen, onClose }: EnrollmentEditModalProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canCorrect = CORRECTION_ROLES.includes(user?.role ?? '');

  const [formData, setFormData] = useState<EnrollmentEditFormData>({
    status: '',
    productTypes: [],
    applicationDate: '',
    effectiveDate: '',
    terminationDate: '',
    dateContractReceived: '',
    dateContractSigned: '',
    lastFollowUpDate: '',
    recredentialingDate: '',
    providerNumber: '',
    groupNumber: '',
  });
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionTarget, setCorrectionTarget] = useState('');
  const [correctionConfirmOpen, setCorrectionConfirmOpen] = useState(false);

  // Payer / provider / practice are first-class editable fields (pre-submission
  // only — after submission they're facts and render disabled).
  const isPractice = enrollment ? isPracticeEnrollment(enrollment) : false;
  const reassignable = REASSIGNABLE_STATUSES.includes(enrollment?.status ?? '');
  const [newPayer, setNewPayer] = useState<PayerOption | null>(null);
  const [targetProviderId, setTargetProviderId] = useState('');
  const [targetPracticeId, setTargetPracticeId] = useState('');

  const { data: providerOptions } = useQuery({
    queryKey: ['all-providers'],
    enabled: isOpen && reassignable && !isPractice,
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { data: { id: string; firstName: string; lastName: string; practiceId: string | null }[] };
      }>('/providers?pageSize=100');
      return res.data.data.data;
    },
  });

  const { data: practiceOptions } = useQuery({
    queryKey: ['practices-options'],
    enabled: isOpen && reassignable && isPractice,
    queryFn: async () => (await api.get('/practices')).data.data as { id: string; name: string }[],
  });

  useEffect(() => {
    if (isOpen && enrollment) {
      setFormData({
        status: enrollment.status || 'not_started',
        productTypes: enrollment.productTypes || [],
        applicationDate: enrollment.applicationDate?.split('T')[0] || '',
        effectiveDate: enrollment.effectiveDate?.split('T')[0] || '',
        terminationDate: enrollment.terminationDate?.split('T')[0] || '',
        dateContractReceived: enrollment.dateContractReceived?.split('T')[0] || '',
        dateContractSigned: enrollment.dateContractSigned?.split('T')[0] || '',
        lastFollowUpDate: enrollment.lastFollowUpDate?.split('T')[0] || '',
        recredentialingDate: enrollment.recredentialingDate?.split('T')[0] || '',
        providerNumber: enrollment.providerNumber || '',
        groupNumber: enrollment.groupNumber || '',
      });
      setConfirmStatus(null);
      setCorrectionOpen(false);
      setCorrectionTarget('');
      setCorrectionConfirmOpen(false);
      setNewPayer(null);
      setTargetProviderId(enrollment.providerId || '');
      setTargetPracticeId(enrollment.practiceId || '');
    }
  }, [isOpen, enrollment]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['enrollment', enrollment.id] });
    queryClient.invalidateQueries({ queryKey: ['all-enrollments'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-full'] });
    queryClient.invalidateQueries({ queryKey: ['enrollment-workflow', enrollment.id] });
    if (enrollment.providerId) {
      queryClient.invalidateQueries({ queryKey: ['enrollments', enrollment.providerId] });
    }
  };

  const buildPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = { ...formData };
    if (newPayer && newPayer.id !== enrollment.payerId) payload['payerId'] = newPayer.id;
    if (!isPractice && targetProviderId && targetProviderId !== enrollment.providerId) {
      payload['providerId'] = targetProviderId;
    }
    if (isPractice && targetPracticeId && targetPracticeId !== enrollment.practiceId) {
      payload['practiceId'] = targetPracticeId;
    }
    return payload;
  };

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put(`/enrollments/${enrollment.id}`, data),
    onSuccess: () => {
      invalidateAll();
      notify.success('Enrollment updated');
      onClose();
    },
    onError: (error: any) => {
      notify.error(error?.response?.data?.error?.message || 'Failed to update enrollment');
    },
  });

  const correctionMutation = useMutation({
    mutationFn: (toStatus: string) =>
      api.post(`/enrollments/${enrollment.id}/status-correction`, { toStatus }),
    onSuccess: () => {
      invalidateAll();
      notify.success('Status corrected');
      onClose();
    },
    onError: (error: any) => {
      notify.error(error?.response?.data?.error?.message || 'Failed to correct status');
    },
  });

  const currentStatus = enrollment?.status || 'not_started';
  const isTerminal = TERMINAL_STATUSES.includes(currentStatus);
  const statusValues = allowedStatusValues(currentStatus);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.status !== currentStatus && CONFIRM_STATUSES.includes(formData.status)) {
      setConfirmStatus(formData.status);
      return;
    }
    updateMutation.mutate(buildPayload());
  };

  if (!enrollment) return null;

  return (
    <>
      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-40" onClose={onClose}>
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
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <Dialog.Title className="text-lg font-semibold text-gray-900">
                        Edit Enrollment
                      </Dialog.Title>
                      <p className="mt-0.5 text-sm text-gray-500">
                        <span className="font-medium text-gray-700">
                          {enrollment.payer?.name || 'Unknown payer'}
                        </span>
                        {' · '}
                        {isPractice
                          ? `${enrollment.practice?.name ?? 'Unknown practice'} (practice/group enrollment)`
                          : `${enrollment.provider?.firstName ?? ''} ${enrollment.provider?.lastName ?? ''}`.trim() ||
                            'Unknown provider'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-lg p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Payer + subject — ordinary fields, editable until submission */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="edit-enrollment-payer" className="block text-sm font-medium text-gray-700 mb-1">
                          Payer
                        </label>
                        <PayerCombobox
                          id="edit-enrollment-payer"
                          disabled={!reassignable}
                          value={
                            newPayer ??
                            (enrollment.payer ? { id: enrollment.payerId, name: enrollment.payer.name } : null)
                          }
                          onChange={setNewPayer}
                        />
                      </div>

                      {!isPractice ? (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
                          <select
                            value={targetProviderId}
                            disabled={!reassignable}
                            onChange={(e) => setTargetProviderId(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500 disabled:bg-gray-50 disabled:text-gray-500"
                          >
                            {(providerOptions ?? [])
                              .filter(
                                (p) =>
                                  !enrollment.provider?.practice?.id ||
                                  p.practiceId === enrollment.provider.practice.id ||
                                  p.id === enrollment.providerId
                              )
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.firstName} {p.lastName}
                                </option>
                              ))}
                            {!providerOptions?.length && enrollment.provider && (
                              <option value={enrollment.providerId}>
                                {enrollment.provider.firstName} {enrollment.provider.lastName}
                              </option>
                            )}
                          </select>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Practice</label>
                          <select
                            value={targetPracticeId}
                            disabled={!reassignable}
                            onChange={(e) => setTargetPracticeId(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500 disabled:bg-gray-50 disabled:text-gray-500"
                          >
                            {(practiceOptions ?? []).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                            {!practiceOptions?.length && enrollment.practice && (
                              <option value={enrollment.practiceId}>{enrollment.practice.name}</option>
                            )}
                          </select>
                        </div>
                      )}
                    </div>
                    {!reassignable && (
                      <p className="-mt-2 text-xs text-gray-500">
                        The payer and {isPractice ? 'practice' : 'provider'} are locked once an
                        application is submitted.
                      </p>
                    )}

                    {/* Status */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                      <select
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                        disabled={isTerminal}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500 disabled:bg-gray-50 disabled:text-gray-500"
                      >
                        {statusValues.map((v) => (
                          <option key={v} value={v}>
                            {statusLabel(v)}
                          </option>
                        ))}
                      </select>
                      {isTerminal && (
                        <p className="mt-1 text-xs text-gray-500">
                          This status is final.{' '}
                          {canCorrect ? 'Made a mistake? Use Correct status below.' : 'Contact staff to correct a mistake.'}
                        </p>
                      )}
                    </div>

                    {/* Correct status (staff only) */}
                    {canCorrect && (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        {!correctionOpen ? (
                          <button
                            type="button"
                            onClick={() => setCorrectionOpen(true)}
                            className="text-sm font-medium text-primary-600 hover:text-primary-700"
                          >
                            Correct a mis-clicked status…
                          </button>
                        ) : (
                          <div className="space-y-2">
                            <label className="block text-xs font-medium text-gray-600">
                              Correct status to
                            </label>
                            <div className="flex items-center gap-2">
                              <select
                                value={correctionTarget}
                                onChange={(e) => setCorrectionTarget(e.target.value)}
                                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                              >
                                <option value="">Select status…</option>
                                {STATUS_OPTIONS.filter((o) => o.value !== currentStatus).map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={!correctionTarget}
                                onClick={() => setCorrectionConfirmOpen(true)}
                                className="rounded-lg bg-white border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                              >
                                Correct
                              </button>
                            </div>
                            <p className="text-xs text-gray-500">
                              For fixing wrong clicks. No emails are sent and records are cleaned up.
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Dates */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {DATE_FIELDS.map(({ key, label }) => (
                        <div key={key}>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                          <input
                            type="date"
                            value={formData[key] as string}
                            onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                          />
                        </div>
                      ))}
                    </div>

                    {/* Numbers */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Provider #</label>
                        <input
                          type="text"
                          maxLength={50}
                          value={formData.providerNumber}
                          onChange={(e) => setFormData({ ...formData, providerNumber: e.target.value })}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Group #</label>
                        <input
                          type="text"
                          maxLength={50}
                          value={formData.groupNumber}
                          onChange={(e) => setFormData({ ...formData, groupNumber: e.target.value })}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                        />
                      </div>
                    </div>

                    {/* Product types */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Product Types</label>
                      <div className="flex flex-wrap gap-2">
                        {PRODUCT_TYPE_OPTIONS.map((type) => (
                          <label
                            key={type}
                            className={`inline-flex items-center px-3 py-1 rounded-full text-sm cursor-pointer border ${
                              formData.productTypes.includes(type)
                                ? 'bg-primary-100 border-primary-500 text-primary-800'
                                : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={formData.productTypes.includes(type)}
                              onChange={(e) => {
                                setFormData({
                                  ...formData,
                                  productTypes: e.target.checked
                                    ? [...formData.productTypes, type]
                                    : formData.productTypes.filter((t) => t !== type),
                                });
                              }}
                              className="sr-only"
                            />
                            {type}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Notes moved to the timestamped feed on the detail page */}

                    <div className="flex justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={updateMutation.isPending}
                        className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
                      >
                        {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                      </button>
                    </div>
                  </form>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Confirm terminal / notification-bearing status */}
      <ConfirmDialog
        isOpen={confirmStatus !== null}
        onClose={() => setConfirmStatus(null)}
        onConfirm={() => {
          setConfirmStatus(null);
          updateMutation.mutate(buildPayload());
        }}
        title={confirmStatus ? confirmCopy(confirmStatus).title : ''}
        message={confirmStatus ? confirmCopy(confirmStatus).message : ''}
        confirmLabel={confirmStatus ? `Mark as ${statusLabel(confirmStatus)}` : 'Confirm'}
        variant={confirmStatus ? confirmCopy(confirmStatus).variant : 'warning'}
        isLoading={updateMutation.isPending}
      />

      {/* Confirm status correction */}
      <ConfirmDialog
        isOpen={correctionConfirmOpen}
        onClose={() => setCorrectionConfirmOpen(false)}
        onConfirm={() => {
          setCorrectionConfirmOpen(false);
          correctionMutation.mutate(correctionTarget);
        }}
        title={`Correct status to ${statusLabel(correctionTarget)}?`}
        message="This fixes a mis-clicked status. No emails will be sent, the outcome record for the old status will be removed, and auto-skipped workflow steps will be restored. The change is audit-logged."
        confirmLabel="Correct status"
        variant="warning"
        isLoading={correctionMutation.isPending}
      />
    </>
  );
}
