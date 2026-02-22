import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { MatrixData } from '../../hooks/useCommandCenter';

const statusColors: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  submitted: 'bg-purple-100 text-purple-700',
  pending_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  denied: 'bg-red-100 text-red-700',
  terminated: 'bg-gray-200 text-gray-500',
};

const statusLabels: Record<string, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  submitted: 'Submitted',
  pending_review: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
  terminated: 'Terminated',
};

interface Props {
  data: MatrixData;
  statusFilter: string;
  searchTerm: string;
}

export default function MatrixView({ data, statusFilter, searchTerm }: Props) {
  const filteredRows = data.rows.filter((row) => {
    // Search filter
    if (searchTerm) {
      const name = `${row.provider.firstName} ${row.provider.lastName}`.toLowerCase();
      if (!name.includes(searchTerm.toLowerCase()) && !row.provider.npi.includes(searchTerm)) {
        return false;
      }
    }
    // Status filter
    if (statusFilter !== 'all') {
      const hasStatus = Object.values(row.enrollments).some((e) => e.status === statusFilter);
      if (!hasStatus) return false;
    }
    return true;
  });

  if (data.payers.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-lg font-medium">No payers with enrollments yet</p>
        <p className="text-sm mt-1">Create enrollments to see them in the matrix view</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[200px]">
              Provider
            </th>
            {data.payers.map((payer) => (
              <th key={payer.id} className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[120px]">
                <span className="truncate block max-w-[120px]" title={payer.name}>
                  {payer.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {filteredRows.map((row) => (
            <tr key={row.provider.id} className="hover:bg-gray-50/50 transition-colors">
              <td className="sticky left-0 z-10 bg-white px-4 py-3">
                <Link to={`/providers/${row.provider.id}`} className="group">
                  <p className="text-sm font-medium text-gray-900 group-hover:text-primary-600 transition-colors">
                    {row.provider.lastName}, {row.provider.firstName}
                  </p>
                  <p className="text-xs text-gray-500">NPI: {row.provider.npi}</p>
                </Link>
              </td>
              {data.payers.map((payer) => {
                const cell = row.enrollments[payer.id];
                return (
                  <td key={payer.id} className="px-3 py-3 text-center">
                    {cell ? (
                      <Link
                        to={`/enrollments/${cell.enrollmentId}`}
                        className={clsx(
                          'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-all hover:scale-105 hover:shadow-sm',
                          statusColors[cell.status] || 'bg-gray-100 text-gray-600',
                        )}
                        title={`${cell.daysSinceUpdate}d since update`}
                      >
                        {statusLabels[cell.status] || cell.status}
                      </Link>
                    ) : (
                      <Link
                        to={`/enrollments?newProvider=${row.provider.id}&newPayer=${payer.id}`}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-gray-300 hover:text-primary-500 hover:bg-primary-50 transition-colors"
                        title="Create enrollment"
                      >
                        +
                      </Link>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {filteredRows.length === 0 && (
            <tr>
              <td colSpan={data.payers.length + 1} className="px-4 py-12 text-center text-gray-500">
                No providers match the current filters
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
