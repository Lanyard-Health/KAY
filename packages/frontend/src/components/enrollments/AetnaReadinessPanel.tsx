import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import { useAetnaReadiness, useStartAetnaEnrollment } from '../../hooks/useAetnaEnrollment';

interface Props {
  enrollmentId: string;
  payerName: string;
  onRunStarted: (runId: string) => void;
}

export function AetnaReadinessPanel({ enrollmentId, payerName, onRunStarted }: Props) {
  const readinessMutation = useAetnaReadiness(enrollmentId);
  const startMutation = useStartAetnaEnrollment(enrollmentId);
  const [readiness, setReadiness] = useState<any>(null);

  const handleCheckReadiness = async () => {
    const result = await readinessMutation.mutateAsync();
    setReadiness(result);
  };

  const handleStart = async () => {
    const result = await startMutation.mutateAsync();
    onRunStarted(result.runId);
  };

  // Only show for Aetna enrollments
  if (!payerName.toLowerCase().includes('aetna')) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <PlayIcon className="h-5 w-5 text-primary-600" />
          Aetna Enrollment Automation
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Auto-fill the Aetna enrollment form using provider data from Lanyard.
        </p>
      </div>

      <div className="px-6 py-4">
        {/* Check Readiness Button */}
        {!readiness && (
          <button
            onClick={handleCheckReadiness}
            disabled={readinessMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
          >
            {readinessMutation.isPending ? (
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircleIcon className="h-4 w-4" />
            )}
            Check Readiness
          </button>
        )}

        {/* Readiness Results */}
        {readiness && (
          <div className="space-y-4">
            <div className={`flex items-center gap-2 text-sm font-medium ${readiness.ready ? 'text-green-700' : 'text-amber-700'}`}>
              {readiness.ready ? (
                <>
                  <CheckCircleIcon className="h-5 w-5 text-green-500" />
                  All required data is present. Ready to start.
                </>
              ) : (
                <>
                  <ExclamationTriangleIcon className="h-5 w-5 text-amber-500" />
                  Some required fields are missing.
                </>
              )}
            </div>

            {/* Per-page breakdown */}
            <div className="space-y-2">
              {readiness.pages.map((page: any) => (
                <div key={page.page} className="flex items-start gap-2">
                  {page.ready ? (
                    <CheckCircleIcon className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  ) : (
                    <XCircleIcon className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  )}
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      Page {page.page}: {page.title}
                    </span>
                    {page.missing.length > 0 && (
                      <ul className="mt-1 space-y-1">
                        {page.missing.map((m: any) => (
                          <li key={m.field} className="text-sm text-gray-600 flex items-center gap-1">
                            <span>{m.label}</span>
                            <Link to={m.fixPath} className="text-primary-600 hover:underline text-xs">
                              (fix)
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCheckReadiness}
                disabled={readinessMutation.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md text-gray-700 bg-gray-100 hover:bg-gray-200"
              >
                <ArrowPathIcon className="h-4 w-4" />
                Re-check
              </button>

              {readiness.ready && (
                <button
                  onClick={handleStart}
                  disabled={startMutation.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
                >
                  {startMutation.isPending ? (
                    <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  ) : (
                    <PlayIcon className="h-4 w-4" />
                  )}
                  Start Aetna Enrollment
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
