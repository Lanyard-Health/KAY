import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateCdsRegistration, useUpdateCdsRegistration } from '../../hooks/usePayerEnrollmentData';

interface CdsRegistrationFormData {
  cdsNumber: string;
  state: string;
  issueDate: string;
  expirationDate: string;
  status: string;
  notes?: string;
}

interface CdsRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  registration?: any;
}

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

export default function CdsRegistrationModal({
  isOpen,
  onClose,
  providerId,
  registration,
}: CdsRegistrationModalProps) {
  const isEditing = !!registration;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CdsRegistrationFormData>({
    defaultValues: {
      cdsNumber: '',
      state: '',
      issueDate: '',
      expirationDate: '',
      status: 'active',
      notes: '',
    },
  });

  useEffect(() => {
    if (registration) {
      reset({
        // Left blank on edit: the API returns the CDS number masked (****1234),
        // so we don't pre-fill it. Blank = keep the existing number unchanged.
        cdsNumber: '',
        state: registration.state || '',
        issueDate: formatDate(registration.issueDate),
        expirationDate: formatDate(registration.expirationDate),
        status: registration.status || 'active',
        notes: registration.notes || '',
      });
    } else {
      reset({
        cdsNumber: '',
        state: '',
        issueDate: '',
        expirationDate: '',
        status: 'active',
        notes: '',
      });
    }
  }, [registration, reset]);

  const createMutation = useCreateCdsRegistration();
  const updateMutation = useUpdateCdsRegistration();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: CdsRegistrationFormData) => {
    const payload = {
      ...data,
      // On edit, only send the CDS number if the user typed a new one; blank
      // means keep the stored value (the displayed value is masked).
      cdsNumber: data.cdsNumber && data.cdsNumber.trim() !== '' ? data.cdsNumber.trim() : undefined,
      issueDate: data.issueDate || undefined,
      expirationDate: data.expirationDate || undefined,
      notes: data.notes || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: registration.id, providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('CDS registration updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to update CDS registration');
          },
        }
      );
    } else {
      createMutation.mutate(
        { providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('CDS registration added');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to add CDS registration');
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
                      {isEditing ? 'Edit CDS Registration' : 'Add CDS Registration'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* CDS Number + State */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">CDS Number {isEditing ? '' : '*'}</label>
                        <input
                          {...register('cdsNumber', { required: isEditing ? false : 'Required' })}
                          className="input"
                          placeholder={isEditing ? `Current: ${registration?.cdsNumber ?? ''} (leave blank to keep)` : 'State CDS number'}
                        />
                        {errors.cdsNumber && (
                          <p className="mt-1 text-sm text-red-600">{errors.cdsNumber.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">State *</label>
                        <select {...register('state', { required: 'Required' })} className="input">
                          <option value="">Select</option>
                          {US_STATES.map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                        </select>
                        {errors.state && (
                          <p className="mt-1 text-sm text-red-600">{errors.state.message}</p>
                        )}
                      </div>
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Issue Date</label>
                        <input
                          type="date"
                          {...register('issueDate')}
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
                        {mutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add CDS Registration'}
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
