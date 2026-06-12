import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusIcon, TrashIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import {
  usePracticeUsers,
  useRemoveUser,
  useAssignUser,
  usePracticeInvitations,
  useResendInvitation,
  useRevokeInvitation,
} from '../../hooks/usePractices';
import type { PracticeUserAssignment } from '../../hooks/usePractices';
import ConfirmDialog from '../../components/ConfirmDialog';
import AssignUserModal from './AssignUserModal';
import InviteUserModal from './InviteUserModal';
import EmptyState from '../../components/ui/EmptyState';
import UserFormModal from '../users/UserFormModal';

const INVITE_STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Pending' },
  accepted: { bg: 'bg-green-100', text: 'text-green-800', label: 'Accepted' },
  revoked: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Revoked' },
  expired: { bg: 'bg-red-100', text: 'text-red-700', label: 'Expired' },
};

interface PracticeUsersTabProps {
  practiceId: string;
}

const ROLE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  SUPER_ADMIN: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Super Admin' },
  PRACTICE_ADMIN: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Practice Admin' },
  PRACTICE_STAFF: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Practice Staff' },
  PROVIDER: { bg: 'bg-green-100', text: 'text-green-800', label: 'Provider' },
};

export default function PracticeUsersTab({ practiceId }: PracticeUsersTabProps) {
  const { data: assignments, isLoading } = usePracticeUsers(practiceId);
  const { data: invitations } = usePracticeInvitations(practiceId);
  const removeMutation = useRemoveUser();
  const assignUserMutation = useAssignUser();
  const resendMutation = useResendInvitation();
  const revokeMutation = useRevokeInvitation();
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [createUserModalOpen, setCreateUserModalOpen] = useState(false);
  const [revokeConfirm, setRevokeConfirm] = useState<{ isOpen: boolean; invitation: { id: string; email: string } | null }>({ isOpen: false, invitation: null });

  const pendingInvitations = (invitations || []).filter((i) => i.status === 'pending' || i.status === 'expired');

  const handleResend = (invitationId: string, email: string) => {
    resendMutation.mutate(
      { invitationId, practiceId },
      {
        onSuccess: () => toast.success(`Invitation re-sent to ${email}.`),
        onError: () => toast.error("We couldn't re-send that invitation. Please try again."),
      }
    );
  };
  const [removeConfirm, setRemoveConfirm] = useState<{ isOpen: boolean; assignment: PracticeUserAssignment | null }>({ isOpen: false, assignment: null });

  const handleRemove = (assignment: PracticeUserAssignment) => {
    setRemoveConfirm({ isOpen: true, assignment });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="card card-body animate-pulse">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-4 w-40 bg-gray-200 rounded" />
                <div className="h-3 w-56 bg-gray-200 rounded" />
              </div>
              <div className="h-6 w-24 bg-gray-200 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const existingUserIds = (assignments || []).map((a) => a.userId);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">Users</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setInviteModalOpen(true)} className="btn-secondary text-sm">
            <EnvelopeIcon className="-ml-1 mr-1.5 h-4 w-4" />
            Invite by Email
          </button>
          <button onClick={() => setAssignModalOpen(true)} className="btn-primary text-sm">
            <PlusIcon className="-ml-1 mr-1.5 h-4 w-4" />
            Add User
          </button>
        </div>
      </div>

      {!assignments || assignments.length === 0 ? (
        <EmptyState
          illustration="people"
          title="No users assigned"
          description="Add users to this practice to manage access."
          action={{ label: 'Assign your first user', onClick: () => setAssignModalOpen(true) }}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  System Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Practice Role
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {assignments.map((assignment) => {
                const badge = ROLE_BADGE[assignment.role] || ROLE_BADGE.PRACTICE_STAFF;
                return (
                  <tr key={assignment.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <Link
                        to={`/users/${assignment.userId}`}
                        className="text-primary-600 hover:text-primary-500"
                      >
                        {assignment.user.firstName} {assignment.user.lastName}
                      </Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {assignment.user.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                      {assignment.user.role.replace('_', ' ')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          badge.bg,
                          badge.text
                        )}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button
                        onClick={() => handleRemove(assignment)}
                        disabled={removeMutation.isPending}
                        className="text-red-600 hover:text-red-900 disabled:opacity-50"
                        title="Remove user"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pending invitations */}
      {pendingInvitations.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">Pending invitations</h4>
          <div className="card overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <tbody className="bg-white divide-y divide-gray-200">
                {pendingInvitations.map((inv) => {
                  const badge = INVITE_STATUS_BADGE[inv.status] || INVITE_STATUS_BADGE.pending;
                  return (
                    <tr key={inv.id}>
                      <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-700">{inv.email}</td>
                      <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-500">
                        {(ROLE_BADGE[inv.role] || ROLE_BADGE.PRACTICE_STAFF).label}
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap">
                        <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', badge.bg, badge.text)}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap text-right text-sm">
                        <button
                          onClick={() => handleResend(inv.id, inv.email)}
                          disabled={resendMutation.isPending}
                          className="text-primary-600 hover:text-primary-500 disabled:opacity-50 mr-4"
                        >
                          Resend
                        </button>
                        <button
                          onClick={() => setRevokeConfirm({ isOpen: true, invitation: { id: inv.id, email: inv.email } })}
                          disabled={revokeMutation.isPending}
                          className="text-red-600 hover:text-red-900 disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Or create a brand new user */}
      <div className="mt-4 text-center">
        <button
          onClick={() => setCreateUserModalOpen(true)}
          className="text-sm text-primary-600 hover:text-primary-500"
        >
          Or create a new user
        </button>
      </div>

      <InviteUserModal
        isOpen={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        practiceId={practiceId}
      />

      <ConfirmDialog
        isOpen={revokeConfirm.isOpen}
        onClose={() => setRevokeConfirm({ isOpen: false, invitation: null })}
        onConfirm={() => {
          if (revokeConfirm.invitation) {
            const email = revokeConfirm.invitation.email;
            revokeMutation.mutate(
              { invitationId: revokeConfirm.invitation.id, practiceId },
              {
                onSuccess: () => toast.success(`Invitation for ${email} revoked.`),
                onError: () => toast.error('Failed to revoke invitation'),
              }
            );
          }
          setRevokeConfirm({ isOpen: false, invitation: null });
        }}
        title="Revoke invitation"
        message={`Revoke the invitation for ${revokeConfirm.invitation?.email}? The link in their email will stop working.`}
        confirmLabel="Revoke"
        variant="warning"
      />

      <AssignUserModal
        isOpen={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        practiceId={practiceId}
        existingUserIds={existingUserIds}
      />

      <UserFormModal
        isOpen={createUserModalOpen}
        onClose={() => setCreateUserModalOpen(false)}
        onCreated={(created) => {
          if (created?.id) {
            // Derive practice-scope role from the system role chosen in the
            // user form. A system-level `admin` or `practice_admin` should
            // get PRACTICE_ADMIN permissions on this practice; everyone else
            // (credentialing_staff, provider) gets PRACTICE_STAFF.
            const isPracticeAdmin = created.role === 'admin' || created.role === 'practice_admin';
            const practiceRole = isPracticeAdmin ? 'PRACTICE_ADMIN' : 'PRACTICE_STAFF';
            assignUserMutation.mutate(
              { practiceId, userId: created.id, role: practiceRole },
              {
                onSuccess: () => toast.success('User created and assigned to practice'),
                onError: () => toast.success('User created (assign to practice manually)'),
              }
            );
          }
        }}
      />

      <ConfirmDialog
        isOpen={removeConfirm.isOpen}
        onClose={() => setRemoveConfirm({ isOpen: false, assignment: null })}
        onConfirm={() => {
          if (removeConfirm.assignment) {
            removeMutation.mutate(
              { practiceId, userId: removeConfirm.assignment.userId },
              {
                onSuccess: () => toast.success('User removed from practice'),
                onError: () => toast.error('Failed to remove user'),
              }
            );
          }
          setRemoveConfirm({ isOpen: false, assignment: null });
        }}
        title="Remove User"
        message={`Remove ${removeConfirm.assignment?.user.firstName} ${removeConfirm.assignment?.user.lastName} from this practice?`}
        confirmLabel="Remove"
        variant="warning"
      />
    </div>
  );
}
