import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRightIcon } from '@heroicons/react/20/solid';
import clsx from 'clsx';
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
  const activeRun = runs.find((r) => ACTIVE_STATUSES.includes(r.status));

  // Open by default only when there's something to act on: an active run, or
  // an explicit ?aetnaRun= link from the launch flow.
  const [isOpen, setIsOpen] = useState(Boolean(searchParams.get('aetnaRun')));
  useEffect(() => {
    if (activeRun) setIsOpen(true);
  }, [activeRun?.id]);

  // Auto-select the active (or most recent) run when nothing is selected yet.
  useEffect(() => {
    if (!selectedRunId && runs.length > 0) {
      setSelectedRunId((activeRun ?? runs[0]!).id);
    }
  }, [selectedRunId, runs]);

  if (runs.length === 0) return null;

  const latest = runs[0]!;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm" data-testid="aetna-runs-section">
      <div
        className="px-6 py-4 flex items-center justify-between cursor-pointer select-none"
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
      >
        <div className="flex items-center gap-2">
          <ChevronRightIcon className={clsx('h-4 w-4 text-gray-400 transition-transform duration-200', isOpen && 'rotate-90')} />
          <h2 className="text-lg font-semibold text-gray-900">Aetna Application Runs</h2>
          <span className="text-sm text-gray-400">({runs.length})</span>
        </div>
        {!isOpen && <StatusBadge status={(activeRun ?? latest).status} />}
      </div>

      {isOpen && (
      <div className="px-6 py-4 border-t border-gray-100 space-y-6">
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
      )}
    </div>
  );
}
