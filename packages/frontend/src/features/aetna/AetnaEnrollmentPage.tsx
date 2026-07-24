import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircleIcon, XCircleIcon, ArrowPathIcon } from '@heroicons/react/24/solid';
import { api } from '../../services/api';

/**
 * Aetna Enrollment workflow — staff screen for the human-in-the-loop Aetna
 * "Join the Network" automation: pick a provider, verify the pre-flight
 * readiness checklist, launch a run, review per-page screenshots of the
 * filled application, and approve (final submit) or reject.
 */

interface ReadinessItem { key: string; label: string; ok: boolean; message?: string }
interface Readiness { ready: boolean; checklist: ReadinessItem[]; enrollmentId: string | null }
interface RunSummary {
  id: string; enrollmentId: string; status: string; startedAt: string;
  submittedAt?: string | null; externalReference?: string | null; confirmationNumber?: string | null;
  errorDetails?: { message?: string } | null;
  enrollment?: { provider?: { id: string; firstName: string; lastName: string } | null };
}
interface RunDetail extends RunSummary {
  screens: Array<{ label: string; s3Key: string; signedUrl?: string }>;
  liveSession: boolean;
}

const ACTIVE_STATUSES = ['FILLING', 'AWAITING_REVIEW', 'SUBMITTING'];

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'SUBMITTED' ? 'bg-green-100 text-green-800'
    : status === 'AWAITING_REVIEW' ? 'bg-amber-100 text-amber-800'
    : status === 'FAILED' ? 'bg-red-100 text-red-800'
    : status === 'CANCELLED' ? 'bg-gray-100 text-gray-600'
    : 'bg-blue-100 text-blue-800';
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{status.replace(/_/g, ' ')}</span>;
}

