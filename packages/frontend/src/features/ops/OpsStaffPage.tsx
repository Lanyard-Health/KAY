import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import PageTransition from '../../components/ui/PageTransition';
import {
  UserGroupIcon,
  ArrowsRightLeftIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  InboxStackIcon,
} from '@heroicons/react/24/outline';
import {
  useOpsStaff,
  useTransferAssignments,
  type OpsStaffMember,
} from '../../hooks/useOps';

// ── Staff Card ─────────────────────────────────────

function StaffCard({ member }: { member: OpsStaffMember }) {
  const initials = `${member.firstName[0]}${member.lastName[0]}`;

  return (
    <Link
      to={`/ops/staff/${member.id}`}
      className="block bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 hover:shadow-md hover:border-primary-200 transition-all group"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-full bg-primary-600 text-white text-sm font-semibold flex items-center justify-center flex-shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 group-hover:text-primary-700 transition-colors truncate">
            {member.firstName} {member.lastName}
          </p>
          <p className="text-xs text-gray-400 truncate">{member.email}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <MiniStat
          icon={<InboxStackIcon className="h-4 w-4" />}
          label="Open"
          value={member.openItems}
        />
        <MiniStat
          icon={<ExclamationCircleIcon className="h-4 w-4" />}
          label="Overdue"
          value={member.overdueItems}
          alert={member.overdueItems > 0}
        />
        <MiniStat
          icon={<CheckCircleIcon className="h-4 w-4" />}
          label="Done this week"
          value={member.completedThisWeek}
        />
        <MiniStat
          icon={<ClockIcon className="h-4 w-4" />}
          label="Avg turnaround"
          value={`${member.avgTurnaroundDays.toFixed(1)}d`}
        />
      </div>
    </Link>
  );
}

function MiniStat({
  icon,
  label,
  value,
  alert,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  alert?: boolean;
}) {
  return (
    <div
      className={clsx(
        'rounded-xl px-3 py-2 flex items-center gap-2',
        alert ? 'bg-red-50' : 'bg-gray-50',
      )}
    >
      <span className={clsx(alert ? 'text-red-500' : 'text-gray-400')}>{icon}</span>
      <div>
        <p className={clsx('text-sm font-semibold', alert ? 'text-red-600' : 'text-gray-800')}>
          {value}
        </p>
        <p className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mt-0.5">
          {label}
        </p>
      </div>
    </div>
  );
}

// ── Skeleton Card ──────────────────────────────────

function SkeletonStaffCard() {
  return (
    <div className="animate-pulse bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-full bg-gray-200" />
        <div className="space-y-2">
          <div className="h-4 w-28 bg-gray-200 rounded" />
          <div className="h-3 w-36 bg-gray-100 rounded" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 bg-gray-100 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// ── Transfer Section ───────────────────────────────

function TransferSection({ staff }: { staff: OpsStaffMember[] }) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const transfer = useTransferAssignments();

  const canSubmit = fromId && toId && fromId !== toId && !transfer.isPending;

  const handleTransfer = () => {
    if (!canSubmit) return;
    transfer.mutate(
      { fromStaffId: fromId, toStaffId: toId },
      {
        onSuccess: () => {
          setFromId('');
          setToId('');
        },
      },
    );
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
      <div className="flex items-center gap-2 mb-4">
        <ArrowsRightLeftIcon className="h-5 w-5 text-primary-500" />
        <h3 className="text-sm font-semibold text-gray-900">Transfer All Assignments</h3>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Move all open work items and practice assignments from one staff member to another.
      </p>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
        {/* From */}
        <div className="flex-1">
          <label htmlFor="transfer-from" className="block text-xs font-medium text-gray-500 mb-1">
            From
          </label>
          <select
            id="transfer-from"
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">Select staff...</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName} ({s.openItems} open)
              </option>
            ))}
          </select>
        </div>

        {/* Arrow */}
        <div className="hidden sm:flex items-center pb-1">
          <ArrowsRightLeftIcon className="h-5 w-5 text-gray-300" />
        </div>

        {/* To */}
        <div className="flex-1">
          <label htmlFor="transfer-to" className="block text-xs font-medium text-gray-500 mb-1">
            To
          </label>
          <select
            id="transfer-to"
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">Select staff...</option>
            {staff
              .filter((s) => s.id !== fromId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.firstName} {s.lastName}
                </option>
              ))}
          </select>
        </div>

        {/* Button */}
        <button
          type="button"
          onClick={handleTransfer}
          disabled={!canSubmit}
          className={clsx(
            'px-5 py-2 rounded-xl text-sm font-medium transition-all',
            canSubmit
              ? 'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed',
          )}
        >
          {transfer.isPending ? 'Transferring...' : 'Transfer'}
        </button>
      </div>

      {/* Success / Error feedback */}
      {transfer.isSuccess && (
        <p className="mt-3 text-xs text-green-600 font-medium">
          Transferred {transfer.data.assignments} assignment(s) and {transfer.data.workItems} work item(s).
        </p>
      )}
      {transfer.isError && (
        <p className="mt-3 text-xs text-red-600 font-medium">
          Transfer failed. Please try again.
        </p>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────

export default function OpsStaffPage() {
  const { data: staff, isLoading, error } = useOpsStaff();

  const staffList = staff ?? [];

  return (
    <PageTransition>
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Staff</h1>
        <p className="mt-1 text-sm text-gray-500">
          View workload, performance, and manage assignments across your ops team.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700">
          <p className="font-medium">Failed to load staff data</p>
          <p className="text-sm mt-1">Please check your connection and try again.</p>
        </div>
      )}

      {/* Staff Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonStaffCard key={i} />
          ))}
        </div>
      ) : staffList.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-12 text-center">
          <UserGroupIcon className="h-12 w-12 text-gray-300 mx-auto" />
          <p className="mt-3 text-sm font-medium text-gray-500">No staff members found</p>
          <p className="mt-1 text-xs text-gray-400">
            Staff accounts will appear here once team members are added to the system.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {staffList.map((member) => (
              <StaffCard key={member.id} member={member} />
            ))}
          </div>

          {/* Transfer Section */}
          {staffList.length >= 2 && <TransferSection staff={staffList} />}
        </>
      )}
    </div>
    </PageTransition>
  );
}
