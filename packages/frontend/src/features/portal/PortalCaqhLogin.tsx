import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyIcon, ArrowTopRightOnSquareIcon, IdentificationIcon } from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import { notify } from '../../utils/notify';
import ErrorState from '../../components/ui/ErrorState';

// All three verified live against the real portal on 2026-06-12.
const PROVIEW_SIGNIN_URL = 'https://proview.caqh.org/pr';
const FORGOT_PASSWORD_URL = 'https://proview.caqh.org/Login/ForgotPassword?Type=PR';
const FORGOT_USERNAME_URL = 'https://proview.caqh.org/Login/ForgotUsername?Type=PR';

interface CaqhLoginInfo {
  caqhUsername: string | null;
  caqhProviderId: string | null;
}

export default function PortalCaqhLogin() {
  const queryClient = useQueryClient();
  const [draftUsername, setDraftUsername] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['portal-caqh-login'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: CaqhLoginInfo }>('/portal/me/caqh-login');
      return res.data.data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: (caqhUsername: string) =>
      api.patch('/portal/me/caqh-login', { caqhUsername }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-caqh-login'] });
      notify.success('CAQH username saved');
      setDraftUsername('');
    },
    onError: () => notify.error("We couldn't save that username. Please try again."),
  });

  if (error) {
    return (
      <ErrorState
        title="Couldn't load your CAQH login info"
        message="Check your connection and try again."
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Your CAQH login</h1>
        <p className="mt-1 text-sm text-gray-500">
          Everything you need to sign in to DataSpring (formerly CAQH) and re-attest.
          We never store or display your password.
        </p>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-24 bg-gray-100 rounded-2xl" />
          <div className="h-24 bg-gray-100 rounded-2xl" />
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 space-y-4">
            <div className="flex items-center gap-2">
              <IdentificationIcon className="h-5 w-5 text-primary-600" />
              <h2 className="text-sm font-semibold text-gray-900">Sign-in details</h2>
            </div>

            <dl className="space-y-3">
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Username</dt>
                {data?.caqhUsername ? (
                  <dd className="mt-0.5 text-base font-medium text-gray-900">{data.caqhUsername}</dd>
                ) : (
                  <dd className="mt-2">
                    <p className="text-sm text-gray-600 mb-2">
                      We don't have your CAQH username on file. Add it here so we can
                      remind you of it next time, or recover it on DataSpring below.
                    </p>
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = draftUsername.trim();
                        if (!v) return notify.error('Enter your CAQH username first');
                        saveMutation.mutate(v);
                      }}
                    >
                      <input
                        type="text"
                        value={draftUsername}
                        onChange={(e) => setDraftUsername(e.target.value)}
                        maxLength={100}
                        placeholder="Your CAQH / DataSpring username"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                      <button
                        type="submit"
                        disabled={saveMutation.isPending}
                        className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                      >
                        {saveMutation.isPending ? 'Saving…' : 'Save'}
                      </button>
                    </form>
                  </dd>
                )}
              </div>

              {data?.caqhProviderId && (
                <div>
                  <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">CAQH Provider ID</dt>
                  <dd className="mt-0.5 text-base font-medium text-gray-900">{data.caqhProviderId}</dd>
                </div>
              )}

              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Password</dt>
                <dd className="mt-0.5 text-sm text-gray-600">
                  Only you know it. If you've forgotten it, reset it directly on DataSpring.
                </dd>
              </div>
            </dl>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 space-y-3">
            <div className="flex items-center gap-2">
              <KeyIcon className="h-5 w-5 text-primary-600" />
              <h2 className="text-sm font-semibold text-gray-900">DataSpring self-service</h2>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href={PROVIEW_SIGNIN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 text-sm font-medium"
              >
                Sign in to DataSpring
                <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              </a>
              <a
                href={FORGOT_PASSWORD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-sm font-medium"
              >
                Reset your password
                <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              </a>
              <a
                href={FORGOT_USERNAME_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-sm font-medium"
              >
                Recover your username
                <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              </a>
            </div>
            <p className="text-xs text-gray-500">
              These links open DataSpring's official pages. Lanyard Health never asks
              for your DataSpring password.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
