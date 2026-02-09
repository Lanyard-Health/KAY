import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreatePractice, useUpdatePractice } from '../../hooks/usePractices';
import type { Practice } from '../../hooks/usePractices';

interface PracticeFormData {
  name: string;
  phone: string;
  email: string;
  website: string;
  notes: string;
  status: 'ACTIVE' | 'INACTIVE';
}

interface PracticeFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  practice?: Practice | null;
}

export default function PracticeFormModal({ isOpen, onClose, practice }: PracticeFormModalProps) {
  const isEditing = !!practice;
  const createMutation = useCreatePractice();
  const updateMutation = useUpdatePractice();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PracticeFormData>({
    defaultValues: {
      name: '',
      phone: '',
      email: '',
      website: '',
      notes: '',
      status: 'ACTIVE',
    },
  });

  useEffect(() => {
    if (practice) {
      reset({
        name: practice.name,
        phone: practice.phone || '',
        email: practice.email || '',
        website: practice.website || '',
        notes: practice.notes || '',
        status: practice.status,
      });
    } else {
      reset({
        name: '',
        phone: '',
        email: '',
        website: '',
        notes: '',
        status: 'ACTIVE',
      });
    }
  }, [practice, reset]);

  const onSubmit = (data: PracticeFormData) => {
    if (isEditing) {
      updateMutation.mutate(
        { practiceId: practice!.id, ...data },
        {
          onSuccess: () => {
            toast.success('Practice updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.message || 'Failed to update practice');
          },
        }
      );
    } else {
      createMutation.mutate(data, {
        onSuccess: () => {
          toast.success('Practice created');
          onClose();
        },
        onError: (error: any) => {
          toast.error(error.message || 'Failed to create practice');
        },
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

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
              <Dialog.Panel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
                <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      {isEditing ? 'Edit Practice' : 'Add Practice'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div>
                      <label className="label">Name *</label>
                      <input
                        {...register('name', { required: 'Name is required' })}
                        className="input"
                        placeholder="Practice name"
                      />
                      {errors.name && (
                        <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Phone</label>
                        <input
                          {...register('phone')}
                          className="input"
                          placeholder="(555) 555-5555"
                        />
                      </div>
                      <div>
                        <label className="label">Email</label>
                        <input
                          {...register('email')}
                          type="email"
                          className="input"
                          placeholder="office@practice.com"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="label">Website</label>
                      <input
                        {...register('website')}
                        className="input"
                        placeholder="https://www.practice.com"
                      />
                    </div>

                    {isEditing && (
                      <div>
                        <label className="label">Status</label>
                        <select {...register('status')} className="input">
                          <option value="ACTIVE">Active</option>
                          <option value="INACTIVE">Inactive</option>
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="label">Notes</label>
                      <textarea
                        {...register('notes')}
                        className="input"
                        rows={3}
                        placeholder="Optional notes about this practice"
                      />
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t">
                      <button type="button" onClick={onClose} className="btn-secondary">
                        Cancel
                      </button>
                      <button type="submit" disabled={isPending} className="btn-primary">
                        {isPending ? 'Saving...' : isEditing ? 'Update' : 'Create Practice'}
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
