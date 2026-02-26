import { useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  UserPlusIcon,
  DocumentArrowUpIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  CheckCircleIcon,
  UserCircleIcon,
  BellAlertIcon,
  CurrencyDollarIcon,
  SparklesIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { useGettingStarted } from '../../hooks/useReporting';
import ErrorBoundary from '../../components/ErrorBoundary';
import RefreshIndicator from '../../components/RefreshIndicator';
import StatCard from '../../components/ui/StatCard';
import HealthScoreGauge from '../../components/ui/HealthScoreGauge';
import ActionCard from '../../components/ui/ActionCard';
import clsx from 'clsx';

// Lazy-loaded widgets — Recharts (EnrollmentPipelineChart) is ~150KB
const GettingStartedChecklist = lazy(() => import('./GettingStartedChecklist'));
const EnrollmentPipelineChart = lazy(() => import('./EnrollmentPipelineChart'));
const ExpirationForecastWidget = lazy(() => import('./ExpirationForecastWidget'));
const ProviderReadinessTable = lazy(() => import('./ProviderReadinessTable'));

export default function Dashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const practiceId = user?.practices?.[0]?.practiceId ?? '';
  const isPracticeAdmin = user?.role === 'practice_admin';

  // Getting Started check — only for practice_admin with a practiceId
  const {
    data: gettingStarted,
    isLoading: gettingStartedLoading,
  } = useGettingStarted(isPracticeAdmin ? practiceId : '');

  const [checklistDismissed, setChecklistDismissed] = useState(false);

  // Show getting-started for practice_admin who hasn't onboarded
  const showGettingStarted =
    isPracticeAdmin &&
    practiceId &&
    !checklistDismissed &&
    gettingStarted &&
    !gettingStarted.isOnboarded;

  // Fetch all dashboard data
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['dashboard-full'],
    queryFn: async () => {
      const [statsRes, expirationsRes, expirationDashRes] = await Promise.all([
        api.get('/dashboard/stats'),
        api.get('/expirations?days=30'),
        api.get('/expirations/dashboard'),
      ]);

      const stats = statsRes.data.data || {};
      const expirations = expirationsRes.data.data || [];
      const expirationSummary = expirationDashRes.data.data || {};
      const expiringItems = Array.isArray(expirations) ? expirations : [];

      return {
        totalProviders: stats.totalProviders || 0,
        activeProviders: stats.activeProviders || 0,
        pendingProviders: stats.pendingProviders || 0,
        activeEnrollments: stats.activeEnrollments || 0,
        incompleteProviders: stats.incompleteProviders || [],
        incompleteCount: stats.incompleteCount || 0,
        expiringItems,
        expirationSummary,
        needsFollowUp: stats.needsFollowUp || [],
        followUpCount: stats.followUpCount || 0,
        // Phase 2 fields
        credentialingHealthScore: stats.credentialingHealthScore ?? 0,
        revenueAtRisk: stats.revenueAtRisk ?? 0,
        aiActionsToday: stats.aiActionsToday ?? 0,
        trendData: stats.trendData ?? { providers7d: [], enrollments7d: [] },
        healthBreakdown: stats.healthBreakdown ?? {},
      };
    },
    enabled: !showGettingStarted,
  });

  const quickActions = [
    {
      name: 'Add Provider',
      description: 'Start credentialing a new provider',
      icon: UserPlusIcon,
      href: '/providers/new',
      color: 'bg-white/[0.08] hover:bg-white/[0.15] backdrop-blur-sm border border-white/[0.1]',
    },
    {
      name: 'Upload Document',
      description: 'Add documents to a provider',
      icon: DocumentArrowUpIcon,
      href: '/documents',
      color: 'bg-white/[0.08] hover:bg-white/[0.15] backdrop-blur-sm border border-white/[0.1]',
    },
    {
      name: 'New Enrollment',
      description: 'Start a payer enrollment',
      icon: ClipboardDocumentListIcon,
      href: '/enrollments',
      color: 'bg-white/[0.08] hover:bg-white/[0.15] backdrop-blur-sm border border-white/[0.1]',
    },
  ];

  // Build action items for the priority stream
  const actionItems: { title: string; description: string; priority: 'urgent' | 'high' | 'normal'; link: string }[] = [];

  if (data) {
    // Expired credentials → urgent
    if (data.expirationSummary?.expired > 0) {
      actionItems.push({
        title: `${data.expirationSummary.expired} credential${data.expirationSummary.expired > 1 ? 's' : ''} expired`,
        description: 'Renew immediately to avoid coverage gaps',
        priority: 'urgent',
        link: '/expirations',
      });
    }
    // Expiring within 7 days → high
    if (data.expirationSummary?.expiring7Days > 0) {
      actionItems.push({
        title: `${data.expirationSummary.expiring7Days} credential${data.expirationSummary.expiring7Days > 1 ? 's' : ''} expiring within 7 days`,
        description: 'Start renewal process now',
        priority: 'high',
        link: '/expirations',
      });
    }
    // Follow-ups needed → high
    if (data.followUpCount > 0) {
      actionItems.push({
        title: `${data.followUpCount} enrollment${data.followUpCount > 1 ? 's' : ''} need follow-up`,
        description: 'No follow-up in the last 7 days',
        priority: 'high',
        link: '/enrollments',
      });
    }
    // Incomplete profiles → normal
    if (data.incompleteCount > 0) {
      actionItems.push({
        title: `${data.incompleteCount} provider${data.incompleteCount > 1 ? 's' : ''} with incomplete profiles`,
        description: 'Missing documents, licenses, or certifications',
        priority: 'normal',
        link: '/providers',
      });
    }
    // Expiring within 30 days → normal
    if (data.expirationSummary?.expiring30Days > 0) {
      actionItems.push({
        title: `${data.expirationSummary.expiring30Days} credential${data.expirationSummary.expiring30Days > 1 ? 's' : ''} expiring within 30 days`,
        description: 'Plan renewal ahead of time',
        priority: 'normal',
        link: '/expirations',
      });
    }
  }

  const actionItemsCount = actionItems.length;

  // Credentialed percentage for stat card
  const credentialedPct = data?.totalProviders
    ? Math.round((data.activeProviders / data.totalProviders) * 100)
    : 0;

  // Loading state for practice_admin while getting-started query loads
  if (isPracticeAdmin && practiceId && gettingStartedLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-48 bg-gray-200 rounded-2xl" />
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Getting Started Checklist for new practice_admin users
  if (showGettingStarted) {
    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-br from-primary-600 via-primary-700 to-primary-800 rounded-2xl p-8 text-white">
          <h1 className="text-2xl font-bold">Welcome to Lanyard Health</h1>
          <p className="mt-1 text-primary-100">
            Let's get your practice set up. Complete the steps below to unlock your full dashboard.
          </p>
        </div>
        <Suspense fallback={<div className="animate-pulse h-48 bg-gray-200 rounded-2xl" />}>
          <GettingStartedChecklist
            providerCount={gettingStarted.providerCount}
            documentCount={gettingStarted.documentCount}
            enrollmentCount={gettingStarted.enrollmentCount}
            onDismiss={() => setChecklistDismissed(true)}
          />
        </Suspense>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <p className="font-medium">Failed to load dashboard data</p>
          <p className="text-sm mt-1">Please check your connection and try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <style>{`
        @keyframes dashFadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .dash-stagger { animation: dashFadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .dash-d1 { animation-delay: 0.05s; }
        .dash-d2 { animation-delay: 0.1s; }
        .dash-d3 { animation-delay: 0.15s; }
        .dash-d4 { animation-delay: 0.2s; }
      `}</style>
      {/* Welcome Header */}
      <div className="dash-stagger bg-gradient-to-br from-primary-600 via-primary-700 to-primary-800 rounded-2xl p-8 text-white">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Welcome to Lanyard Health</h1>
          <RefreshIndicator isFetching={isFetching && !isLoading} />
        </div>
        <p className="mt-1 text-primary-100">
          {actionItemsCount > 0
            ? `You have ${actionItemsCount} item${actionItemsCount !== 1 ? 's' : ''} that need${actionItemsCount === 1 ? 's' : ''} attention`
            : "You're all caught up! No urgent items."}
        </p>

        {/* Quick Actions */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {quickActions.map((action) => (
            <Link
              key={action.name}
              to={action.href}
              className={clsx(
                'flex items-center gap-3 p-4 rounded-xl transition-all',
                action.color,
                'text-white backdrop-blur-sm hover:scale-[1.02]'
              )}
            >
              <action.icon className="h-8 w-8 flex-shrink-0" />
              <div>
                <p className="font-semibold">{action.name}</p>
                <p className="text-sm text-white/80">{action.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Row 1: Hero Stats */}
      <div className="dash-stagger dash-d1 grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Total Providers"
          value={isLoading ? '-' : data?.totalProviders ?? 0}
          sparkline={data?.trendData?.providers7d}
          icon={<UserCircleIcon className="h-5 w-5" />}
        />
        <StatCard
          label="Fully Credentialed"
          value={isLoading ? '-' : `${credentialedPct}%`}
          trend={credentialedPct >= 80 ? { value: credentialedPct, label: 'of target' } : undefined}
          icon={<CheckCircleIcon className="h-5 w-5" />}
        />
        <StatCard
          label="Active Enrollments"
          value={isLoading ? '-' : data?.activeEnrollments ?? 0}
          sparkline={data?.trendData?.enrollments7d}
          icon={<ClipboardDocumentListIcon className="h-5 w-5" />}
        />
        <StatCard
          label="Revenue at Risk"
          value={isLoading ? '-' : `$${((data?.revenueAtRisk ?? 0) / 1000).toFixed(0)}k`}
          icon={<CurrencyDollarIcon className="h-5 w-5" />}
        />
        <StatCard
          label="AI Actions Today"
          value={isLoading ? '-' : data?.aiActionsToday ?? 0}
          icon={<SparklesIcon className="h-5 w-5" />}
        />
      </div>

      {/* Row 2: Health Score + Action Stream */}
      <div className="dash-stagger dash-d2 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Health Score */}
        <div className="lg:col-span-4 bg-white rounded-2xl shadow-sm border border-gray-200/60 hover:shadow-md transition-shadow duration-300 p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-4">Credentialing Health Score</h3>
          <div className="flex flex-col items-center">
            <HealthScoreGauge
              score={data?.credentialingHealthScore ?? 0}
              size={160}
              strokeWidth={12}
            />
            {data?.healthBreakdown && (
              <div className="mt-4 w-full space-y-2">
                <BreakdownBar label="Credentialed" value={data.healthBreakdown.credentialedPct ?? 0} />
                <BreakdownBar label="Enrollments Active" value={data.healthBreakdown.activeEnrollmentsPct ?? 0} />
                <BreakdownBar label="CAQH Current" value={data.healthBreakdown.caqhCurrentPct ?? 0} />
                <BreakdownBar
                  label="Expired Creds"
                  value={data.healthBreakdown.expiredCredsPenalty ?? 0}
                  invert
                />
              </div>
            )}
          </div>
        </div>

        {/* Prioritized Action Stream */}
        <div className="lg:col-span-8 bg-white rounded-2xl shadow-sm border border-gray-200/60 hover:shadow-md transition-shadow duration-300">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BellAlertIcon className="h-5 w-5 text-primary-500" />
              <h3 className="font-semibold text-gray-900">Priority Actions</h3>
              {actionItemsCount > 0 && (
                <span className="bg-red-100 text-red-800 text-xs font-medium px-2 py-0.5 rounded-full">
                  {actionItemsCount}
                </span>
              )}
            </div>
          </div>
          <div className="p-5 space-y-3 max-h-[360px] overflow-y-auto">
            {isLoading ? (
              <div className="animate-pulse space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-16 bg-gray-100 rounded-xl" />
                ))}
              </div>
            ) : actionItems.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircleIcon className="h-12 w-12 text-green-400 mx-auto" />
                <p className="mt-2 text-sm text-gray-500">All clear! No action items.</p>
              </div>
            ) : (
              actionItems.map((item, i) => (
                <ActionCard
                  key={i}
                  title={item.title}
                  description={item.description}
                  priority={item.priority}
                  icon={
                    item.priority === 'urgent' ? <ExclamationTriangleIcon className="h-5 w-5 text-red-500" /> :
                    item.priority === 'high' ? <ClockIcon className="h-5 w-5 text-amber-500" /> :
                    <ChartBarIcon className="h-5 w-5 text-blue-500" />
                  }
                  actions={[{ label: 'View →', onClick: () => navigate(item.link) }]}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Row 3: Enrollment Pipeline + Expiration Forecast */}
      <div className="dash-stagger dash-d3">
      <ErrorBoundary>
        <Suspense fallback={
          <div className="grid grid-cols-1 lg:grid-cols-8 gap-6">
            <div className="lg:col-span-5 bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 animate-pulse">
              <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
              <div className="h-48 bg-gray-100 rounded" />
            </div>
            <div className="lg:col-span-3 bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 animate-pulse">
              <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
              <div className="h-48 bg-gray-100 rounded" />
            </div>
          </div>
        }>
          <div className="grid grid-cols-1 lg:grid-cols-8 gap-6">
            <div className="lg:col-span-5">
              <EnrollmentPipelineChart practiceId={practiceId} />
            </div>
            <div className="lg:col-span-3">
              <ExpirationForecastWidget practiceId={practiceId} />
            </div>
          </div>
        </Suspense>
      </ErrorBoundary>
      </div>

      {/* Row 4: Provider Readiness Table */}
      <div className="dash-stagger dash-d4">
      <ErrorBoundary>
        <Suspense fallback={
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 animate-pulse">
            <div className="h-4 w-48 bg-gray-200 rounded mb-4" />
            <div className="h-64 bg-gray-100 rounded" />
          </div>
        }>
          <ProviderReadinessTable practiceId={practiceId} />
        </Suspense>
      </ErrorBoundary>
      </div>
    </div>
  );
}

/** Small horizontal bar for health score breakdown */
function BreakdownBar({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const displayValue = invert ? 100 - value : value;
  const barColor = invert
    ? value > 20 ? 'bg-red-500' : value > 5 ? 'bg-amber-500' : 'bg-green-500'
    : displayValue >= 80 ? 'bg-green-500' : displayValue >= 60 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-28 text-gray-500 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-700', barColor)}
          style={{ width: `${Math.max(2, invert ? value : displayValue)}%` }}
        />
      </div>
      <span className="w-8 text-right text-gray-600 font-medium">
        {invert ? value : displayValue}%
      </span>
    </div>
  );
}
