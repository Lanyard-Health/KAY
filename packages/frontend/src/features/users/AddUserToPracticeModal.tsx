import { Fragment, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { usePractices, useAssignUser } from '../../hooks/usePractices';

interface AddUserToPracticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  existingPracticeIds: string[];
}

const PRACTICE_ROLES = [
  { value: 'PRACTICE_ADMIN', label: 'Practice Admin' },
  { value: 'PRACTICE_STAFF', label: 'Practice Staff' },
  { value: 'PROVIDER', label: 'Provider' },
] as const;

type PracticeRole = 'PRACTICE_ADMIN' | 'PRACTICE_STAFF' | 'PROVIDER';

export default function AddUserToPracticeModal({
  isOpen,
  onClose,
  userId,
  existingPracticeIds,
}: AddUserToPracticeModalProps) {
  const [selectedPracticeId, setSelectedPracticeId] = useState('');
  const [selectedRole, setSelectedRole] = useState<PracticeRole>('PRACTICE_STAFF');

  const { data: practices } = usePractices();
  const assignMutation = useAssignUser();

  const availablePractices = (practices || []).filter(
    (p) => !existingPracticeIds.includes(p.id) && p.status === 'ACTIVE'
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPracticeId) {
      toast.error('Please select a practice');
      return;
    }

    assignMutation.mutate(
      { practiceId: selectedPracticeId, userId, role: selectedRole },
      {
        onSuccess: () => {
          toast.success('User added to practice');
          handleClose();
        },
        onError: (error: any) => {
          const message =
            error?.response?.status === 409
              ? 'User is already assigned to this practice'
              : error?.response?.data?.error?.message || 'Failed to assign user';
          toast.error(message);
        },
      }
    );
  };

  const handleClose = () => {
    setSelectedPracticeId('');
    setSelectedRole('PRACTICE_STAFF');
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
                      Add to Practice
                    </Dialog.Title>
                    <button onClick={handleClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label className="label">Practice *</label>
                      <select
                        className="input"
                        value={selectedPracticeId}
                        onChange={(e) => setSelectedPracticeId(e.target.value)}
                        required
                      >
                        <option value="">Choose a practice...</option>
                        {availablePractices.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {availablePractices.length === 0 && (
                        <p className="mt-1 text-sm text-gray-500">
                          No available practices to assign.
                        </p>
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
                        disabled={assignMutation.isPending || !selectedPracticeId}
                        className="btn-primary"
                      >
                        {assignMutation.isPending ? 'Adding...' : 'Add to Practice'}
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
