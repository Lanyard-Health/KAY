import { Link } from 'react-router-dom';
import { useCurrentProvider, useProfileCompleteness } from './hooks/usePortalData';
import OnboardingWizard from './OnboardingWizard';

export default function PortalDashboard() {
  const { data: providerData, isLoading, error } = useCurrentProvider();
  const { data: completeness } = useProfileCompleteness();

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-sm text-red-600">
            {error instanceof Error ? error.message : 'Failed to load dashboard'}
          </p>
        </div>
      </div>
    );
  }

  const provider = (providerData as any)?.data?.provider;

  // Show onboarding wizard if onboarding is not complete
  if (provider && !provider.onboardingCompletedAt) {
    return <OnboardingWizard />;
  }

  const sections = (completeness as any)?.data?.sections ?? [];
  const percentage = (completeness as any)?.data?.percentage ?? 0;
  const incompleteSections = sections.filter((s: any) => !s.complete);

  return (
    <div className="max-w-7xl mx-auto">
      {/* Welcome Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome, {provider?.firstName} {provider?.lastName}
        </h1>
        <p className="mt-1 text-sm text-gray-500">NPI: {provider?.npi}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Completeness Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Profile Completeness</h2>
          <div className="flex items-center justify-center mb-4">
            <div className="relative w-32 h-32">
              <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-gray-200"
                  d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <path
                  className="text-primary-500"
                  d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray={`${percentage}, 100`}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-gray-900">{percentage}%</span>
              </div>
            </div>
          </div>
          <p className="text-sm text-gray-500 text-center">
            {(completeness as any)?.data?.completedCount} of {(completeness as any)?.data?.totalCount} sections complete
          </p>
        </div>

        {/* Action Items */}
        <div className="bg-white rounded-lg shadow p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Action Items</h2>
          {incompleteSections.length === 0 ? (
            <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-green-800">Your profile is complete!</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {incompleteSections.map((section: any) => {
                const linkMap: Record<string, { href: string; action: string }> = {
                  'Personal Info': { href: '/portal/profile', action: 'Update your personal information' },
                  'NPI': { href: '/portal/profile', action: 'Verify your NPI number' },
                  'Specialties': { href: '/portal/profile', action: 'Add your specialties' },
                  'Date of Birth': { href: '/portal/profile', action: 'Add your date of birth' },
                  'Provider Type': { href: '/portal/profile', action: 'Set your provider type' },
                  'Practice Locations': { href: '/portal/locations', action: 'Add a practice location' },
                };
                const link = linkMap[section.name] || { href: '/portal/profile', action: `Complete ${section.name}` };

                return (
                  <li key={section.name}>
                    <Link
                      to={link.href}
                      className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      <svg className="w-5 h-5 text-yellow-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{link.action}</p>
                        <p className="text-xs text-gray-500">{section.name} - Incomplete</p>
                      </div>
                      <svg className="w-5 h-5 text-gray-400 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{(providerData as any)?.data?.enrollmentCount ?? 0}</p>
              <p className="text-sm text-gray-500">Enrollments</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{(providerData as any)?.data?.locationCount ?? 0}</p>
              <p className="text-sm text-gray-500">Practice Locations</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{provider?.status ?? '—'}</p>
              <p className="text-sm text-gray-500">Provider Status</p>
            </div>
          </div>
        </div>
      </div>

      {/* Enrollments */}
      {provider?.enrollments && provider.enrollments.length > 0 && (
        <div className="mt-6 bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Enrollment Status</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {provider.enrollments.map((enrollment: any) => (
              <div key={enrollment.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{enrollment.payer.name}</p>
                  <p className="text-xs text-gray-500">{enrollment.payer.payerType}</p>
                </div>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    enrollment.status === 'approved'
                      ? 'bg-green-100 text-green-800'
                      : enrollment.status === 'pending_review' || enrollment.status === 'submitted'
                      ? 'bg-yellow-100 text-yellow-800'
                      : enrollment.status === 'denied'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {enrollment.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
