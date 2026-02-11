import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateLicense, useUpdateLicense } from '../../hooks/useCredentials';

interface LicenseFormData {
  licenseType: string;
  licenseNumber: string;
  state?: string;
  issueDate: string;
  expirationDate: string;
  notes?: string;
}

interface LicenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  license?: any;
}

const LICENSE_TYPES = [
  { value: 'state_medical', label: 'State Medical' },
  { value: 'state_psychology', label: 'State Psychology' },
  { value: 'state_social_work', label: 'State Social Work' },
  { value: 'state_counseling', label: 'State Counseling' },
  { value: 'state_marriage_family', label: 'State Marriage & Family' },
  { value: 'dea', label: 'DEA' },
  { value: 'controlled_substance', label: 'Controlled Substance' },
  { value: 'npi', label: 'NPI' },
];

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN', 'TX',
  'UT', 'VT', 'VA', 'VI', 'WA', 'WV', 'WI', 'WY',
];

const formatDate = (dateStr: string | undefined): string => {
  if (!dateStr) return '';
  return dateStr.substring(0, 10);
};

export default function LicenseModal({
  isOpen,
  onClose,
  providerId,
  license,
}: LicenseModalProps) {
  const isEditing = !!license;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<LicenseFormData>({
    defaultValues: {
      licenseType: 'state_medical',
      licenseNumber: '',
      state: '',
      issueDate: '',
      expirationDate: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (license) {
      reset({
        licenseType: license.licenseType,
        licenseNumber: license.licenseNumber,
        state: license.state || '',
        issueDate: formatDate(license.issueDate),
        expirationDate: formatDate(license.expirationDate),
        notes: license.notes || '',
      });
    } else {
      reset({
        licenseType: 'state_medical',
        licenseNumber: '',
        state: '',
        issueDate: '',
        expirationDate: '',
        notes: '',
      });
    }
  }, [license, reset]);

  const createMutation = useCreateLicense();
  const updateMutation = useUpdateLicense();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: LicenseFormData) => {
    const payload = {
      ...data,
      state: data.state || undefined,
      notes: data.notes || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(
        { licenseId: license.id, providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('License updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to update license');
          },
        }
      );
    } else {
      createMutation.mutate(
        { providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('License added');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to add license');
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
                      {isEditing ? 'Edit License' : 'Add License'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* License Type + State */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">License Type *</label>
                        <select
                          {...register('licenseType', { required: 'Required' })}
                          className="input"
                        >
                          {LICENSE_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                        {errors.licenseType && (
                          <p className="mt-1 text-sm text-red-600">{errors.licenseType.message}</p>
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

                    {/* License Number */}
                    <div>
                      <label className="label">License Number *</label>
                      <input
                        {...register('licenseNumber', { required: 'Required', maxLength: { value: 50, message: 'Max 50 characters' } })}
                        className="input"
                        placeholder="e.g. MD-12345"
                      />
                      {errors.licenseNumber && (
                        <p className="mt-1 text-sm text-red-600">{errors.licenseNumber.message}</p>
                      )}
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Issue Date *</label>
                        <input
                          type="date"
                          {...register('issueDate', { required: 'Required' })}
                          className="input"
                        />
                        {errors.issueDate && (
                          <p className="mt-1 text-sm text-red-600">{errors.issueDate.message}</p>
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
                        {mutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add License'}
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
