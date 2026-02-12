import { useFollowUpHistory } from '../../hooks/useFollowUp';
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';

interface FollowUpHistoryProps {
  enrollmentId: string;
}

export default function FollowUpHistory({ enrollmentId }: FollowUpHistoryProps) {
  const { data: historyResp, isLoading } = useFollowUpHistory(enrollmentId);
  const notifications = historyResp?.data ?? [];

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-gray-200 rounded" />
        ))}
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-gray-500">No follow-up emails sent yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {notifications.map((n) => (
        <div key={n.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-md">
          {n.status === 'sent' ? (
            <CheckCircleIcon className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
          ) : (
            <XCircleIcon className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-900 truncate">{n.subject}</p>
              <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                n.status === 'sent'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}>
                {n.status}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
              <span>{new Date(n.createdAt).toLocaleString()}</span>
              <span className="truncate">{n.recipientEmail}</span>
            </div>
            {n.error && (
              <p className="mt-1 text-xs text-red-600">{n.error}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
