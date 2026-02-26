import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  UserIcon,
  DocumentDuplicateIcon,
  ShieldCheckIcon,
  MapPinIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { useCurrentProvider, useProfileCompleteness } from './hooks/usePortalData';
import OnboardingWizard from './OnboardingWizard';

interface SmartPrompt {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  bgColor: string;
  iconColor: string;
  borderColor: string;
}

function getSmartPrompts(sections: Array<{ name: string; complete: boolean }>): SmartPrompt[] {
  const prompts: SmartPrompt[] = [];
  const incomplete = sections.filter(s => !s.complete);
  for (const section of incomplete) {
    const n = section.name.toLowerCase();
    if (n.includes('personal') || n.includes('npi') || n.includes('specialt') || n.includes('date') || n.includes('provider type')) {
      if (!prompts.find(p => p.href === '/portal/profile')) {
        prompts.push({
          icon: UserIcon,
          title: 'Complete your profile',
          description: 'Payers require a complete provider profile before processing any enrollments.',
          href: '/portal/profile',
          actionLabel: 'Update profile',
          bgColor: 'bg-primary-50',
          iconColor: 'text-primary-600',
          borderColor: 'group-hover:border-primary-200',
        });
      }
    } else if (n.includes('document')) {
      prompts.push({
        icon: DocumentDuplicateIcon,
        title: 'Upload required documents',
        description: 'Malpractice insurance, DEA certificate, and board certs speed up approvals.',
        href: '/portal/documents',
        actionLabel: 'Upload documents',
        bgColor: 'bg-blue-50',
        iconColor: 'text-blue-600',
        borderColor: 'group-hover:border-blue-200',
      });
    } else if (n.includes('license')) {
      prompts.push({
        icon: ShieldCheckIcon,
        title: 'Add your state licenses',
        description: 'Each state you practice in requires a verified license on file.',
        href: '/portal/licenses',
        actionLabel: 'Add license',
        bgColor: 'bg-violet-50',
        iconColor: 'text-violet-600',
        borderColor: 'group-hover:border-violet-200',
      });
    } else if (n.includes('location')) {
      prompts.push({
        icon: MapPinIcon,
        title: 'Add a practice location',
        description: 'Payers need at least one service location for network directory listings.',
        href: '/portal/locations',
        actionLabel: 'Add location',
        bgColor: 'bg-amber-50',
        iconColor: 'text-amber-600',
        borderColor: 'group-hover:border-amber-200',
      });
    }
  }
  return prompts;
}

const formatStatus = (status: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: 'Active', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    pending_verification: { label: 'Pending', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
    inactive: { label: 'Inactive', cls: 'text-gray-600 bg-gray-50 border-gray-200' },
    suspended: { label: 'Suspended', cls: 'text-red-700 bg-red-50 border-red-200' },
  };
  const s = map[status] || { label: status, cls: 'text-gray-600 bg-gray-50 border-gray-200' };
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
};

const enrollmentStatusCls = (status: string) => {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (['pending_review', 'submitted'].includes(status)) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'denied') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-gray-50 text-gray-600 border-gray-200';
};

