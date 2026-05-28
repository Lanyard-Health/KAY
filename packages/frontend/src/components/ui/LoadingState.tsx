import { useEffect, useState } from 'react';
import clsx from 'clsx';

interface LoadingStateProps {
  label?: string;
  slowThresholdMs?: number;
  slowMessage?: string;
  className?: string;
}

export default function LoadingState({
  label = 'Loading…',
  slowThresholdMs = 10_000,
  slowMessage = 'Taking longer than usual — please wait…',
  className,
}: LoadingStateProps) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), slowThresholdMs);
    return () => clearTimeout(timer);
  }, [slowThresholdMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx('flex flex-col items-center text-center p-6', className)}
    >
      <div
        className="h-8 w-8 border-2 border-gray-200 border-t-primary-600 rounded-full animate-spin"
        aria-hidden="true"
      />
      <p className="mt-3 text-sm text-gray-500">{label}</p>
      {slow && (
        <p className="mt-2 text-xs text-gray-400 max-w-sm">{slowMessage}</p>
      )}
    </div>
  );
}
