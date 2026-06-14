import { useState } from 'react';
import { SparklesIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useUpdateRecommendation } from '../../hooks/useAi';
import { useQueryClient } from '@tanstack/react-query';
import type { PayerAIInsight, PayerInsightRecord } from '../../hooks/useEnrollmentStrategy';

function riskBadgeColor(level: string): string {
  switch (level) {
    case 'high': return 'bg-red-100 text-red-800';
    case 'medium': return 'bg-yellow-100 text-yellow-800';
    case 'low': return 'bg-green-100 text-green-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}

function priorityBadgeColor(priority: string): string {
  switch (priority) {
    case 'high': return 'bg-red-50 text-red-700';
    case 'medium': return 'bg-yellow-50 text-yellow-700';
    case 'low': return 'bg-green-50 text-green-700';
    default: return 'bg-gray-50 text-gray-700';
  }
}

interface PayerAIInsightCardProps {
  insight: PayerAIInsight;
  recommendationId: string;
  payerId?: string;
  onDismissed?: () => void;
}

export function PayerAIInsightCard({ insight, recommendationId, payerId, onDismissed }: PayerAIInsightCardProps) {
  const queryClient = useQueryClient();
  const [actionTaken, setActionTaken] = useState<'accepted' | 'dismissed' | null>(null);
  const updateRecommendation = useUpdateRecommendation();

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-5 w-5 text-purple-600" />
          <h4 className="font-semibold text-gray-900">AI Strategic Analysis</h4>
        </div>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${riskBadgeColor(insight.riskAssessment)}`}>
          {insight.riskAssessment} risk
        </span>
      </div>

      {/* Summary */}
      <p className="text-sm text-gray-700">{insight.summary}</p>

      {/* Strengths & Risks */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {insight.strengths.length > 0 && (
          <div>
            <h5 className="text-xs font-medium text-green-700 uppercase mb-2">Strengths</h5>
            <ul className="space-y-1">
              {insight.strengths.map((s, i) => (
                <li key={i} className="text-sm text-gray-600 flex items-start gap-1.5">
                  <span className="text-green-500 mt-0.5 shrink-0">+</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {insight.risks.length > 0 && (
          <div>
            <h5 className="text-xs font-medium text-red-700 uppercase mb-2">Risks</h5>
            <ul className="space-y-1">
              {insight.risks.map((r, i) => (
                <li key={i} className="text-sm text-gray-600 flex items-start gap-1.5">
                  <span className="text-red-500 mt-0.5 shrink-0">!</span>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Recommendations */}
      {insight.recommendations.length > 0 && (
        <div>
          <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">Recommendations</h5>
          <div className="space-y-2">
            {insight.recommendations.map((rec, i) => (
              <div key={i} className="bg-gray-50 rounded-md p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-900">{i + 1}. {rec.action}</span>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${priorityBadgeColor(rec.priority)}`}>
                    {rec.priority}
                  </span>
                </div>
                <p className="text-xs text-gray-500">{rec.reasoning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Follow-up Strategy */}
      {insight.optimalFollowUpStrategy && (
        <div className="bg-blue-50 rounded-md p-4">
          <h5 className="text-xs font-medium text-blue-700 uppercase mb-2">Optimal Follow-Up Strategy</h5>
          <div className="space-y-1 text-sm text-blue-900">
            <p><span className="font-medium">Frequency:</span> Every {insight.optimalFollowUpStrategy.frequencyDays} days</p>
            <p><span className="font-medium">Approach:</span> {insight.optimalFollowUpStrategy.bestApproach}</p>
            <p><span className="font-medium">Escalate when:</span> {insight.optimalFollowUpStrategy.escalationThreshold}</p>
          </div>
        </div>
      )}

      {/* Comparison */}
      {insight.comparisonInsight && (
        <p className="text-sm text-gray-500 italic border-l-2 border-gray-300 pl-3">
          {insight.comparisonInsight}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-gray-100">
        {actionTaken ? (
          <div className="flex items-center gap-1.5 text-sm">
            <CheckCircleIcon className={`h-4 w-4 ${actionTaken === 'accepted' ? 'text-green-600' : 'text-gray-400'}`} />
            <span className={actionTaken === 'accepted' ? 'text-green-700' : 'text-gray-500'}>
              {actionTaken === 'accepted' ? 'Accepted' : 'Dismissed'}
            </span>
          </div>
        ) : (
          <>
            <button
              onClick={() => updateRecommendation.mutate(
                { id: recommendationId, status: 'accepted' },
                {
                  onSuccess: () => {
                    setActionTaken('accepted');
                    if (payerId) queryClient.invalidateQueries({ queryKey: ['payer-insights', payerId] });
                  },
                }
              )}
              disabled={updateRecommendation.isPending}
              className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-md hover:bg-green-100 disabled:opacity-50"
            >
              {updateRecommendation.isPending ? 'Saving...' : 'Accept'}
            </button>
            <button
              onClick={() => updateRecommendation.mutate(
                { id: recommendationId, status: 'dismissed' },
                {
                  onSuccess: () => {
                    setActionTaken('dismissed');
                    if (payerId) queryClient.invalidateQueries({ queryKey: ['payer-insights', payerId] });
                    onDismissed?.();
                  },
                }
              )}
              disabled={updateRecommendation.isPending}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-50 rounded-md hover:bg-gray-100 disabled:opacity-50"
            >
              {updateRecommendation.isPending ? 'Saving...' : 'Dismiss'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface PastInsightItemProps {
  record: PayerInsightRecord;
}

export function PastInsightItem({ record }: PastInsightItemProps) {
  const [expanded, setExpanded] = useState(false);

  let parsed: PayerAIInsight | null = null;
  try {
    parsed = JSON.parse(record.content);
  } catch {
    // ignore
  }

  return (
    <div className="border border-gray-100 rounded-md p-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <p className="text-sm font-medium text-gray-900">{record.title}</p>
          <p className="text-xs text-gray-500">
            {new Date(record.createdAt).toLocaleDateString()} · {record.status}
          </p>
        </div>
        <span className="text-gray-400 text-xs">{expanded ? 'Hide' : 'Show'}</span>
      </button>
      {expanded && parsed && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-sm text-gray-700 mb-2">{parsed.summary}</p>
          {parsed.recommendations.length > 0 && (
            <ul className="space-y-1">
              {parsed.recommendations.map((rec, i) => (
                <li key={i} className="text-xs text-gray-600">
                  <span className="font-medium">{rec.priority}:</span> {rec.action}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
