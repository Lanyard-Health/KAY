import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import PageTransition from '../../components/ui/PageTransition';
import EmptyState from '../../components/ui/EmptyState';
import clsx from 'clsx';
import { api } from '../../services/api';

type Stage = 'registered' | 'profileComplete' | 'active';

interface PipelinePractice {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  providerCount: number;
  enrollmentCount: number;
}

interface PipelineData {
  registered: PipelinePractice[];
  profileComplete: PipelinePractice[];
  active: PipelinePractice[];
}

const tabs: { key: Stage; label: string; description: string }[] = [
  { key: 'registered', label: 'Registered', description: 'Signed up, no providers yet' },
  { key: 'profileComplete', label: 'Profile Complete', description: 'Has providers, no enrollments' },
  { key: 'active', label: 'First Enrollment', description: 'At least 1 enrollment submitted' },
];

export default function PracticeOnboarding() {
  const [activeTab, setActiveTab] = useState<Stage>('registered');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'practice-onboarding-pipeline'],
    queryFn: async () => {
      const res = await api.get('/practices/onboarding-pipeline');
      return (res.data as any).data as PipelineData;
    },
  });

  const counts = {
    registered: data?.registered.length ?? 0,
    profileComplete: data?.profileComplete.length ?? 0,
    active: data?.active.length ?? 0,
  };

  const practices = data?.[activeTab] ?? [];

  return (
    <PageTransition>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Practice Onboarding</h1>
          <p className="mt-1 text-sm text-gray-500">
            Track practice progression from signup through first enrollment
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {tabs.map((tab) => (
            <div
              key={tab.key}
              className={clsx(
                'rounded-lg p-4 cursor-pointer transition-colors',
                activeTab === tab.key
                  ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200'
                  : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
              )}
              onClick={() => setActiveTab(tab.key)}
            >
              <p className="text-sm font-medium">{tab.label}</p>
              <p className="text-2xl font-bold mt-1">{isLoading ? '--' : counts[tab.key]}</p>
              <p className="text-xs mt-1 opacity-70">{tab.description}</p>
            </div>
          ))}
        </div>

        {/* Tab Bar */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={clsx(
                  'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm',
                  activeTab === tab.key
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )}
              >
                {tab.label}
                <span className="ml-2 bg-gray-100 text-gray-600 py-0.5 px-2 rounded-full text-xs">
                  {isLoading ? '...' : counts[tab.key]}
                </span>
              </button>
            ))}
          </nav>
        </div>

        {/* Practice Table */}
        {isLoading ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden animate-pulse">
            <div className="bg-gray-50 px-6 py-3 flex gap-8">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-3 w-24 bg-gray-200 rounded" />
              ))}
            </div>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="px-6 py-4 flex gap-8 border-t border-gray-100">
                <div className="h-4 w-40 bg-gray-200 rounded" />
                <div className="h-4 w-48 bg-gray-200 rounded" />
                <div className="h-4 w-24 bg-gray-200 rounded" />
                <div className="h-4 w-16 bg-gray-200 rounded" />
                <div className="h-4 w-16 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        ) : practices.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 py-12">
            <EmptyState
              illustration="people"
              title="No practices in this stage"
              description="Practices will appear here as they progress through onboarding."
            />
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50/80">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Practice</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contact Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Signup Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Providers</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enrollments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {practices.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{p.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{p.email || '--'}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{p.providerCount}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{p.enrollmentCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageTransition>
  );
}
