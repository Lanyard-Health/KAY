import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateMalpracticeInsurance, useUpdateMalpracticeInsurance } from '../../hooks/usePayerEnrollmentData';

interface MalpracticeInsuranceFormData {
  carrierName: string;
  policyNumber: string;
  coverageType: string;
  perClaimAmount: string;
  aggregateAmount: string;
  effectiveDate: string;
  expirationDate: string;
  retroactiveDate: string;
  hasTailCoverage: boolean;
  hasGapInCoverage: boolean;
  gapExplanation: string;
  isSelfInsured: boolean;
  hasUnlimitedCoverage: boolean;
  isIndividualCoverage: boolean;
  coveredLocationIds: string[];
  status: string;
  notes: string;
}

interface MalpracticeInsuranceModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  insurance?: any;
  practiceLocations?: Array<{ id: string; name?: string; locationName?: string; city?: string; state?: string }>;
}

const COVERAGE_TYPES = [
  { value: 'occurrence', label: 'Occurrence' },
  { value: 'claims_made', label: 'Claims Made' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'pending', label: 'Pending' },
  { value: 'revoked', label: 'Revoked' },
];

const formatDate = (d: string | undefined) => d ? d.substring(0, 10) : '';

export default function MalpracticeInsuranceModal({
  isOpen,
  onClose,
  providerId,
  insurance,
  practiceLocations,
}: MalpracticeInsuranceModalProps) {
  const isEditing = !!insurance;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<MalpracticeInsuranceFormData>({
    defaultValues: {
      carrierName: '',
      policyNumber: '',
      coverageType: 'occurrence',
      perClaimAmount: '',
      aggregateAmount: '',
      effectiveDate: '',
      expirationDate: '',
      retroactiveDate: '',
      hasTailCoverage: false,
      hasGapInCoverage: false,
      gapExplanation: '',
      isSelfInsured: false,
      hasUnlimitedCoverage: false,
      isIndividualCoverage: false,
      coveredLocationIds: [],
      status: 'active',
      notes: '',
    },
  });

  const hasGapInCoverage = watch('hasGapInCoverage');
  const watchedCoveredLocationIds = watch('coveredLocationIds');

  const handleLocationToggle = (locationId: string, checked: boolean) => {
    const current = watchedCoveredLocationIds || [];
    if (checked) {
      setValue('coveredLocationIds', [...current, locationId]);
    } else {
      setValue('coveredLocationIds', current.filter((id) => id !== locationId));
    }
  };

  useEffect(() => {
    if (insurance) {
      reset({
        carrierName: insurance.carrierName || '',
        policyNumber: insurance.policyNumber || '',
        coverageType: insurance.coverageType || 'occurrence',
        perClaimAmount: insurance.perClaimAmount?.toString() || '',
        aggregateAmount: insurance.aggregateAmount?.toString() || '',
        effectiveDate: formatDate(insurance.effectiveDate),
        expirationDate: formatDate(insurance.expirationDate),
        retroactiveDate: formatDate(insurance.retroactiveDate),
        hasTailCoverage: insurance.hasTailCoverage || false,
        hasGapInCoverage: insurance.hasGapInCoverage || false,
        gapExplanation: insurance.gapExplanation || '',
        isSelfInsured: insurance.isSelfInsured || false,
        hasUnlimitedCoverage: insurance.hasUnlimitedCoverage || false,
        isIndividualCoverage: insurance.isIndividualCoverage || false,
        coveredLocationIds: insurance.coveredLocationIds || [],
        status: insurance.status || 'active',
        notes: insurance.notes || '',
      });
    } else {
      reset({
        carrierName: '',
        policyNumber: '',
        coverageType: 'occurrence',
        perClaimAmount: '',
        aggregateAmount: '',
        effectiveDate: '',
        expirationDate: '',
        retroactiveDate: '',
        hasTailCoverage: false,
        hasGapInCoverage: false,
        gapExplanation: '',
        isSelfInsured: false,
        hasUnlimitedCoverage: false,
        isIndividualCoverage: false,
        coveredLocationIds: [],
        status: 'active',
        notes: '',
      });
    }
  }, [insurance, reset]);

  const createMutation = useCreateMalpracticeInsurance();
  const updateMutation = useUpdateMalpracticeInsurance();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: MalpracticeInsuranceFormData) => {
    const payload = {
      ...data,
      perClaimAmount: data.perClaimAmount ? Number(data.perClaimAmount) : undefined,
      aggregateAmount: data.aggregateAmount ? Number(data.aggregateAmount) : undefined,
      retroactiveDate: data.retroactiveDate || undefined,
      gapExplanation: data.hasGapInCoverage ? data.gapExplanation || undefined : undefined,
      coveredLocationIds: data.coveredLocationIds || [],
      notes: data.notes || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: insurance.id, providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Malpractice insurance updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to update malpractice insurance');
          },
        }
      );
    } else {
      createMutation.mutate(
        { providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Malpractice insurance added');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to add malpractice insurance');
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
                      {isEditing ? 'Edit Malpractice Insurance' : 'Add Malpractice Insurance'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Carrier Name + Policy Number */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Carrier Name *</label>
                        <input
                          {...register('carrierName', { required: 'Required' })}
                          className="input"
                          placeholder="Insurance carrier name"
                        />
                        {errors.carrierName && (
                          <p className="mt-1 text-sm text-red-600">{errors.carrierName.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Policy Number *</label>
                        <input
                          {...register('policyNumber', { required: 'Required' })}
                          className="input"
                          placeholder="Policy number"
                        />
                        {errors.policyNumber && (
                          <p className="mt-1 text-sm text-red-600">{errors.policyNumber.message}</p>
                        )}
                      </div>
                    </div>

                    {/* Coverage Type + Status */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Coverage Type</label>
                        <select
                          {...register('coverageType')}
                          className="input"
                        >
                          {COVERAGE_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label">Status</label>
                        <select
                          {...register('status')}
                          className="input"
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Coverage Amounts */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Per Claim Amount</label>
                        <input
                          type="number"
                          {...register('perClaimAmount')}
                          className="input"
                          placeholder="$1,000,000"
                        />
                      </div>
                      <div>
                        <label className="label">Aggregate Amount</label>
                        <input
                          type="number"
                          {...register('aggregateAmount')}
                          className="input"
                          placeholder="$3,000,000"
                        />
                      </div>
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className="label">Effective Date *</label>
                        <input
                          type="date"
                          {...register('effectiveDate', { required: 'Required' })}
                          className="input"
                        />
                        {errors.effectiveDate && (
                          <p className="mt-1 text-sm text-red-600">{errors.effectiveDate.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Expiration Date *</label>
                        <input
                          type="date"
                          {...register('expirationDate', { required: 'Required' })}
                          className="input"
                        />
                        {errors.expirationDate && (
                          <p className="mt-1 text-sm text-red-600">{errors.expirationDate.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Retroactive Date</label>
                        <input
                          type="date"
                          {...register('retroactiveDate')}
                          className="input"
                        />
                      </div>
                    </div>

                    {/* Checkboxes */}
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          {...register('hasTailCoverage')}
                          id="hasTailCoverage"
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <label htmlFor="hasTailCoverage" className="label mb-0">
                          Has Tail Coverage
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          {...register('hasGapInCoverage')}
                          id="hasGapInCoverage"
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <label htmlFor="hasGapInCoverage" className="label mb-0">
                          Has Gap in Coverage
                        </label>
                      </div>
                    </div>

                    {/* Gap Explanation (conditional) */}
                    {hasGapInCoverage && (
                      <div>
                        <label className="label">Gap Explanation</label>
                        <textarea
                          {...register('gapExplanation', { maxLength: { value: 1000, message: 'Max 1000 characters' } })}
                          className="input"
                          rows={2}
                          placeholder="Explain the gap in coverage"
                        />
                        {errors.gapExplanation && (
                          <p className="mt-1 text-sm text-red-600">{errors.gapExplanation.message}</p>
                        )}
                      </div>
                    )}

                    {/* CAQH-extended flags */}
                    <div className="flex items-center gap-6 flex-wrap">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          {...register('isSelfInsured')}
                          id="isSelfInsured"
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <label htmlFor="isSelfInsured" className="label mb-0">
                          Self-Insured
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          {...register('hasUnlimitedCoverage')}
                          id="hasUnlimitedCoverage"
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <label htmlFor="hasUnlimitedCoverage" className="label mb-0">
                          Unlimited Coverage
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          {...register('isIndividualCoverage')}
                          id="isIndividualCoverage"
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <label htmlFor="isIndividualCoverage" className="label mb-0">
                          Individual Coverage
                        </label>
                      </div>
                    </div>

                    {/* Covered Practice Locations (multi-select) */}
                    {practiceLocations && practiceLocations.length > 0 && (
                      <div>
                        <label className="label">Covered Practice Locations</label>
                        <div className="mt-1 space-y-2 rounded-lg border border-gray-200 p-3 max-h-48 overflow-y-auto">
                          {practiceLocations.map((loc) => {
                            const checked = (watchedCoveredLocationIds || []).includes(loc.id);
                            const labelLine = [loc.name || loc.locationName || 'Location', [loc.city, loc.state].filter(Boolean).join(', ')]
                              .filter(Boolean)
                              .join(' · ');
                            return (
                              <label key={loc.id} className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => handleLocationToggle(loc.id, e.target.checked)}
                                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                />
                                {labelLine}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

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
                        {mutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add Insurance'}
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
