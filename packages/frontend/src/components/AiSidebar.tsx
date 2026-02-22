import { useState } from 'react';
import clsx from 'clsx';
import {
  SparklesIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  ShieldExclamationIcon,
  ClockIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import {
  useAiRecommendations,
  useContextualRecommendations,
  useUpdateRecommendation,
} from '../hooks/useAi';
import type { AiRecommendation } from '../hooks/useAi';

interface AiSidebarProps {
  entityType: 'provider' | 'enrollment';
  entityId: string;
}

const severityConfig = {
  info: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    badge: 'bg-blue-100 text-blue-700',
    icon: InformationCircleIcon,
  },
  warning: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    badge: 'bg-amber-100 text-amber-700',
    icon: ExclamationTriangleIcon,
  },
  critical: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-700',
    icon: ShieldExclamationIcon,
  },
};

function mapRecommendationSeverity(rec: AiRecommendation): 'info' | 'warning' | 'critical' {
  const meta = rec.metadata as Record<string, unknown> | null;
  const urgency = meta?.['urgencyScore'];
  if (typeof urgency === 'number') {
    if (urgency >= 8) return 'critical';
    if (urgency >= 5) return 'warning';
  }
  if (rec.type === 'priority_alert') return 'warning';
  return 'info';
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-200/60 bg-white p-3">
      <div className="flex items-start gap-2">
        <div className="h-5 w-5 rounded-full bg-gray-200" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-20 rounded bg-gray-200" />
          <div className="h-4 w-full rounded bg-gray-200" />
          <div className="h-3 w-3/4 rounded bg-gray-200" />
        </div>
      </div>
    </div>
  );
}

export default function AiSidebar({ entityType, entityId }: AiSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [snoozedIds, setSnoozedIds] = useState<Set<string>>(new Set());

  const filterKey = entityType === 'provider' ? 'providerId' : 'enrollmentId';
  const aiRecs = useAiRecommendations({ [filterKey]: entityId, status: 'pending' });
  const contextualRecs = useContextualRecommendations(entityType, entityId);
  const updateRecommendation = useUpdateRecommendation();

  const isLoading = aiRecs.isLoading || contextualRecs.isLoading;

  // Merge AI recommendations with contextual recommendations into a unified list
  const items: Array<{
    id: string;
    severity: 'info' | 'warning' | 'critical';
    title: string;
    description: string;
    actionUrl?: string;
    actionLabel?: string;
    source: 'ai' | 'contextual';
    snoozed: boolean;
  }> = [];

  // Add contextual recommendations
  if (contextualRecs.data?.data) {
    for (const rec of contextualRecs.data.data) {
      items.push({
        id: `ctx-${rec.type}-${rec.title}`,
        severity: rec.severity,
        title: rec.title,
        description: rec.description,
        actionUrl: rec.actionUrl,
        actionLabel: rec.actionLabel,
        source: 'contextual',
        snoozed: snoozedIds.has(`ctx-${rec.type}-${rec.title}`),
      });
    }
  }

  // Add AI-generated recommendations
  if (aiRecs.data?.data) {
    for (const rec of aiRecs.data.data) {
      items.push({
        id: rec.id,
        severity: mapRecommendationSeverity(rec),
        title: rec.title,
        description: rec.content,
        source: 'ai',
        snoozed: snoozedIds.has(rec.id),
      });
    }
  }

  // Sort by severity (critical first), snoozed last
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  items.sort((a, b) => {
    if (a.snoozed !== b.snoozed) return a.snoozed ? 1 : -1;
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  const activeCount = items.filter((i) => !i.snoozed).length;

  function handleDismiss(item: (typeof items)[number]) {
    if (item.source === 'ai') {
      updateRecommendation.mutate({ id: item.id, status: 'dismissed' });
    }
    // For contextual, just snooze visually (they regenerate from data)
    setSnoozedIds((prev) => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });
  }

  function handleSnooze(item: (typeof items)[number]) {
    setSnoozedIds((prev) => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });
  }

  return (
    <>
      {/* Collapsed tab */}
      <button
        onClick={() => setIsOpen(true)}
        className={clsx(
          'fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-xl border border-r-0 border-gray-200/60 bg-white px-2 py-4 shadow-sm transition-all hover:bg-primary-50 hover:shadow-md',
          isOpen && 'pointer-events-none opacity-0'
        )}
        aria-label="Open AI recommendations"
      >
        <div className="flex flex-col items-center gap-1.5">
          <SparklesIcon className="h-5 w-5 text-primary-600" />
          <span className="text-[10px] font-semibold tracking-wide text-primary-700">AI</span>
          {activeCount > 0 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] font-bold text-white">
              {activeCount}
            </span>
          )}
        </div>
      </button>

      {/* Expanded panel */}
      <div
        className={clsx(
          'fixed right-0 top-0 z-50 flex h-full w-80 flex-col border-l border-gray-200/60 bg-white shadow-lg transition-transform duration-300 ease-in-out',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <SparklesIcon className="h-5 w-5 text-primary-600" />
            <h2 className="text-sm font-semibold text-gray-900">AI Recommendations</h2>
            {activeCount > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary-100 px-1.5 text-xs font-semibold text-primary-700">
                {activeCount}
              </span>
            )}
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close AI recommendations"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {isLoading ? (
            <div className="space-y-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckIcon className="mb-3 h-10 w-10 text-primary-300" />
              <p className="text-sm font-medium text-gray-500">No recommendations</p>
              <p className="mt-1 text-xs text-gray-400">
                Everything looks good for this {entityType}.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {items.map((item) => {
                const config = severityConfig[item.severity];
                const SeverityIcon = config.icon;

                return (
                  <div
                    key={item.id}
                    className={clsx(
                      'rounded-2xl border border-gray-200/60 p-3 shadow-sm transition-all',
                      item.snoozed ? 'opacity-50' : config.bg
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <SeverityIcon
                        className={clsx('mt-0.5 h-4 w-4 flex-shrink-0', config.text)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <span
                            className={clsx(
                              'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                              config.badge
                            )}
                          >
                            {item.severity}
                          </span>
                          {item.snoozed && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
                              <ClockIcon className="h-3 w-3" />
                              Snoozed
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-gray-900">{item.title}</p>
                        <p className="mt-0.5 line-clamp-3 text-xs text-gray-600">
                          {item.description}
                        </p>

                        {/* Actions */}
                        <div className="mt-2 flex items-center gap-2">
                          {item.actionUrl && item.actionLabel && (
                            <a
                              href={item.actionUrl}
                              className="text-xs font-medium text-primary-600 hover:text-primary-700"
                            >
                              {item.actionLabel}
                            </a>
                          )}
                          {!item.snoozed && (
                            <>
                              <button
                                onClick={() => handleDismiss(item)}
                                className="text-xs text-gray-400 hover:text-gray-600"
                                disabled={updateRecommendation.isPending}
                              >
                                Dismiss
                              </button>
                              <button
                                onClick={() => handleSnooze(item)}
                                className="text-xs text-gray-400 hover:text-gray-600"
                              >
                                Snooze
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px]"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}
    </>
  );
}
