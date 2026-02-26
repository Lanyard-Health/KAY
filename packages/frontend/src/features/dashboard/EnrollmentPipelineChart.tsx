import { useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useEnrollmentPipeline } from '../../hooks/useReporting';
import EmptyState from '../../components/ui/EmptyState';
import { downloadCsv } from '../../utils/downloadCsv';

const STATUS_CONFIG = [
  { key: 'not_started', label: 'Not Started', color: '#9CA3AF' },
  { key: 'in_progress', label: 'In Progress', color: '#3B82F6' },
  { key: 'submitted', label: 'Submitted', color: '#F59E0B' },
  { key: 'pending_review', label: 'Pending Review', color: '#8B5CF6' },
  { key: 'approved', label: 'Approved', color: '#22C55E' },
  { key: 'denied', label: 'Denied', color: '#EF4444' },
  { key: 'terminated', label: 'Terminated', color: '#6B7280' },
];

const DATE_RANGES = [
  { label: '30 days', days: 30 },
  { label: '60 days', days: 60 },
  { label: '90 days', days: 90 },
  { label: 'All time', days: null },
] as const;

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl shadow-lg border border-gray-200/60 bg-white/95 backdrop-blur-sm p-3 min-w-[180px]">
      <p className="text-sm font-semibold text-gray-900 mb-2">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-gray-600">{entry.name}</span>
          </div>
          <span className="font-medium text-gray-900">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function CustomLegend({ payload }: any) {
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3 justify-center">
      {payload.map((entry: any) => (
        <span
          key={entry.value}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-50 text-gray-700"
        >
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          {entry.value}
        </span>
      ))}
    </div>
  );
}

interface EnrollmentPipelineChartProps {
  practiceId: string;
}

export default function EnrollmentPipelineChart({
  practiceId,
}: EnrollmentPipelineChartProps) {
  const navigate = useNavigate();
  const [selectedDays, setSelectedDays] = useState<number | null>(null);

  const startDate = useMemo(() => {
    if (selectedDays === null) return undefined;
    const d = new Date();
    d.setDate(d.getDate() - selectedDays);
    return d.toISOString().split('T')[0];
  }, [selectedDays]);

  const { data, isLoading } = useEnrollmentPipeline(practiceId, startDate);

  const chartData = useMemo(() => {
    if (!data?.byPayer) return [];
    return data.byPayer.map((payer) => ({
      payerName: payer.payerName,
      ...STATUS_CONFIG.reduce(
        (acc, s) => ({ ...acc, [s.key]: payer.statuses[s.key] || 0 }),
        {} as Record<string, number>,
      ),
    }));
  }, [data]);

  // Only render bar segments for statuses that exist in the data
  const activeStatuses = useMemo(() => {
    if (!data) return [];
    const present = new Set<string>();
    for (const payer of data.byPayer) {
      for (const [status, count] of Object.entries(payer.statuses)) {
        if (count > 0) present.add(status);
      }
    }
    return STATUS_CONFIG.filter((s) => present.has(s.key));
  }, [data]);

  const handleExportCsv = () => {
    if (!data) return;
    const headers = ['Payer', 'Status', 'Count'];
    const rows: string[][] = [];
    for (const payer of data.byPayer) {
      for (const [status, count] of Object.entries(payer.statuses)) {
        const label =
          STATUS_CONFIG.find((s) => s.key === status)?.label || status;
        rows.push([payer.payerName, label, String(count)]);
      }
    }
    downloadCsv('enrollment-pipeline.csv', headers, rows);
  };

  const isEmpty = !isLoading && !data?.byPayer?.length;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-semibold text-gray-900">Enrollment Pipeline</h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
            {DATE_RANGES.map((range) => (
              <button
                key={range.label}
                onClick={() => setSelectedDays(range.days)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  selectedDays === range.days
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900',
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
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
      </div>

      <div className="p-5">
        {isLoading ? (
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-5 bg-gray-100 rounded w-28 flex-shrink-0" />
                <div
                  className="h-8 bg-gray-100 rounded"
                  style={{ width: `${70 - i * 15}%` }}
                />
              </div>
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState
            illustration="chart"
            title="No enrollments yet"
            description="Start your first enrollment to track your pipeline."
            action={{ label: 'Go to Enrollments', onClick: () => navigate('/enrollments') }}
          />
        ) : (
          <ResponsiveContainer
            width="100%"
            height={Math.max(chartData.length * 50 + 40, 150)}
          >
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis
                dataKey="payerName"
                type="category"
                width={140}
                tick={{ fontSize: 13 }}
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              />
              <Legend content={<CustomLegend />} />
              {activeStatuses.map((status) => (
                <Bar
                  key={status.key}
                  dataKey={status.key}
                  stackId="a"
                  fill={status.color}
                  name={status.label}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
