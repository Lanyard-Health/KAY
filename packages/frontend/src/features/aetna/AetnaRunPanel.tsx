import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowPathIcon } from '@heroicons/react/24/solid';
import { api } from '../../services/api';
import { ACTIVE_STATUSES, StatusBadge, type RunDetail } from './shared';

/**
 * Review panel for one Aetna run: live status, per-page screenshots of the
 * filled application, and Approve (final submit) / Reject actions while the
 * run is paused for review. Embedded on the enrollment detail page.
 */
export default function AetnaRunPanel({ runId }: { runId: string }) {
  const queryClient = useQueryClient();
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);

  const { data: runDetail } = useQuery({
    queryKey: ['aetna-run', runId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: RunDetail }>(`/aetna-runs/${runId}`);
      return res.data.data;
    },
    refetchInterval: (q) =>
      q.state.data && ACTIVE_STATUSES.includes(q.state.data.status) ? 4000 : false,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['aetna-run', runId] });
    void queryClient.invalidateQueries({ queryKey: ['aetna-runs'] });
  };

  const approve = useMutation({
    mutationFn: async () => (await api.post(`/aetna-runs/${runId}/approve`, {})).data,
    onSettled: invalidate,
  });

  const reject = useMutation({
    mutationFn: async () => (await api.post(`/aetna-runs/${runId}/reject`, { reason: rejectReason })).data,
    onSuccess: () => { setShowReject(false); setRejectReason(''); },
    onSettled: invalidate,
  });

  if (!runDetail) return <div className="animate-pulse h-16 bg-gray-100 rounded" />;

  return (
    <div className="space-y-4" data-testid="aetna-run-panel">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Started {new Date(runDetail.startedAt).toLocaleString()}
        </p>
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
  );
}
