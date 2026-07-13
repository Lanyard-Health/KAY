import { Fragment, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Menu, Transition } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/20/solid';
import clsx from 'clsx';
import ConfirmDialog from './ConfirmDialog';
import CaqhNotReadyModal from './ui/CaqhNotReadyModal';
import {
  useCaqhCredentialStatus,
  useSaveCaqhCredentials,
  useVerifyCaqhCredentials,
  getCredentialStatusLabel,
  getCredentialStatusColor,
  CAQH_PROVIEW_URL,
} from '../hooks/useCaqhCredentials';
import { useCaqhSyncHistory, useCaqhConfig, useAddToRoster, useRemoveFromRoster } from '../hooks/useCaqhSync';
import { api } from '../services/api';

interface CaqhCardProps {
  providerId: string;
}

export function CaqhCard({ providerId }: CaqhCardProps) {
  const [isEditingCredentials, setIsEditingCredentials] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showSyncHistory, setShowSyncHistory] = useState(false);
  const [syncHistoryPage, setSyncHistoryPage] = useState(1);
  const [removeRosterConfirm, setRemoveRosterConfirm] = useState(false);
  // Non-null = the import pre-flight found the provider not roster-ready; holds
  // the missing-field codes shown in CaqhNotReadyModal.
  const [notReadyFields, setNotReadyFields] = useState<string[] | null>(null);

  const queryClient = useQueryClient();
  const { data: credentialStatusData, isLoading: isLoadingCredentials } = useCaqhCredentialStatus(providerId);
  const saveCredentials = useSaveCaqhCredentials();
  const verifyCredentials = useVerifyCaqhCredentials();

  const { data: syncHistoryData } = useCaqhSyncHistory(providerId, syncHistoryPage, 5);
  const { data: caqhConfig } = useCaqhConfig();
  const addToRoster = useAddToRoster();
  const removeFromRoster = useRemoveFromRoster();

  const exportMutation = useMutation({
    mutationFn: async (exportFormat: 'json' | 'csv' | 'pdf') => {
      const { blob, headers } = await api.downloadBlob(
        `/caqh/export/${providerId}?format=${exportFormat}`,
      );

      const disposition = headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] || `caqh-export.${exportFormat}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    onError: (error: any) => {
      const code = error.response?.data?.code;
      const msg = code === 'CAQH_NOT_SYNCED'
        ? 'No CAQH data available — sync this provider first.'
        : error.response?.data?.error || error.message || 'CAQH export failed';
      toast.error(msg);
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/caqh/pull/${providerId}`);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caqh-sync-history', providerId] });
      queryClient.invalidateQueries({ queryKey: ['provider', providerId] });
      queryClient.invalidateQueries({ queryKey: ['caqh-credentials', providerId] });
      toast.success('CAQH sync completed');
    },
    onError: (error: any) => {
      const code = error.response?.data?.code;
      const msg = code === 'CAQH_NOT_REGISTERED'
        ? 'This provider is not registered with CAQH. Add them to the roster first.'
        : code === 'CAQH_NOT_CONFIGURED'
        ? 'CAQH integration is not configured. Contact your administrator.'
        : error.response?.data?.error || 'CAQH sync failed';
      toast.error(msg);
    },
  });

  // CAQH-first onboarding: orchestrated background import (roster-add → status
  // check → full profile sync), unlike syncMutation which pulls inline and fails
  // if the provider isn't roster-ready.
  const importMutation = useMutation({
    mutationFn: async () => {
      // Pre-flight: mirror the background job's roster-readiness check so an
      // incomplete provider gets a clear on-screen explanation instead of a
      // failed worker alert. Runs inside mutationFn so isPending covers it.
      const readinessRes = await api.get(`/caqh/roster-readiness/${providerId}`);
      const readiness = (readinessRes.data as { data: { ready: boolean; missingFields: string[] } }).data;
      if (!readiness.ready) {
        return { notReady: true, missingFields: readiness.missingFields };
      }
      const response = await api.post(`/caqh/import/${providerId}`);
      return response.data.data;
    },
    onSuccess: (data: { notReady?: boolean; missingFields?: string[]; deduplicated?: boolean }) => {
      if (data?.notReady) {
        setNotReadyFields(data.missingFields ?? []);
        return;
      }
      toast.success(
        data?.deduplicated
          ? 'An import is already running for this provider'
          : 'Import started — this runs in the background. We\'ll email the provider if anything needs their action in CAQH.'
      );
      queryClient.invalidateQueries({ queryKey: ['provider', providerId] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to start CAQH import');
    },
  });

  // PR 3: documents-only import (profile import above also ingests documents
  // automatically; this button re-runs just the document pull — it's idempotent).
  const importDocsMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/caqh/import-documents/${providerId}`);
      return response.data.data;
    },
    onSuccess: (summary: { imported?: number; skippedAlreadyImported?: number; failed?: number }) => {
      const imported = summary?.imported ?? 0;
      const skipped = summary?.skippedAlreadyImported ?? 0;
      toast.success(`Documents imported: ${imported} new, ${skipped} already on file`);
      queryClient.invalidateQueries({ queryKey: ['provider', providerId] });
      queryClient.invalidateQueries({ queryKey: ['documents', providerId] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to import documents from CAQH');
    },
  });

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
            href={caqhConfig?.proviewUrl ?? CAQH_PROVIEW_URL}
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

            {/* CAQH Roster Status */}
            {credentialStatus?.caqhProviderId && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">CAQH ID</span>
                <span className="text-sm text-gray-900">{credentialStatus.caqhProviderId}</span>
              </div>
            )}

            {credentialStatus?.caqhStatus && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Roster Status</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  credentialStatus.caqhStatus === 'active' ? 'bg-green-100 text-green-800' :
                  credentialStatus.caqhStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {credentialStatus.caqhStatus.charAt(0).toUpperCase() + credentialStatus.caqhStatus.slice(1)}
                </span>
              </div>
            )}

            {/* Auto-Sync Schedule */}
            {caqhConfig?.configured && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Auto-Sync</span>
                <span className="text-xs text-gray-600">Daily at 2:00 AM</span>
              </div>
            )}

            {credentialStatus?.caqhLastSync && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Last Sync</span>
                <span className="text-sm text-gray-900">
                  {formatDistanceToNow(new Date(credentialStatus.caqhLastSync), { addSuffix: true })}
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
                    MFA required — credentials not fully verified
                  </span>
                )}
              </div>
            )}

            {/* Sync History Toggle */}
            <button
              onClick={() => setShowSyncHistory(!showSyncHistory)}
              className="text-xs text-primary-600 hover:text-primary-800 underline"
            >
              {showSyncHistory ? 'Hide Sync History' : 'View Sync History'}
            </button>

            {showSyncHistory && syncHistoryData && (
              <div className="space-y-2 mt-2">
                {syncHistoryData.data.length === 0 ? (
                  <p className="text-xs text-gray-500">No sync history yet.</p>
                ) : (
                  <>
                    {syncHistoryData.data.map((entry) => (
                      <div key={entry.id} className="text-xs p-2 rounded bg-gray-50 border border-gray-100">
                        <div className="flex justify-between">
                          <span className={entry.status === 'completed' ? 'text-green-700' : entry.status === 'failed' ? 'text-red-700' : 'text-yellow-700'}>
                            {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                          </span>
                          <span className="text-gray-500">
                            {formatDistanceToNow(new Date(entry.startedAt), { addSuffix: true })}
                          </span>
                        </div>
                        {entry.durationMs && (
                          <span className="text-gray-400">{(entry.durationMs / 1000).toFixed(1)}s</span>
                        )}
                        {entry.errorMessage && (
                          <p className="text-red-600 mt-1">{entry.errorMessage}</p>
                        )}
                      </div>
                    ))}
                    {syncHistoryData.pagination.totalPages > 1 && (
                      <div className="flex justify-between items-center pt-1">
                        <button
                          onClick={() => setSyncHistoryPage(Math.max(1, syncHistoryPage - 1))}
                          disabled={syncHistoryPage === 1}
                          className="text-xs text-primary-600 hover:text-primary-800 disabled:text-gray-400"
                        >
                          Previous
                        </button>
                        <span className="text-xs text-gray-500">
                          Page {syncHistoryData.pagination.page} of {syncHistoryData.pagination.totalPages}
                        </span>
                        <button
                          onClick={() => setSyncHistoryPage(syncHistoryPage + 1)}
                          disabled={syncHistoryPage >= syncHistoryData.pagination.totalPages}
                          className="text-xs text-primary-600 hover:text-primary-800 disabled:text-gray-400"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              {credentialStatus?.hasCredentials ? (
                <>
                  <button
                    onClick={() => syncMutation.mutate()}
                    disabled={syncMutation.isPending}
                    className="flex-1 px-3 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {syncMutation.isPending ? (
                      <span className="flex items-center justify-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Syncing...
                      </span>
                    ) : (
                      'Sync Credentials'
                    )}
                  </button>
                  <button
                    onClick={handleVerify}
                    disabled={verifyCredentials.isPending}
                    className="px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {verifyCredentials.isPending ? 'Verifying...' : 'Verify'}
                  </button>
                  <Menu as="div" className="relative">
                    <Menu.Button
                      disabled={!credentialStatus?.caqhLastSync || exportMutation.isPending}
                      title={
                        !credentialStatus?.caqhLastSync
                          ? 'Sync this provider before exporting.'
                          : undefined
                      }
                      className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center"
                    >
                      {exportMutation.isPending ? 'Exporting...' : 'Export'}
                      <ChevronDownIcon className="ml-1 -mr-0.5 h-4 w-4" aria-hidden="true" />
                    </Menu.Button>
                    <Transition
                      as={Fragment}
                      enter="transition ease-out duration-100"
                      enterFrom="transform opacity-0 scale-95"
                      enterTo="transform opacity-100 scale-100"
                      leave="transition ease-in duration-75"
                      leaveFrom="transform opacity-100 scale-100"
                      leaveTo="transform opacity-0 scale-95"
                    >
                      <Menu.Items className="absolute right-0 z-10 mt-2 w-40 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black/5 focus:outline-none">
                        <div className="py-1">
                          {(['pdf', 'csv', 'json'] as const).map((fmt) => (
                            <Menu.Item key={fmt}>
                              {({ active }) => (
                                <button
                                  onClick={() => exportMutation.mutate(fmt)}
                                  className={clsx(
                                    active ? 'bg-gray-50' : '',
                                    'block w-full text-left px-4 py-2 text-sm text-gray-700',
                                  )}
                                >
                                  Export as {fmt.toUpperCase()}
                                </button>
                              )}
                            </Menu.Item>
                          ))}
                        </div>
                      </Menu.Items>
                    </Transition>
                  </Menu>
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

            {/* Roster Management */}
            {credentialStatus?.hasCredentials && !credentialStatus?.caqhProviderId && (
              <div className="pt-2 border-t border-gray-100">
                <button
                  onClick={() => addToRoster.mutate(providerId, {
                    onSuccess: () => toast.success('Added to CAQH roster'),
                    onError: () => toast.error('Failed to add to roster'),
                  })}
                  disabled={addToRoster.isPending}
                  className="w-full px-3 py-2 text-sm font-medium text-primary-700 bg-primary-50 rounded-md hover:bg-primary-100 disabled:opacity-50"
                >
                  {addToRoster.isPending ? 'Adding...' : 'Add to CAQH Roster'}
                </button>
              </div>
            )}

            {credentialStatus?.caqhProviderId && (
              <div className="pt-2 border-t border-gray-100">
                <button
                  onClick={() => importMutation.mutate()}
                  disabled={importMutation.isPending}
                  className="w-full mb-2 px-3 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {importMutation.isPending ? 'Starting import…' : 'Import from CAQH'}
                </button>
                <button
                  onClick={() => importDocsMutation.mutate()}
                  disabled={importDocsMutation.isPending}
                  className="w-full mb-2 px-3 py-2 text-sm font-medium text-primary-700 bg-primary-50 rounded-md hover:bg-primary-100 disabled:opacity-50"
                >
                  {importDocsMutation.isPending ? 'Importing documents…' : 'Import documents only'}
                </button>
                <button
                  onClick={() => setRemoveRosterConfirm(true)}
                  disabled={removeFromRoster.isPending}
                  className="w-full px-3 py-2 text-xs font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 disabled:opacity-50"
                >
                  {removeFromRoster.isPending ? 'Removing...' : 'Remove from Roster'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={removeRosterConfirm}
        onClose={() => setRemoveRosterConfirm(false)}
        onConfirm={() => {
          removeFromRoster.mutate(providerId, {
            onSuccess: () => toast.success('Removed from CAQH roster'),
            onError: () => toast.error('Failed to remove from roster'),
          });
          setRemoveRosterConfirm(false);
        }}
        title="Remove from Roster"
        message="Remove this provider from the CAQH roster? You can add them back later."
        confirmLabel="Remove"
        variant="danger"
        isLoading={removeFromRoster.isPending}
      />

      <CaqhNotReadyModal
        isOpen={notReadyFields !== null}
        onClose={() => setNotReadyFields(null)}
        missingFields={notReadyFields ?? []}
      />
    </div>
  );
}
