import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateCertification, useUpdateCertification } from '../../hooks/useCredentials';

interface CertificationFormData {
  boardType: string;
  boardName: string;
  certificationNumber?: string;
  specialty: string;
  initialCertificationDate: string;
  expirationDate?: string;
  isBoardEligible: boolean;
  notes?: string;
}

interface CertificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  certification?: any;
}

const BOARD_TYPES = [
  { value: 'abpn_psychiatry', label: 'ABPN - Psychiatry' },
  { value: 'abpn_child_adolescent', label: 'ABPN - Child & Adolescent' },
  { value: 'abpn_addiction', label: 'ABPN - Addiction' },
  { value: 'abpp_clinical', label: 'ABPP - Clinical' },
  { value: 'abpp_counseling', label: 'ABPP - Counseling' },
  { value: 'abecsw', label: 'ABECSW' },
  { value: 'nbcc', label: 'NBCC' },
  { value: 'aamft', label: 'AAMFT' },
  { value: 'ancc_pmhnp', label: 'ANCC - PMHNP' },
  { value: 'other', label: 'Other' },
];

const formatDate = (dateStr: string | undefined): string => {
  if (!dateStr) return '';
  return dateStr.substring(0, 10);
};

export default function CertificationModal({
  isOpen,
  onClose,
  providerId,
  certification,
}: CertificationModalProps) {
  const isEditing = !!certification;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CertificationFormData>({
    defaultValues: {
      boardType: 'abpn_psychiatry',
      boardName: '',
      certificationNumber: '',
      specialty: '',
      initialCertificationDate: '',
      expirationDate: '',
      isBoardEligible: false,
      notes: '',
    },
  });

  useEffect(() => {
    if (certification) {
      reset({
        boardType: certification.boardType,
        boardName: certification.boardName,
        certificationNumber: certification.certificationNumber || '',
        specialty: certification.specialty,
        initialCertificationDate: formatDate(certification.initialCertificationDate),
        expirationDate: formatDate(certification.expirationDate),
        isBoardEligible: certification.isBoardEligible || false,
        notes: certification.notes || '',
      });
    } else {
      reset({
        boardType: 'abpn_psychiatry',
        boardName: '',
        certificationNumber: '',
        specialty: '',
        initialCertificationDate: '',
        expirationDate: '',
        isBoardEligible: false,
        notes: '',
      });
    }
  }, [certification, reset]);

  const createMutation = useCreateCertification();
  const updateMutation = useUpdateCertification();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: CertificationFormData) => {
    const payload = {
      ...data,
      certificationNumber: data.certificationNumber || undefined,
      expirationDate: data.expirationDate || undefined,
      notes: data.notes || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(
        { certificationId: certification.id, providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Certification updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to update certification');
          },
        }
      );
    } else {
      createMutation.mutate(
        { providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Certification added');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to add certification');
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
                      {isEditing ? 'Edit Board Certification' : 'Add Board Certification'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Board Type + Board Name */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Board Type *</label>
                        <select
                          {...register('boardType', { required: 'Required' })}
                          className="input"
                        >
                          {BOARD_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                        {errors.boardType && (
                          <p className="mt-1 text-sm text-red-600">{errors.boardType.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Board Name *</label>
                        <input
                          {...register('boardName', { required: 'Required', maxLength: { value: 200, message: 'Max 200 characters' } })}
                          className="input"
                          placeholder="e.g. American Board of Psychiatry and Neurology"
                        />
                        {errors.boardName && (
                          <p className="mt-1 text-sm text-red-600">{errors.boardName.message}</p>
                        )}
                      </div>
                    </div>

                    {/* Specialty + Certification Number */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Specialty *</label>
                        <input
                          {...register('specialty', { required: 'Required', maxLength: { value: 200, message: 'Max 200 characters' } })}
                          className="input"
                          placeholder="e.g. Psychiatry"
                        />
                        {errors.specialty && (
                          <p className="mt-1 text-sm text-red-600">{errors.specialty.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Certification Number</label>
                        <input
                          {...register('certificationNumber', { maxLength: { value: 50, message: 'Max 50 characters' } })}
                          className="input"
                          placeholder="Optional"
                        />
                        {errors.certificationNumber && (
                          <p className="mt-1 text-sm text-red-600">{errors.certificationNumber.message}</p>
                        )}
                      </div>
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Initial Certification Date *</label>
                        <input
                          type="date"
                          {...register('initialCertificationDate', { required: 'Required' })}
                          className="input"
                        />
                        {errors.initialCertificationDate && (
                          <p className="mt-1 text-sm text-red-600">{errors.initialCertificationDate.message}</p>
                        )}
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

                    {/* Board Eligible */}
                    <label className="flex items-center">
                      <input type="checkbox" {...register('isBoardEligible')} className="mr-2" />
                      <span className="text-sm">Board Eligible</span>
                    </label>

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
                        {mutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add Certification'}
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
