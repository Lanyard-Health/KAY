import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateDeaRegistration, useUpdateDeaRegistration } from '../../hooks/usePayerEnrollmentData';

interface DeaRegistrationFormData {
  deaNumber: string;
  deaState?: string;
  deaSchedules: string[];
  issueDate: string;
  expirationDate: string;
  buprenorphineWaiver: boolean;
  status: string;
  notes?: string;
}

interface DeaRegistrationModalProps {
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

const DEA_SCHEDULES = ['II', 'III', 'IV', 'V'];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'pending', label: 'Pending' },
  { value: 'revoked', label: 'Revoked' },
];

const formatDate = (d: string | undefined) => d ? d.substring(0, 10) : '';

export default function DeaRegistrationModal({
  isOpen,
  onClose,
  providerId,
  registration,
}: DeaRegistrationModalProps) {
  const isEditing = !!registration;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<DeaRegistrationFormData>({
    defaultValues: {
      deaNumber: '',
      deaState: '',
      deaSchedules: [],
      issueDate: '',
      expirationDate: '',
      buprenorphineWaiver: false,
      status: 'active',
      notes: '',
    },
  });

  const watchedSchedules = watch('deaSchedules');

  useEffect(() => {
    if (registration) {
      reset({
        // Left blank on edit: the API returns the DEA number masked (****1234),
        // so we don't pre-fill it. Blank = keep the existing number unchanged.
        deaNumber: '',
        deaState: registration.deaState || '',
        deaSchedules: registration.deaSchedules || [],
        issueDate: formatDate(registration.issueDate),
        expirationDate: formatDate(registration.expirationDate),
        buprenorphineWaiver: registration.buprenorphineWaiver || false,
        status: registration.status || 'active',
        notes: registration.notes || '',
      });
    } else {
      reset({
        deaNumber: '',
        deaState: '',
        deaSchedules: [],
        issueDate: '',
        expirationDate: '',
        status: 'active',
        notes: '',
      });
    }
  }, [registration, reset]);

  const handleScheduleChange = (schedule: string, checked: boolean) => {
    const current = watchedSchedules || [];
    if (checked) {
      setValue('deaSchedules', [...current, schedule]);
    } else {
      setValue('deaSchedules', current.filter((s) => s !== schedule));
    }
  };

  const createMutation = useCreateDeaRegistration();
  const updateMutation = useUpdateDeaRegistration();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: DeaRegistrationFormData) => {
    const payload = {
      ...data,
      // On edit, only send the DEA number if the user typed a new one; blank
      // means keep the stored value (the displayed value is masked).
      deaNumber: data.deaNumber && data.deaNumber.trim() !== '' ? data.deaNumber.trim() : undefined,
      deaState: data.deaState || undefined,
      notes: data.notes || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: registration.id, providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('DEA registration updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to update DEA registration');
          },
        }
      );
    } else {
      createMutation.mutate(
        { providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('DEA registration added');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to add DEA registration');
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
                      {isEditing ? 'Edit DEA Registration' : 'Add DEA Registration'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* DEA Number + State */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">DEA Number {isEditing ? '' : '*'}</label>
                        <input
                          {...register('deaNumber', { required: isEditing ? false : 'Required' })}
                          className="input"
                          placeholder={isEditing ? `Current: ${registration?.deaNumber ?? ''} — leave blank to keep` : 'e.g. AB1234567'}
                        />
                        {errors.deaNumber && (
                          <p className="mt-1 text-sm text-red-600">{errors.deaNumber.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">State</label>
                        <select {...register('deaState')} className="input">
                          <option value="">Select</option>
                          {US_STATES.map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* DEA Schedules */}
                    <div>
                      <label className="label">DEA Schedules</label>
                      <div className="flex gap-6 mt-1">
                        {DEA_SCHEDULES.map((schedule) => (
                          <label key={schedule} className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={(watchedSchedules || []).includes(schedule)}
                              onChange={(e) => handleScheduleChange(schedule, e.target.checked)}
                              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                            Schedule {schedule}
                          </label>
                        ))}
                      </div>
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

                    {/* Buprenorphine Waiver */}
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        {...register('buprenorphineWaiver')}
                        id="buprenorphineWaiver"
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <label htmlFor="buprenorphineWaiver" className="label mb-0">
                        Buprenorphine (DATA 2000) Waiver
                      </label>
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
                        {mutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add DEA Registration'}
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
