import clsx from 'clsx';

type Priority = 'urgent' | 'high' | 'normal' | 'low';

interface ActionCardProps {
  title: string;
  description?: string;
  priority?: Priority;
  actions?: { label: string; onClick: () => void }[];
  icon?: React.ReactNode;
  className?: string;
}

const priorityStyles: Record<Priority, { border: string; bg: string; iconBg: string }> = {
  urgent: { border: 'border-l-red-500', bg: 'hover:bg-red-50/50', iconBg: 'bg-red-50 text-red-600' },
  high: { border: 'border-l-amber-500', bg: 'hover:bg-amber-50/50', iconBg: 'bg-amber-50 text-amber-600' },
  normal: { border: 'border-l-blue-500', bg: 'hover:bg-blue-50/50', iconBg: 'bg-blue-50 text-blue-600' },
  low: { border: 'border-l-gray-300', bg: 'hover:bg-gray-50/50', iconBg: 'bg-gray-100 text-gray-500' },
};

export default function ActionCard({
  title,
  description,
  priority = 'normal',
  actions,
  icon,
  className,
}: ActionCardProps) {
  const styles = priorityStyles[priority];
  return (
    <div
      className={clsx(
        'bg-white rounded-xl border border-gray-200/60 border-l-4 p-4 animate-fade-in transition-colors duration-200',
        styles.border,
        styles.bg,
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {icon && (
          <span className={clsx('mt-0.5 shrink-0 flex items-center justify-center w-8 h-8 rounded-lg', styles.iconBg)}>
            {icon}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          {description && (
            <p className="mt-0.5 text-sm text-gray-500 line-clamp-2">{description}</p>
          )}
          {actions && actions.length > 0 && (
            <div className="mt-2.5 flex gap-3">
              {actions.map((action) => (
                <button
                  key={action.label}
                  onClick={action.onClick}
                  className="text-xs font-semibold text-primary-600 hover:text-primary-700 transition-colors"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
