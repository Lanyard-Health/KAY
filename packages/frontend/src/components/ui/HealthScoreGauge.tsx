import clsx from 'clsx';
import AnimatedNumber from './AnimatedNumber';

interface HealthScoreGaugeProps {
  score: number; // 0-100
  size?: number;
  strokeWidth?: number;
  label?: string;
  className?: string;
}

function getColor(score: number): string {
  if (score >= 80) return '#16a34a'; // green
  if (score >= 60) return '#d97706'; // amber
  return '#dc2626'; // red
}

function getLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Needs Attention';
}

export default function HealthScoreGauge({
  score,
  size = 140,
  strokeWidth = 10,
  label,
  className,
}: HealthScoreGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const color = getColor(clamped);

  return (
    <div className={clsx('flex flex-col items-center gap-2', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <filter id={`gauge-glow-${clamped}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feFlood floodColor={color} floodOpacity="0.3" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="shadow" />
              <feMerge>
                <feMergeNode in="shadow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* Background ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={strokeWidth}
          />
          {/* Score ring with glow */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            filter={`url(#gauge-glow-${clamped})`}
            style={{ stroke: color, transition: 'stroke 0.5s ease, stroke-dashoffset 1s ease-out' }}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={clsx(
            'font-bold text-gray-900',
            size < 80 ? 'text-sm' : size < 120 ? 'text-xl' : 'text-3xl'
          )}>
            <AnimatedNumber value={clamped} duration={1.2} />
          </span>
          <span className={clsx(
            'text-gray-500',
            size < 80 ? 'text-[8px]' : size < 120 ? 'text-[10px]' : 'text-xs'
          )}>{label || getLabel(clamped)}</span>
        </div>
      </div>
    </div>
  );
}
