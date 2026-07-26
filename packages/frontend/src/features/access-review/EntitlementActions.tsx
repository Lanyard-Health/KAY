import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useUpdateUser, useDeactivateUser, useActivateUser } from '../../hooks/useUserManagement';
import { useRemoveUser } from '../../hooks/usePractices';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { EntitlementRow } from './hooks';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  lanyard_staff: 'Lanyard Health Staff',
  credentialing_staff: 'Credentialing Staff',
  practice_admin: 'Practice Admin',
  provider: 'Provider',
};

interface PendingAction {
  title: string;
  message: string;
  variant: 'danger' | 'warning' | 'info';
  confirmLabel: string;
  run: () => void;
}

/**
 * Inline access-management actions for a single entitlement row:
 * change role, activate/deactivate, remove a practice assignment.
 * All actions confirm first and are audited server-side (old → new values).
 */
export default function EntitlementActions({ user }: { user: EntitlementRow }) {
  const queryClient = useQueryClient();
  const updateMutation = useUpdateUser();
  const deactivateMutation = useDeactivateUser();
  const activateMutation = useActivateUser();
  const removePracticeMutation = useRemoveUser();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [roleValue, setRoleValue] = useState(user.role);

  const busy =
    updateMutation.isPending ||
    deactivateMutation.isPending ||
    activateMutation.isPending ||
    removePracticeMutation.isPending;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['access-review-entitlements'] });
    queryClient.invalidateQueries({ queryKey: ['access-review-permission-users'] });
  };

  const handleRoleChange = (newRole: string) => {
    if (newRole === user.role) return;
    setRoleValue(newRole);
    setPending({
      title: 'Change role',
      message: `Change ${user.firstName} ${user.lastName}'s role from ${ROLE_LABELS[user.role] || user.role} to ${ROLE_LABELS[newRole] || newRole}? Their permissions will change immediately, and the change is recorded in the audit log.`,
      variant: 'warning',
      confirmLabel: 'Change Role',
      run: () =>
        updateMutation.mutate(
          { userId: user.id, role: newRole },
          {
            onSuccess: () => {
              toast.success('Role updated');
              refresh();
            },
            onError: (error: any) => {
              setRoleValue(user.role);
              toast.error(error?.response?.data?.error?.message || 'Failed to update role');
            },
          }
        ),
    });
  };

  const handleToggleActive = () => {
    if (user.isActive) {
      setPending({
        title: 'Deactivate user',
        message: `Deactivate ${user.firstName} ${user.lastName}? They immediately lose all access and can't log in. You can reactivate them later.`,
        variant: 'danger',
        confirmLabel: 'Deactivate',
        run: () =>
          deactivateMutation.mutate(user.id, {
            onSuccess: () => {
              toast.success('User deactivated');
              refresh();
            },
            onError: (error: any) =>
              toast.error(error?.response?.data?.error?.message || 'Failed to deactivate user'),
          }),
      });
    } else {
      setPending({
        title: 'Reactivate user',
        message: `Reactivate ${user.firstName} ${user.lastName}? They regain the permissions granted by their ${ROLE_LABELS[user.role] || user.role} role.`,
        variant: 'info',
        confirmLabel: 'Reactivate',
        run: () =>
          activateMutation.mutate(user.id, {
            onSuccess: () => {
              toast.success('User reactivated');
              refresh();
            },
            onError: (error: any) =>
              toast.error(error?.response?.data?.error?.message || 'Failed to reactivate user'),
          }),
      });
    }
  };

  const handleRemovePractice = (practiceId: string, practiceName: string) => {
    setPending({
      title: 'Remove practice access',
      message: `Remove ${user.firstName} ${user.lastName} from ${practiceName}? They lose access to that practice's data.`,
      variant: 'danger',
      confirmLabel: 'Remove',
      run: () =>
        removePracticeMutation.mutate(
          { practiceId, userId: user.id },
          {
            onSuccess: () => {
              toast.success('Removed from practice');
              refresh();
            },
            onError: (error: any) =>
              toast.error(error?.response?.data?.error?.message || 'Failed to remove from practice'),
          }
        ),
    });
  };

  return (
    <div className="flex flex-col gap-2 items-start">
      <select
        className="input py-1 text-xs w-44"
        value={roleValue}
        disabled={busy}
        onChange={(e) => handleRoleChange(e.target.value)}
        aria-label={`Change role for ${user.email}`}
      >
        {Object.entries(ROLE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleToggleActive}
        disabled={busy}
        className={
          user.isActive
            ? 'text-xs font-medium text-red-600 hover:text-red-500 disabled:opacity-50'
            : 'text-xs font-medium text-green-600 hover:text-green-500 disabled:opacity-50'
        }
      >
        {user.isActive ? 'Deactivate' : 'Reactivate'}
      </button>
      {user.practices.map((p) => (
        <button
          key={p.practiceId}
          type="button"
          disabled={busy}
          onClick={() => handleRemovePractice(p.practiceId, p.practice.name)}
          className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
          title={`Remove from ${p.practice.name}`}
        >
          ✕ {p.practice.name}
        </button>
      ))}
      <ConfirmDialog
        isOpen={!!pending}
        onClose={() => {
          setRoleValue(user.role);
          setPending(null);
        }}
        onConfirm={() => {
          pending?.run();
          setPending(null);
        }}
        title={pending?.title || ''}
        message={pending?.message || ''}
        confirmLabel={pending?.confirmLabel}
        variant={pending?.variant}
        isLoading={busy}
      />
    </div>
  );
}
