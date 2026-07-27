import { api } from '../../services/api';
import { useQuery } from '@tanstack/react-query';

/** Shared types + small components for the Aetna workflow surfaces. */

export interface ReadinessItem { key: string; label: string; ok: boolean; message?: string }
export interface Readiness { ready: boolean; checklist: ReadinessItem[]; enrollmentId: string | null }
export interface RunSummary {
  id: string; enrollmentId: string; status: string; startedAt: string;
  submittedAt?: string | null; externalReference?: string | null; confirmationNumber?: string | null;
  errorDetails?: { message?: string } | null;
  enrollment?: { provider?: { id: string; firstName: string; lastName: string } | null };
}
export interface RunDetail extends RunSummary {
  screens: Array<{ label: string; s3Key: string; signedUrl?: string }>;
  liveSession: boolean;
}

export const ACTIVE_STATUSES = ['FILLING', 'AWAITING_REVIEW', 'SUBMITTING'];

export function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'SUBMITTED' ? 'bg-green-100 text-green-800'
    : status === 'AWAITING_REVIEW' ? 'bg-amber-100 text-amber-800'
    : status === 'FAILED' ? 'bg-red-100 text-red-800'
    : status === 'CANCELLED' ? 'bg-gray-100 text-gray-600'
    : 'bg-blue-100 text-blue-800';
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{status.replace(/_/g, ' ')}</span>;
}

/** All Aetna runs, polling while any run is active. */
export function useAetnaRuns() {
  return useQuery({
    queryKey: ['aetna-runs'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: RunSummary[] }>('/aetna-runs');
      return res.data.data;
    },
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => ACTIVE_STATUSES.includes(r.status)) ? 5000 : false,
  });
}
