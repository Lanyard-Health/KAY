import { Fragment, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useCreateInvitation } from '../../hooks/usePractices';
import type { PracticeRoleValue } from '../../hooks/usePractices';

interface InviteUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  practiceId: string;
}

const INVITE_ROLES = [
  { value: 'PRACTICE_ADMIN', label: 'Practice Admin' },
  { value: 'PRACTICE_STAFF', label: 'Practice Staff' },
  { value: 'PROVIDER', label: 'Provider' },
] as const;

export default function InviteUserModal({ isOpen, onClose, practiceId }: InviteUserModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PracticeRoleValue>('PRACTICE_ADMIN');
  const createInvitation = useCreateInvitation();

  const handleClose = () => {
    setEmail('');
    setRole('PRACTICE_ADMIN');
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error('Enter an email address');
      return;
    }

    createInvitation.mutate(
      { practiceId, email: trimmed, role },
      {
        onSuccess: () => {
          toast.success(`Invitation sent to ${trimmed}.`);
          handleClose();
        },
        onError: (error: any) => {
          toast.error(error?.response?.data?.error?.message || "We couldn't send that invitation. Check the email and try again.");
        },
      }
    );
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95" enterTo="opacity-100 translate-y-0 sm:scale-100" leave="ease-in duration-200" leaveFrom="opacity-100 translate-y-0 sm:scale-100" leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95">
              <Dialog.Panel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-md">
                <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      Invite to Practice
                    </Dialog.Title>
                    <button onClick={handleClose} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <p className="text-sm text-gray-500 mb-4">
                    We'll email a branded invitation with a secure link. They set their own password and are added to this practice automatically.
                  </p>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label className="label">Email *</label>
                      <input
                        type="email"
                        className="input"
                        placeholder="person@practice.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>

                    <div>
                      <label className="label">Practice Role *</label>
                      <select className="input" value={role} onChange={(e) => setRole(e.target.value as PracticeRoleValue)}>
                        {INVITE_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t">
                      <button type="button" onClick={handleClose} className="btn-secondary">Cancel</button>
                      <button type="submit" disabled={createInvitation.isPending || !email.trim()} className="btn-primary">
                        {createInvitation.isPending ? 'Sending...' : 'Send Invitation'}
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
