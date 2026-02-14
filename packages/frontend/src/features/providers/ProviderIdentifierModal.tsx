import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateProviderIdentifier, useUpdateProviderIdentifier } from '../../hooks/usePayerEnrollmentData';

interface ProviderIdentifierFormData {
  identifierType: string;
  identifierValue: string;
  issuingEntity?: string;
  state?: string;
  effectiveDate?: string;
  expirationDate?: string;
  status: string;
  notes?: string;
}

interface ProviderIdentifierModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  identifier?: any;
}

const IDENTIFIER_TYPES = [
  { value: 'MEDICARE_PTAN', label: 'Medicare PTAN' },
  { value: 'MEDICARE_PECOS_ID', label: 'Medicare PECOS ID' },
  { value: 'MEDICAID_ID', label: 'Medicaid ID' },
  { value: 'TRICARE_ID', label: 'TRICARE ID' },
  { value: 'RAILROAD_MEDICARE_ID', label: 'Railroad Medicare ID' },
  { value: 'STATE_LICENSE_ID', label: 'State License ID' },
  { value: 'PAYER_SPECIFIC_ID', label: 'Payer Specific ID' },
  { value: 'UPIN', label: 'UPIN' },
  { value: 'OTHER', label: 'Other' },
];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','PR','RI','SC','SD','TN','TX',
  'UT','VT','VA','VI','WA','WV','WI','WY',
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'pending', label: 'Pending' },
  { value: 'revoked', label: 'Revoked' },
];

const formatDate = (d: string | undefined) => d ? d.substring(0, 10) : '';

export default function ProviderIdentifierModal({
  isOpen,
  onClose,
  providerId,
  identifier,
}: ProviderIdentifierModalProps) {
  const isEditing = !!identifier;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProviderIdentifierFormData>({
    defaultValues: {
      identifierType: 'MEDICARE_PTAN',
      identifierValue: '',
      issuingEntity: '',
      state: '',
      effectiveDate: '',
      expirationDate: '',
      status: 'active',
      notes: '',
    },
  });

  useEffect(() => {
    if (identifier) {
      reset({
        identifierType: identifier.identifierType,
        identifierValue: identifier.identifierValue,
        issuingEntity: identifier.issuingEntity || '',
        state: identifier.state || '',
        effectiveDate: formatDate(identifier.effectiveDate),
        expirationDate: formatDate(identifier.expirationDate),
        status: identifier.status || 'active',
        notes: identifier.notes || '',
      });
    } else {
      reset({
        identifierType: 'MEDICARE_PTAN',
        identifierValue: '',
        issuingEntity: '',
        state: '',
        effectiveDate: '',
        expirationDate: '',
        status: 'active',
        notes: '',
      });
    }
  }, [identifier, reset]);

  const createMutation = useCreateProviderIdentifier();
  const updateMutation = useUpdateProviderIdentifier();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: ProviderIdentifierFormData) => {
    const payload = {
      ...data,
      issuingEntity: data.issuingEntity || undefined,
      state: data.state || undefined,
      effectiveDate: data.effectiveDate || undefined,
      expirationDate: data.expirationDate || undefined,
      notes: data.notes || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: identifier.id, providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Provider identifier updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to update identifier');
          },
        }
      );
    } else {
      createMutation.mutate(
        { providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Provider identifier added');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to add identifier');
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
                      {isEditing ? 'Edit Provider Identifier' : 'Add Provider Identifier'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Identifier Type + State */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Identifier Type *</label>
                        <select
                          {...register('identifierType', { required: 'Required' })}
                          className="input"
                        >
                          {IDENTIFIER_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                        {errors.identifierType && (
                          <p className="mt-1 text-sm text-red-600">{errors.identifierType.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">State</label>
                        <select {...register('state')} className="input">
                          <option value="">Select</option>
                          {US_STATES.map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Identifier Value */}
                    <div>
                      <label className="label">Identifier Value *</label>
                      <input
                        {...register('identifierValue', { required: 'Required' })}
                        className="input"
                        placeholder="e.g. 12345678"
                      />
                      {errors.identifierValue && (
                        <p className="mt-1 text-sm text-red-600">{errors.identifierValue.message}</p>
                      )}
                    </div>

                    {/* Issuing Entity */}
                    <div>
                      <label className="label">Issuing Entity</label>
                      <input
                        {...register('issuingEntity')}
                        className="input"
                        placeholder="e.g. CMS, State Board"
                      />
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Effective Date</label>
                        <input
                          type="date"
                          {...register('effectiveDate')}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="label">Expiration Date</label>
                        <input
                          type="date"
                          {...register('expirationDate')}
                          className="input"
                        />
                      </div>
                    </div>

                    {/* Status */}
                    <div>
                      <label className="label">Status</label>
                      <select {...register('status')} className="input">
                        {STATUS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
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
                        {mutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add Identifier'}
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
