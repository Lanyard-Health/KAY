import clsx from 'clsx';
import type { PdmAttestationStatus } from '../hooks/usePdmStatus';

interface PdmAttestationBadgeProps {
  status: PdmAttestationStatus['status'];
  daysUntilDue?: number | null;
  needsUpdate?: boolean;
  showDays?: boolean;
  size?: 'sm' | 'md';
}

const statusStyles: Record<PdmAttestationStatus['status'], string> = {
  current: 'bg-green-100 text-green-800',
  due_soon: 'bg-yellow-100 text-yellow-800',
  overdue: 'bg-red-100 text-red-800',
  never_attested: 'bg-gray-100 text-gray-800',
};

const statusLabels: Record<PdmAttestationStatus['status'], string> = {
  current: 'Current',
  due_soon: 'Due Soon',
  overdue: 'Overdue',
  never_attested: 'Never Attested',
};

export function PdmAttestationBadge({
  status,
  daysUntilDue,
  needsUpdate,
  showDays = false,
  size = 'md',
}: PdmAttestationBadgeProps) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  const label = statusLabels[status];
  const daysText =
    showDays && daysUntilDue !== null && daysUntilDue !== undefined
      ? ` (${daysUntilDue}d)`
      : '';

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={clsx(
          'inline-flex items-center rounded-full font-medium',
          sizeClasses,
          statusStyles[status]
        )}
      >
        {label}
        {daysText}
      </span>
      {needsUpdate && (
        <span
          className={clsx(
            'inline-flex items-center rounded-full font-medium bg-orange-100 text-orange-800',
            sizeClasses
          )}
          title="Directory information has changed since last attestation"
        >
          Update Needed
        </span>
      )}
    </span>
  );
}

interface PdmStatusBadgeSimpleProps {
  enrollmentId: string;
  statuses: PdmAttestationStatus[];
}

export function PdmStatusBadgeForEnrollment({
  enrollmentId,
  statuses,
}: PdmStatusBadgeSimpleProps) {
  const enrollmentStatus = statuses.find((s) => s.enrollmentId === enrollmentId);

  if (!enrollmentStatus) {
    return <span className="text-gray-400 text-sm">N/A</span>;
  }

  return (
    <PdmAttestationBadge
      status={enrollmentStatus.status}
      daysUntilDue={enrollmentStatus.daysUntilDue}
      needsUpdate={enrollmentStatus.needsUpdate}
      showDays
      size="sm"
    />
  );
}

export default PdmAttestationBadge;
