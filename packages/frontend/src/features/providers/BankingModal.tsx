import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateBanking, useUpdateBanking } from '../../hooks/usePayerEnrollmentData';

interface BankingFormData {
  bankName: string;
  bankAccountType: string;
  routingNumber: string;
  accountNumber: string;
  accountHolderName: string;
  accountHolderTaxId?: string;
  eftAuthorizationDate?: string;
  w9OnFile: boolean;
  voidedCheckOnFile: boolean;
  isPrimary: boolean;
  notes?: string;
}

interface BankingModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  banking?: any;
}

const ACCOUNT_TYPES = [
  { value: 'CHECKING', label: 'Checking' },
  { value: 'SAVINGS', label: 'Savings' },
];

const formatDate = (d: string | undefined) => d ? d.substring(0, 10) : '';

export default function BankingModal({
  isOpen,
  onClose,
  providerId,
  banking,
}: BankingModalProps) {
  const isEditing = !!banking;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BankingFormData>({
    defaultValues: {
      bankName: '',
      bankAccountType: 'CHECKING',
      routingNumber: '',
      accountNumber: '',
      accountHolderName: '',
      accountHolderTaxId: '',
      eftAuthorizationDate: '',
      w9OnFile: false,
      voidedCheckOnFile: false,
      isPrimary: false,
      notes: '',
    },
  });

  useEffect(() => {
    if (banking) {
      reset({
        bankName: banking.bankName,
        bankAccountType: banking.bankAccountType || 'CHECKING',
        routingNumber: '',
        accountNumber: '',
        accountHolderName: banking.accountHolderName,
        accountHolderTaxId: '',
        eftAuthorizationDate: formatDate(banking.eftAuthorizationDate),
        w9OnFile: banking.w9OnFile ?? false,
        voidedCheckOnFile: banking.voidedCheckOnFile ?? false,
        isPrimary: banking.isPrimary ?? false,
        notes: banking.notes || '',
      });
    } else {
      reset({
        bankName: '',
        bankAccountType: 'CHECKING',
        routingNumber: '',
        accountNumber: '',
        accountHolderName: '',
        accountHolderTaxId: '',
        eftAuthorizationDate: '',
        w9OnFile: false,
        voidedCheckOnFile: false,
        isPrimary: false,
        notes: '',
      });
    }
  }, [banking, reset]);

  const createMutation = useCreateBanking();
  const updateMutation = useUpdateBanking();
  const mutation = isEditing ? updateMutation : createMutation;

  const onSubmit = (data: BankingFormData) => {
    const payload = {
      ...data,
      accountHolderTaxId: data.accountHolderTaxId || undefined,
      eftAuthorizationDate: data.eftAuthorizationDate || undefined,
      notes: data.notes || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: banking.id, providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Banking info updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to update banking info');
          },
        }
      );
    } else {
      createMutation.mutate(
        { providerId, ...payload },
        {
          onSuccess: () => {
            toast.success('Banking info added');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.error?.message || 'Failed to add banking info');
          },
        }
      );
    }
  };

  const handleSensitiveFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (e.target.value.startsWith('****')) {
      e.target.value = '';
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
                      {isEditing ? 'Edit Banking Information' : 'Add Banking Information'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Bank Name + Account Type */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Bank Name *</label>
                        <input
                          {...register('bankName', { required: 'Required' })}
                          className="input"
                          placeholder="e.g. Chase Bank"
                        />
                        {errors.bankName && (
                          <p className="mt-1 text-sm text-red-600">{errors.bankName.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Account Type</label>
                        <select {...register('bankAccountType')} className="input">
                          {ACCOUNT_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Routing + Account Numbers */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Routing Number *</label>
                        <input
                          {...register('routingNumber', {
                            required: 'Required',
                            pattern: {
                              value: /^\d{9}$/,
                              message: 'Must be exactly 9 digits',
                            },
                          })}
                          className="input"
                          placeholder={isEditing && banking?.routingNumber ? `****${banking.routingNumber.slice(-4)}` : '9 digits'}
                          onFocus={handleSensitiveFocus}
                        />
                        {errors.routingNumber && (
                          <p className="mt-1 text-sm text-red-600">{errors.routingNumber.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Account Number *</label>
                        <input
                          {...register('accountNumber', { required: 'Required' })}
                          className="input"
                          placeholder={isEditing && banking?.accountNumber ? `****${banking.accountNumber.slice(-4)}` : 'Account number'}
                          onFocus={handleSensitiveFocus}
                        />
                        {errors.accountNumber && (
                          <p className="mt-1 text-sm text-red-600">{errors.accountNumber.message}</p>
                        )}
                      </div>
                    </div>

                    {/* Account Holder Name + Tax ID */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">Account Holder Name *</label>
                        <input
                          {...register('accountHolderName', { required: 'Required' })}
                          className="input"
                          placeholder="Full legal name"
                        />
                        {errors.accountHolderName && (
                          <p className="mt-1 text-sm text-red-600">{errors.accountHolderName.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Tax ID (EIN/SSN)</label>
                        <input
                          {...register('accountHolderTaxId')}
                          className="input"
                          placeholder={isEditing && banking?.accountHolderTaxId ? `****${banking.accountHolderTaxId.slice(-4)}` : 'Optional'}
                          onFocus={handleSensitiveFocus}
                        />
                      </div>
                    </div>

                    {/* EFT Authorization Date */}
                    <div>
                      <label className="label">EFT Authorization Date</label>
                      <input
                        type="date"
                        {...register('eftAuthorizationDate')}
                        className="input"
                      />
                    </div>

                    {/* Checkboxes */}
                    <div className="flex flex-wrap gap-6">
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          {...register('w9OnFile')}
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        W-9 On File
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          {...register('voidedCheckOnFile')}
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        Voided Check On File
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          {...register('isPrimary')}
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        Primary Account
                      </label>
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
                        {mutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add Banking Info'}
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
