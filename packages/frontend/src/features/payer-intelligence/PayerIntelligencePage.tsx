import { useState } from 'react';
import { ChartBarSquareIcon, SparklesIcon } from '@heroicons/react/24/outline';
import PageTransition from '../../components/ui/PageTransition';
import clsx from 'clsx';
import {
  usePayerAnalytics,
  usePayerLeaderboard,
  useAnalyzePayer,
  usePayerInsights,
} from '../../hooks/usePayerIntelligence';
import type { PayerLeaderboardItem } from '../../hooks/usePayerIntelligence';
import PayerAnalyticsCards from './PayerAnalyticsCards';
import { PayerAIInsightCard, PastInsightItem } from './PayerAIInsightCard';
import EmptyState from '../../components/ui/EmptyState';

function difficultyBadgeColor(score: number): string {
  if (score >= 60) return 'bg-red-100 text-red-800';
  if (score >= 40) return 'bg-orange-100 text-orange-800';
  if (score >= 20) return 'bg-yellow-100 text-yellow-800';
  return 'bg-green-100 text-green-800';
}

export default function PayerIntelligencePage() {
  const [selectedPayerId, setSelectedPayerId] = useState<string | null>(null);

  const { data: analyticsResp, isLoading: analyticsLoading } = usePayerAnalytics();
  const { data: leaderboardResp, isLoading: leaderboardLoading } = usePayerLeaderboard();
  const { data: selectedAnalyticsResp } = usePayerAnalytics(selectedPayerId ?? undefined);
  const { data: insightsResp } = usePayerInsights(selectedPayerId);
  const analyzePayer = useAnalyzePayer();

  const allAnalytics = analyticsResp?.data ?? [];
  const leaderboard = leaderboardResp?.data ?? [];
  const selectedAnalytics = selectedAnalyticsResp?.data?.[0] ?? null;
  const pastInsights = insightsResp?.data ?? [];

  // Summary stats
  const totalPayers = allAnalytics.length;
  const withRates = allAnalytics.filter(a => a.approvalRate !== null);
  const avgApproval = withRates.length > 0
    ? Math.round(withRates.reduce((sum, a) => sum + (a.approvalRate ?? 0), 0) / withRates.length)
    : null;
  const withDays = allAnalytics.filter(a => a.avgDaysToApproval !== null);
  const avgDays = withDays.length > 0
    ? Math.round(withDays.reduce((sum, a) => sum + (a.avgDaysToApproval ?? 0), 0) / withDays.length)
    : null;
  const totalStuck = allAnalytics.reduce((sum, a) => sum + a.enrollmentsStuckOver60Days, 0);

  const handleAnalyze = (payerId: string) => {
    analyzePayer.mutate(payerId);
  };

  return (
    <PageTransition>
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2">
          <ChartBarSquareIcon className="h-7 w-7 text-primary-700" />
          <h1 className="text-2xl font-bold text-gray-900">Payer Intelligence</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Data-driven enrollment analytics and AI-powered strategic insights
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <div className="card card-body">
          <p className="text-sm font-medium text-gray-500">Payers with Enrollments</p>
          <p className="mt-1 text-3xl font-semibold text-gray-900">
            {analyticsLoading ? '-' : totalPayers}
          </p>
        </div>
        <div className="card card-body">
          <p className="text-sm font-medium text-gray-500">Avg Approval Rate</p>
          <p className="mt-1 text-3xl font-semibold text-green-600">
            {analyticsLoading ? '-' : avgApproval !== null ? `${avgApproval}%` : '--'}
          </p>
        </div>
        <div className="card card-body">
          <p className="text-sm font-medium text-gray-500">Avg Days to Approval</p>
          <p className="mt-1 text-3xl font-semibold text-blue-600">
            {analyticsLoading ? '-' : avgDays !== null ? `${avgDays}` : '--'}
          </p>
        </div>
        <div className="card card-body">
          <p className="text-sm font-medium text-gray-500">Stuck Enrollments</p>
          <p className={clsx('mt-1 text-3xl font-semibold', totalStuck > 0 ? 'text-red-600' : 'text-green-600')}>
            {analyticsLoading ? '-' : totalStuck}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Leaderboard */}
        <div className="lg:col-span-2">
          <div className="card">
            <div className="card-header">
              <h3 className="text-lg font-medium text-gray-900">Payer Difficulty Ranking</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Ranked by composite score (denial rate, processing time, stuck enrollments)
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50/80">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payer</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Approval</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg Days</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Denial</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stuck</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {leaderboardLoading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading...</td>
                    </tr>
                  ) : leaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState
                          illustration="chart"
                          title="No payers with enough data"
                          description="Payers need at least 3 enrollments to appear in the ranking."
                          className="py-8"
                        />
                      </td>
                    </tr>
                  ) : (
                    leaderboard.map((payer: PayerLeaderboardItem, idx: number) => (
                      <tr
                        key={payer.payerId}
                        onClick={() => setSelectedPayerId(
                          selectedPayerId === payer.payerId ? null : payer.payerId
                        )}
                        className={clsx(
                          'cursor-pointer hover:bg-primary-50/50 transition-colors',
                          selectedPayerId === payer.payerId && 'bg-primary-50'
                        )}
                      >
                        <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-900">{payer.payerName}</div>
                          <div className="text-xs text-gray-500">{payer.totalEnrollments} enrollments</div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {payer.approvalRate !== null ? (
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-2 rounded-full bg-gray-100 overflow-hidden">
                                <div
                                  className="h-full bg-green-500 rounded-full"
                                  style={{ width: `${payer.approvalRate}%` }}
                                />
                              </div>
                              <span className="text-gray-700">{payer.approvalRate}%</span>
                            </div>
                          ) : (
                            <span className="text-gray-400">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {payer.avgDaysToApproval !== null ? `${payer.avgDaysToApproval}d` : '--'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {payer.denialRate !== null ? `${payer.denialRate}%` : '--'}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {payer.stuckCount > 0 ? (
                            <span className="text-red-600 font-medium">{payer.stuckCount}</span>
                          ) : (
                            <span className="text-green-600">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={clsx(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                            difficultyBadgeColor(payer.difficultyScore)
                          )}>
                            {payer.difficultyScore}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-1 space-y-4">
          {selectedPayerId && selectedAnalytics ? (
            <>
              {/* Payer Header */}
              <div className="card card-body">
                <h3 className="text-lg font-semibold text-gray-900">{selectedAnalytics.payerName}</h3>
                <p className="text-sm text-gray-500">{selectedAnalytics.payerType || 'Unknown type'}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {selectedAnalytics.totalEnrollments} total · {selectedAnalytics.activeEnrollments} active
                </p>
              </div>

              {/* Analytics */}
              <PayerAnalyticsCards analytics={selectedAnalytics} />

              {/* AI Analysis */}
              <div className="card card-body space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-gray-900">AI Analysis</h4>
                  <button
                    onClick={() => handleAnalyze(selectedPayerId)}
                    disabled={analyzePayer.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary-700 rounded-md hover:bg-primary-800 disabled:opacity-50"
                  >
                    <SparklesIcon className="h-3.5 w-3.5" />
                    {analyzePayer.isPending ? 'Analyzing...' : 'Generate Analysis'}
                  </button>
                </div>

                {/* Show latest AI result */}
                {analyzePayer.data?.data && (
                  <PayerAIInsightCard
                    insight={analyzePayer.data.data.insight}
                    recommendationId={analyzePayer.data.data.recommendation.id}
                    payerId={selectedPayerId ?? undefined}
                  />
                )}

                {/* Past insights */}
                {pastInsights.length > 0 && !analyzePayer.data && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">Previous analyses</p>
                    {pastInsights.map(record => (
                      <PastInsightItem key={record.id} record={record} />
                    ))}
                  </div>
                )}

                {!analyzePayer.data && pastInsights.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">
                    No AI analysis yet. Click "Generate Analysis" to get strategic insights.
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="card card-body text-center py-12">
              <ChartBarSquareIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">
                Select a payer from the table to view detailed analytics and AI insights
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
    </PageTransition>
  );
}
