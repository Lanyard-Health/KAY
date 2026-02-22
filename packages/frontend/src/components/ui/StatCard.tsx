import clsx from 'clsx';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/20/solid';

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: { value: number; label?: string };
  sparkline?: number[];
  icon?: React.ReactNode;
  className?: string;
}

function MiniSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 24;
  const w = 64;
  const step = w / (data.length - 1);

  const points = data
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(' ');

  return (
    <svg width={w} height={h} className="text-primary-500">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export default function StatCard({
  label,
  value,
  trend,
  sparkline,
  icon,
  className,
}: StatCardProps) {
  const isPositive = trend && trend.value >= 0;

  return (
    <div className={clsx('stat-card', className)}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {icon && <span className="text-gray-400">{icon}</span>}
      </div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-2xl font-semibold text-gray-900">{value}</p>
          {trend && (
            <div className="flex items-center gap-1 mt-1">
              {isPositive ? (
                <ArrowTrendingUpIcon className="h-4 w-4 text-green-600" />
              ) : (
                <ArrowTrendingDownIcon className="h-4 w-4 text-red-600" />
              )}
              <span
                className={clsx(
                  'text-xs font-medium',
                  isPositive ? 'text-green-600' : 'text-red-600',
                )}
              >
                {isPositive ? '+' : ''}
                {trend.value}%
              </span>
              {trend.label && (
                <span className="text-xs text-gray-400">{trend.label}</span>
              )}
            </div>
          )}
        </div>
        {sparkline && <MiniSparkline data={sparkline} />}
      </div>
    </div>
  );
}
