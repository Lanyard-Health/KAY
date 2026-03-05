import { useState } from 'react';
import clsx from 'clsx';

type StatusVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface StatusBadgeProps {
  label: string;
  variant?: StatusVariant;
  dot?: boolean;
  tooltip?: string;
  className?: string;
}

const variantStyles: Record<StatusVariant, string> = {
  success: 'bg-green-50 text-green-700 ring-green-600/20',
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  danger: 'bg-red-50 text-red-700 ring-red-600/20',
  info: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  neutral: 'bg-gray-50 text-gray-600 ring-gray-500/10',
};

const dotColors: Record<StatusVariant, string> = {
  success: 'bg-green-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-blue-500',
  neutral: 'bg-gray-400',
};

export const STATUS_TOOLTIPS: Record<string, string> = {
  waiting_external: 'Submitted to payer. Typical response: 5-15 business days.',
  in_progress: 'Being actively worked on by staff.',
  at_risk: 'SLA deadline approaching. Needs attention soon.',
  breached: 'Past SLA deadline. Requires immediate action.',
  pending: 'Awaiting initial review or processing.',
  active: 'Currently active and in good standing.',
  approved: 'Application has been approved by the payer.',
  denied: 'Application was denied. Review denial reason.',
  expired: 'Credential or enrollment has expired. Renewal required.',
  submitted: 'Application submitted and awaiting payer response.',
  pending_verification: 'Provider account pending admin verification.',
};

export default function StatusBadge({
  label,
  variant = 'neutral',
  dot = false,
  tooltip,
  className,
}: StatusBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const badge = (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset',
        variantStyles[variant],
        tooltip && 'cursor-help',
        className,
      )}
      onMouseEnter={() => tooltip && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {dot && (
        <span className={clsx('h-1.5 w-1.5 rounded-full', dotColors[variant])} />
      )}
      {label}
    </span>
  );

  if (!tooltip) return badge;

  return (
    <span className="relative inline-flex">
      {badge}
      {showTooltip && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 text-xs text-white bg-gray-900 rounded-lg shadow-lg whitespace-nowrap z-50 pointer-events-none">
          {tooltip}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-900" />
        </span>
      )}
    </span>
  );
}
