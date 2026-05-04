import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateWorkHistoryGap, useUpdateWorkHistoryGap } from '../../hooks/usePayerEnrollmentData';

interface WorkHistoryGapFormData {
  startDate: string;
  endDate: string;
  gapDescription: string;
  gapExplanation: string;
}

interface WorkHistoryGapModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  gap?: any;
}

const formatDate = (d: string | undefined) => d ? d.substring(0, 10) : '';

const EMPTY_FORM: WorkHistoryGapFormData = {
  startDate: '',
  endDate: '',
  gapDescription: '',
  gapExplanation: '',
};

export default function WorkHistoryGapModal({
  isOpen,
  onClose,
  providerId,
  gap,
}: WorkHistoryGapModalProps) {
  const isEditing = !!gap;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<WorkHistoryGapFormData>({ defaultValues: EMPTY_FORM });

  useEffect(() => {
    if (gap) {
      reset({
        startDate: formatDate(gap.startDate),
        endDate: formatDate(gap.endDate),
        gapDescription: gap.gapDescription || '',
        gapExplanation: gap.gapExplanation || '',
      });
    } else {
      reset(EMPTY_FORM);
    }
  }, [gap, reset]);

  const createMutation = useCreateWorkHistoryGap();
  const updateMutation = useUpdateWorkHistoryGap();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: WorkHistoryGapFormData) => {
    const blank = (v: string) => v === '' ? undefined : v;
    const payload = {
      startDate: data.startDate,
      endDate: data.endDate,
      gapDescription: blank(data.gapDescription),
      gapExplanation: blank(data.gapExplanation),
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: gap.id, providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Employment gap updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to update employment gap');
          },
        }
      );
    } else {
      createMutation.mutate(
        { providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Employment gap added');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to add employment gap');
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-xl">
                <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      {isEditing ? 'Edit Employment Gap' : 'Add Employment Gap'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Start Date *</label>
                        <input
                          type="date"
                          {...register('startDate', { required: 'Required' })}
                          className="input"
                        />
                        {errors.startDate && (
                          <p className="mt-1 text-sm text-red-600">{errors.startDate.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">End Date *</label>
                        <input
                          type="date"
                          {...register('endDate', { required: 'Required' })}
                          className="input"
                        />
                        {errors.endDate && (
                          <p className="mt-1 text-sm text-red-600">{errors.endDate.message}</p>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="label">Description</label>
                      <input
                        {...register('gapDescription')}
                        className="input"
                        placeholder='e.g. "Family Leave", "Charitable Work", "Sabbatical"'
                      />
                    </div>

                    <div>
                      <label className="label">Explanation</label>
                      <textarea
                        {...register('gapExplanation')}
                        className="input"
                        rows={4}
                        placeholder="Detail the reason for the gap"
                      />
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t">
                      <button type="button" onClick={onClose} className="btn-secondary">
                        Cancel
                      </button>
                      <button type="submit" disabled={mutation.isPending} className="btn-primary">
                        {mutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add Gap'}
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
