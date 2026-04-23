import clsx from 'clsx';
import {
  CloudArrowDownIcon,
  PencilSquareIcon,
  UserCircleIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

export type CredentialSource =
  | 'manual_entry'
  | 'caqh_sync'
  | 'portal_import'
  | 'agent_parsed';

interface SourceBadgeProps {
  source?: CredentialSource | null;
  className?: string;
}

const config: Record<
  CredentialSource,
  { label: string; classes: string; Icon: typeof CloudArrowDownIcon }
> = {
  caqh_sync: {
    label: 'CAQH Synced',
    classes: 'bg-primary-50 text-primary-700 ring-primary-600/20',
    Icon: CloudArrowDownIcon,
  },
  manual_entry: {
    label: 'Manual',
    classes: 'bg-slate-50 text-slate-600 ring-slate-500/20',
    Icon: PencilSquareIcon,
  },
  portal_import: {
    label: 'Provider Portal',
    classes: 'bg-blue-50 text-blue-700 ring-blue-600/20',
    Icon: UserCircleIcon,
  },
  agent_parsed: {
    label: 'AI Parsed',
    classes: 'bg-purple-50 text-purple-700 ring-purple-600/20',
    Icon: SparklesIcon,
  },
};

export default function SourceBadge({ source, className }: SourceBadgeProps) {
  if (!source) return null;
  const { label, classes, Icon } = config[source];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset',
        classes,
        className,
      )}
      title={`Source: ${label}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
