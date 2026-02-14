import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateDisclosure, useUpdateDisclosure } from '../../hooks/usePayerEnrollmentData';

interface DisclosureFormData {
  category: string;
  questionText: string;
  answer: boolean;
  explanation?: string;
  dateOfOccurrence?: string;
  state?: string;
  resolutionDetails?: string;
}

interface DisclosureModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  disclosure?: any;
}

const DISCLOSURE_CATEGORIES = [
  { value: 'LICENSE_ACTION', label: 'License Action' },
  { value: 'HOSPITAL_PRIVILEGES', label: 'Hospital Privileges' },
  { value: 'FELONY_CONVICTION', label: 'Felony Conviction' },
  { value: 'MISDEMEANOR_CONVICTION', label: 'Misdemeanor Conviction' },
  { value: 'SUBSTANCE_ABUSE', label: 'Substance Abuse' },
  { value: 'MALPRACTICE', label: 'Malpractice' },
  { value: 'MEDICARE_MEDICAID', label: 'Medicare / Medicaid' },
  { value: 'BOARD_ACTION', label: 'Board Action' },
  { value: 'INSURANCE_DENIAL', label: 'Insurance Denial' },
  { value: 'ABILITY_TO_PERFORM', label: 'Ability to Perform' },
  { value: 'OTHER', label: 'Other' },
];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','PR','RI','SC','SD','TN','TX',
  'UT','VT','VA','VI','WA','WV','WI','WY',
];

const formatDate = (d: string | undefined) => d ? d.substring(0, 10) : '';

export default function DisclosureModal({
  isOpen,
  onClose,
  providerId,
  disclosure,
}: DisclosureModalProps) {
  const isEditing = !!disclosure;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<DisclosureFormData>({
    defaultValues: {
      category: 'LICENSE_ACTION',
      questionText: '',
      answer: false,
      explanation: '',
      dateOfOccurrence: '',
      state: '',
      resolutionDetails: '',
    },
  });

  const answerValue = watch('answer');

  useEffect(() => {
    if (disclosure) {
      reset({
        category: disclosure.category,
        questionText: disclosure.questionText,
        answer: disclosure.answer ?? false,
        explanation: disclosure.explanation || '',
        dateOfOccurrence: formatDate(disclosure.dateOfOccurrence),
        state: disclosure.state || '',
        resolutionDetails: disclosure.resolutionDetails || '',
      });
    } else {
      reset({
        category: 'LICENSE_ACTION',
        questionText: '',
        answer: false,
        explanation: '',
        dateOfOccurrence: '',
        state: '',
        resolutionDetails: '',
      });
    }
  }, [disclosure, reset]);

  const createMutation = useCreateDisclosure();
  const updateMutation = useUpdateDisclosure();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: DisclosureFormData) => {
    const payload = {
      ...data,
      explanation: data.answer ? data.explanation || undefined : undefined,
      dateOfOccurrence: data.dateOfOccurrence || undefined,
      state: data.state || undefined,
      resolutionDetails: data.answer ? data.resolutionDetails || undefined : undefined,
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: disclosure.id, providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Disclosure updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to update disclosure');
          },
        }
      );
    } else {
      createMutation.mutate(
        { providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Disclosure added');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to add disclosure');
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
                      {isEditing ? 'Edit Disclosure' : 'Add Disclosure'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Category + State */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Category *</label>
                        <select
                          {...register('category', { required: 'Required' })}
                          className="input"
                        >
                          {DISCLOSURE_CATEGORIES.map((cat) => (
                            <option key={cat.value} value={cat.value}>
                              {cat.label}
                            </option>
                          ))}
                        </select>
                        {errors.category && (
                          <p className="mt-1 text-sm text-red-600">{errors.category.message}</p>
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

                    {/* Question Text */}
                    <div>
                      <label className="label">Question Text *</label>
                      <textarea
                        {...register('questionText', { required: 'Required' })}
                        className="input"
                        rows={3}
                      />
                      {errors.questionText && (
                        <p className="mt-1 text-sm text-red-600">{errors.questionText.message}</p>
                      )}
                    </div>

                    {/* Answer Toggle + Date */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="flex items-center gap-3 pt-6">
                        <input
                          type="checkbox"
                          {...register('answer')}
                          id="disclosure-answer"
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <label htmlFor="disclosure-answer" className="label mb-0">
                          Yes (Affirmative Disclosure)
                        </label>
                      </div>
                      <div>
                        <label className="label">Date of Occurrence</label>
                        <input
                          type="date"
                          {...register('dateOfOccurrence')}
                          className="input"
                        />
                      </div>
                    </div>

                    {/* Explanation - shown only when answer is true */}
                    {answerValue && (
                      <div>
                        <label className="label">Explanation</label>
                        <textarea
                          {...register('explanation')}
                          className="input"
                          rows={3}
                        />
                      </div>
                    )}

                    {/* Resolution Details - shown only when answer is true */}
                    {answerValue && (
                      <div>
                        <label className="label">Resolution Details</label>
                        <textarea
                          {...register('resolutionDetails')}
                          className="input"
                          rows={3}
                        />
                      </div>
                    )}

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
                        {mutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add Disclosure'}
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