export default function AetnaEnrollmentPage() {
  const queryClient = useQueryClient();
  const [providerId, setProviderId] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);

  const { data: providers } = useQuery({
    queryKey: ['aetna-providers'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { data: Array<{ id: string; firstName: string; lastName: string; npi?: string }> } }>('/providers?pageSize=100');
      return res.data.data?.data ?? [];
    },
  });

  const { data: readiness, isFetching: readinessLoading } = useQuery({
    queryKey: ['aetna-readiness', providerId],
    enabled: !!providerId,
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Readiness }>(`/providers/${providerId}/aetna-readiness`);
      return res.data.data;
    },
  });

  const { data: runs, refetch: refetchRuns } = useQuery({
    queryKey: ['aetna-runs'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: RunSummary[] }>('/aetna-runs');
      return res.data.data;
    },
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => ACTIVE_STATUSES.includes(r.status)) ? 5000 : false,
  });

  const { data: runDetail } = useQuery({
    queryKey: ['aetna-run', selectedRunId],
    enabled: !!selectedRunId,
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: RunDetail }>(`/aetna-runs/${selectedRunId}`);
      return res.data.data;
    },
    refetchInterval: (q) =>
      q.state.data && ACTIVE_STATUSES.includes(q.state.data.status) ? 4000 : false,
  });

  const launch = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ success: boolean; data: { runId: string } }>('/aetna-runs', { providerId });
      return res.data.data;
    },
    onSuccess: (data) => {
      setSelectedRunId(data.runId);
      void refetchRuns();
    },
  });

  const approve = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/aetna-runs/${selectedRunId}/approve`, {});
      return res.data;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['aetna-run', selectedRunId] });
      void refetchRuns();
    },
  });

  const reject = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/aetna-runs/${selectedRunId}/reject`, { reason: rejectReason });
      return res.data;
    },
    onSuccess: () => {
      setShowReject(false);
      setRejectReason('');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['aetna-run', selectedRunId] });
      void refetchRuns();
    },
  });

  return (
    <div className="space-y-8" data-testid="aetna-enrollment-page">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Aetna Enrollment</h1>
        <p className="text-sm text-gray-500 mt-1">
          Automates Aetna’s “Join the Network” application. The form is filled automatically, then pauses for
          your review — nothing is submitted until you approve.
        </p>
      </div>

      {/* 1. Provider + readiness */}
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-medium text-gray-900">1. Pick a provider</h2>
        <select
          className="w-full md:w-96 rounded-md border-gray-300 text-sm shadow-sm"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          data-testid="aetna-provider-picker"
        >
          <option value="">— select a provider —</option>
          {(providers ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.lastName}, {p.firstName}{p.npi ? ` (NPI ${p.npi})` : ''}</option>
          ))}
        </select>

        {providerId && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              Pre-flight readiness
              {readinessLoading && <ArrowPathIcon className="h-4 w-4 animate-spin text-gray-400" />}
            </h3>
            {readiness && (
              <>
                <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md">
                  {readiness.checklist.map((item) => (
                    <li key={item.key} className="flex items-start gap-2 px-3 py-2 text-sm">
                      {item.ok
                        ? <CheckCircleIcon className="h-5 w-5 text-green-500 shrink-0" />
                        : <XCircleIcon className="h-5 w-5 text-red-500 shrink-0" />}
                      <div>
                        <span className={item.ok ? 'text-gray-700' : 'text-red-700 font-medium'}>{item.label}</span>
                        {item.message && <p className="text-xs text-gray-500">{item.message}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
                {!readiness.enrollmentId && (
                  <p className="text-sm text-amber-600">No enrollment exists for this provider with Aetna — create one under Enrollments first.</p>
                )}
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!readiness.ready || !readiness.enrollmentId || launch.isPending}
                  onClick={() => launch.mutate()}
                  data-testid="aetna-launch-button"
                >
                  {launch.isPending ? 'Launching…' : 'Launch Aetna application'}
                </button>
                {launch.isError && (
                  <p className="text-sm text-red-600">{(launch.error as Error)?.message || 'Launch failed'}</p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* 2. Review */}
      {selectedRunId && runDetail && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">2. Review run</h2>
            <StatusBadge status={runDetail.status} />
          </div>

          {runDetail.status === 'FILLING' && (
            <p className="text-sm text-gray-600 flex items-center gap-2">
              <ArrowPathIcon className="h-4 w-4 animate-spin" /> Filling the Aetna application — screenshots will appear here…
            </p>
          )}
          {runDetail.externalReference && (
            <p className="text-sm text-gray-700">Aetna Request ID: <span className="font-mono font-medium">{runDetail.externalReference}</span></p>
          )}
          {runDetail.errorDetails?.message && (
            <p className="text-sm text-red-600">{runDetail.errorDetails.message}</p>
          )}

          {runDetail.screens.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {runDetail.screens.map((s) => (
                <figure key={s.label} className="border border-gray-200 rounded-md overflow-hidden">
                  <figcaption className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border-b border-gray-200">{s.label}</figcaption>
                  {s.signedUrl
                    ? <a href={s.signedUrl} target="_blank" rel="noreferrer"><img src={s.signedUrl} alt={s.label} className="w-full" /></a>
                    : <p className="p-3 text-xs text-gray-400">screenshot unavailable</p>}
                </figure>
              ))}
            </div>
          )}

          {runDetail.status === 'AWAITING_REVIEW' && (
            <div className="border-t border-gray-200 pt-4 space-y-3">
              {!runDetail.liveSession && (
                <p className="text-sm text-amber-600">The live browser session for this run is no longer available (expired or server restarted). Launch a new run to submit.</p>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!runDetail.liveSession || approve.isPending}
                  onClick={() => approve.mutate()}
                  data-testid="aetna-approve-button"
                >
                  {approve.isPending ? 'Submitting…' : 'Approve & submit to Aetna'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setShowReject((v) => !v)}>
                  Reject
                </button>
              </div>
              {approve.isError && <p className="text-sm text-red-600">{(approve.error as Error)?.message || 'Submit failed'}</p>}
              {showReject && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    className="flex-1 rounded-md border-gray-300 text-sm shadow-sm"
                    placeholder="Reason for rejecting this filled application"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-secondary text-red-700"
                    disabled={!rejectReason.trim() || reject.isPending}
                    onClick={() => reject.mutate()}
                  >
                    {reject.isPending ? 'Rejecting…' : 'Confirm reject'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 3. Run history */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Run history</h2>
        {(runs ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">No Aetna runs yet.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Started</th>
                <th className="py-2 pr-4">Aetna Request ID</th>
                <th className="py-2 pr-4">Error</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(runs ?? []).map((r) => (
                <tr key={r.id} className={r.id === selectedRunId ? 'bg-primary-50/40' : ''}>
                  <td className="py-2 pr-4">
                    {r.enrollment?.provider
                      ? <Link className="text-primary-600 hover:underline" to={`/providers/${r.enrollment.provider.id}`}>{r.enrollment.provider.lastName}, {r.enrollment.provider.firstName}</Link>
                      : '—'}
                  </td>
                  <td className="py-2 pr-4"><StatusBadge status={r.status} /></td>
                  <td className="py-2 pr-4 text-gray-600">{new Date(r.startedAt).toLocaleString()}</td>
                  <td className="py-2 pr-4 font-mono">{r.confirmationNumber || r.externalReference || '—'}</td>
                  <td className="py-2 pr-4 text-red-600 text-xs max-w-xs truncate">{r.errorDetails?.message || ''}</td>
                  <td className="py-2 text-right">
                    <button type="button" className="text-primary-600 hover:underline" onClick={() => setSelectedRunId(r.id)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
