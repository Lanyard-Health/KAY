import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useOpsSla, type OpsSlaSummary } from '../../hooks/useOps';

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-800',
    active: 'bg-green-100 text-green-800',
    PENDING: 'bg-yellow-100 text-yellow-800',
    pending: 'bg-yellow-100 text-yellow-800',
    submitted: 'bg-blue-100 text-blue-800',
    SUBMITTED: 'bg-blue-100 text-blue-800',
    in_review: 'bg-indigo-100 text-indigo-800',
    IN_REVIEW: 'bg-indigo-100 text-indigo-800',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        styles[status] ?? 'bg-gray-100 text-gray-600',
      )}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function computeDaysOverdue(slaTargetDate: string): number {
  const target = new Date(slaTargetDate).getTime();
  const now = Date.now();
  const diffMs = now - target;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export default function OpsSlaDashboard() {
  const { data, isLoading, isError } = useOpsSla();

  const sortedBreaches = useMemo(() => {
    if (!data?.breachedEnrollments) return [];
    return [...data.breachedEnrollments].sort((a, b) => {
      return computeDaysOverdue(b.slaTargetDate) - computeDaysOverdue(a.slaTargetDate);
    });
  }, [data?.breachedEnrollments]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">SLA Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Monitor enrollment SLA compliance across all practices
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5 animate-pulse"
            >
              <div className="h-4 w-24 bg-gray-200 rounded mb-3" />
              <div className="h-8 w-16 bg-gray-200 rounded mb-2" />
              <div className="h-3 w-20 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 animate-pulse">
          <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">SLA Dashboard</h1>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-12 text-center">
          <p className="text-sm text-red-600">
            Failed to load SLA data. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  const sla: OpsSlaSummary = data ?? {
    totalActive: 0,
    onTrack: 0,
    atRisk: 0,
    breached: 0,
    breachedEnrollments: [],
  };

  const total = sla.totalActive || 1; // avoid division by zero
  const pct = (val: number) => ((val / total) * 100).toFixed(1);

  const summaryCards = [
    {
      label: 'Total Active',
      count: sla.totalActive,
      percentage: '100',
      icon: ClockIcon,
      bgColor: 'bg-gray-50',
      iconColor: 'text-gray-500',
      textColor: 'text-gray-900',
    },
    {
      label: 'On Track',
      count: sla.onTrack,
      percentage: pct(sla.onTrack),
      icon: CheckCircleIcon,
      bgColor: 'bg-green-50',
      iconColor: 'text-green-600',
      textColor: 'text-green-900',
    },
    {
      label: 'At Risk',
      count: sla.atRisk,
      percentage: pct(sla.atRisk),
      icon: ExclamationTriangleIcon,
      bgColor: 'bg-amber-50',
      iconColor: 'text-amber-600',
      textColor: 'text-amber-900',
    },
    {
      label: 'Breached',
      count: sla.breached,
      percentage: pct(sla.breached),
      icon: XCircleIcon,
      bgColor: 'bg-red-50',
      iconColor: 'text-red-600',
      textColor: 'text-red-900',
    },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">SLA Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Monitor enrollment SLA compliance across all practices
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className={clsx(
                'rounded-2xl shadow-sm border border-gray-200/60 p-5',
                card.bgColor,
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-600">{card.label}</span>
                <Icon className={clsx('h-5 w-5', card.iconColor)} />
              </div>
              <p className={clsx('text-3xl font-bold', card.textColor)}>{card.count}</p>
              <p className="mt-1 text-xs text-gray-500">{card.percentage}% of total</p>
            </div>
          );
        })}
      </div>

      {/* Active Breaches Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200/60">
          <h2 className="text-lg font-semibold text-gray-900">Active Breaches</h2>
        </div>

        {sortedBreaches.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <CheckCircleIcon className="mx-auto h-10 w-10 text-green-500" />
            <p className="mt-3 text-sm font-medium text-green-800">
              No SLA breaches -- all enrollments on track!
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200/60">
              <thead className="bg-gray-50/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Provider
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Payer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Practice
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    SLA Target Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Breached Since
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Days Overdue
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200/60">
                {sortedBreaches.map((enrollment) => {
                  const daysOverdue = computeDaysOverdue(enrollment.slaTargetDate);
                  return (
                    <tr
                      key={enrollment.id}
                      className="hover:bg-gray-50/50 transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Link
                          to={`/providers/${enrollment.id}`}
                          className="text-sm font-medium text-primary-600 hover:text-primary-700"
                        >
                          {enrollment.providerName}
                        </Link>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {enrollment.payerName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {enrollment.practiceName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge status={enrollment.status} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {new Date(enrollment.slaTargetDate).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {new Date(enrollment.slaBreachedAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={clsx(
                            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold',
                            daysOverdue >= 30
                              ? 'bg-red-100 text-red-800'
                              : daysOverdue >= 14
                                ? 'bg-orange-100 text-orange-800'
                                : 'bg-yellow-100 text-yellow-800',
                          )}
                        >
                          {daysOverdue}d
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
