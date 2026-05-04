import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateMalpracticeClaim, useUpdateMalpracticeClaim } from '../../hooks/usePayerEnrollmentData';

interface MalpracticeClaimFormData {
  // Core
  dateOfIncident: string;
  dateOfClaim: string;
  claimStatus: string;
  description: string;
  notes: string;

  // Outcome
  settlementAmount: string;
  settlementAmountPaid: string;
  judgmentAmount: string;
  dateResolved: string;
  resolutionMethod: string;

  // Defendant context
  isLeadDefendant: boolean;
  defendantRole: string;
  numberOtherCodefendants: string;
  caseInvolvement: string;

  // Allegation / injury
  allegationDescription: string;
  patientInjuryDescription: string;
  patientGenderAge: string;
  npdbReported: boolean;
  patientDied: boolean;
  narrative: string;

  // Insurance
  insuranceCarrier: string;
  policyNumber: string;

  // Court / litigation
  courtName: string;
  caseNumber: string;
  courtAddressLine1: string;
  courtCity: string;
  courtState: string;
  courtZipCode: string;
  courtPhone: string;
  courtCountry: string;
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

const EMPTY_FORM: MalpracticeClaimFormData = {
  dateOfIncident: '',
  dateOfClaim: '',
  claimStatus: 'OPEN',
  description: '',
  notes: '',
  settlementAmount: '',
  settlementAmountPaid: '',
  judgmentAmount: '',
  dateResolved: '',
  resolutionMethod: '',
  isLeadDefendant: false,
  defendantRole: '',
  numberOtherCodefendants: '',
  caseInvolvement: '',
  allegationDescription: '',
  patientInjuryDescription: '',
  patientGenderAge: '',
  npdbReported: false,
  patientDied: false,
  narrative: '',
  insuranceCarrier: '',
  policyNumber: '',
  courtName: '',
  caseNumber: '',
  courtAddressLine1: '',
  courtCity: '',
  courtState: '',
  courtZipCode: '',
  courtPhone: '',
  courtCountry: '',
};

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
    defaultValues: EMPTY_FORM,
  });

  useEffect(() => {
    if (claim) {
      reset({
        dateOfIncident: formatDate(claim.dateOfIncident),
        dateOfClaim: formatDate(claim.dateOfClaim),
        claimStatus: claim.claimStatus || 'OPEN',
        description: claim.description || '',
        notes: claim.notes || '',
        settlementAmount: claim.settlementAmount?.toString() || '',
        settlementAmountPaid: claim.settlementAmountPaid?.toString() || '',
        judgmentAmount: claim.judgmentAmount?.toString() || '',
        dateResolved: formatDate(claim.dateResolved),
        resolutionMethod: claim.resolutionMethod || '',
        isLeadDefendant: claim.isLeadDefendant ?? false,
        defendantRole: claim.defendantRole || '',
        numberOtherCodefendants: claim.numberOtherCodefendants?.toString() || '',
        caseInvolvement: claim.caseInvolvement || '',
        allegationDescription: claim.allegationDescription || '',
        patientInjuryDescription: claim.patientInjuryDescription || '',
        patientGenderAge: claim.patientGenderAge || '',
        npdbReported: claim.npdbReported ?? false,
        patientDied: claim.patientDied ?? false,
        narrative: claim.narrative || '',
        insuranceCarrier: claim.insuranceCarrier || '',
        policyNumber: claim.policyNumber || '',
        courtName: claim.courtName || '',
        caseNumber: claim.caseNumber || '',
        courtAddressLine1: claim.courtAddressLine1 || '',
        courtCity: claim.courtCity || '',
        courtState: claim.courtState || '',
        courtZipCode: claim.courtZipCode || '',
        courtPhone: claim.courtPhone || '',
        courtCountry: claim.courtCountry || '',
      });
    } else {
      reset(EMPTY_FORM);
    }
  }, [claim, reset]);

  const createMutation = useCreateMalpracticeClaim();
  const updateMutation = useUpdateMalpracticeClaim();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: MalpracticeClaimFormData) => {
    // Strip empty strings so the server-side schema's `.optional()` paths don't
    // get tripped up by `state: ""` etc., and coerce numerics.
    const blank = (v: string) => v === '' ? undefined : v;
    const num = (v: string) => v === '' ? undefined : Number(v);
    const intNum = (v: string) => v === '' ? undefined : parseInt(v, 10);

    const payload = {
      dateOfIncident: data.dateOfIncident,
      dateOfClaim: data.dateOfClaim,
      claimStatus: data.claimStatus,
      description: data.description,
      notes: blank(data.notes),
      settlementAmount: num(data.settlementAmount),
      settlementAmountPaid: num(data.settlementAmountPaid),
      judgmentAmount: num(data.judgmentAmount),
      dateResolved: blank(data.dateResolved),
      resolutionMethod: blank(data.resolutionMethod),
      isLeadDefendant: data.isLeadDefendant,
      defendantRole: blank(data.defendantRole),
      numberOtherCodefendants: intNum(data.numberOtherCodefendants),
      caseInvolvement: blank(data.caseInvolvement),
      allegationDescription: blank(data.allegationDescription),
      patientInjuryDescription: blank(data.patientInjuryDescription),
      patientGenderAge: blank(data.patientGenderAge),
      npdbReported: data.npdbReported,
      patientDied: data.patientDied,
      narrative: blank(data.narrative),
      insuranceCarrier: blank(data.insuranceCarrier),
      policyNumber: blank(data.policyNumber),
      courtName: blank(data.courtName),
      caseNumber: blank(data.caseNumber),
      courtAddressLine1: blank(data.courtAddressLine1),
      courtCity: blank(data.courtCity),
      courtState: blank(data.courtState),
      courtZipCode: blank(data.courtZipCode),
      courtPhone: blank(data.courtPhone),
      courtCountry: blank(data.courtCountry),
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-3xl">
                <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4 max-h-[85vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-4 sticky top-0 bg-white pb-2 -mx-6 px-6 border-b">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      {isEditing ? 'Edit Malpractice Claim' : 'Add Malpractice Claim'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    {/* ──────────── Core ──────────── */}
                    <fieldset className="space-y-4">
                      <legend className="text-sm font-semibold text-gray-700">Core</legend>
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
                      <div>
                        <label className="label">Claim Status</label>
                        <select {...register('claimStatus')} className="input">
                          {CLAIM_STATUSES.map((status) => (
                            <option key={status.value} value={status.value}>
                              {status.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label">Description *</label>
                        <textarea
                          {...register('description', { required: 'Required', maxLength: { value: 5000, message: 'Max 5000 characters' } })}
                          className="input"
                          rows={3}
                          placeholder="Short summary used in lists and credentialing reports"
                        />
                        {errors.description && (
                          <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
                        )}
                      </div>
                    </fieldset>

                    {/* ──────────── Outcome ──────────── */}
                    <fieldset className="space-y-4">
                      <legend className="text-sm font-semibold text-gray-700">Outcome</legend>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="label">Resolution Method</label>
                          <input
                            {...register('resolutionMethod')}
                            className="input"
                            placeholder="e.g. Settlement, Judgment for Defendant"
                          />
                        </div>
                        <div>
                          <label className="label">Date Resolved</label>
                          <input type="date" {...register('dateResolved')} className="input" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div>
                          <label className="label">Settlement Amount</label>
                          <input
                            type="number"
                            step="0.01"
                            {...register('settlementAmount')}
                            className="input"
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <label className="label">Settlement Paid To Date</label>
                          <input
                            type="number"
                            step="0.01"
                            {...register('settlementAmountPaid')}
                            className="input"
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <label className="label">Judgment Amount</label>
                          <input
                            type="number"
                            step="0.01"
                            {...register('judgmentAmount')}
                            className="input"
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                    </fieldset>

                    {/* ──────────── Defendant context ──────────── */}
                    <fieldset className="space-y-4">
                      <legend className="text-sm font-semibold text-gray-700">Defendant Context</legend>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="flex items-center gap-3 pt-6">
                          <input
                            type="checkbox"
                            {...register('isLeadDefendant')}
                            id="claim-lead-defendant"
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <label htmlFor="claim-lead-defendant" className="label mb-0">
                            Lead / primary defendant
                          </label>
                        </div>
                        <div>
                          <label className="label"># Other Co-defendants</label>
                          <input
                            type="number"
                            min="0"
                            {...register('numberOtherCodefendants')}
                            className="input"
                            placeholder="0"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="label">Defendant Role</label>
                        <input
                          {...register('defendantRole')}
                          className="input"
                          placeholder="e.g. Treating physician, Attending"
                        />
                      </div>
                      <div>
                        <label className="label">Case Involvement</label>
                        <textarea
                          {...register('caseInvolvement')}
                          className="input"
                          rows={2}
                          placeholder="Provider's role and involvement in the underlying care"
                        />
                      </div>
                    </fieldset>

                    {/* ──────────── Allegation / injury ──────────── */}
                    <fieldset className="space-y-4">
                      <legend className="text-sm font-semibold text-gray-700">Allegation &amp; Injury</legend>
                      <div>
                        <label className="label">Allegation Description</label>
                        <textarea
                          {...register('allegationDescription')}
                          className="input"
                          rows={3}
                          placeholder="What the plaintiff alleged"
                        />
                      </div>
                      <div>
                        <label className="label">Patient Injury Description</label>
                        <textarea
                          {...register('patientInjuryDescription')}
                          className="input"
                          rows={3}
                          placeholder="Nature and extent of patient harm"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div>
                          <label className="label">Patient Gender / Age</label>
                          <input
                            {...register('patientGenderAge')}
                            className="input"
                            placeholder="e.g. F / 42"
                          />
                        </div>
                        <div className="flex items-center gap-3 pt-6">
                          <input
                            type="checkbox"
                            {...register('npdbReported')}
                            id="claim-npdb"
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <label htmlFor="claim-npdb" className="label mb-0" title="Reported to the National Practitioner Data Bank">
                            NPDB reported
                          </label>
                        </div>
                        <div className="flex items-center gap-3 pt-6">
                          <input
                            type="checkbox"
                            {...register('patientDied')}
                            id="claim-patient-died"
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <label htmlFor="claim-patient-died" className="label mb-0">
                            Patient died
                          </label>
                        </div>
                      </div>
                      <div>
                        <label className="label">Narrative</label>
                        <textarea
                          {...register('narrative')}
                          className="input"
                          rows={3}
                          placeholder="Free-form narrative for credentialing-committee review"
                        />
                      </div>
                    </fieldset>

                    {/* ──────────── Insurance ──────────── */}
                    <fieldset className="space-y-4">
                      <legend className="text-sm font-semibold text-gray-700">Insurance</legend>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="label">Insurance Carrier</label>
                          <input {...register('insuranceCarrier')} className="input" placeholder="Carrier name" />
                        </div>
                        <div>
                          <label className="label">Policy Number</label>
                          <input {...register('policyNumber')} className="input" placeholder="Policy number" />
                        </div>
                      </div>
                    </fieldset>

                    {/* ──────────── Court / litigation ──────────── */}
                    <fieldset className="space-y-4">
                      <legend className="text-sm font-semibold text-gray-700">Court &amp; Litigation</legend>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="label">Court Name</label>
                          <input {...register('courtName')} className="input" placeholder="Court name" />
                        </div>
                        <div>
                          <label className="label">Case Number</label>
                          <input {...register('caseNumber')} className="input" placeholder="Case number" />
                        </div>
                      </div>
                      <div>
                        <label className="label">Court Address Line 1</label>
                        <input {...register('courtAddressLine1')} className="input" placeholder="Street address" />
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div>
                          <label className="label">City</label>
                          <input {...register('courtCity')} className="input" />
                        </div>
                        <div>
                          <label className="label">State</label>
                          <input
                            {...register('courtState', {
                              maxLength: { value: 2, message: '2-letter abbreviation' },
                            })}
                            className="input"
                            maxLength={2}
                            placeholder="CA"
                          />
                          {errors.courtState && (
                            <p className="mt-1 text-sm text-red-600">{errors.courtState.message}</p>
                          )}
                        </div>
                        <div>
                          <label className="label">ZIP</label>
                          <input {...register('courtZipCode')} className="input" placeholder="00000" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className="label">Court Phone</label>
                          <input {...register('courtPhone')} className="input" placeholder="(000) 000-0000" />
                        </div>
                        <div>
                          <label className="label">Country</label>
                          <input {...register('courtCountry')} className="input" placeholder="United States" />
                        </div>
                      </div>
                    </fieldset>

                    {/* ──────────── Notes ──────────── */}
                    <fieldset className="space-y-4">
                      <legend className="text-sm font-semibold text-gray-700">Internal Notes</legend>
                      <div>
                        <label className="label">Notes</label>
                        <textarea
                          {...register('notes', { maxLength: { value: 1000, message: 'Max 1000 characters' } })}
                          className="input"
                          rows={2}
                          placeholder="Internal notes, not part of the credentialing record"
                        />
                        {errors.notes && (
                          <p className="mt-1 text-sm text-red-600">{errors.notes.message}</p>
                        )}
                      </div>
                    </fieldset>

                    {/* Actions */}
                    <div className="flex justify-end gap-3 pt-4 border-t sticky bottom-0 bg-white -mx-6 px-6 pb-1">
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
