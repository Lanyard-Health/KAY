import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateProviderCertification, useUpdateProviderCertification } from '../../hooks/usePayerEnrollmentData';

interface LifeSupportCertFormData {
  certType: string;
  certDescription: string;
  certNumber: string;
  issuingAuthority: string;
  issueDate: string;
  expirationDate: string;
  status: string;
  notes: string;
}

interface LifeSupportCertModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  certification?: any;
}

const CERT_TYPES = [
  { value: 'acls', label: 'ACLS — Advanced Cardiac Life Support' },
  { value: 'bls', label: 'BLS — Basic Life Support' },
  { value: 'cpr', label: 'CPR' },
  { value: 'pals', label: 'PALS — Pediatric Advanced Life Support' },
  { value: 'other', label: 'Other' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'pending', label: 'Pending' },
  { value: 'revoked', label: 'Revoked' },
];

const formatDate = (d: string | undefined) => d ? d.substring(0, 10) : '';

export default function LifeSupportCertModal({
  isOpen,
  onClose,
  providerId,
  certification,
}: LifeSupportCertModalProps) {
  const isEditing = !!certification;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<LifeSupportCertFormData>({
    defaultValues: {
      certType: 'bls',
      certDescription: '',
      certNumber: '',
      issuingAuthority: '',
      issueDate: '',
      expirationDate: '',
      status: 'active',
      notes: '',
    },
  });

  useEffect(() => {
    if (certification) {
      reset({
        certType: certification.certType || 'bls',
        certDescription: certification.certDescription || '',
        certNumber: certification.certNumber || '',
        issuingAuthority: certification.issuingAuthority || '',
        issueDate: formatDate(certification.issueDate),
        expirationDate: formatDate(certification.expirationDate),
        status: certification.status || 'active',
        notes: certification.notes || '',
      });
    } else {
      reset({
        certType: 'bls',
        certDescription: '',
        certNumber: '',
        issuingAuthority: '',
        issueDate: '',
        expirationDate: '',
        status: 'active',
        notes: '',
      });
    }
  }, [certification, reset]);

  const createMutation = useCreateProviderCertification();
  const updateMutation = useUpdateProviderCertification();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: LifeSupportCertFormData) => {
    const payload = {
      ...data,
      certNumber: data.certNumber || undefined,
      issuingAuthority: data.issuingAuthority || undefined,
      issueDate: data.issueDate || undefined,
      expirationDate: data.expirationDate || undefined,
      notes: data.notes || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: certification.id, providerId, ...payload },
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
                      {isEditing ? 'Edit Life-Support Cert' : 'Add Life-Support Cert'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Cert Type + Description */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Cert Type *</label>
                        <select {...register('certType', { required: 'Required' })} className="input">
                          {CERT_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                        {errors.certType && (
                          <p className="mt-1 text-sm text-red-600">{errors.certType.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Description *</label>
                        <input
                          {...register('certDescription', { required: 'Required' })}
                          className="input"
                          placeholder="e.g. AHA BLS Provider"
                        />
                        {errors.certDescription && (
                          <p className="mt-1 text-sm text-red-600">{errors.certDescription.message}</p>
                        )}
                      </div>
                    </div>

                    {/* Cert Number + Issuing Authority */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Cert Number</label>
                        <input
                          {...register('certNumber')}
                          className="input"
                          placeholder="Optional"
                        />
                      </div>
                      <div>
                        <label className="label">Issuing Authority</label>
                        <input
                          {...register('issuingAuthority')}
                          className="input"
                          placeholder="e.g. American Heart Association"
                        />
                      </div>
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Issue Date</label>
                        <input type="date" {...register('issueDate')} className="input" />
                      </div>
                      <div>
                        <label className="label">Expiration Date</label>
                        <input type="date" {...register('expirationDate')} className="input" />
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
