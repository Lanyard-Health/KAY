import { useState } from 'react';
import { format } from 'date-fns';
import {
  useCaqhCredentialStatus,
  useSaveCaqhCredentials,
  useVerifyCaqhCredentials,
  getCredentialStatusLabel,
  getCredentialStatusColor,
  CAQH_PROVIEW_URL,
} from '../hooks/useCaqhCredentials';

interface CaqhCardProps {
  providerId: string;
}

export function CaqhCard({ providerId }: CaqhCardProps) {
  const [isEditingCredentials, setIsEditingCredentials] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const { data: credentialStatusData, isLoading: isLoadingCredentials } = useCaqhCredentialStatus(providerId);
  const saveCredentials = useSaveCaqhCredentials();
  const verifyCredentials = useVerifyCaqhCredentials();

  const credentialStatus = credentialStatusData?.data;

  const handleSaveCredentials = async () => {
    if (!username || !password) return;

    await saveCredentials.mutateAsync({
      providerId,
      username,
      password,
    });

    setIsEditingCredentials(false);
    setPassword('');
  };

  const handleVerify = async () => {
    await verifyCredentials.mutateAsync(providerId);
  };

  const handleCancelEdit = () => {
    setIsEditingCredentials(false);
    setUsername('');
    setPassword('');
  };

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900">CAQH ProView</h3>
          <a
            href={CAQH_PROVIEW_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary-600 hover:text-primary-800"
          >
            Open Portal
          </a>
        </div>
      </div>

      <div className="p-4">
        {isLoadingCredentials ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-8 bg-gray-200 rounded w-full"></div>
          </div>
        ) : isEditingCredentials ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500"
                placeholder="CAQH username"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 pr-10"
                  placeholder="CAQH password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-500 hover:text-gray-700"
                >
                  {showPassword ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSaveCredentials}
                disabled={!username || !password || saveCredentials.isPending}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saveCredentials.isPending ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Credential Status */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Status</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  credentialStatus ? getCredentialStatusColor(credentialStatus) : 'bg-gray-100 text-gray-800'
                }`}
              >
                {credentialStatus ? getCredentialStatusLabel(credentialStatus) : 'Unknown'}
              </span>
            </div>

            {/* Username */}
            {credentialStatus?.hasCredentials && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Username</span>
                <span className="text-sm text-gray-900">{credentialStatus.username}</span>
              </div>
            )}

            {/* Last Verified */}
            {credentialStatus?.lastChecked && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Last Verified</span>
                <span className="text-sm text-gray-900">
                  {format(new Date(credentialStatus.lastChecked), 'MMM d, yyyy')}
                </span>
              </div>
            )}

            {/* Verification Result Message */}
            {verifyCredentials.data?.data && (
              <div
                className={`text-xs p-2 rounded ${
                  verifyCredentials.data.data.valid
                    ? 'bg-green-50 text-green-700'
                    : 'bg-red-50 text-red-700'
                }`}
              >
                {verifyCredentials.data.data.message}
                {verifyCredentials.data.data.errorType === 'mfa_required' && (
                  <span className="block mt-1 text-yellow-600">
                    MFA is enabled - credentials are valid
                  </span>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              {credentialStatus?.hasCredentials ? (
                <>
                  <button
                    onClick={handleVerify}
                    disabled={verifyCredentials.isPending}
                    className="flex-1 px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {verifyCredentials.isPending ? (
                      <span className="flex items-center justify-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Verifying...
                      </span>
                    ) : (
                      'Verify'
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setUsername(credentialStatus.username || '');
                      setIsEditingCredentials(true);
                    }}
                    className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                  >
                    Edit
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setIsEditingCredentials(true)}
                  className="flex-1 px-3 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700"
                >
                  Add Credentials
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
