import { motion } from 'framer-motion';
import clsx from 'clsx';

interface ProgressRingProps {
  value: number; // 0-100
  size?: number;
  strokeWidth?: number;
  className?: string;
  showLabel?: boolean;
}

function getColors(value: number): { stroke: string; bg: string } {
  if (value >= 80) return { stroke: '#10B981', bg: '#D1FAE5' };
  if (value >= 40) return { stroke: '#F59E0B', bg: '#FEF3C7' };
  return { stroke: '#EF4444', bg: '#FEE2E2' };
}

export default function ProgressRing({
  value,
  size = 40,
  strokeWidth = 4,
  className,
  showLabel = true,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const colors = getColors(clamped);

  return (
    <div
      className={clsx('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.bg}
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.6, ease: 'easeOut', delay: 0.2 }}
          style={{ stroke: colors.stroke, transition: 'stroke 0.3s ease' }}
        />
      </svg>
      {showLabel && (
        <span className="absolute text-[10px] font-semibold text-gray-700">
          {clamped}%
        </span>
      )}
    </div>
  );
}
