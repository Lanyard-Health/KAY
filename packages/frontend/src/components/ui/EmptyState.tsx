import clsx from 'clsx';
import { motion } from 'framer-motion';
import {
  SearchIllustration,
  InboxIllustration,
  ClipboardIllustration,
  FolderIllustration,
  ChartIllustration,
  PeopleIllustration,
} from './illustrations';

const ILLUSTRATIONS = {
  search: SearchIllustration,
  inbox: InboxIllustration,
  clipboard: ClipboardIllustration,
  folder: FolderIllustration,
  chart: ChartIllustration,
  people: PeopleIllustration,
} as const;

export type IllustrationPreset = keyof typeof ILLUSTRATIONS;

interface EmptyStateProps {
  icon?: React.ReactNode;
  illustration?: IllustrationPreset;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export default function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const Illustration = illustration ? ILLUSTRATIONS[illustration] : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] as const }}
      className={clsx('empty-state', className)}
    >
      {Illustration ? (
        <div className="mb-4 text-gray-300">
          <Illustration size={120} />
        </div>
      ) : icon ? (
        <div className="mb-4 text-gray-300">{icon}</div>
      ) : null}
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-gray-500 max-w-sm">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 btn-primary text-sm"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
