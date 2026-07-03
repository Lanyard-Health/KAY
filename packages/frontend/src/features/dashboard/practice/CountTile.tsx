import { Link } from 'react-router-dom';
import clsx from 'clsx';

interface CountTileProps {
  value: number;
  chip: string;          // human label, e.g. "Submitted to payer"
  chipClass: string;     // soft chip classes from STATUS_META/DELAYED_META
  to?: string;           // tile is a filter — links to the enrollments list
  hot?: boolean;         // warm border for warning-state tiles
  delta?: string;        // e.g. "+3 this month"
}

export default function CountTile({ value, chip, chipClass, to, hot, delta }: CountTileProps) {
  const body = (
    <div
      className={clsx(
        'h-full rounded-2xl bg-white p-4 shadow-sm transition-shadow',
        hot ? 'border border-[#F0DCB8]' : 'border border-gray-200/60',
        to && 'hover:shadow-md',
      )}
    >
      <p className="text-[34px] font-bold leading-tight text-gray-900 tabular-nums">
        {value}
        {delta ? <span className="ml-2 align-middle text-[12.5px] font-semibold text-[#15803D]">{delta}</span> : null}
      </p>
      <span className={clsx('mt-2 inline-block rounded-lg px-2.5 py-1 text-xs font-semibold', chipClass)}>
        {chip}
      </span>
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}
