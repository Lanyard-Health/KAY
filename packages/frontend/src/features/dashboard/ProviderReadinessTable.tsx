import { Link } from 'react-router-dom';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid';
import { UserGroupIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useProviderReadiness } from '../../hooks/useReporting';
import { downloadCsv } from '../../utils/downloadCsv';

interface ProviderReadinessTableProps {
  practiceId: string;
}

export default function ProviderReadinessTable({
  practiceId,
}: ProviderReadinessTableProps) {
  const { data, isLoading } = useProviderReadiness(practiceId);

  const handleExportCsv = () => {
    if (!data) return;
    const headers = [
      'Provider',
      'Active License',
      'Malpractice Insurance',
      'Active Enrollment',
      'Readiness Score',
    ];
    const rows = data.providers.map((p) => [
      p.providerName,
      p.hasActiveLicense ? 'Yes' : 'No',
      p.hasMalpractice ? 'Yes' : 'No',
      p.hasActiveEnrollment ? 'Yes' : 'No',
      `${p.readinessScore}/3`,
    ]);
    downloadCsv('provider-readiness.csv', headers, rows);
  };

  const isEmpty = !isLoading && !data?.providers?.length;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Provider Readiness</h3>
        {!isEmpty && (
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <ArrowDownTrayIcon className="h-3.5 w-3.5" />
            Export CSV
          </button>
        )}
      </div>

      {/* Summary bar */}
      {data?.summary && !isEmpty && (
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-4 text-xs font-medium">
            <span className="text-green-700">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1 align-middle" />
              {data.summary.fullyReady} fully ready
            </span>
            <span className="text-yellow-700">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-500 mr-1 align-middle" />
              {data.summary.partiallyReady} partially ready
            </span>
            <span className="text-red-700">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1 align-middle" />
              {data.summary.notReady} not ready
            </span>
          </div>
        </div>
      )}

      <div className="p-5">
        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 bg-gray-100 rounded" />
            ))}
          </div>
        ) : isEmpty ? (
          <div className="text-center py-10">
            <UserGroupIcon className="h-12 w-12 text-gray-300 mx-auto" />
            <p className="mt-3 text-sm text-gray-500">
              No providers added yet.
            </p>
            <Link
              to="/providers/new"
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-primary-700 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
            >
              Add Provider
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs bg-gray-50">
                  <th className="text-left py-2 px-3 font-medium text-gray-600 rounded-l-lg">
                    Provider
                  </th>
                  <th className="text-center py-2 px-3 font-medium text-gray-600">
                    License
                  </th>
                  <th className="text-center py-2 px-3 font-medium text-gray-600">
                    Malpractice
                  </th>
                  <th className="text-center py-2 px-3 font-medium text-gray-600">
                    Enrollment
                  </th>
                  <th className="text-center py-2 px-3 font-medium text-gray-600 rounded-r-lg">
                    Readiness
                  </th>
                </tr>
              </thead>
              <tbody>
                {data!.providers.map((provider) => (
                  <tr
                    key={provider.providerId}
                    className="border-b border-gray-50 last:border-0"
                  >
                    <td className="py-2.5 px-3">
                      <Link
                        to={`/providers/${provider.providerId}`}
                        className="font-medium text-primary-700 hover:text-primary-800 hover:underline"
                      >
                        {provider.providerName}
                      </Link>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <BooleanIcon value={provider.hasActiveLicense} />
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <BooleanIcon value={provider.hasMalpractice} />
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <BooleanIcon value={provider.hasActiveEnrollment} />
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <ReadinessBadge score={provider.readinessScore} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function BooleanIcon({ value }: { value: boolean }) {
  return value ? (
    <CheckCircleIcon className="h-5 w-5 text-green-500 mx-auto" />
  ) : (
    <XCircleIcon className="h-5 w-5 text-red-400 mx-auto" />
  );
}

function ReadinessBadge({ score }: { score: number }) {
  const colorClass =
    score === 3
      ? 'bg-green-100 text-green-800'
      : score >= 1
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-red-100 text-red-800';

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        colorClass,
      )}
    >
      {score}/3
    </span>
  );
}
