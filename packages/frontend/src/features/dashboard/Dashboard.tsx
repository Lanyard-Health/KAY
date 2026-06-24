import { useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import PageTransition from '../../components/ui/PageTransition';
import ErrorState from '../../components/ui/ErrorState';
import {
  UserPlusIcon,
  DocumentArrowUpIcon,
  ClipboardDocumentListIcon,
  CheckCircleIcon,
  UserCircleIcon,
  CurrencyDollarIcon,
  SparklesIcon,
  BuildingOfficeIcon,
  BuildingOffice2Icon,
  PhoneArrowUpRightIcon,
  Cog6ToothIcon,
  MapPinIcon,
  QueueListIcon,
} from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { dashboardGreeting } from './greeting';
import { useGettingStarted } from '../../hooks/useReporting';
import ErrorBoundary from '../../components/ErrorBoundary';
import RefreshIndicator from '../../components/RefreshIndicator';
import StatCard from '../../components/ui/StatCard';
import AnimatedCard from '../../components/ui/AnimatedCard';
import clsx from 'clsx';

// Lazy-loaded widgets — Recharts (EnrollmentPipelineChart) is ~150KB
const GettingStartedChecklist = lazy(() => import('./GettingStartedChecklist'));
const EnrollmentPipelineChart = lazy(() => import('./EnrollmentPipelineChart'));
const ExpirationForecastWidget = lazy(() => import('./ExpirationForecastWidget'));
const ProviderReadinessTable = lazy(() => import('./ProviderReadinessTable'));
const AttestationBoardWidget = lazy(() => import('./AttestationBoardWidget'));

export default function Dashboard() {
  const { user } = useAuthStore();
  const practiceId = user?.practices?.[0]?.practiceId ?? '';
  const isPracticeAdmin = user?.role === 'practice_admin';
  const isAdmin = user?.role === 'admin' || user?.role === 'lanyard_staff';

  // Getting Started check — only for practice_admin with a practiceId
  const {
    data: gettingStarted,
    isLoading: gettingStartedLoading,
  } = useGettingStarted(isPracticeAdmin ? practiceId : '');

  const dismissKey = `lanyard_checklist_dismissed_${practiceId}`;
  const [checklistDismissed, setChecklistDismissed] = useState(
    () => localStorage.getItem(dismissKey) === 'true',
  );

  // Show getting-started for practice_admin who hasn't onboarded
  const showGettingStarted =
    isPracticeAdmin &&
    practiceId &&
    !checklistDismissed &&
    gettingStarted &&
    !gettingStarted.isOnboarded;

  // Fetch all dashboard data
  const { data, isLoading, isFetching, error, refetch } = useQuery({
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
        // Practice view fields
        followUpEngagementCount: stats.followUpEngagementCount ?? 0,
        practiceProfile: stats.practiceProfile ?? null,
        // Admin-only fields
        practicesOnboarded: stats.practicesOnboarded ?? null,
        enterpriseQueuePending: stats.enterpriseQueuePending ?? null,
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
          <h1 className="text-2xl font-bold">{dashboardGreeting(user?.firstName)}</h1>
          <p className="mt-1 text-primary-100">
            Let's get your practice set up. Complete the steps below to unlock your full dashboard.
          </p>
        </div>
        <Suspense fallback={<div className="animate-pulse h-48 bg-gray-200 rounded-2xl" />}>
          <GettingStartedChecklist
            providerCount={gettingStarted.providerCount}
            documentCount={gettingStarted.documentCount}
            enrollmentCount={gettingStarted.enrollmentCount}
            onDismiss={() => { localStorage.setItem(dismissKey, 'true'); setChecklistDismissed(true); }}
          />
        </Suspense>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <ErrorState
          title="Couldn't load dashboard"
          message="Check your connection and try again."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  // Practice admin / credentialing_staff simplified dashboard
  if (!isAdmin) {
    const pp = data?.practiceProfile;
    const addressParts = [pp?.addressLine1, pp?.city, pp?.state, pp?.zipCode].filter(Boolean);

    return (
      <PageTransition>
      <div className="space-y-6">
        {/* Welcome Header */}
        <div className="bg-gradient-to-br from-primary-600 via-primary-700 to-primary-800 rounded-2xl p-8 text-white">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{dashboardGreeting(user?.firstName)}</h1>
            <RefreshIndicator isFetching={isFetching && !isLoading} />
          </div>
          <p className="mt-1 text-primary-100">Your practice overview at a glance.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Practice Profile Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5">
            <div className="flex items-center gap-2 mb-3">
              <BuildingOfficeIcon className="h-5 w-5 text-primary-500" />
              <h3 className="text-sm font-semibold text-gray-900">Practice Profile</h3>
            </div>
            {isLoading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 w-3/4 bg-gray-200 rounded" />
                <div className="h-3 w-1/2 bg-gray-100 rounded" />
              </div>
            ) : pp ? (
              <div className="space-y-2">
                <p className="text-base font-medium text-gray-900">{pp.name}</p>
                {addressParts.length > 0 && (
                  <div className="flex items-start gap-1.5 text-sm text-gray-500">
                    <MapPinIcon className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{addressParts.join(', ')}</span>
                  </div>
                )}
                {pp.states?.length > 0 && (
                  <p className="text-xs text-gray-400">
                    Operating in: {pp.states.join(', ')}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No practice information available</p>
            )}
            <Link
              to="/settings"
              className="mt-3 inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              <Cog6ToothIcon className="h-3.5 w-3.5" />
              Full profile in Settings
            </Link>
          </div>

          {/* Active Enrollments Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardDocumentListIcon className="h-5 w-5 text-primary-500" />
              <h3 className="text-sm font-semibold text-gray-900">Active Enrollments</h3>
            </div>
            <p className="text-3xl font-bold text-gray-900">
              {isLoading ? '-' : data?.activeEnrollments ?? 0}
            </p>
            <p className="text-xs text-gray-400 mt-1">Excludes draft, terminated, and denied</p>
          </div>

          {/* Follow-Up Engagements Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5">
            <div className="flex items-center gap-2 mb-3">
              <PhoneArrowUpRightIcon className="h-5 w-5 text-primary-500" />
              <h3 className="text-sm font-semibold text-gray-900">Follow-Up Engagements</h3>
            </div>
            <p className="text-3xl font-bold text-gray-900">
              {isLoading ? '-' : data?.followUpEngagementCount ?? 0}
            </p>
            <p className="text-xs text-gray-400 mt-1">Total email &amp; call follow-ups</p>
          </div>
        </div>
      </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
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
          <h1 className="text-2xl font-bold">{dashboardGreeting(user?.firstName)}</h1>
          <RefreshIndicator isFetching={isFetching && !isLoading} />
        </div>
        <p className="mt-1 text-primary-100">Platform operations overview</p>

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

      {/* Row 0: Admin Platform Stats */}
      <div className="dash-stagger grid grid-cols-2 gap-4">
        <AnimatedCard index={0}>
          <StatCard
            label="Practices Onboarded"
            value={isLoading ? '-' : data?.practicesOnboarded ?? 0}
            icon={<BuildingOffice2Icon className="h-5 w-5" />}
          />
        </AnimatedCard>
        <AnimatedCard index={1}>
          <div className={clsx(
            'h-full rounded-2xl shadow-sm border p-5 transition-shadow duration-300 hover:shadow-md',
            (data?.enterpriseQueuePending ?? 0) > 0
              ? 'bg-amber-50 border-amber-200'
              : 'bg-white border-gray-200/60',
          )}>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <QueueListIcon className={clsx('h-5 w-5', (data?.enterpriseQueuePending ?? 0) > 0 ? 'text-amber-500' : '')} />
              <span>Enterprise Queue</span>
            </div>
            <p className={clsx(
              'text-2xl font-bold',
              (data?.enterpriseQueuePending ?? 0) > 0 ? 'text-amber-700' : 'text-gray-900',
            )}>
              {isLoading ? '-' : data?.enterpriseQueuePending ?? 0}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">pending setup</p>
          </div>
        </AnimatedCard>
      </div>

      {/* Row 1: Hero Stats */}
      <div className="dash-stagger dash-d1 grid grid-cols-2 lg:grid-cols-5 gap-4">
        <AnimatedCard index={0}>
          <StatCard
            label="Total Providers"
            value={isLoading ? '-' : data?.totalProviders ?? 0}
            sparkline={data?.trendData?.providers7d}
            icon={<UserCircleIcon className="h-5 w-5" />}
          />
        </AnimatedCard>
        <AnimatedCard index={1}>
          <StatCard
            label="Fully Credentialed"
            value={isLoading ? '-' : `${credentialedPct}%`}
            trend={credentialedPct >= 80 ? { value: credentialedPct, label: 'of target' } : undefined}
            icon={<CheckCircleIcon className="h-5 w-5" />}
          />
        </AnimatedCard>
        <AnimatedCard index={2}>
          <StatCard
            label="Active Enrollments"
            value={isLoading ? '-' : data?.activeEnrollments ?? 0}
            sparkline={data?.trendData?.enrollments7d}
            icon={<ClipboardDocumentListIcon className="h-5 w-5" />}
          />
        </AnimatedCard>
        <AnimatedCard index={3}>
          <StatCard
            label="Revenue at Risk"
            value={isLoading ? '-' : `$${((data?.revenueAtRisk ?? 0) / 1000).toFixed(0)}k`}
            icon={<CurrencyDollarIcon className="h-5 w-5" />}
          />
        </AnimatedCard>
        <AnimatedCard index={4}>
          <StatCard
            label="AI Actions Today"
            value={isLoading ? '-' : data?.aiActionsToday ?? 0}
            icon={<SparklesIcon className="h-5 w-5" />}
          />
        </AnimatedCard>
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

      {/* Row 5: CAQH Attestation Board */}
      <div className="dash-stagger dash-d4">
      <ErrorBoundary>
        <Suspense fallback={
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 animate-pulse">
            <div className="h-4 w-48 bg-gray-200 rounded mb-4" />
            <div className="h-32 bg-gray-100 rounded" />
          </div>
        }>
          <AttestationBoardWidget />
        </Suspense>
      </ErrorBoundary>
      </div>
    </div>
    </PageTransition>
  );
}

