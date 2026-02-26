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
  const h = 28;
  const w = 72;
  const step = w / (data.length - 1);

  const points = data
    .map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`)
    .join(' ');

  // Area fill points (close the polygon at the bottom)
  const areaPoints = `0,${h} ${points} ${w},${h}`;

  return (
    <svg width={w} height={h} className="text-primary-500">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill="url(#sparkFill)" points={areaPoints} />
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
    <div className={clsx('stat-card group', className)}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
        {icon && (
          <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary-50 text-primary-600 group-hover:bg-primary-100 transition-colors">
            {icon}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-4 mt-2">
        <div>
          <p className="text-2xl font-bold text-gray-900 tracking-tight">{value}</p>
          {trend && (
            <div className="flex items-center gap-1 mt-1">
              {isPositive ? (
                <ArrowTrendingUpIcon className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <ArrowTrendingDownIcon className="h-3.5 w-3.5 text-red-500" />
              )}
              <span
                className={clsx(
                  'text-xs font-semibold',
                  isPositive ? 'text-emerald-600' : 'text-red-500',
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
