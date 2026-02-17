import { useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  UserPlusIcon,
  DocumentArrowUpIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  UserCircleIcon,
  DocumentTextIcon,
  BellAlertIcon,
} from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { useGettingStarted } from '../../hooks/useReporting';
import ErrorBoundary from '../../components/ErrorBoundary';
import clsx from 'clsx';
import { format, differenceInDays } from 'date-fns';

// Lazy-loaded widgets — Recharts (EnrollmentPipelineChart) is ~150KB
const GettingStartedChecklist = lazy(() => import('./GettingStartedChecklist'));
const EnrollmentPipelineChart = lazy(() => import('./EnrollmentPipelineChart'));
const ExpirationForecastWidget = lazy(() => import('./ExpirationForecastWidget'));
const ProviderReadinessTable = lazy(() => import('./ProviderReadinessTable'));

export default function Dashboard() {
  const { user } = useAuthStore();
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
  const { data, isLoading, error } = useQuery({
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

      // expirations is already a flat ExpiringCredential[] sorted by date
      const expiringItems = Array.isArray(expirations) ? expirations : [];

      return {
        totalProviders: stats.totalProviders || 0,
        activeProviders: stats.activeProviders || 0,
        pendingProviders: stats.pendingProviders || 0,
        incompleteProviders: stats.incompleteProviders || [],
        incompleteCount: stats.incompleteCount || 0,
        expiringItems,
        expirationSummary,
        needsFollowUp: stats.needsFollowUp || [],
        followUpCount: stats.followUpCount || 0,
      };
    },
    // Skip dashboard fetch while showing getting-started checklist
    enabled: !showGettingStarted,
  });

  const quickActions = [
    {
      name: 'Add Provider',
      description: 'Start credentialing a new provider',
      icon: UserPlusIcon,
      href: '/providers/new',
      color: 'bg-white/20 hover:bg-white/30',
    },
    {
      name: 'Upload Document',
      description: 'Add documents to a provider',
      icon: DocumentArrowUpIcon,
      href: '/documents',
      color: 'bg-white/20 hover:bg-white/30',
    },
    {
      name: 'New Enrollment',
      description: 'Start a payer enrollment',
      icon: ClipboardDocumentListIcon,
      href: '/enrollments',
      color: 'bg-white/20 hover:bg-white/30',
    },
  ];

  // Calculate action items count
  const actionItemsCount =
    (data?.incompleteCount || data?.incompleteProviders?.length || 0) +
    (data?.expiringItems?.length || 0) +
    (data?.followUpCount || data?.needsFollowUp?.length || 0);

  // Loading state for practice_admin while getting-started query loads
  if (isPracticeAdmin && practiceId && gettingStartedLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-48 bg-gray-200 rounded-2xl" />
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
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
      {/* Welcome Header */}
      <div className="bg-gradient-to-br from-primary-600 via-primary-700 to-primary-800 rounded-2xl p-8 text-white">
        <h1 className="text-2xl font-bold">Welcome to Lanyard Health</h1>
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

      {/* Stats Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Providers</p>
              <p className="text-3xl font-bold text-gray-900">
                {isLoading ? '-' : data?.totalProviders || 0}
              </p>
            </div>
            <div className="p-3 bg-primary-100 rounded-2xl">
              <UserCircleIcon className="h-6 w-6 text-primary-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Active</p>
              <p className="text-3xl font-bold text-green-600">
                {isLoading ? '-' : data?.activeProviders || 0}
              </p>
            </div>
            <div className="p-3 bg-green-100 rounded-2xl">
              <CheckCircleIcon className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Pending</p>
              <p className="text-3xl font-bold text-yellow-600">
                {isLoading ? '-' : data?.pendingProviders || 0}
              </p>
            </div>
            <div className="p-3 bg-yellow-100 rounded-2xl">
              <ClockIcon className="h-6 w-6 text-yellow-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Needs Attention</p>
              <p className="text-3xl font-bold text-red-600">
                {isLoading ? '-' : actionItemsCount}
              </p>
            </div>
            <div className="p-3 bg-red-100 rounded-2xl">
              <BellAlertIcon className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Action Items Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Incomplete Providers */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500" />
              <h3 className="font-semibold text-gray-900">Incomplete Profiles</h3>
              {(data?.incompleteCount || data?.incompleteProviders?.length || 0) > 0 && (
                <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-0.5 rounded-full">
                  {data?.incompleteCount || data?.incompleteProviders?.length}
                </span>
              )}
            </div>
            <Link to="/providers" className="text-sm text-primary-600 hover:text-primary-700">
              View all
            </Link>
          </div>
          <div className="p-5">
            {isLoading ? (
              <div className="animate-pulse space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-gray-100 rounded"></div>
                ))}
              </div>
            ) : data?.incompleteProviders?.length === 0 ? (
              <div className="text-center py-6">
                <CheckCircleIcon className="h-12 w-12 text-green-400 mx-auto" />
                <p className="mt-2 text-sm text-gray-500">All provider profiles are complete!</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {data?.incompleteProviders?.slice(0, 5).map((provider: any) => (
                  <li key={provider.id}>
                    <Link
                      to={`/providers/${provider.id}`}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100/80 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-yellow-100 flex items-center justify-center">
                          <span className="text-yellow-700 font-medium">
                            {provider.firstName?.[0]}{provider.lastName?.[0]}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {provider.firstName} {provider.lastName}
                          </p>
                          <p className="text-sm text-gray-500">
                            Missing: {[
                              !provider._count?.documents && 'Documents',
                              !provider._count?.licenses && 'Licenses',
                              !provider._count?.boardCertifications && 'Certifications',
                            ].filter(Boolean).join(', ') || 'Review needed'}
                          </p>
                        </div>
                      </div>
                      <ArrowRightIcon className="h-5 w-5 text-gray-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Expiring Soon */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClockIcon className="h-5 w-5 text-red-500" />
              <h3 className="font-semibold text-gray-900">Expiring Soon</h3>
              {(data?.expiringItems?.length ?? 0) > 0 && (
                <span className="bg-red-100 text-red-800 text-xs font-medium px-2 py-0.5 rounded-full">
                  {data?.expiringItems?.length}
                </span>
              )}
            </div>
            <Link to="/expirations" className="text-sm text-primary-600 hover:text-primary-700">
              View all
            </Link>
          </div>
          <div className="p-5">
            {isLoading ? (
              <div className="animate-pulse space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-gray-100 rounded"></div>
                ))}
              </div>
            ) : data?.expiringItems?.length === 0 && !data?.expirationSummary?.expired ? (
              <div className="text-center py-6">
                <CheckCircleIcon className="h-12 w-12 text-green-400 mx-auto" />
                <p className="mt-2 text-sm text-gray-500">Nothing expiring in the next 30 days!</p>
              </div>
            ) : (
              <>
                {/* Summary counts */}
                {data?.expirationSummary && (
                  <div className="flex items-center gap-3 mb-4 text-xs font-medium">
                    {data.expirationSummary.expired > 0 && (
                      <span className="bg-red-100 text-red-700 px-2 py-1 rounded-full">
                        {data.expirationSummary.expired} expired
                      </span>
                    )}
                    {data.expirationSummary.expiring7Days > 0 && (
                      <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
                        {data.expirationSummary.expiring7Days} within 7d
                      </span>
                    )}
                    {data.expirationSummary.expiring30Days > 0 && (
                      <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">
                        {data.expirationSummary.expiring30Days} within 30d
                      </span>
                    )}
                  </div>
                )}
                <ul className="space-y-3">
                  {data?.expiringItems?.slice(0, 5).map((item: any, index: number) => {
                    const daysUntil = differenceInDays(new Date(item.expirationDate), new Date());
                    const isUrgent = daysUntil <= 7;
                    return (
                      <li key={item.id || index}>
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                          <div className="flex items-center gap-3">
                            <div className={clsx(
                              'h-10 w-10 rounded-full flex items-center justify-center',
                              isUrgent ? 'bg-red-100' : 'bg-yellow-100'
                            )}>
                              <DocumentTextIcon className={clsx(
                                'h-5 w-5',
                                isUrgent ? 'text-red-600' : 'text-yellow-600'
                              )} />
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{item.name}</p>
                              <p className="text-sm text-gray-500">
                                {item.providerName} &middot; {item.type}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={clsx(
                              'text-sm font-medium',
                              isUrgent ? 'text-red-600' : 'text-yellow-600'
                            )}>
                              {daysUntil <= 0 ? 'Expired' : `${daysUntil} days`}
                            </p>
                            <p className="text-xs text-gray-500">
                              {format(new Date(item.expirationDate), 'MMM d, yyyy')}
                            </p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>

        {/* Enrollments Needing Follow-up */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardDocumentListIcon className="h-5 w-5 text-primary-500" />
              <h3 className="font-semibold text-gray-900">Enrollments - Follow Up Needed</h3>
              {(data?.followUpCount || data?.needsFollowUp?.length || 0) > 0 && (
                <span className="bg-primary-100 text-primary-800 text-xs font-medium px-2 py-0.5 rounded-full">
                  {data?.followUpCount || data?.needsFollowUp?.length}
                </span>
              )}
            </div>
            <Link to="/enrollments" className="text-sm text-primary-600 hover:text-primary-700">
              View all
            </Link>
          </div>
          <div className="p-5">
            {isLoading ? (
              <div className="animate-pulse space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-gray-100 rounded"></div>
                ))}
              </div>
            ) : data?.needsFollowUp?.length === 0 ? (
              <div className="text-center py-6">
                <CheckCircleIcon className="h-12 w-12 text-green-400 mx-auto" />
                <p className="mt-2 text-sm text-gray-500">All enrollments are up to date!</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {data?.needsFollowUp?.slice(0, 5).map((enrollment: any) => (
                  <li key={enrollment.id}>
                    <Link
                      to={`/enrollments/${enrollment.id}`}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100/80 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center">
                          <ClipboardDocumentListIcon className="h-5 w-5 text-primary-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {enrollment.payer?.name || 'Unknown Payer'}
                          </p>
                          <p className="text-sm text-gray-500">
                            {enrollment.provider?.firstName} {enrollment.provider?.lastName}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={clsx(
                          'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                          enrollment.status === 'in_progress' ? 'bg-primary-100 text-primary-800' :
                          enrollment.status === 'submitted' ? 'bg-purple-100 text-purple-800' :
                          'bg-gray-100 text-gray-800'
                        )}>
                          {enrollment.status?.replace('_', ' ')}
                        </span>
                        <p className="text-xs text-gray-500 mt-1">
                          {enrollment.lastFollowUpDate
                            ? `Last: ${format(new Date(enrollment.lastFollowUpDate), 'MMM d')}`
                            : 'No follow-up yet'}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Reporting Widgets — practice_admin only */}
      {isPracticeAdmin && practiceId && (
        <ErrorBoundary>
        <Suspense fallback={
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {[5, 3, 2].map((span) => (
              <div key={span} className={`lg:col-span-${span} bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 animate-pulse`}>
                <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
                <div className="h-48 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        }>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-5">
              <EnrollmentPipelineChart practiceId={practiceId} />
            </div>
            <div className="lg:col-span-3">
              <ExpirationForecastWidget practiceId={practiceId} />
            </div>
            <div className="lg:col-span-2">
              <ProviderReadinessTable practiceId={practiceId} />
            </div>
          </div>
        </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}
