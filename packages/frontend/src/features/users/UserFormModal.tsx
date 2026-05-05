import { Fragment, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useCreateUser, useUpdateUser } from '../../hooks/useUserManagement';
import type { UserDetail } from '../../hooks/useUserManagement';
import { useAuthStore } from '../../stores/auth.store';

interface UserFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
}

interface UserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: UserDetail | null;
  onCreated?: (user: any) => void;
}

// `practice_admin` was missing from both lists, which made it impossible to
// invite an admin-of-this-practice user from the UI. The system-level role
// `practice_admin` controls which sidebar group the user sees and gives them
// the ability to manage their own practice's users; the practice-scope role
// (UserPractice.role = PRACTICE_ADMIN/PRACTICE_STAFF) is auto-derived in
// PracticeUsersTab when the form returns.
const ALL_ROLES = [
  { value: 'admin', label: 'System Admin (all practices)' },
  { value: 'practice_admin', label: 'Practice Admin' },
  { value: 'credentialing_staff', label: 'Credentialing Staff' },
  { value: 'provider', label: 'Provider' },
];

const NON_ADMIN_ROLES = [
  { value: 'practice_admin', label: 'Practice Admin' },
  { value: 'credentialing_staff', label: 'Credentialing Staff' },
  { value: 'provider', label: 'Provider' },
];

export default function UserFormModal({ isOpen, onClose, user, onCreated }: UserFormModalProps) {
  const isEditing = !!user;
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const currentUser = useAuthStore((s) => s.user);
  const isSuperAdmin = currentUser?.role === 'admin';

  const roles = isSuperAdmin ? ALL_ROLES : NON_ADMIN_ROLES;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UserFormData>({
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      role: 'credentialing_staff',
    },
  });

  useEffect(() => {
    if (user) {
      reset({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || '',
        role: user.role,
      });
    } else {
      reset({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        role: 'credentialing_staff',
      });
    }
  }, [user, reset]);

  const onSubmit = (data: UserFormData) => {
    const payload = {
      ...data,
      phone: data.phone || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(
        { userId: user!.id, ...payload },
        {
          onSuccess: () => {
            toast.success('User updated');
            onClose();
          },
          onError: (error: any) => {
            toast.error(error?.response?.data?.error?.message || 'Failed to update user');
          },
        }
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: (created) => {
          toast.success('User created');
          onCreated?.(created);
          onClose();
        },
        onError: (error: any) => {
          const message = error?.response?.data?.error?.message || 'Failed to create user';
          toast.error(message);
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
                      {isEditing ? 'Edit User' : 'Create User'}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label">First Name *</label>
                        <input
                          {...register('firstName', { required: 'First name is required' })}
                          className="input"
                          placeholder="First name"
                        />
                        {errors.firstName && (
                          <p className="mt-1 text-sm text-red-600">{errors.firstName.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="label">Last Name *</label>
                        <input
                          {...register('lastName', { required: 'Last name is required' })}
                          className="input"
                          placeholder="Last name"
                        />
                        {errors.lastName && (
                          <p className="mt-1 text-sm text-red-600">{errors.lastName.message}</p>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="label">Email *</label>
                      <input
                        {...register('email', {
                          required: 'Email is required',
                          pattern: {
                            value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                            message: 'Invalid email address',
                          },
                        })}
                        type="email"
                        className="input"
                        placeholder="user@example.com"
                      />
                      {errors.email && (
                        <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
                      )}
                    </div>

                    <div>
                      <label className="label">Phone</label>
                      <input
                        {...register('phone')}
                        className="input"
                        placeholder="(555) 555-5555"
                      />
                    </div>

                    <div>
                      <label className="label">System Role *</label>
                      <select {...register('role')} className="input">
                        {roles.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t">
                      <button type="button" onClick={onClose} className="btn-secondary">
                        Cancel
                      </button>
                      <button type="submit" disabled={isPending} className="btn-primary">
                        {isPending ? 'Saving...' : isEditing ? 'Update' : 'Create User'}
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
