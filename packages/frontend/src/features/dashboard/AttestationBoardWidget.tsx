import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ShieldExclamationIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { api } from '../../services/api';

interface AttestationRow {
  providerId: string;
  providerName: string;
  practice: { id: string; name: string } | null;
  providerStatus: string | null;
  lastAttestationDate: string | null;
  nextDueDate: string | null;
  daysUntilDue: number | null;
  diffVerdict: 'no_baseline' | 'unchanged' | 'changed';
  changedSections: string[];
  bucket: 'overdue' | 'dueSoon' | 'onTrack' | 'untracked';
}

interface AttestationBoard {
  counts: { overdue: number; dueSoon: number; onTrack: number; untracked: number };
  providers: AttestationRow[];
}

const BUCKET_STYLES: Record<string, { label: string; badge: string; row: string }> = {
  overdue: { label: 'Overdue', badge: 'bg-red-100 text-red-700', row: 'bg-red-50/50' },
  dueSoon: { label: 'Due soon', badge: 'bg-amber-100 text-amber-700', row: 'bg-amber-50/50' },
  onTrack: { label: 'On track', badge: 'bg-green-100 text-green-700', row: '' },
  untracked: { label: 'No date yet', badge: 'bg-gray-100 text-gray-600', row: '' },
};

function VerdictChip({ row }: { row: AttestationRow }) {
  if (row.diffVerdict === 'unchanged') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
        <CheckCircleIcon className="h-3.5 w-3.5" />
        No changes
      </span>
    );
  }
  if (row.diffVerdict === 'changed') {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
        {row.changedSections.length} section{row.changedSections.length === 1 ? '' : 's'} changed
      </span>
    );
  }
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
      First cycle
    </span>
  );
}

function dueLabel(row: AttestationRow): string {
  if (row.daysUntilDue === null) return 'No due date';
  if (row.daysUntilDue < 0) return `${Math.abs(row.daysUntilDue)}d overdue`;
  if (row.daysUntilDue === 0) return 'Due today';
  return `Due in ${row.daysUntilDue}d`;
}

export default function AttestationBoardWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-attestations'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: AttestationBoard }>('/dashboard/attestations');
      return res.data.data;
    },
  });

  const board: AttestationBoard | undefined = data;
  // Show what needs attention first; cap the list — the board is a glance, not a registry.
  const visible = (board?.providers ?? [])
    .filter((p) => p.bucket !== 'untracked')
    .slice(0, 8);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldExclamationIcon className="h-5 w-5 text-primary-600" />
          <h3 className="text-sm font-semibold text-gray-900">CAQH Attestations</h3>
        </div>
        {board && (
          <div className="flex items-center gap-2 text-xs">
            {board.counts.overdue > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                {board.counts.overdue} overdue
              </span>
            )}
            {board.counts.dueSoon > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                {board.counts.dueSoon} due soon
              </span>
            )}
            <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
              {board.counts.onTrack} on track
            </span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-gray-100 rounded-lg" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          No providers being tracked for re-attestation yet. Providers appear here
          once their CAQH profile has synced.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {visible.map((row) => {
            const style = BUCKET_STYLES[row.bucket];
            return (
              <li
                key={row.providerId}
                className={clsx('flex items-center justify-between gap-3 py-2.5 px-2 rounded-lg', style.row)}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{row.providerName}</p>
                  {row.practice?.name && (
                    <p className="text-xs text-gray-500 truncate">{row.practice.name}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <VerdictChip row={row} />
                  <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', style.badge)}>
                    {dueLabel(row)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