export default function PortalDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isWelcome = searchParams.get('welcome') === 'true';
  const [animatedPct, setAnimatedPct] = useState(0);

  const { data: providerData, isLoading, error } = useCurrentProvider();
  const completeness = useProfileCompleteness();

  const targetPct = (completeness as any)?.data?.data?.percentage ?? (completeness as any)?.data?.percentage ?? 0;

  useEffect(() => {
    if (targetPct === 0) return;
    const duration = 1200;
    const startTime = performance.now();
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedPct(Math.round(eased * targetPct));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [targetPct]);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-32 bg-gray-200 rounded animate-pulse mt-2" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl border border-gray-200/60 p-6 animate-pulse">
            <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
            <div className="h-32 w-32 mx-auto bg-gray-200 rounded-full" />
          </div>
          <div className="bg-white rounded-2xl border border-gray-200/60 p-6 lg:col-span-2 animate-pulse">
            <div className="h-5 w-32 bg-gray-200 rounded mb-4" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-gray-100 rounded-lg" />)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
          <svg className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <h3 className="text-sm font-medium text-red-800">Failed to load dashboard</h3>
            <p className="text-sm text-red-600 mt-1">Please try refreshing the page.</p>
          </div>
        </div>
      </div>
    );
  }

  const provider = (providerData as any)?.data?.provider;

  // Show onboarding wizard if onboarding is not complete
  if (provider && !provider.onboardingCompletedAt) {
    return <OnboardingWizard />;
  }

  const sections = (completeness as any)?.data?.data?.sections ?? (completeness as any)?.data?.sections ?? [];
  const prompts = getSmartPrompts(sections);

  return (
    <div className="max-w-7xl mx-auto">
      <style>{`
        @keyframes portalFadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes donutFill {
          from { stroke-dasharray: 0, 100; }
        }
        @keyframes donutGlow {
          0%, 100% { filter: drop-shadow(0 0 4px rgba(16, 185, 129, 0.3)); }
          50% { filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.5)); }
        }
        .portal-fade { animation: portalFadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .portal-fade-d1 { animation: portalFadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.08s both; }
        .portal-fade-d2 { animation: portalFadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.16s both; }
        .portal-fade-d3 { animation: portalFadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.24s both; }
        .portal-fade-d4 { animation: portalFadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.32s both; }
        .donut-ring { animation: donutGlow 4s ease-in-out infinite; }
      `}</style>

      {/* Welcome Banner for new signups */}
      {isWelcome ? (
        <div className="mb-8 relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-700 via-primary-600 to-emerald-500 p-8 portal-fade">
          {/* Floating orbs */}
          <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-white/[0.06] blur-2xl -translate-y-1/2 translate-x-1/4" />
          <div className="absolute bottom-0 left-[20%] w-32 h-32 rounded-full bg-emerald-300/[0.08] blur-xl translate-y-1/2" />
          <div className="relative z-10">
            <h1 className="text-2xl font-bold text-white">Welcome to Lanyard Health, {provider?.firstName}!</h1>
            <p className="text-sm text-white/70 mt-1.5 max-w-lg">Your provider account is ready. Complete your credentialing profile below — most providers finish in under 10 minutes.</p>
            <button
              onClick={() => {
                searchParams.delete('welcome');
                setSearchParams(searchParams, { replace: true });
              }}
              className="mt-4 text-xs text-white/40 hover:text-white/70 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-8 portal-fade">
          <h1 className="text-2xl font-bold text-gray-900">Welcome back, {provider?.firstName}</h1>
          <p className="mt-1 text-sm text-gray-400">NPI: {provider?.npi}</p>
        </div>
      )}

      {/* Pending verification banner */}
      {provider?.status === 'pending_verification' && (
        <div className="mb-6 rounded-2xl border border-amber-200/60 bg-amber-50 p-5 flex items-start gap-3 portal-fade-d1">
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-amber-800">Account verification in progress</h3>
            <p className="text-sm text-amber-700/80 mt-0.5">You can start setting up your profile. Enrollment features unlock after verification.</p>
          </div>
        </div>
      )}

      {/* Main 2-column grid: Donut + Smart Prompts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 portal-fade-d1">
        {/* Profile Completeness Donut */}
        <div className="bg-white rounded-2xl border border-gray-200/60 p-6">
          <h2 className="text-[11px] font-semibold text-gray-900 mb-5 uppercase tracking-wider">Profile Completeness</h2>
          <div className="flex items-center justify-center mb-4">
            <div className="relative w-36 h-36">
              <svg className="w-36 h-36 transform -rotate-90 donut-ring" viewBox="0 0 36 36">
                <defs>
                  <linearGradient id="donutGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#10b981" />
                    <stop offset="100%" stopColor="#34d399" />
                  </linearGradient>
                </defs>
                <path
                  d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="#f3f4f6"
                  strokeWidth="2.5"
                />
                <path
                  d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="url(#donutGrad)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={`${animatedPct}, 100`}
                  style={{ transition: 'stroke-dasharray 0.1s ease-out' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-gray-900 tabular-nums">{animatedPct}%</span>
                <span className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">Complete</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-400 text-center">
            {(completeness as any)?.data?.data?.completedCount ?? (completeness as any)?.data?.completedCount ?? 0} of{' '}
            {(completeness as any)?.data?.data?.totalCount ?? (completeness as any)?.data?.totalCount ?? 0} sections
          </p>
        </div>

        {/* Smart Prompts / Next Steps */}
        <div className="bg-white rounded-2xl border border-gray-200/60 p-6 lg:col-span-2">
          <h2 className="text-[11px] font-semibold text-gray-900 mb-4 uppercase tracking-wider">Next Steps</h2>
          {prompts.length > 0 ? (
            <div className="space-y-2.5">
              {prompts.map((prompt) => (
                <Link
                  key={prompt.href}
                  to={prompt.href}
                  className={`flex items-center gap-4 p-4 rounded-xl border border-gray-100 ${prompt.borderColor} hover:shadow-sm transition-all duration-200 group`}
                >
                  <div className={`w-10 h-10 rounded-xl ${prompt.bgColor} flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105`}>
                    <prompt.icon className={`w-5 h-5 ${prompt.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 group-hover:text-gray-700">{prompt.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{prompt.description}</p>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all duration-200 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center py-10 text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-3">
                <CheckCircleIcon className="w-7 h-7 text-emerald-500" />
              </div>
              <p className="text-sm font-semibold text-gray-900">All set!</p>
              <p className="text-xs text-gray-400 mt-1">Your credentialing profile is complete.</p>
            </div>
          )}
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 portal-fade-d2">
        <div className="bg-white rounded-2xl border border-gray-200/60 p-6 hover:border-gray-300/80 transition-colors duration-200">
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

        <div className="bg-white rounded-2xl border border-gray-200/60 p-6 hover:border-gray-300/80 transition-colors duration-200">
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

        <div className="bg-white rounded-2xl border border-gray-200/60 p-6 hover:border-gray-300/80 transition-colors duration-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="mb-0.5">{formatStatus(provider?.status ?? 'unknown')}</div>
              <p className="text-sm text-gray-500">Provider Status</p>
            </div>
          </div>
        </div>
      </div>

      {/* Enrollment Status Table */}
      {provider?.enrollments && provider.enrollments.length > 0 && (
        <div className="mt-6 bg-white rounded-2xl border border-gray-200/60 portal-fade-d3">
          <div className="px-6 py-4 border-b border-gray-200/60">
            <h2 className="text-[11px] font-semibold text-gray-900 uppercase tracking-wider">Enrollment Status</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {provider.enrollments.map((enrollment: any) => (
              <div key={enrollment.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{enrollment.payer.name}</p>
                  <p className="text-xs text-gray-400">{enrollment.payer.payerType}</p>
                </div>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${enrollmentStatusCls(enrollment.status)}`}>
                  {enrollment.status.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
