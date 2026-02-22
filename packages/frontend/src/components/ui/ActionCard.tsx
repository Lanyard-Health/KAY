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

const priorityStyles: Record<Priority, string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-amber-500',
  normal: 'border-l-blue-500',
  low: 'border-l-gray-300',
};

export default function ActionCard({
  title,
  description,
  priority = 'normal',
  actions,
  icon,
  className,
}: ActionCardProps) {
  return (
    <div
      className={clsx(
        'bg-white rounded-xl border border-gray-200/60 border-l-4 p-4 animate-fade-in',
        priorityStyles[priority],
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {icon && <span className="mt-0.5 text-gray-400 shrink-0">{icon}</span>}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{title}</p>
          {description && (
            <p className="mt-0.5 text-sm text-gray-500 line-clamp-2">{description}</p>
          )}
          {actions && actions.length > 0 && (
            <div className="mt-2 flex gap-2">
              {actions.map((action) => (
                <button
                  key={action.label}
                  onClick={action.onClick}
                  className="text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors"
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
