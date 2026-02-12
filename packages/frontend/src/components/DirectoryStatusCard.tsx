import { useState } from 'react';
import { format } from 'date-fns';
import { ArrowPathIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import {
  useDirectoryStatus,
  useVerifyAllDirectories,
  useResolveDirectoryAlert,
  getDirectoryStatusLabel,
  getDirectoryStatusColor,
  type DirectorySnapshot,
} from '../hooks/useDirectoryStatus';

interface DirectoryStatusCardProps {
  providerId: string;
}

export function DirectoryStatusCard({ providerId }: DirectoryStatusCardProps) {
  const [expandedSnapshot, setExpandedSnapshot] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useDirectoryStatus(providerId);
  const verifyAll = useVerifyAllDirectories();
  const resolveAlert = useResolveDirectoryAlert();

  const handleVerifyAll = () => {
    verifyAll.mutate(providerId, {
      onSuccess: () => toast.success('Directory verification complete'),
      onError: () => toast.error('Directory verification failed'),
    });
  };

  const handleResolveAlert = (alertId: string) => {
    resolveAlert.mutate(
      { alertId, providerId },
      {
        onSuccess: () => toast.success('Alert resolved'),
        onError: () => toast.error('Failed to resolve alert'),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="card card-body">
        <h3 className="text-sm font-medium text-gray-500 mb-3">Directory Verification</h3>
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className="card card-body">
        <h3 className="text-sm font-medium text-gray-500 mb-3">Directory Verification</h3>
        <p className="text-sm text-red-600">Failed to load directory status</p>
      </div>
    );
  }

  const { snapshots, alerts, configuredPayers, summary } = data.data;

  if (configuredPayers.length === 0) {
    return (
      <div className="card card-body">
        <h3 className="text-sm font-medium text-gray-500 mb-3">Directory Verification</h3>
        <p className="text-sm text-gray-500">No directory integrations configured</p>
      </div>
    );
  }

  const toggleSnapshot = (id: string) => {
    setExpandedSnapshot(prev => (prev === id ? null : id));
  };

  return (
    <div className="card card-body">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-500">Directory Verification</h3>
        <div className="flex items-center gap-2">
          {summary.openAlerts > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
              {summary.openAlerts} Alert{summary.openAlerts > 1 ? 's' : ''}
            </span>
          )}
          <button
            onClick={() => refetch()}
            className="text-gray-400 hover:text-gray-600"
            title="Refresh"
          >
            <ArrowPathIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Per-payer status rows */}
      {snapshots.length > 0 ? (
        <div className="space-y-2 mb-4">
          {snapshots.map((snapshot: DirectorySnapshot) => (
            <div key={snapshot.id} className="border rounded p-2">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => snapshot.mismatches ? toggleSnapshot(snapshot.id) : undefined}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {snapshot.payer.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    Checked {format(new Date(snapshot.checkedAt), 'MMM d, yyyy')}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getDirectoryStatusColor(snapshot.status)}`}
                  >
                    {getDirectoryStatusLabel(snapshot.status)}
                  </span>
                  {snapshot.mismatches && snapshot.mismatches.length > 0 && (
                    expandedSnapshot === snapshot.id
                      ? <ChevronUpIcon className="h-4 w-4 text-gray-400" />
                      : <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                  )}
                </div>
              </div>

              {/* Expanded mismatch details */}
              {expandedSnapshot === snapshot.id && snapshot.mismatches && (
                <div className="mt-2 border-t pt-2">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="text-left py-1">Field</th>
                        <th className="text-left py-1">Ours</th>
                        <th className="text-left py-1">Theirs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.mismatches.map((m, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="py-1 font-medium capitalize">{m.field}</td>
                          <td className="py-1 text-gray-600">{m.ours}</td>
                          <td className="py-1 text-gray-600">{m.theirs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500 mb-4">No verification checks run yet</p>
      )}

      {/* Open alerts */}
      {alerts.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Open Alerts</p>
          {alerts.map((alert) => (
            <div key={alert.id} className="flex items-center justify-between p-2 bg-red-50 rounded mb-1">
              <p className="text-xs text-red-800 flex-1">{alert.message}</p>
              <button
                onClick={() => handleResolveAlert(alert.id)}
                className="text-xs text-red-600 hover:text-red-800 ml-2 whitespace-nowrap"
                disabled={resolveAlert.isPending}
              >
                Resolve
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Verify All button */}
      <button
        onClick={handleVerifyAll}
        disabled={verifyAll.isPending}
        className="w-full inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
      >
        {verifyAll.isPending ? 'Verifying...' : 'Verify All Payers'}
      </button>
    </div>
  );
}

export default DirectoryStatusCard;
