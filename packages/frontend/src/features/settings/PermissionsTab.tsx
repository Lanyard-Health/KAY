import { useState, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import {
  useCurrentPracticeUsers,
  useInviteUser,
  useUpdateUserRole,
} from '../../hooks/useSettings';

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'credentialing_staff', label: 'Credentialing Staff' },
  { value: 'practice_admin', label: 'Practice Admin' },
];

function InviteUserModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const inviteUser = useInviteUser();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: 'credentialing_staff',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    inviteUser.mutate(form, {
      onSuccess: () => {
        onClose();
        setForm({ firstName: '', lastName: '', email: '', role: 'credentialing_staff' });
      },
    });
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                <div className="flex items-center justify-between mb-5">
                  <Dialog.Title className="text-lg font-semibold text-gray-900">
                    Invite Team Member
                  </Dialog.Title>
                  <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">First Name</label>
                      <input
                        type="text"
                        value={form.firstName}
                        onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                        required
                        className="input-field mt-1"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Last Name</label>
                      <input
                        type="text"
                        value={form.lastName}
                        onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                        required
                        className="input-field mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Email</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      required
                      className="input-field mt-1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Role</label>
                    <select
                      value={form.role}
                      onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                      className="input-field mt-1"
                    >
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={inviteUser.isPending}
                      className="btn-primary text-sm"
                    >
                      {inviteUser.isPending ? 'Inviting...' : 'Send Invite'}
                    </button>
                  </div>
                </form>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

export default function PermissionsTab() {
  const { data: users, isLoading } = useCurrentPracticeUsers();
  const updateRole = useUpdateUserRole();
  const [inviteOpen, setInviteOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 bg-gray-200 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Team Members</h3>
        <button
          onClick={() => setInviteOpen(true)}
          className="btn-primary text-sm inline-flex items-center gap-1.5"
        >
          <PlusIcon className="h-4 w-4" />
          Invite User
        </button>
      </div>

      {!users?.length ? (
        <EmptyState
          illustration="people"
          title="No team members"
          description="Invite users to your practice to get started."
          action={{ label: 'Invite User', onClick: () => setInviteOpen(true) }}
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr className="bg-gray-50/80">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((pu) => (
                <tr key={pu.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <p className="text-sm font-medium text-gray-900">
                      {pu.user.firstName} {pu.user.lastName}
                    </p>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {pu.user.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <select
                      value={pu.user.role}
                      onChange={(e) => updateRole.mutate({ userId: pu.user.id, role: e.target.value })}
                      className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white"
                    >
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <StatusBadge
                      label={pu.user.isActive ? 'Active' : 'Inactive'}
                      variant={pu.user.isActive ? 'success' : 'neutral'}
                      dot
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InviteUserModal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
