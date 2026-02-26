import { Link } from 'react-router-dom';
import clsx from 'clsx';
import PageTransition from '../../components/ui/PageTransition';
import {
  BuildingOffice2Icon,
  UserGroupIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  InboxStackIcon,
  CheckCircleIcon,
  ClockIcon,
  ShieldExclamationIcon,
} from '@heroicons/react/24/outline';
import {
  useOpsDashboard,
  useMyWorkItems,
  useOpsStaff,
  type OpsStaffMember,
} from '../../hooks/useOps';
import EmptyState from '../../components/ui/EmptyState';

// ── Helpers ────────────────────────────────────────

const priorityStyles: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high: 'bg-amber-100 text-amber-700',
  medium: 'bg-blue-100 text-blue-700',
  low: 'bg-gray-100 text-gray-600',
};

const statusStyles: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  blocked: 'bg-red-100 text-red-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

function formatDate(iso: string | null): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Skeleton Pulse ─────────────────────────────────

function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={clsx('animate-pulse bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6', className)}>
      <div className="h-3 w-20 bg-gray-200 rounded mb-3" />
      <div className="h-8 w-16 bg-gray-200 rounded" />
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="animate-pulse flex items-center gap-4 py-3">
      <div className="h-4 w-40 bg-gray-100 rounded" />
      <div className="h-4 w-20 bg-gray-100 rounded" />
      <div className="h-4 w-16 bg-gray-100 rounded" />
      <div className="h-4 w-16 bg-gray-100 rounded" />
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  alert?: boolean;
}

function StatCard({ label, value, icon, alert }: StatCardProps) {
  return (
    <div
      className={clsx(
        'bg-white rounded-2xl shadow-sm border p-5 flex items-start justify-between',
        alert ? 'border-red-300 bg-red-50/40' : 'border-gray-200/60',
      )}
    >
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <p className={clsx('mt-1 text-2xl font-semibold', alert ? 'text-red-600' : 'text-gray-900')}>
          {value}
        </p>
      </div>
      <div className={clsx('p-2 rounded-xl', alert ? 'bg-red-100 text-red-500' : 'bg-primary-50 text-primary-600')}>
        {icon}
      </div>
    </div>
  );
}

// ── Staff Workload Bar ─────────────────────────────

