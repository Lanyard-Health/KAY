import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { CheckCircleIcon, XCircleIcon, ArrowPathIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/solid';
import { api } from '../../services/api';
import type { Readiness } from './shared';

/**
 * Compact Aetna readiness card for the provider record: summary line
 * ("N items missing" / "Ready"), expandable checklist, and a Launch button
 * once everything is green. Launching navigates to the enrollment detail
 * page where the run is reviewed and approved.
 */
export default function AetnaReadinessCard({ providerId }: { providerId: string }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  const { data: readiness, isFetching } = useQuery({
    queryKey: ['aetna-readiness', providerId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Readiness }>(`/providers/${providerId}/aetna-readiness`);
      return res.data.data;
    },
  });

  const launch = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ success: boolean; data: { runId: string; enrollmentId: string } }>(
        '/aetna-runs', { providerId }
      );
      return res.data.data;
    },
    onSuccess: (data) => navigate(`/enrollments/${data.enrollmentId}?aetnaRun=${data.runId}`),
  });

  if (!readiness) {
    return <div className="animate-pulse h-10 bg-gray-100 rounded" data-testid="aetna-readiness-card" />;
  }

  const missing = readiness.checklist.filter((c) => !c.ok);

  return (
    <div className="space-y-3" data-testid="aetna-readiness-card">
      <button
        type="button"
        className="flex items-center gap-2 text-sm w-full text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDownIcon className="h-4 w-4 text-gray-400" /> : <ChevronRightIcon className="h-4 w-4 text-gray-400" />}
        {missing.length === 0 ? (
          <span className="flex items-center gap-1.5 text-green-700 font-medium">
            <CheckCircleIcon className="h-5 w-5 text-green-500" /> Ready for Aetna — all {readiness.checklist.length} checks pass
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-red-700 font-medium">
            <XCircleIcon className="h-5 w-5 text-red-500" /> {missing.length} item{missing.length === 1 ? '' : 's'} missing for Aetna
          </span>
        )}
        {isFetching && <ArrowPathIcon className="h-4 w-4 animate-spin text-gray-400" />}
      </button>

      {expanded && (
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
      )}

      {!readiness.enrollmentId && (
        <p className="text-sm text-amber-600">No Aetna enrollment exists for this provider — create one under Enrollments first.</p>
      )}
      <div className="flex items-center gap-3">
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
      </div>
      <p className="text-xs text-gray-500">
        The application is filled automatically, then pauses for review on the enrollment page — nothing is submitted until approved.
      </p>
    </div>
  );
}
