import { etaCaption } from './statusMeta';

interface EtaBarProps {
  dayCount: number;
  minDays: number | null;
  maxDays: number | null;
  isDelayed: boolean;
}

// DESIGN.md eta_bar: fill = dayCount / window MAX; tick at window MIN;
// past max → amber fill pinned at 100%; no window → plain bar, no tick, honest caption.
export default function EtaBar({ dayCount, minDays, maxDays, isDelayed }: EtaBarProps) {
  const hasWindow = minDays !== null && maxDays !== null && maxDays > 0;
  const fillPct = hasWindow ? Math.min(100, Math.round((dayCount / maxDays) * 100)) : 15;
  const tickPct = hasWindow ? Math.min(100, Math.round((minDays / maxDays) * 100)) : null;
  return (
    <div>
      <div className="relative h-[7px] overflow-hidden rounded bg-[#EFF0F5]">
        <div
          className="absolute inset-y-0 left-0 rounded"
          style={{ width: `${fillPct}%`, background: isDelayed ? '#B45309' : '#1A6B4E' }}
        />
        {tickPct !== null && !isDelayed && (
          <div className="absolute -inset-y-0.5 w-0.5 bg-gray-500" style={{ left: `${tickPct}%` }} />
        )}
      </div>
      <p className="mt-1 text-right text-[13px] text-gray-500 tabular-nums">
        {etaCaption(dayCount, minDays, maxDays)}
      </p>
    </div>
  );
}
