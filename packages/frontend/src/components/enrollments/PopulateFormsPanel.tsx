import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { notify } from '../../utils/notify';
import {
  SparklesIcon,
  DocumentArrowDownIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

/**
 * PopulateFormsPanel — Phase 5 UX.
 *
 * Lets staff trigger a PDF fill run for the enrollment and shows the
 * latest run's outcome: per-form status, per-form filled/skipped
 * counts, and download links to the filled PDFs (signed S3 URLs from
 * the backend, 1-hour expiry).
 *
 * Designed to be payer-agnostic. If the payer track has no PDF forms
 * configured, the panel tells the user that and disables the button.
 */

interface FilledArtifact {
  payerFormId: string;
  engine: string;
  filledS3Key: string;
  signedUrl?: string;
  filledCount: number;
  skippedCount: number;
  fieldLog?: Array<{
    fieldKey: string;
    fieldLabel: string;
    outcome: string;
    writtenValue: string | null;
    errorMessage?: string;
  }>;
}

interface EnrollmentRun {
  id: string;
  enrollmentId: string;
  status: 'pending' | 'filling' | 'awaiting_review' | 'submitting' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  filledArtifacts: FilledArtifact[] | null;
  errorDetails: { message?: string } | null;
  triggeredBy: string | null;
}

const STATUS_STYLES: Record<EnrollmentRun['status'], { label: string; bg: string; icon: typeof ClockIcon }> = {
  pending: { label: 'Pending', bg: 'bg-gray-100 text-gray-800', icon: ClockIcon },
  filling: { label: 'Filling', bg: 'bg-yellow-100 text-yellow-800', icon: ArrowPathIcon },
  awaiting_review: { label: 'Ready for review', bg: 'bg-primary-100 text-primary-800', icon: CheckCircleIcon },
  submitting: { label: 'Submitting', bg: 'bg-yellow-100 text-yellow-800', icon: ArrowPathIcon },
  completed: { label: 'Completed', bg: 'bg-green-100 text-green-800', icon: CheckCircleIcon },
  failed: { label: 'Failed', bg: 'bg-red-100 text-red-800', icon: ExclamationTriangleIcon },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function PopulateFormsPanel({ enrollmentId }: { enrollmentId: string }) {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // List of runs for this enrollment (lightweight — no signed URLs)
  const runsQuery = useQuery({
    queryKey: ['enrollment-runs', enrollmentId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: EnrollmentRun[] }>(
        `/enrollments/${enrollmentId}/runs`
      );
      return res.data.data ?? [];
    },
  });

  // Selected run's full detail — includes signed artifact URLs
  const latestRunId = selectedRunId ?? runsQuery.data?.[0]?.id ?? null;
  const runDetailQuery = useQuery({
    queryKey: ['enrollment-run', latestRunId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: EnrollmentRun }>(
        `/enrollment-runs/${latestRunId}`
      );
      return res.data.data;
    },
    enabled: !!latestRunId,
  });

  const populateMutation = useMutation({
    mutationFn: () => api.post(`/enrollments/${enrollmentId}/populate-forms`),
    onSuccess: async (response: any) => {
      const runId = response?.data?.data?.enrollmentRunId;
      notify.success('Forms populated, ready for review');
      setSelectedRunId(runId ?? null);
      await queryClient.invalidateQueries({ queryKey: ['enrollment-runs', enrollmentId] });
      if (runId) {
        await queryClient.invalidateQueries({ queryKey: ['enrollment-run', runId] });
      }
    },
    onError: (err: any) => {
      const message =
        err?.response?.data?.error?.message ??
        'Could not populate forms; check payer configuration';
      notify.error('Populate failed', { description: message });
    },
  });

  const runs = runsQuery.data ?? [];
  const run = runDetailQuery.data;
  const status = run?.status;
  const statusStyle = status ? STATUS_STYLES[status] : null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-5 w-5 text-primary-600" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Populate Forms</h2>
            <p className="text-xs text-gray-400">Manual fill: backup if the AI agent above is unavailable</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => populateMutation.mutate()}
          disabled={populateMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
        >
          {populateMutation.isPending ? (
            <>
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              Populating…
            </>
          ) : (
            <>
              <SparklesIcon className="h-4 w-4" />
              {runs.length > 0 ? 'Re-populate' : 'Populate Forms'}
            </>
          )}
        </button>
      </div>

      <div className="px-6 py-4 space-y-4">
        {runs.length === 0 && !populateMutation.isPending && (
          <p className="text-sm text-gray-500">
            No runs yet. Click <span className="font-medium">Populate Forms</span> to fill the
            payer's enrollment PDFs from this practice and provider's data. You'll be able to
            review and download each filled form before submission.
          </p>
        )}

        {run && statusStyle && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${statusStyle.bg}`}
              >
                <statusStyle.icon className="h-3.5 w-3.5" />
                {statusStyle.label}
              </span>
              <span className="text-gray-500">started {formatTime(run.startedAt)}</span>
              {runs.length > 1 && (
                <select
                  value={run.id}
                  onChange={(e) => setSelectedRunId(e.target.value)}
                  className="ml-auto text-xs border border-gray-300 rounded px-2 py-1"
                  aria-label="Select run"
                >
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      Run from {formatTime(r.startedAt)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {run.status === 'failed' && run.errorDetails?.message && (
              <div className="px-3 py-2 rounded bg-red-50 text-sm text-red-800 flex items-start gap-2">
                <ExclamationTriangleIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{run.errorDetails.message}</span>
              </div>
            )}

            <div className="space-y-2">
              {(run.filledArtifacts ?? []).map((a) => (
                <ArtifactRow key={a.payerFormId} artifact={a} />
              ))}
              {(run.filledArtifacts ?? []).length === 0 && run.status !== 'failed' && (
                <p className="text-sm text-gray-400">No artifacts yet.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactRow({ artifact }: { artifact: FilledArtifact }) {
  const [showLog, setShowLog] = useState(false);
  const hasWarnings = artifact.skippedCount > 0;

  return (
    <div className="rounded border border-gray-200 bg-gray-50/50">
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm min-w-0">
          <DocumentArrowDownIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <div className="truncate">
            <div className="font-medium text-gray-900 truncate">{artifact.payerFormId}</div>
            <div className="text-xs text-gray-500">
              {artifact.filledCount} filled
              {hasWarnings && <span className="text-amber-700"> · {artifact.skippedCount} skipped</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            {showLog ? 'Hide log' : 'View log'}
          </button>
          {artifact.signedUrl && (
            <a
              href={artifact.signedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-primary-600 text-white hover:bg-primary-700"
            >
              <DocumentArrowDownIcon className="h-3.5 w-3.5" />
              Open PDF
            </a>
          )}
        </div>
      </div>
      {showLog && artifact.fieldLog && (
        <div className="px-3 pb-3 pt-1 text-xs overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-gray-500 text-left">
                <th className="py-1 font-medium">Field</th>
                <th className="py-1 font-medium">Outcome</th>
                <th className="py-1 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {artifact.fieldLog.map((entry) => (
                <tr key={entry.fieldKey} className="border-t border-gray-100">
                  <td className="py-1 pr-2 text-gray-700">{entry.fieldLabel}</td>
                  <td className="py-1 pr-2">
                    <span
                      className={
                        entry.outcome === 'filled'
                          ? 'text-green-700'
                          : entry.outcome === 'skipped_no_value'
                            ? 'text-gray-400'
                            : 'text-red-700'
                      }
                    >
                      {entry.outcome}
                    </span>
                  </td>
                  <td className="py-1 text-gray-600 truncate">{entry.writtenValue ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
