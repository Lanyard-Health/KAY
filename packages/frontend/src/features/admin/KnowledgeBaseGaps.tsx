import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useKnowledgeBaseGaps } from '../../hooks/useKnowledgeBase';
import type { KnowledgeBaseGap } from '../../hooks/useKnowledgeBase';
import PageTransition from '../../components/ui/PageTransition';
import clsx from 'clsx';

// Tables that represent critical child data (missing these = structural gaps)
const CRITICAL_TABLES = new Set(['PayerContact', 'PayerTimeline', 'PayerRequirement']);

interface GapGroup {
  payerTrackId: string;
  payerName: string;
  track: string;
  stateRegion: string;
  gaps: KnowledgeBaseGap[];
  criticalCount: number;
}

function groupGaps(gaps: KnowledgeBaseGap[]): GapGroup[] {
  const map = new Map<string, GapGroup>();

  for (const gap of gaps) {
    let group = map.get(gap.payerTrackId);
    if (!group) {
      group = {
        payerTrackId: gap.payerTrackId,
        payerName: gap.payerName,
        track: gap.track,
        stateRegion: gap.stateRegion,
        gaps: [],
        criticalCount: 0,
      };
      map.set(gap.payerTrackId, group);
    }
    group.gaps.push(gap);
    if (CRITICAL_TABLES.has(gap.table)) {
      group.criticalCount++;
    }
  }

  const groups = Array.from(map.values());
  groups.sort((a, b) => b.gaps.length - a.gaps.length);
  return groups;
}

function GapGroupSection({ group }: { group: GapGroup }) {
  const [isOpen, setIsOpen] = useState(false);
  const hasCritical = group.criticalCount > 0;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'w-full flex items-center justify-between px-4 py-3 text-left transition-colors',
          hasCritical ? 'bg-red-50 hover:bg-red-100' : 'bg-yellow-50 hover:bg-yellow-100'
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          {isOpen ? (
            <ChevronDownIcon className="h-4 w-4 text-gray-500 flex-shrink-0" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 text-gray-500 flex-shrink-0" />
          )}
          {hasCritical && (
            <ExclamationTriangleIcon className="h-5 w-5 text-red-500 flex-shrink-0" />
          )}
          <span className="text-sm font-medium text-gray-900 truncate">
            {group.payerName} — {group.track} ({group.stateRegion})
          </span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          <span
            className={clsx(
              'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
              hasCritical ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
            )}
          >
            {group.gaps.length} {group.gaps.length === 1 ? 'gap' : 'gaps'}
          </span>
          <Link
            to={`/admin/knowledge-base/${group.payerTrackId}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-medium text-primary-600 hover:text-primary-800"
          >
            Fix
          </Link>
        </div>
      </button>

      {isOpen && (
        <div className="bg-white px-4 py-3 border-t border-gray-200">
          <ul className="space-y-1.5">
            {group.gaps.map((gap, idx) => {
              const isCritical = CRITICAL_TABLES.has(gap.table);
              return (
                <li
                  key={`${gap.field}-${gap.table}-${idx}`}
                  className="flex items-center gap-2 text-sm"
                >
                  <span
                    className={clsx(
                      'inline-block h-2 w-2 rounded-full flex-shrink-0',
                      isCritical ? 'bg-red-400' : 'bg-yellow-400'
                    )}
                  />
                  <span className="text-gray-700">{gap.field}</span>
                  <span className="text-gray-400">in</span>
                  <span className="text-gray-500 font-mono text-xs">{gap.table}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function KnowledgeBaseGaps() {
  const { data, isLoading } = useKnowledgeBaseGaps();

  const groups = useMemo(() => {
    if (!data?.data) return [];
    return groupGaps(data.data);
  }, [data]);

  const totalGaps = data?.meta?.totalGaps ?? 0;

  if (isLoading) {
    return (
      <div>
        <div className="sm:flex sm:items-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Knowledge Base Gaps</h1>
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse border border-gray-200 rounded-lg px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="h-4 w-64 bg-gray-200 rounded" />
                <div className="h-5 w-16 bg-gray-200 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <PageTransition>
      <div>
        {/* Header */}
        <div className="sm:flex sm:items-center gap-3 mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Knowledge Base Gaps</h1>
          {totalGaps > 0 && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
              {totalGaps} total
            </span>
          )}
        </div>

        {/* Legend */}
        {groups.length > 0 && (
          <div className="flex items-center gap-6 mb-6 text-xs text-gray-500">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
              Critical (missing children)
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" />
              Optional fields
            </div>
          </div>
        )}

        {/* Gap groups or empty state */}
        {groups.length === 0 ? (
          <div className="card p-12 text-center">
            <CheckCircleIcon className="mx-auto h-12 w-12 text-green-500" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">All records are complete!</h3>
            <p className="mt-1 text-sm text-gray-500">
              No missing fields were found in the knowledge base.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <GapGroupSection key={group.payerTrackId} group={group} />
            ))}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
