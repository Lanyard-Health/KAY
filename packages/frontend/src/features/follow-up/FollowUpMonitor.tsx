import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowPathIcon,
  ClockIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  PauseIcon,
  PlayIcon,
  PhoneIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import StatCard from '../../components/ui/StatCard';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import PageTransition from '../../components/ui/PageTransition';
import {
  useFollowUpRuns,
  useFollowUpStats,
  usePauseResumeRun,
  useTriggerFollowUps,
  computeNextActionDate,
} from '../../hooks/useFollowUpMonitor';
import type { FollowUpRunItem, FollowUpMonitorFilters } from '../../hooks/useFollowUpMonitor';

// ===========================
// Status config
// ===========================

const statusTabs = [
  { key: undefined, label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

const statusVariantMap: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success',
  paused: 'warning',
  completed: 'neutral',
  cancelled: 'danger',
};

// ===========================
// Skeleton components
// ===========================

function SkeletonStatCards() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="stat-card animate-pulse">
          <div className="h-3 bg-gray-200 rounded w-20 mb-3" />
          <div className="h-7 bg-gray-200 rounded w-12" />
        </div>
      ))}
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="animate-pulse">
        <div className="h-12 bg-gray-50 border-b border-gray-200" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-gray-100">
            <div className="h-4 bg-gray-200 rounded w-32" />
            <div className="h-4 bg-gray-200 rounded w-24" />
            <div className="h-4 bg-gray-200 rounded w-16" />
            <div className="h-4 bg-gray-200 rounded w-12" />
            <div className="h-4 bg-gray-200 rounded w-20" />
            <div className="h-5 bg-gray-200 rounded-full w-16" />
            <div className="h-8 bg-gray-200 rounded w-20 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================
// Row component
// ===========================

function RunRow({ run }: { run: FollowUpRunItem }) {
  const navigate = useNavigate();
  const pauseResume = usePauseResumeRun();

  const nextAction = useMemo(() => {
    const date = computeNextActionDate(run);
    if (!date) return '—';
    const now = new Date();
    const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return 'Overdue';
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return `${diff} days`;
  }, [run]);

  const currentStep = run.template?.steps?.find(
    (s) => s.stepOrder === run.currentStepOrder
  );

  const handlePauseResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    pauseResume.mutate({
      runId: run.id,
      status: run.status === 'active' ? 'paused' : 'active',
    });
  };

  return (
    <tr
      className="hover:bg-gray-50 cursor-pointer transition-colors"
      onClick={() => navigate(`/enrollments/${run.enrollmentId}`)}
    >
      <td className="px-6 py-4 whitespace-nowrap">
        <p className="text-sm font-medium text-gray-900">
          {run.enrollment.provider.firstName} {run.enrollment.provider.lastName}
        </p>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
        {run.enrollment.payer.name}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        {currentStep?.channel === 'phone_call' ? (
          <PhoneIcon className="h-4 w-4 text-blue-500" />
        ) : (
          <EnvelopeIcon className="h-4 w-4 text-primary-500" />
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
        {run.currentStepOrder} / {run.template?.steps?.length || '?'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className={clsx(
          'text-sm font-medium',
          nextAction === 'Overdue' ? 'text-red-600' : nextAction === 'Today' ? 'text-amber-600' : 'text-gray-600'
        )}>
          {nextAction}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <StatusBadge
          label={run.status}
          variant={statusVariantMap[run.status] || 'neutral'}
          dot
        />
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        {(run.status === 'active' || run.status === 'paused') && (
          <button
            onClick={handlePauseResume}
            disabled={pauseResume.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {run.status === 'active' ? (
              <>
                <PauseIcon className="h-3.5 w-3.5" />
                Pause
              </>
            ) : (
              <>
                <PlayIcon className="h-3.5 w-3.5" />
                Resume
              </>
            )}
          </button>
        )}
      </td>
    </tr>
  );
}

// ===========================
// Main component
// ===========================

export default function FollowUpMonitor() {
  const [filters, setFilters] = useState<FollowUpMonitorFilters>({});
  const [selectedTab, setSelectedTab] = useState(0);
  const [searchInput, setSearchInput] = useState('');

  const { data: runs, isLoading } = useFollowUpRuns(filters);
  const stats = useFollowUpStats(runs);
  const triggerFollowUps = useTriggerFollowUps();

  const handleTabChange = (index: number) => {
    setSelectedTab(index);
    setFilters((f) => ({ ...f, status: statusTabs[index].key }));
  };

  const handleSearch = (value: string) => {
    setSearchInput(value);
    // Debounce by updating filters after brief delay
    const trimmed = value.trim();
    setFilters((f) => ({ ...f, search: trimmed || undefined }));
  };

  return (
    <PageTransition>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Follow-Up Monitor</h1>
            <p className="mt-1 text-sm text-gray-500">
              Track and manage automated follow-up sequences across all enrollments
            </p>
          </div>
          <button
            onClick={() => triggerFollowUps.mutate()}
            disabled={triggerFollowUps.isPending}
            className="btn-primary inline-flex items-center gap-2 text-sm"
          >
            <BoltIcon className="h-4 w-4" />
            {triggerFollowUps.isPending ? 'Running...' : 'Run Follow-Ups'}
          </button>
        </div>

        {/* Stats */}
        {isLoading ? (
          <SkeletonStatCards />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Active Runs"
              value={stats.active}
              icon={<ArrowPathIcon className="h-5 w-5" />}
            />
            <StatCard
              label="Due Today"
              value={stats.dueToday}
              icon={<ClockIcon className="h-5 w-5" />}
              className={stats.dueToday > 0 ? 'ring-1 ring-amber-200' : ''}
            />
            <StatCard
              label="Sent This Week"
              value={stats.sentThisWeek}
              icon={<EnvelopeIcon className="h-5 w-5" />}
            />
            <StatCard
              label="Failed"
              value={stats.failed}
              icon={<ExclamationTriangleIcon className="h-5 w-5" />}
              className={stats.failed > 0 ? 'ring-1 ring-red-200' : ''}
            />
          </div>
        )}

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <input
            type="text"
            placeholder="Search by provider name..."
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
            className="input-field w-full sm:w-64"
          />
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {statusTabs.map((tab, index) => (
              <button
                key={tab.label}
                onClick={() => handleTabChange(index)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                  selectedTab === index
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <SkeletonTable />
        ) : !runs?.length ? (
          <EmptyState
            illustration="inbox"
            title="No follow-up runs yet"
            description="Follow-up runs will appear here when enrollment follow-up sequences are started."
          />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm"
          >
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr className="bg-gray-50/80">
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Provider
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Payer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Channel
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Step
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Next Action
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {runs.map((run) => (
                    <RunRow key={run.id} run={run} />
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </div>
    </PageTransition>
  );
}
