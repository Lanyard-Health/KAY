import type { PayerAnalytics } from '../../hooks/useEnrollmentStrategy';

function daysColor(days: number | null): string {
  if (days === null) return 'text-gray-400';
  if (days > 60) return 'text-red-600';
  if (days > 30) return 'text-yellow-600';
  return 'text-green-600';
}

const STATUS_COLORS: Record<string, string> = {
  approved: 'bg-green-500',
  in_progress: 'bg-blue-500',
  submitted: 'bg-indigo-500',
  pending_review: 'bg-yellow-500',
  not_started: 'bg-gray-400',
  denied: 'bg-red-500',
  terminated: 'bg-gray-600',
};

interface PayerAnalyticsCardsProps {
  analytics: PayerAnalytics;
}

export default function PayerAnalyticsCards({ analytics }: PayerAnalyticsCardsProps) {
  const totalForBar = Object.values(analytics.statusDistribution).reduce((sum, n) => sum + n, 0);

  return (
    <div className="space-y-4">
      {analytics.insufficientData && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-800">
          This payer has fewer than 3 enrollments. Rates may not be statistically representative.
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Approval Rate</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {analytics.approvalRate !== null ? `${analytics.approvalRate}%` : '--'}
          </p>
          {analytics.denialRate !== null && (
            <p className="text-xs text-gray-500 mt-1">Denial rate: {analytics.denialRate}%</p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Avg Days to Approval</p>
          <p className={`mt-1 text-2xl font-semibold ${daysColor(analytics.avgDaysToApproval)}`}>
            {analytics.avgDaysToApproval !== null ? `${analytics.avgDaysToApproval}d` : '--'}
          </p>
          {analytics.avgDaysInCurrentStatus !== null && (
            <p className="text-xs text-gray-500 mt-1">
              Avg in current status: {analytics.avgDaysInCurrentStatus}d
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Stuck Enrollments</p>
          <p className={`mt-1 text-2xl font-semibold ${analytics.enrollmentsStuckOver60Days > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {analytics.enrollmentsStuckOver60Days}
          </p>
          <p className="text-xs text-gray-500 mt-1">Over 60 days in-flight</p>
        </div>
      </div>

      {/* Status Distribution Bar */}
      {totalForBar > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase mb-2">Status Distribution</p>
          <div className="h-4 rounded-full overflow-hidden flex bg-gray-100">
            {Object.entries(analytics.statusDistribution).map(([status, count]) => {
              const pct = (count / totalForBar) * 100;
              if (pct === 0) return null;
              return (
                <div
                  key={status}
                  className={`${STATUS_COLORS[status] || 'bg-gray-400'}`} // eslint-disable-line security/detect-object-injection -- status from Object.entries iteration
                  style={{ width: `${pct}%` }}
                  title={`${status}: ${count} (${Math.round(pct)}%)`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {Object.entries(analytics.statusDistribution).map(([status, count]) => (
              <div key={status} className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className={`w-2.5 h-2.5 rounded-full ${STATUS_COLORS[status] || 'bg-gray-400'}`} /> {/* eslint-disable-line security/detect-object-injection -- status from Object.entries */}
                {status.replace(/_/g, ' ')}: {count}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
