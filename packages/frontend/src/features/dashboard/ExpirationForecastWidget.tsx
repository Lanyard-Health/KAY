import { format } from 'date-fns';
import {
  ArrowDownTrayIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useExpirationForecast } from '../../hooks/useReporting';
import { downloadCsv } from '../../utils/downloadCsv';

const CREDENTIAL_TYPE_LABELS: Record<string, string> = {
  license: 'License',
  board_certification: 'Board Certification',
  malpractice_insurance: 'Malpractice Insurance',
};

const BUCKETS = [
  {
    key: 'critical' as const,
    label: 'Expiring within 30 days',
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    badgeColor: 'bg-red-100 text-red-700',
    daysColor: 'text-red-600',
  },
  {
    key: 'warning' as const,
    label: 'Expiring within 31\u201360 days',
    color: 'text-amber-700',
    bgColor: 'bg-amber-50',
    badgeColor: 'bg-amber-100 text-amber-700',
    daysColor: 'text-amber-600',
  },
  {
    key: 'upcoming' as const,
    label: 'Expiring within 61\u201390 days',
    color: 'text-green-700',
    bgColor: 'bg-green-50',
    badgeColor: 'bg-green-100 text-green-700',
    daysColor: 'text-green-600',
  },
];

interface ExpirationForecastWidgetProps {
  practiceId: string;
}

export default function ExpirationForecastWidget({
  practiceId,
}: ExpirationForecastWidgetProps) {
  const { data, isLoading } = useExpirationForecast(practiceId);

  const totalCount = data
    ? data.counts.critical + data.counts.warning + data.counts.upcoming
    : 0;

  const handleExportCsv = () => {
    if (!data) return;
    const headers = [
      'Provider',
      'Credential Type',
      'Credential Name',
      'Expiration Date',
      'Days Remaining',
      'Urgency',
    ];
    const rows: string[][] = [];
    for (const bucket of BUCKETS) {
      for (const item of data.buckets[bucket.key]) {
        rows.push([
          item.providerName,
          CREDENTIAL_TYPE_LABELS[item.credentialType] || item.credentialType,
          item.credentialName,
          format(new Date(item.expirationDate), 'yyyy-MM-dd'),
          String(item.daysRemaining),
          bucket.label,
        ]);
      }
    }
    downloadCsv('expiration-forecast.csv', headers, rows);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Expiration Forecast</h3>
        {totalCount > 0 && (
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <ArrowDownTrayIcon className="h-3.5 w-3.5" />
            Export CSV
          </button>
        )}
      </div>

      <div className="p-5">
        {isLoading ? (
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i}>
                <div className="h-5 bg-gray-100 rounded w-48 mb-2" />
                <div className="h-10 bg-gray-50 rounded" />
              </div>
            ))}
          </div>
        ) : totalCount === 0 ? (
          <div className="text-center py-10">
            <ShieldCheckIcon className="h-12 w-12 text-green-400 mx-auto" />
            <p className="mt-3 text-sm text-gray-600">
              No credentials expiring in the next 90 days. You're in good
              shape!
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {BUCKETS.map((bucket) => {
              const items = data!.buckets[bucket.key];
              const count = data!.counts[bucket.key];

              return (
                <div key={bucket.key}>
                  <div className="flex items-center gap-2 mb-2">
                    <h4
                      className={clsx('text-sm font-semibold', bucket.color)}
                    >
                      {bucket.label}
                    </h4>
                    <span
                      className={clsx(
                        'text-xs font-medium px-2 py-0.5 rounded-full',
                        bucket.badgeColor,
                      )}
                    >
                      {count}
                    </span>
                  </div>

                  {items.length === 0 ? (
                    <p className="text-sm text-gray-400 pl-1">None</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className={clsx('text-xs', bucket.bgColor)}>
                            <th className="text-left py-2 px-3 font-medium text-gray-600 rounded-l-lg">
                              Provider
                            </th>
                            <th className="text-left py-2 px-3 font-medium text-gray-600">
                              Type
                            </th>
                            <th className="text-left py-2 px-3 font-medium text-gray-600">
                              Credential
                            </th>
                            <th className="text-left py-2 px-3 font-medium text-gray-600">
                              Expires
                            </th>
                            <th className="text-right py-2 px-3 font-medium text-gray-600 rounded-r-lg">
                              Days Left
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item, idx) => (
                            <tr
                              key={`${item.providerId}-${item.credentialType}-${idx}`}
                              className="border-b border-gray-50 last:border-0"
                            >
                              <td className="py-2 px-3 text-gray-900 font-medium">
                                {item.providerName}
                              </td>
                              <td className="py-2 px-3 text-gray-600">
                                {CREDENTIAL_TYPE_LABELS[item.credentialType] ||
                                  item.credentialType}
                              </td>
                              <td className="py-2 px-3 text-gray-600">
                                {item.credentialName}
                              </td>
                              <td className="py-2 px-3 text-gray-600">
                                {format(
                                  new Date(item.expirationDate),
                                  'MMM d, yyyy',
                                )}
                              </td>
                              <td
                                className={clsx(
                                  'py-2 px-3 text-right font-medium',
                                  bucket.daysColor,
                                )}
                              >
                                {item.daysRemaining}d
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
