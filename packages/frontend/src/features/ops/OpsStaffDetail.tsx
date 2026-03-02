import { useParams, Link } from 'react-router-dom';
import clsx from 'clsx';
import PageTransition from '../../components/ui/PageTransition';
import {
  ArrowLeftIcon,
  InboxStackIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { useOpsStaffWorkload, useOpsWorkQueue, type OpsWorkItem } from '../../hooks/useOps';

function StatCard({ icon, label, value, alert }: { icon: React.ReactNode; label: string; value: string | number; alert?: boolean }) {
  return (
    <div className={clsx('rounded-2xl border p-5', alert ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200/60 shadow-sm')}>
      <div className="flex items-center gap-3">
        <span className={clsx('h-9 w-9 rounded-xl flex items-center justify-center', alert ? 'bg-red-100 text-red-500' : 'bg-primary-50 text-primary-600')}>
          {icon}
        </span>
        <div>
          <p className={clsx('text-xl font-bold', alert ? 'text-red-700' : 'text-gray-900')}>{value}</p>
          <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
        </div>
      </div>
    </div>
  );
}

function WorkItemRow({ item }: { item: OpsWorkItem }) {
  const statusColor: Record<string, string> = {
    open: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-amber-100 text-amber-700',
    completed: 'bg-green-100 text-green-700',
    blocked: 'bg-red-100 text-red-700',
  };

  return (
    <Link
      to={`/ops/work-queue/${item.id}`}
      className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0"
    >
      <span className={clsx('text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full', statusColor[item.status] || 'bg-gray-100 text-gray-600')}>
        {item.status.replace(/_/g, ' ')}
      </span>
      <span className="text-sm text-gray-900 font-medium flex-1 truncate">{item.title}</span>
      {item.priority && (
        <span className={clsx(
          'text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full',
          item.priority === 'urgent' ? 'bg-red-100 text-red-600' : item.priority === 'high' ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-500',
        )}>
          {item.priority}
        </span>
      )}
    </Link>
  );
}

export default function OpsStaffDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: member, isLoading, error } = useOpsStaffWorkload(id!);
  const { data: workQueue } = useOpsWorkQueue({ assigneeId: id, status: ['open', 'in_progress'] });

  if (isLoading) {
    return (
      <PageTransition>
        <div className="space-y-6 animate-pulse">
          <div className="h-8 w-48 bg-gray-200 rounded" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-2xl" />)}
          </div>
          <div className="h-64 bg-gray-100 rounded-2xl" />
        </div>
      </PageTransition>
    );
  }

  if (error || !member) {
    return (
      <PageTransition>
        <div className="space-y-4">
          <Link to="/ops/staff" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeftIcon className="h-4 w-4" /> Back to Staff
          </Link>
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700">
            <p className="font-medium">Staff member not found</p>
          </div>
        </div>
      </PageTransition>
    );
  }

  const items = workQueue?.items ?? [];

  return (
    <PageTransition>
      <div className="space-y-6">
        {/* Back + Header */}
        <div>
          <Link to="/ops/staff" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
            <ArrowLeftIcon className="h-4 w-4" /> Back to Staff
          </Link>
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-primary-600 text-white text-lg font-semibold flex items-center justify-center flex-shrink-0">
              {member.firstName[0]}{member.lastName[0]}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{member.firstName} {member.lastName}</h1>
              <p className="text-sm text-gray-400">{member.email}</p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={<InboxStackIcon className="h-5 w-5" />} label="Open Items" value={member.openItems} />
          <StatCard icon={<ExclamationCircleIcon className="h-5 w-5" />} label="Overdue" value={member.overdueItems} alert={member.overdueItems > 0} />
          <StatCard icon={<CheckCircleIcon className="h-5 w-5" />} label="Done This Week" value={member.completedThisWeek} />
          <StatCard icon={<ClockIcon className="h-5 w-5" />} label="Avg Turnaround" value={`${member.avgTurnaroundDays.toFixed(1)}d`} />
        </div>

        {/* Assigned Practices */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Assigned Practices</h2>
          <p className="text-2xl font-bold text-primary-700">{member.assignedPractices}</p>
        </div>

        {/* Work Items */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Active Work Items</h2>
            <p className="text-xs text-gray-400 mt-0.5">{items.length} item{items.length !== 1 ? 's' : ''}</p>
          </div>
          {items.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-400 text-center">No active work items assigned.</p>
          ) : (
            <div>
              {items.map((item) => <WorkItemRow key={item.id} item={item} />)}
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
