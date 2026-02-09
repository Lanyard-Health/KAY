import { Fragment, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useAssignUser } from '../../hooks/usePractices';
import { useUsers } from '../../hooks/useTasks';

interface AssignUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  practiceId: string;
  existingUserIds: string[];
}

const PRACTICE_ROLES = [
  { value: 'PRACTICE_ADMIN', label: 'Practice Admin' },
  { value: 'PRACTICE_STAFF', label: 'Practice Staff' },
  { value: 'PROVIDER', label: 'Provider' },
] as const;

type PracticeRole = 'PRACTICE_ADMIN' | 'PRACTICE_STAFF' | 'PROVIDER';

export default function AssignUserModal({ isOpen, onClose, practiceId, existingUserIds }: AssignUserModalProps) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<PracticeRole>('PRACTICE_STAFF');
  const [search, setSearch] = useState('');

  const { data: usersData } = useUsers();
  const assignMutation = useAssignUser();

  const users = usersData?.data ?? [];
  const availableUsers = users.filter(
    (u: any) => !existingUserIds.includes(u.id) && u.isActive !== false
  );
  const filteredUsers = availableUsers.filter((u: any) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      u.firstName?.toLowerCase().includes(term) ||
      u.lastName?.toLowerCase().includes(term) ||
      u.email?.toLowerCase().includes(term)
    );
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) {
      toast.error('Please select a user');
      return;
    }

    assignMutation.mutate(
      { practiceId, userId: selectedUserId, role: selectedRole },
      {
        onSuccess: () => {
          toast.success('User assigned to practice');
          handleClose();
        },
        onError: (error: any) => {
          const message =
            error?.response?.status === 409
              ? 'This user is already assigned to this practice'
              : error?.response?.data?.message || 'Failed to assign user';
          toast.error(message);
        },
      }
    );
  };

  const handleClose = () => {
    setSelectedUserId('');
    setSelectedRole('PRACTICE_STAFF');
    setSearch('');
    onClose();
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-md">
                <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      Add User to Practice
                    </Dialog.Title>
                    <button onClick={handleClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label className="label">Search Users</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="Filter by name or email..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="label">Select User *</label>
                      <select
                        className="input"
                        value={selectedUserId}
                        onChange={(e) => setSelectedUserId(e.target.value)}
                        required
                      >
                        <option value="">Choose a user...</option>
                        {filteredUsers.map((user: any) => (
                          <option key={user.id} value={user.id}>
                            {user.firstName} {user.lastName} ({user.email})
                          </option>
                        ))}
                      </select>
                      {availableUsers.length === 0 && (
                        <p className="mt-1 text-sm text-gray-500">All users are already assigned to this practice.</p>
                      )}
                    </div>

                    <div>
                      <label className="label">Practice Role *</label>
                      <select
                        className="input"
                        value={selectedRole}
                        onChange={(e) => setSelectedRole(e.target.value as PracticeRole)}
                      >
                        {PRACTICE_ROLES.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t">
                      <button type="button" onClick={handleClose} className="btn-secondary">
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={assignMutation.isPending || !selectedUserId}
                        className="btn-primary"
                      >
                        {assignMutation.isPending ? 'Assigning...' : 'Assign User'}
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
