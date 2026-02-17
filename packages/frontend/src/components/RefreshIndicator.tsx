import { ArrowPathIcon } from '@heroicons/react/24/outline';

export default function RefreshIndicator({ isFetching }: { isFetching: boolean }) {
  if (!isFetching) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
      <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
      Refreshing…
    </span>
  );
}
