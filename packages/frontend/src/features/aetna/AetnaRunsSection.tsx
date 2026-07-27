import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AetnaRunPanel from './AetnaRunPanel';
import { ACTIVE_STATUSES, StatusBadge, useAetnaRuns } from './shared';

/**
 * Aetna run history + review for one enrollment, embedded on the enrollment
 * detail page. Auto-selects the run from the ?aetnaRun= query param (set when
 * launching from the provider record) or the most recent active run.
 */
export default function AetnaRunsSection({ enrollmentId }: { enrollmentId: string }) {
  const [searchParams] = useSearchParams();
  const { data: allRuns } = useAetnaRuns();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(searchParams.get('aetnaRun'));

  const runs = (allRuns ?? []).filter((r) => r.enrollmentId === enrollmentId);

  // Auto-select the active (or most recent) run when nothing is selected yet.
  useEffect(() => {
    if (!selectedRunId && runs.length > 0) {
      const active = runs.find((r) => ACTIVE_STATUSES.includes(r.status));
      setSelectedRunId((active ?? runs[0]!).id);
    }
  }, [selectedRunId, runs]);

  if (runs.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm" data-testid="aetna-runs-section">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Aetna Application Runs</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Automated “Join the Network” submissions for this enrollment — review and approve here.
        </p>
      </div>

      <div className="px-6 py-4 space-y-6">
        {selectedRunId && <AetnaRunPanel runId={selectedRunId} />}

        {runs.length > 1 && (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-4">Started</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Aetna Request ID</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map((r) => (
                <tr key={r.id} className={r.id === selectedRunId ? 'bg-primary-50/40' : ''}>
                  <td className="py-2 pr-4 text-gray-600">{new Date(r.startedAt).toLocaleString()}</td>
                  <td className="py-2 pr-4"><StatusBadge status={r.status} /></td>
                  <td className="py-2 pr-4 font-mono">{r.confirmationNumber || r.externalReference || '—'}</td>
                  <td className="py-2 text-right">
                    {r.id !== selectedRunId && (
                      <button type="button" className="text-primary-600 hover:underline" onClick={() => setSelectedRunId(r.id)}>
                        View
                      </button>
                    )}
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
