import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { notify } from '../../utils/notify';
import {
  PaperAirplaneIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

/**
 * SubmitToPortalPanel — triggers the v2 submission pipeline for an enrollment
 * and shows live status.
 *
 * Flow: POST /workflows/:id/submit-to-portal creates an EnrollmentRun and queues
 * the submission job. The worker routes it to the payer's adapter — for Aetna,
 * that is the Libretto Cloud adapter when LIBRETTO_AETNA_RFP_ENABLED is on
 * (otherwise the in-process Playwright bot). We poll GET /enrollment-runs/:id
 * until the run reaches a terminal status.
 *
 * Submitting files a real application with the payer, so the button asks for a
 * confirmation first.
 */

// EnrollmentRunStatus (uppercase) — the v2 submission pipeline's vocabulary.
type RunStatus =
  | 'PENDING' | 'QUEUED' | 'FILLING' | 'AWAITING_REVIEW' | 'SUBMITTING'
  | 'SUBMITTED' | 'ACKNOWLEDGED' | 'APPROVED' | 'DENIED'
  | 'FAILED' | 'CANCELLED' | 'NEEDS_REVIEW';

const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'SUBMITTED', 'ACKNOWLEDGED', 'APPROVED', 'DENIED', 'FAILED', 'CANCELLED', 'NEEDS_REVIEW',
]);

const STATUS_STYLE: Record<RunStatus, { label: string; bg: string; spin?: boolean; icon: typeof ClockIcon }> = {
  PENDING: { label: 'Queued', bg: 'bg-gray-100 text-gray-700', icon: ClockIcon },
  QUEUED: { label: 'Queued', bg: 'bg-gray-100 text-gray-700', icon: ClockIcon },
  FILLING: { label: 'Filling form…', bg: 'bg-yellow-100 text-yellow-800', spin: true, icon: ArrowPathIcon },
  AWAITING_REVIEW: { label: 'Awaiting review', bg: 'bg-amber-100 text-amber-800', icon: ClockIcon },
  SUBMITTING: { label: 'Submitting…', bg: 'bg-yellow-100 text-yellow-800', spin: true, icon: ArrowPathIcon },
  SUBMITTED: { label: 'Submitted', bg: 'bg-green-100 text-green-800', icon: CheckCircleIcon },
  ACKNOWLEDGED: { label: 'Acknowledged', bg: 'bg-green-100 text-green-800', icon: CheckCircleIcon },
  APPROVED: { label: 'Approved', bg: 'bg-green-100 text-green-800', icon: CheckCircleIcon },
  DENIED: { label: 'Denied', bg: 'bg-red-100 text-red-800', icon: ExclamationTriangleIcon },
  FAILED: { label: 'Failed', bg: 'bg-red-100 text-red-800', icon: ExclamationTriangleIcon },
  CANCELLED: { label: 'Cancelled', bg: 'bg-gray-100 text-gray-600', icon: ExclamationTriangleIcon },
  NEEDS_REVIEW: { label: 'Needs review', bg: 'bg-amber-100 text-amber-800', icon: ExclamationTriangleIcon },
};

interface RunDetail {
  id: string;
  status: RunStatus;
  externalReference: string | null;
  confirmationNumber: string | null;
  errorDetails: { errorMessage?: string; message?: string } | null;
}

export function SubmitToPortalPanel({
  enrollmentId,
  providerId,
  payerId,
  payerName,
}: {
  enrollmentId: string;
  providerId: string;
  payerId?: string;
  payerName: string;
}) {
  const queryClient = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ enrollmentRunId: string }>(
        `/workflows/${enrollmentId}/submit-to-portal`,
        { providerId, payerId, enrollmentId, action: 'submit_to_portal' }
      );
      return res.data;
    },
    onSuccess: (data) => {
      setRunId(data.enrollmentRunId);
      setConfirming(false);
      notify.success(`Submission to ${payerName} started`);
      void queryClient.invalidateQueries({ queryKey: ['enrollment-run', data.enrollmentRunId] });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: string | { message?: string } } } })?.response?.data?.error;
      const text = typeof message === 'string' ? message : message?.message;
      notify.error('Submission failed to start', { description: text ?? 'Check payer configuration and try again.' });
    },
  });

  const runQuery = useQuery({
    queryKey: ['enrollment-run', runId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: RunDetail }>(`/enrollment-runs/${runId}`);
      return res.data.data;
    },
    enabled: !!runId,
    // Poll while the run is in flight; stop once it settles.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TERMINAL.has(status) ? false : 5000;
    },
  });

  const run = runQuery.data;
  const style = run ? STATUS_STYLE[run.status] : null;
  const inFlight = !!run && !TERMINAL.has(run.status);
  const busy = submitMutation.isPending || inFlight;
  const disabled = !payerId || !providerId || busy;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PaperAirplaneIcon className="h-5 w-5 text-primary-600" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Submit to {payerName}</h2>
            <p className="text-xs text-gray-400">
              Files the credentialing application with the payer and tracks its status here.
            </p>
          </div>
        </div>

        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={disabled}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {busy ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <PaperAirplaneIcon className="h-4 w-4" />}
            {busy ? 'Submitting…' : 'Submit'}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Submit to {payerName}?</span>
            <button
              type="button"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50"
            >
              Yes, submit
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="px-6 py-4 space-y-3">
        {!payerId && (
          <p className="text-sm text-amber-700">This enrollment has no linked payer, so it can't be submitted yet.</p>
        )}

        {!run && !submitMutation.isPending && payerId && (
          <p className="text-sm text-gray-500">
            No submission yet. Click <span className="font-medium">Submit</span> to file this provider's
            application with {payerName}. You'll see live status here.
          </p>
        )}

        {run && style && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${style.bg}`}>
                <style.icon className={`h-3.5 w-3.5 ${style.spin ? 'animate-spin' : ''}`} />
                {style.label}
              </span>
              {run.externalReference && (
                <span className="text-gray-500">Payer reference: <span className="font-mono">{run.externalReference}</span></span>
              )}
              {run.confirmationNumber && (
                <span className="text-gray-500">Confirmation: <span className="font-mono">{run.confirmationNumber}</span></span>
              )}
            </div>
            {(run.status === 'FAILED' || run.status === 'DENIED') && (
              <div className="px-3 py-2 rounded bg-red-50 text-sm text-red-800 flex items-start gap-2">
                <ExclamationTriangleIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{run.errorDetails?.errorMessage ?? run.errorDetails?.message ?? 'The submission did not complete.'}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
