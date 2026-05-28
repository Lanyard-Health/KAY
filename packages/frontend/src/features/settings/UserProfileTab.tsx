import { useState } from 'react';
import { useAuthStore } from '../../stores/auth.store';
import { notify } from '../../utils/notify';
import { mapCognitoError } from '../../utils/cognito-errors';

export default function UserProfileTab() {
  const user = useAuthStore((s) => s.user);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      notify.error('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      notify.error('Password must be at least 8 characters');
      return;
    }

    setIsChangingPassword(true);
    try {
      const { updatePassword } = await import('aws-amplify/auth');
      await updatePassword({ oldPassword: currentPassword, newPassword });
      notify.success('Password changed');
      setShowPasswordForm(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      notify.error('Password change failed', { description: mapCognitoError(error) });
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Avatar & name */}
      <div className="flex items-center gap-5">
        <div className="h-16 w-16 rounded-2xl bg-primary-100 flex items-center justify-center text-primary-700 text-xl font-bold">
          {initials}
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {user?.firstName} {user?.lastName}
          </h3>
          <p className="text-sm text-gray-500">{user?.email}</p>
          <span className="inline-flex items-center mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-600/20 capitalize">
            {user?.role?.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* User info */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">First Name</p>
            <p className="mt-1 text-sm text-gray-900">{user?.firstName}</p>
          </div>
        </div>
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Last Name</p>
            <p className="mt-1 text-sm text-gray-900">{user?.lastName}</p>
          </div>
        </div>
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Email</p>
            <p className="mt-1 text-sm text-gray-900">{user?.email}</p>
          </div>
          <span className="text-xs text-gray-400">Read-only</span>
        </div>
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Role</p>
            <p className="mt-1 text-sm text-gray-900 capitalize">{user?.role?.replace(/_/g, ' ')}</p>
          </div>
          <span className="text-xs text-gray-400">Read-only</span>
        </div>
      </div>

      {/* Change password */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Password</h4>
            <p className="mt-0.5 text-sm text-gray-500">Change your account password</p>
          </div>
          {!showPasswordForm && (
            <button
              onClick={() => setShowPasswordForm(true)}
              className="text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              Change password
            </button>
          )}
        </div>

        {showPasswordForm && (
          <form onSubmit={handleChangePassword} className="mt-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="input-field mt-1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="input-field mt-1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="input-field mt-1"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={isChangingPassword}
                className="btn-primary text-sm"
              >
                {isChangingPassword ? 'Changing...' : 'Update Password'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPasswordForm(false);
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
