import { useState } from 'react';
import { Tab } from '@headlessui/react';
import {
  ExclamationTriangleIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  MagnifyingGlassIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useDenialTriages, useUpdateDenialTriage } from '../../hooks/useDenialTriages';
import type { DenialTriage } from '../../hooks/useDenialTriages';

const STATUS_TABS = [
  { label: 'Pending', status: 'pending' },
  { label: 'Reviewed', status: 'reviewed' },
  { label: 'Actioned', status: 'actioned' },
  { label: 'All', status: undefined },
];

const ACTION_CONFIG: Record<string, { label: string; color: string; icon: typeof ArrowPathIcon }> = {
  appeal: { label: 'Appeal', color: 'text-blue-700 bg-blue-50 ring-blue-600/20', icon: ArrowPathIcon },
  reapply: { label: 'Reapply', color: 'text-amber-700 bg-amber-50 ring-amber-600/20', icon: ArrowPathIcon },
  abandon: { label: 'Abandon', color: 'text-red-700 bg-red-50 ring-red-600/20', icon: XCircleIcon },
  needs_review: { label: 'Needs Review', color: 'text-gray-700 bg-gray-50 ring-gray-600/20', icon: MagnifyingGlassIcon },
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'text-amber-700 bg-amber-50 ring-amber-600/20',
  reviewed: 'text-blue-700 bg-blue-50 ring-blue-600/20',
  actioned: 'text-green-700 bg-green-50 ring-green-600/20',
};

function ActionBadge({ action }: { action: string | null }) {
  const config = action ? ACTION_CONFIG[action] : ACTION_CONFIG['needs_review'];
  if (!config) return null;
  const Icon = config.icon;
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset', config.color)}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset', STATUS_BADGE[status] || STATUS_BADGE['pending'])}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function TriageCard({ triage }: { triage: DenialTriage }) {
  const [expanded, setExpanded] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const updateMutation = useUpdateDenialTriage();

  const provider = triage.enrollment.provider;
  const payer = triage.enrollment.payer;
  const track = triage.enrollment.payerTrack;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <ExclamationTriangleIcon className="h-5 w-5 text-red-500 shrink-0" />
            <h3 className="text-sm font-semibold text-gray-900 truncate">
              {provider.lastName}, {provider.firstName}
            </h3>
            <span className="text-xs text-gray-500">NPI: {provider.npi}</span>
          </div>
          <p className="text-sm text-gray-600">
            {payer.name}
            {track && <span className="text-gray-400"> &middot; {track.track} &middot; {track.stateRegion}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ActionBadge action={triage.recommendedAction} />
          <StatusBadge status={triage.status} />
        </div>
      </div>

      {/* Denial reason */}
      <div className="px-5 py-3 bg-red-50/50 border-b border-gray-100">
        <p className="text-xs font-medium text-red-800 mb-0.5">Denial Reason</p>
        <p className="text-sm text-red-700">{triage.denialReason}</p>
      </div>

      {/* Triage report preview */}
      {triage.triageReport && (
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-xs font-medium text-gray-500 mb-1">AI Triage Report</p>
          <p className={clsx('text-sm text-gray-700', !expanded && 'line-clamp-3')}>
            {triage.triageReport}
          </p>
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
          >
            <EyeIcon className="h-3.5 w-3.5" />
            {expanded ? 'Show less' : 'Show more'}
          </button>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <>
          {/* Identified gaps */}
          {triage.identifiedGaps && triage.identifiedGaps.length > 0 && (
            <div className="px-5 py-3 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-2">Identified Gaps</p>
              <ul className="space-y-1.5">
                {triage.identifiedGaps.map((gap, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className={clsx(
                      'mt-0.5 inline-block h-2 w-2 rounded-full shrink-0',
                      gap.severity === 'critical' ? 'bg-red-500' :
                      gap.severity === 'major' ? 'bg-amber-500' : 'bg-gray-400'
                    )} />
                    <span className="text-gray-700">{gap.gap}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommended steps */}
          {triage.recommendedSteps && triage.recommendedSteps.length > 0 && (
            <div className="px-5 py-3 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-2">Recommended Steps</p>
              <ol className="space-y-1.5">
                {triage.recommendedSteps.map((step) => (
                  <li key={step.order} className="flex items-start gap-2 text-sm">
                    <span className="shrink-0 h-5 w-5 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-medium">
                      {step.order}
                    </span>
                    <div>
                      <span className="text-gray-700">{step.action}</span>
                      {step.notes && <p className="text-xs text-gray-500 mt-0.5">{step.notes}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}

      {/* Actions */}
      {triage.status === 'pending' && (
        <div className="px-5 py-3 bg-gray-50/50">
          <textarea
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            placeholder="Review notes (optional)..."
            rows={2}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-primary-400 focus:ring-1 focus:ring-primary-400 mb-2"
          />
          <div className="flex gap-2">
            <button
              onClick={() => updateMutation.mutate({ id: triage.id, status: 'reviewed', reviewNotes })}
              disabled={updateMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <CheckCircleIcon className="h-4 w-4" />
              Mark Reviewed
            </button>
            <button
              onClick={() => updateMutation.mutate({ id: triage.id, status: 'actioned', reviewNotes })}
              disabled={updateMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              <CheckCircleIcon className="h-4 w-4" />
              Mark Actioned
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-2 bg-gray-50/30 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
        <span>Denied {new Date(triage.denialDate).toLocaleDateString()}</span>
        {triage.modelUsed && <span>AI: {triage.modelUsed}</span>}
        {triage.reviewedAt && triage.reviewNotes && (
          <span className="text-gray-500 italic">"{triage.reviewNotes}"</span>
        )}
      </div>
    </div>
  );
}

export default function DenialsList() {
  const [selectedTab, setSelectedTab] = useState(0);
  const statusFilter = STATUS_TABS[selectedTab]?.status;
  const { data: triages, isLoading } = useDenialTriages(
    statusFilter ? { status: statusFilter } : undefined
  );

  const pendingCount = triages?.filter((t: DenialTriage) => t.status === 'pending').length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Denial Triage</h1>
        <p className="mt-1 text-sm text-gray-500">
          AI-powered analysis of enrollment denials with recommended actions
          {pendingCount != null && pendingCount > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              {pendingCount} pending
            </span>
          )}
        </p>
      </div>

      <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
        <Tab.List className="flex gap-1 rounded-xl bg-gray-100 p-1 mb-6 w-fit">
          {STATUS_TABS.map((tab) => (
            <Tab
              key={tab.label}
              className={({ selected }) =>
                clsx(
                  'rounded-lg px-4 py-2 text-sm font-medium leading-5 transition-colors',
                  selected
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
                )
              }
            >
              {tab.label}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels>
          {STATUS_TABS.map((tab) => (
            <Tab.Panel key={tab.label}>
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="animate-pulse rounded-xl border border-gray-200 bg-white p-5">
                      <div className="h-4 bg-gray-100 rounded w-1/3 mb-3" />
                      <div className="h-3 bg-gray-50 rounded w-2/3 mb-2" />
                      <div className="h-3 bg-gray-50 rounded w-1/2" />
                    </div>
                  ))}
                </div>
              ) : triages && triages.length > 0 ? (
                <div className="space-y-4">
                  {triages.map((triage: DenialTriage) => (
                    <TriageCard key={triage.id} triage={triage} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-400">
                  <ExclamationTriangleIcon className="mx-auto h-10 w-10 mb-3" />
                  <p className="text-sm">No {tab.status || ''} denial triages</p>
                </div>
              )}
            </Tab.Panel>
          ))}
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
