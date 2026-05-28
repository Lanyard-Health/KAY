import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeftIcon, PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useUserDetail, useDeactivateUser, useActivateUser } from '../../hooks/useUserManagement';
import { useRemoveUser } from '../../hooks/usePractices';
import { useQueryClient } from '@tanstack/react-query';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingState from '../../components/ui/LoadingState';
import UserFormModal from './UserFormModal';
import AddUserToPracticeModal from './AddUserToPracticeModal';

const ROLE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  admin: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Admin' },
  credentialing_staff: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Credentialing Staff' },
  provider: { bg: 'bg-green-100', text: 'text-green-800', label: 'Provider' },
};

const PRACTICE_ROLE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  SUPER_ADMIN: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Super Admin' },
  PRACTICE_ADMIN: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Practice Admin' },
  PRACTICE_STAFF: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Practice Staff' },
  PROVIDER: { bg: 'bg-green-100', text: 'text-green-800', label: 'Provider' },
};

export default function UserDetail() {
  const { userId } = useParams();
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useUserDetail(userId!);
  const deactivateMutation = useDeactivateUser();
  const activateMutation = useActivateUser();
  const removeFromPracticeMutation = useRemoveUser();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [addPracticeModalOpen, setAddPracticeModalOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    variant: 'danger' | 'warning' | 'info';
    confirmLabel: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', variant: 'danger', confirmLabel: 'Confirm', onConfirm: () => {} });

  const closeConfirm = useCallback(() => {
    setConfirmState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleDeactivate = () => {
    setConfirmState({
      isOpen: true,
      title: 'Deactivate User',
      message: `Deactivate ${user!.firstName} ${user!.lastName}? They will no longer be able to log in.`,
      variant: 'danger',
      confirmLabel: 'Deactivate',
      onConfirm: () => {
        deactivateMutation.mutate(userId!, {
          onSuccess: () => toast.success('User deactivated'),
          onError: (error: any) => {
            toast.error(error?.response?.data?.error?.message || 'Failed to deactivate user');
          },
        });
        closeConfirm();
      },
    });
  };

  const handleActivate = () => {
    setConfirmState({
      isOpen: true,
      title: 'Reactivate User',
      message: `Reactivate ${user!.firstName} ${user!.lastName}? They will be able to log in again.`,
      variant: 'info',
      confirmLabel: 'Reactivate',
      onConfirm: () => {
        activateMutation.mutate(userId!, {
          onSuccess: () => toast.success('User activated'),
          onError: () => toast.error('Failed to activate user'),
        });
        closeConfirm();
      },
    });
  };

  const handleRemoveFromPractice = (practiceId: string, practiceName: string) => {
    setConfirmState({
      isOpen: true,
      title: 'Remove from Practice',
      message: `Remove this user from ${practiceName}?`,
      variant: 'warning',
      confirmLabel: 'Remove',
      onConfirm: () => {
        removeFromPracticeMutation.mutate(
          { practiceId, userId: userId! },
          {
            onSuccess: () => {
              toast.success(`Removed from ${practiceName}`);
              queryClient.invalidateQueries({ queryKey: ['user-detail', userId] });
            },
            onError: () => toast.error('Failed to remove from practice'),
          }
        );
        closeConfirm();
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingState label="Loading user…" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">User not found</p>
        <Link to="/users" className="text-primary-600 hover:underline mt-2 inline-block">
          Back to users
        </Link>
      </div>
    );
  }

  const roleBadge = ROLE_BADGE[user.role] || ROLE_BADGE.credentialing_staff;

  return (
    <div>
      {/* Back link */}
      <Link
        to="/users"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeftIcon className="h-4 w-4 mr-1" />
        Back to Users
      </Link>

      {/* Header */}
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div className="flex items-center">
          <div className="h-16 w-16 rounded-full bg-primary-100 flex items-center justify-center">
            <span className="text-primary-600 text-2xl font-bold">
              {user.firstName[0]}{user.lastName[0]}
            </span>
          </div>
          <div className="ml-4">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {user.firstName} {user.lastName}
              </h1>
              <span
                className={clsx(
                  'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                  roleBadge.bg,
                  roleBadge.text
                )}
              >
                {roleBadge.label}
              </span>
              <span
                className={clsx(
                  'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                  user.isActive
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-600'
                )}
              >
                {user.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">{user.email}</p>
            {user.phone && <p className="text-sm text-gray-500">{user.phone}</p>}
          </div>
        </div>
        <div className="mt-4 sm:mt-0 flex gap-3">
          <button onClick={() => setEditModalOpen(true)} className="btn-secondary">
            <PencilIcon className="-ml-1 mr-2 h-5 w-5" />
            Edit
          </button>
          {user.isActive ? (
            <button
              onClick={handleDeactivate}
              disabled={deactivateMutation.isPending}
              className="inline-flex items-center px-4 py-2 border border-red-300 rounded-lg text-sm font-medium text-red-700 bg-white hover:bg-red-50 disabled:opacity-50"
            >
              {deactivateMutation.isPending ? 'Deactivating...' : 'Deactivate'}
            </button>
          ) : (
            <button
              onClick={handleActivate}
              disabled={activateMutation.isPending}
              className="inline-flex items-center px-4 py-2 border border-green-300 rounded-lg text-sm font-medium text-green-700 bg-white hover:bg-green-50 disabled:opacity-50"
            >
              {activateMutation.isPending ? 'Activating...' : 'Activate'}
            </button>
          )}
        </div>
      </div>

      {/* Practice Assignments */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">Practice Assignments</h2>
          <button
            onClick={() => setAddPracticeModalOpen(true)}
            className="text-sm text-primary-600 hover:text-primary-500 flex items-center"
          >
            <PlusIcon className="h-4 w-4 mr-1" />
            Add to Practice
          </button>
        </div>
        <div className="card-body">
          {user.practices.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-gray-500">Not assigned to any practice.</p>
              <button
                onClick={() => setAddPracticeModalOpen(true)}
                className="mt-2 text-sm text-primary-600 hover:text-primary-500"
              >
                Add to a practice
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {user.practices.map((assignment) => {
                const pBadge = PRACTICE_ROLE_BADGE[assignment.role] || PRACTICE_ROLE_BADGE.PRACTICE_STAFF;
                return (
                  <div
                    key={assignment.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <Link
                          to={`/practices/${assignment.practiceId}`}
                          className="text-sm font-medium text-primary-600 hover:text-primary-500"
                        >
                          {assignment.practice.name}
                        </Link>
                        <span
                          className={clsx(
                            'ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                            assignment.practice.status === 'ACTIVE'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-600'
                          )}
                        >
                          {assignment.practice.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={clsx(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          pBadge.bg,
                          pBadge.text
                        )}
                      >
                        {pBadge.label}
                      </span>
                      <button
                        onClick={() => handleRemoveFromPractice(assignment.practiceId, assignment.practice.name)}
                        disabled={removeFromPracticeMutation.isPending}
                        className="text-red-600 hover:text-red-900 disabled:opacity-50"
                        title="Remove from practice"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* User Info */}
      <div className="card mt-6">
        <div className="card-header">
          <h2 className="text-lg font-medium text-gray-900">User Information</h2>
        </div>
        <div className="card-body">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">Email</dt>
              <dd className="mt-1 text-sm text-gray-900">{user.email}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Phone</dt>
              <dd className="mt-1 text-sm text-gray-900">{user.phone || '—'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">System Role</dt>
              <dd className="mt-1 text-sm text-gray-900 capitalize">{user.role.replace('_', ' ')}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Last Login</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {user.lastLoginAt
                  ? new Date(user.lastLoginAt).toLocaleDateString()
                  : 'Never'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Created</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {new Date(user.createdAt).toLocaleDateString()}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <UserFormModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        user={user}
      />

      <AddUserToPracticeModal
        isOpen={addPracticeModalOpen}
        onClose={() => {
          setAddPracticeModalOpen(false);
          queryClient.invalidateQueries({ queryKey: ['user-detail', userId] });
        }}
        userId={userId!}
        existingPracticeIds={user.practices.map((p) => p.practiceId)}
      />

      <ConfirmDialog
        isOpen={confirmState.isOpen}
        onClose={closeConfirm}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel={confirmState.confirmLabel}
        variant={confirmState.variant}
      />
    </div>
  );
}