function StaffBar({ member, maxItems }: { member: OpsStaffMember; maxItems: number }) {
  const pct = maxItems > 0 ? Math.round((member.openItems / maxItems) * 100) : 0;

  return (
    <div className="flex items-center gap-3 py-2">
      {/* Avatar */}
      <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary-600 text-white text-[11px] font-semibold flex items-center justify-center">
        {member.firstName[0]}
        {member.lastName[0]}
      </div>

      {/* Name */}
      <span className="w-28 truncate text-sm text-gray-700 font-medium">
        {member.firstName} {member.lastName}
      </span>

      {/* Bar */}
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.max(pct, 3)}%` }}
        />
      </div>

      {/* Counts */}
      <span className="text-sm font-medium text-gray-700 w-8 text-right">{member.openItems}</span>
      {member.overdueItems > 0 && (
        <span className="text-xs font-medium text-red-600 w-12 text-right">
          {member.overdueItems} late
        </span>
      )}
      {member.overdueItems === 0 && <span className="w-12" />}
    </div>
  );
}

// ── Main Component ─────────────────────────────────

export default function OpsDashboard() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useOpsDashboard();
  const { data: myWork, isLoading: myWorkLoading } = useMyWorkItems();
  const { data: staff, isLoading: staffLoading } = useOpsStaff();

  // Error state
  if (statsError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Ops Dashboard</h1>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700">
          <p className="font-medium">Failed to load dashboard data</p>
          <p className="text-sm mt-1">Please check your connection and try again.</p>
        </div>
      </div>
    );
  }

  const sla = stats?.slaHealth;
  const myItems = myWork?.items ?? [];
  const displayItems = myItems.slice(0, 10);
  const staffList = staff ?? [];
  const maxOpenItems = staffList.length > 0 ? Math.max(...staffList.map((s) => s.openItems), 1) : 1;

  return (
    <PageTransition>
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ops Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Operational overview across all practices and staff.
        </p>
      </div>

      {/* Row 1: Stat Cards */}
      {statsLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard
            label="Total Practices"
            value={stats?.totalPractices ?? 0}
            icon={<BuildingOffice2Icon className="h-5 w-5" />}
          />
          <StatCard
            label="Total Providers"
            value={stats?.totalProviders ?? 0}
            icon={<UserGroupIcon className="h-5 w-5" />}
          />
          <StatCard
            label="Active Enrollments"
            value={stats?.totalEnrollments ?? 0}
            icon={<ClipboardDocumentListIcon className="h-5 w-5" />}
          />
          <StatCard
            label="SLA Breaches"
            value={sla?.breached ?? 0}
            icon={<ExclamationTriangleIcon className="h-5 w-5" />}
            alert={(sla?.breached ?? 0) > 0}
          />
          <StatCard
            label="Open Work Items"
            value={stats?.workItems.total ?? 0}
            icon={<InboxStackIcon className="h-5 w-5" />}
          />
        </div>
      )}

      {/* Row 2: Staff Workload + My Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Staff Workload */}
        <div className="lg:col-span-5 bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Staff Workload</h3>
          {staffLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : staffList.length === 0 ? (
            <EmptyState
              illustration="clipboard"
              title="No staff members yet"
              description="Staff accounts will appear here once team members are added."
              className="py-10"
            />
          ) : (
            <div className="space-y-1">
              {staffList.map((m) => (
                <StaffBar key={m.id} member={m} maxItems={maxOpenItems} />
              ))}
            </div>
          )}
        </div>

        {/* My Queue */}
        <div className="lg:col-span-7 bg-white rounded-2xl shadow-sm border border-gray-200/60">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">My Queue</h3>
            {myItems.length > 10 && (
              <Link to="/ops/work-queue" className="text-xs text-primary-600 hover:text-primary-700 font-medium">
                View all {myItems.length}
              </Link>
            )}
          </div>

          {myWorkLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : displayItems.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircleIcon className="h-10 w-10 text-green-400 mx-auto" />
              <p className="mt-2 text-sm text-gray-400">Your queue is empty.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    <th className="px-6 py-3">Title</th>
                    <th className="px-4 py-3">Practice</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Due</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {displayItems.map((item) => (
                    <tr key={item.id} className="group">
                      <td className="px-6 py-3">
                        <Link
                          to={`/ops/work-queue/${item.id}`}
                          className="text-gray-800 font-medium group-hover:text-primary-600 transition-colors"
                        >
                          {item.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-500 truncate max-w-[140px]">
                        {item.practice?.name ?? '\u2014'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={clsx(
                            'inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                            priorityStyles[item.priority] ?? 'bg-gray-100 text-gray-600',
                          )}
                        >
                          {item.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(item.dueDate)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={clsx(
                            'inline-block px-2 py-0.5 rounded-full text-xs font-medium',
                            statusStyles[item.status] ?? 'bg-gray-100 text-gray-600',
                          )}
                        >
                          {item.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Row 3: SLA Health */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
        <div className="flex items-center gap-2 mb-6">
          <ShieldExclamationIcon className="h-5 w-5 text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-900">SLA Health</h3>
        </div>

        {statsLoading ? (
          <div className="animate-pulse flex gap-8">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 w-40 bg-gray-100 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {/* On Track */}
            <div className="flex flex-col items-center rounded-xl bg-green-50/60 border border-green-200/50 p-5">
              <CheckCircleIcon className="h-6 w-6 text-green-500 mb-2" />
              <span className="text-3xl font-bold text-green-700">{sla?.onTrack ?? 0}</span>
              <span className="text-xs font-medium text-green-600 mt-1 uppercase tracking-wide">On Track</span>
            </div>

            {/* At Risk */}
            <div className="flex flex-col items-center rounded-xl bg-amber-50/60 border border-amber-200/50 p-5">
              <ClockIcon className="h-6 w-6 text-amber-500 mb-2" />
              <span className="text-3xl font-bold text-amber-700">{sla?.atRisk ?? 0}</span>
              <span className="text-xs font-medium text-amber-600 mt-1 uppercase tracking-wide">At Risk</span>
            </div>

            {/* Breached */}
            <div className="flex flex-col items-center rounded-xl bg-red-50/60 border border-red-200/50 p-5">
              <ExclamationTriangleIcon className="h-6 w-6 text-red-500 mb-2" />
              <span className="text-3xl font-bold text-red-700">{sla?.breached ?? 0}</span>
              <span className="text-xs font-medium text-red-600 mt-1 uppercase tracking-wide">Breached</span>
            </div>
          </div>
        )}
      </div>
    </div>
    </PageTransition>
  );
}
