import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateMalpracticeClaim, useUpdateMalpracticeClaim } from '../../hooks/usePayerEnrollmentData';

interface MalpracticeClaimFormData {
  dateOfIncident: string;
  dateOfClaim: string;
  claimStatus: string;
  description: string;
  settlementAmount: string;
  judgmentAmount: string;
  dateResolved: string;
  insuranceCarrier: string;
  policyNumber: string;
  courtName: string;
  caseNumber: string;
  notes: string;
}

interface MalpracticeClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  claim?: any;
}

const CLAIM_STATUSES = [
  { value: 'OPEN', label: 'Open' },
  { value: 'SETTLED', label: 'Settled' },
  { value: 'DISMISSED', label: 'Dismissed' },
  { value: 'JUDGMENT_FOR_PROVIDER', label: 'Judgment for Provider' },
  { value: 'JUDGMENT_AGAINST_PROVIDER', label: 'Judgment Against Provider' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
];

const formatDate = (d: string | undefined) => d ? d.substring(0, 10) : '';

export default function MalpracticeClaimModal({
  isOpen,
  onClose,
  providerId,
  claim,
}: MalpracticeClaimModalProps) {
  const isEditing = !!claim;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MalpracticeClaimFormData>({
    defaultValues: {
      dateOfIncident: '',
      dateOfClaim: '',
      claimStatus: 'OPEN',
      description: '',
      settlementAmount: '',
      judgmentAmount: '',
      dateResolved: '',
      insuranceCarrier: '',
      policyNumber: '',
      courtName: '',
      caseNumber: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (claim) {
      reset({
        dateOfIncident: formatDate(claim.dateOfIncident),
        dateOfClaim: formatDate(claim.dateOfClaim),
        claimStatus: claim.claimStatus || 'OPEN',
        description: claim.description || '',
        settlementAmount: claim.settlementAmount?.toString() || '',
        judgmentAmount: claim.judgmentAmount?.toString() || '',
        dateResolved: formatDate(claim.dateResolved),
        insuranceCarrier: claim.insuranceCarrier || '',
        policyNumber: claim.policyNumber || '',
        courtName: claim.courtName || '',
        caseNumber: claim.caseNumber || '',
        notes: claim.notes || '',
      });
    } else {
      reset({
        dateOfIncident: '',
        dateOfClaim: '',
        claimStatus: 'OPEN',
        description: '',
        settlementAmount: '',
        judgmentAmount: '',
        dateResolved: '',
        insuranceCarrier: '',
        policyNumber: '',
        courtName: '',
        caseNumber: '',
        notes: '',
      });
    }
  }, [claim, reset]);

  const createMutation = useCreateMalpracticeClaim();
  const updateMutation = useUpdateMalpracticeClaim();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: MalpracticeClaimFormData) => {
    const payload = {
      ...data,
      settlementAmount: data.settlementAmount ? Number(data.settlementAmount) : undefined,
      judgmentAmount: data.judgmentAmount ? Number(data.judgmentAmount) : undefined,
      dateResolved: data.dateResolved || undefined,
      insuranceCarrier: data.insuranceCarrier || undefined,
      policyNumber: data.policyNumber || undefined,
      courtName: data.courtName || undefined,
      caseNumber: data.caseNumber || undefined,
      notes: data.notes || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: claim.id, providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Malpractice claim updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to update malpractice claim');
          },
        }
      );
    } else {
      createMutation.mutate(
        { providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Malpractice claim added');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to add malpractice claim');
          },
        }
      );
    }
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl">
                <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      {isEditing ? 'Edit Malpractice Claim' : 'Add Malpractice Claim'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Incident + Claim Dates */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Date of Incident *</label>
                        <input
                          type="date"
                          {...register('dateOfIncident', { required: 'Required' })}
                          className="input"
                        />
                        {errors.dateOfIncident && (
                          <p className="mt-1 text-sm text-red-600">{errors.dateOfIncident.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Date of Claim *</label>
                        <input
                          type="date"
                          {...register('dateOfClaim', { required: 'Required' })}
                          className="input"
                        />
                        {errors.dateOfClaim && (
                          <p className="mt-1 text-sm text-red-600">{errors.dateOfClaim.message}</p>
                        )}
                      </div>
                    </div>

                    {/* Claim Status */}
                    <div>
                      <label className="label">Claim Status</label>
                      <select
                        {...register('claimStatus')}
                        className="input"
                      >
                        {CLAIM_STATUSES.map((status) => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Description */}
                    <div>
                      <label className="label">Description *</label>
                      <textarea
                        {...register('description', { required: 'Required', maxLength: { value: 2000, message: 'Max 2000 characters' } })}
                        className="input"
                        rows={3}
                        placeholder="Describe the claim"
                      />
                      {errors.description && (
                        <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
                      )}
                    </div>

                    {/* Amounts */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Settlement Amount</label>
                        <input
                          type="number"
                          {...register('settlementAmount')}
                          className="input"
                          placeholder="$0.00"
                        />
                      </div>
                      <div>
                        <label className="label">Judgment Amount</label>
                        <input
                          type="number"
                          {...register('judgmentAmount')}
                          className="input"
                          placeholder="$0.00"
                        />
                      </div>
                    </div>

                    {/* Date Resolved */}
                    <div>
                      <label className="label">Date Resolved</label>
                      <input
                        type="date"
                        {...register('dateResolved')}
                        className="input"
                      />
                    </div>

                    {/* Insurance Carrier + Policy */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Insurance Carrier</label>
                        <input
                          {...register('insuranceCarrier')}
                          className="input"
                          placeholder="Carrier name"
                        />
                      </div>
                      <div>
                        <label className="label">Policy Number</label>
                        <input
                          {...register('policyNumber')}
                          className="input"
                          placeholder="Policy number"
                        />
                      </div>
                    </div>

                    {/* Court + Case */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Court Name</label>
                        <input
                          {...register('courtName')}
                          className="input"
                          placeholder="Court name"
                        />
                      </div>
                      <div>
                        <label className="label">Case Number</label>
                        <input
                          {...register('caseNumber')}
                          className="input"
                          placeholder="Case number"
                        />
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="label">Notes</label>
                      <textarea
                        {...register('notes', { maxLength: { value: 1000, message: 'Max 1000 characters' } })}
                        className="input"
                        rows={2}
                      />
                      {errors.notes && (
                        <p className="mt-1 text-sm text-red-600">{errors.notes.message}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-3 pt-4 border-t">
                      <button type="button" onClick={onClose} className="btn-secondary">
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={mutation.isPending}
                        className="btn-primary"
                      >
                        {mutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add Claim'}
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
