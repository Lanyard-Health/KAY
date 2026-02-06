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
import clsx from 'clsx';
import { format, differenceInDays } from 'date-fns';

export default function Dashboard() {
  // Fetch all dashboard data
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-full'],
    queryFn: async () => {
      const [providersRes, expirationsRes, enrollmentsRes] = await Promise.all([
        api.get('/providers?pageSize=100'),
        api.get('/expirations?days=30'),
        api.get('/enrollments'),
      ]);

      const providers = providersRes.data.data.data || [];
      const expirations = expirationsRes.data.data || {};
      const enrollments = enrollmentsRes.data.data || [];

      // Calculate provider stats
      const pendingProviders = providers.filter((p: any) => p.status === 'pending');
      const activeProviders = providers.filter((p: any) => p.status === 'active');

      // Find incomplete providers (no documents)
      const incompleteProviders = providers.filter((p: any) =>
        (p._count?.documents || 0) === 0
      );

      // Find enrollments needing follow-up (last follow-up > 7 days ago or no follow-up)
      const needsFollowUp = enrollments.filter((e: any) => {
        if (e.status === 'approved' || e.status === 'terminated') return false;
        if (!e.lastFollowUpDate) return true;
        return differenceInDays(new Date(), new Date(e.lastFollowUpDate)) > 7;
      });

      // Collect all expiring items
      const expiringItems = [
        ...(expirations.licenses || []).map((l: any) => ({ ...l, type: 'License', providerName: `Provider ${l.providerId}` })),
        ...(expirations.certifications || []).map((c: any) => ({ ...c, type: 'Certification', providerName: `Provider ${c.providerId}` })),
        ...(expirations.insurances || []).map((i: any) => ({ ...i, type: 'Insurance', providerName: `Provider ${i.providerId}` })),
        ...(expirations.documents || []).map((d: any) => ({ ...d, type: 'Document', providerName: `Provider ${d.providerId}` })),
      ].sort((a, b) => new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime());

      return {
        totalProviders: providers.length,
        activeProviders: activeProviders.length,
        pendingProviders: pendingProviders.length,
        incompleteProviders,
        expiringItems,
        needsFollowUp,
        enrollments,
        providers,
      };
    },
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
    (data?.incompleteProviders?.length || 0) +
    (data?.expiringItems?.length || 0) +
    (data?.needsFollowUp?.length || 0);

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
              {(data?.incompleteProviders?.length ?? 0) > 0 && (
                <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-0.5 rounded-full">
                  {data?.incompleteProviders?.length}
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
                          <p className="text-sm text-gray-500">No documents uploaded</p>
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
            ) : data?.expiringItems?.length === 0 ? (
              <div className="text-center py-6">
                <CheckCircleIcon className="h-12 w-12 text-green-400 mx-auto" />
                <p className="mt-2 text-sm text-gray-500">Nothing expiring in the next 30 days!</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {data?.expiringItems?.slice(0, 5).map((item: any, index: number) => {
                  const daysUntil = differenceInDays(new Date(item.expirationDate), new Date());
                  const isUrgent = daysUntil <= 7;
                  return (
                    <li key={index}>
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
                            <p className="font-medium text-gray-900">{item.type}</p>
                            <p className="text-sm text-gray-500">
                              {item.licenseNumber || item.policyNumber || item.originalFileName || 'Document'}
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
            )}
          </div>
        </div>

        {/* Enrollments Needing Follow-up */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardDocumentListIcon className="h-5 w-5 text-primary-500" />
              <h3 className="font-semibold text-gray-900">Enrollments - Follow Up Needed</h3>
              {(data?.needsFollowUp?.length ?? 0) > 0 && (
                <span className="bg-primary-100 text-primary-800 text-xs font-medium px-2 py-0.5 rounded-full">
                  {data?.needsFollowUp?.length}
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
                      to="/enrollments"
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100/80 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center">
                          <ClipboardDocumentListIcon className="h-5 w-5 text-primary-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {enrollment.payer?.displayName || 'Unknown Payer'}
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

        {/* Getting Started Guide */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Getting Started</h3>
          </div>
          <div className="p-5">
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-semibold text-sm">
                  1
                </div>
                <div>
                  <p className="font-medium text-gray-900">Add a Provider</p>
                  <p className="text-sm text-gray-500">Enter provider information and NPI</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-semibold text-sm">
                  2
                </div>
                <div>
                  <p className="font-medium text-gray-900">Upload Documents</p>
                  <p className="text-sm text-gray-500">W-9, COI, licenses, and certifications</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-semibold text-sm">
                  3
                </div>
                <div>
                  <p className="font-medium text-gray-900">Start Enrollments</p>
                  <p className="text-sm text-gray-500">Enroll providers with insurance payers</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-semibold text-sm">
                  4
                </div>
                <div>
                  <p className="font-medium text-gray-900">Track & Monitor</p>
                  <p className="text-sm text-gray-500">Monitor expirations and follow up on enrollments</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
