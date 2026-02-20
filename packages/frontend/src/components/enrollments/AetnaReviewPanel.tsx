import { useState, useEffect } from 'react';
import {
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  DocumentArrowDownIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import {
  useAetnaRunStatus,
  useApproveAetnaRun,
  useRejectAetnaRun,
  useRetryAetnaRun,
} from '../../hooks/useAetnaEnrollment';

interface Props {
  enrollmentId: string;
  runId: string;
  onClose: () => void;
}

const PAGE_TITLES = [
  'Submitter Information',
  'Network & Tax Information',
  'Degree & Specialty',
  'Provider Details & Credentials',
  'Contact Preferences',
  'Primary Practice Location',
  'Mailing & Billing Addresses',
  'Hospital Privileges & Attachments',
  'Additional Questions & Final Review',
];

export function AetnaReviewPanel({ enrollmentId, runId, onClose: _onClose }: Props) {
  const { data: run, isLoading } = useAetnaRunStatus(runId, enrollmentId);
  const approveMutation = useApproveAetnaRun(enrollmentId);
  const rejectMutation = useRejectAetnaRun(enrollmentId);
  const retryMutation = useRetryAetnaRun(enrollmentId);

  const [currentPage, setCurrentPage] = useState(0);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  // Countdown timer
  useEffect(() => {
    if (!run?.reviewExpiresAt || run.status !== 'awaiting_review') return;

    const interval = setInterval(() => {
      const remaining = new Date(run.reviewExpiresAt!).getTime() - Date.now();
      if (remaining <= 0) {
        setTimeRemaining('Expired');
        clearInterval(interval);
        return;
      }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setTimeRemaining(`${mins}:${String(secs).padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [run?.reviewExpiresAt, run?.status]);

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (!run) return null;

  const statusColors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700',
    filling: 'bg-blue-100 text-blue-700',
    awaiting_review: 'bg-amber-100 text-amber-700',
    submitting: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    rejected: 'bg-gray-100 text-gray-700',
    timed_out: 'bg-red-100 text-red-700',
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Aetna Enrollment Review</h2>
          {run.aetnaRequestId && (
            <p className="text-sm text-gray-500">Request ID: {run.aetnaRequestId}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {run.status === 'awaiting_review' && timeRemaining && (
            <span className="inline-flex items-center gap-1 text-sm text-amber-700">
              <ClockIcon className="h-4 w-4" />
              {timeRemaining}
            </span>
          )}
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[run.status] ?? 'bg-gray-100'}`}>
            {run.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Content based on status */}
      <div className="px-6 py-4">
        {/* Filling in progress */}
        {(run.status === 'pending' || run.status === 'filling') && (
          <div className="flex items-center gap-3 text-blue-700">
            <ArrowPathIcon className="h-5 w-5 animate-spin" />
            <span>Filling Aetna enrollment form... This may take a few minutes.</span>
          </div>
        )}

        {/* Submitting */}
        {run.status === 'submitting' && (
          <div className="flex items-center gap-3 text-blue-700">
            <ArrowPathIcon className="h-5 w-5 animate-spin" />
            <span>Submitting to Aetna...</span>
          </div>
        )}

        {/* Awaiting review — show screenshots */}
        {run.status === 'awaiting_review' && run.screenshotUrls.length > 0 && (
          <div className="space-y-4">
            {/* Screenshot carousel */}
            <div className="relative">
              <div className="text-sm font-medium text-gray-700 mb-2">
                Page {currentPage + 2}: {PAGE_TITLES[currentPage] ?? ''}
                <span className="text-gray-400 ml-2">
                  ({currentPage + 1} of {run.screenshotUrls.length})
                </span>
              </div>
              <div className="border rounded-lg overflow-hidden bg-gray-50">
                <img
                  src={run.screenshotUrls[currentPage]}
                  alt={`Page ${currentPage + 2} screenshot`}
                  className="w-full"
                />
              </div>
              <div className="flex justify-between mt-2">
                <button
                  onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                  disabled={currentPage === 0}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                >
                  <ChevronLeftIcon className="h-4 w-4" /> Previous
                </button>
                <button
                  onClick={() => setCurrentPage(Math.min(run.screenshotUrls.length - 1, currentPage + 1))}
                  disabled={currentPage === run.screenshotUrls.length - 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                >
                  Next <ChevronRightIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Approve/Reject buttons */}
            <div className="flex gap-3 pt-4 border-t border-gray-200">
              <button
                onClick={() => setShowConfirmDialog(true)}
                disabled={approveMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
              >
                <CheckCircleIcon className="h-4 w-4" />
                Approve & Submit
              </button>
              <button
                onClick={() => rejectMutation.mutate(runId)}
                disabled={rejectMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
              >
                <XCircleIcon className="h-4 w-4" />
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Completed */}
        {run.status === 'completed' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircleIcon className="h-5 w-5" />
              <span className="font-medium">Enrollment submitted successfully</span>
            </div>
            {run.aetnaRequestId && (
              <p className="text-sm text-gray-600">Aetna Request ID: <strong>{run.aetnaRequestId}</strong></p>
            )}
            {run.submittedAt && (
              <p className="text-sm text-gray-600">Submitted: {new Date(run.submittedAt).toLocaleString()}</p>
            )}
            {run.confirmationPdfUrl && (
              <a
                href={run.confirmationPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary-600 hover:underline"
              >
                <DocumentArrowDownIcon className="h-4 w-4" />
                Download Confirmation
              </a>
            )}
          </div>
        )}

        {/* Failed */}
        {(run.status === 'failed' || run.status === 'timed_out') && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-red-700">
              <ExclamationTriangleIcon className="h-5 w-5" />
              <span className="font-medium">
                {run.status === 'timed_out' ? 'Review window expired' : 'Enrollment failed'}
              </span>
            </div>
            {run.errorMessage && (
              <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{run.errorMessage}</p>
            )}
            <button
              onClick={() => retryMutation.mutate(runId)}
              disabled={retryMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
            >
              <ArrowPathIcon className="h-4 w-4" />
              Retry
            </button>
          </div>
        )}

        {/* Automation log (expandable) */}
        {run.automationLog && (
          <details className="mt-4">
            <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
              View automation log
            </summary>
            <pre className="mt-2 text-xs text-gray-600 bg-gray-50 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
              {run.automationLog}
            </pre>
          </details>
        )}
      </div>

      {/* Confirm dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm" onClick={() => setShowConfirmDialog(false)} />
            <div className="relative z-10 w-full max-w-md p-6 bg-white rounded-2xl shadow-xl">
              <h3 className="text-lg font-semibold text-gray-900">Confirm Submission</h3>
              <p className="mt-2 text-sm text-gray-600">
                This will submit the enrollment application to Aetna. <strong>This action cannot be undone.</strong>
              </p>
              <div className="flex gap-3 mt-6 justify-end">
                <button
                  onClick={() => setShowConfirmDialog(false)}
                  className="px-4 py-2 text-sm font-medium rounded-md text-gray-700 bg-gray-100 hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowConfirmDialog(false);
                    approveMutation.mutate(runId);
                  }}
                  disabled={approveMutation.isPending}
                  className="px-4 py-2 text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                >
                  Approve & Submit to Aetna
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
