import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { MatrixData } from '../../hooks/useCommandCenter';

const columns = [
  { status: 'not_started', label: 'Not Started', color: 'bg-gray-400' },
  { status: 'in_progress', label: 'In Progress', color: 'bg-blue-500' },
  { status: 'submitted', label: 'Submitted', color: 'bg-purple-500' },
  { status: 'pending_review', label: 'Pending Review', color: 'bg-amber-500' },
  { status: 'approved', label: 'Approved', color: 'bg-green-500' },
  { status: 'denied', label: 'Denied', color: 'bg-red-500' },
];

interface KanbanCard {
  enrollmentId: string;
  providerName: string;
  providerId: string;
  payerName: string;
  daysSinceUpdate: number;
  applicationDate: string | null;
}

interface Props {
  data: MatrixData;
  statusFilter: string;
  searchTerm: string;
}

export default function KanbanView({ data, statusFilter, searchTerm }: Props) {
  // Build cards from matrix data
  const cardsByStatus: Record<string, KanbanCard[]> = {};
  for (const col of columns) {
    cardsByStatus[col.status] = [];
  }

  for (const row of data.rows) {
    const providerName = `${row.provider.firstName} ${row.provider.lastName}`;
    if (searchTerm) {
      const match = providerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        row.provider.npi.includes(searchTerm);
      if (!match) continue;
    }

    for (const [payerId, cell] of Object.entries(row.enrollments)) {
      if (statusFilter !== 'all' && cell.status !== statusFilter) continue;
      const payer = data.payers.find((p) => p.id === payerId);
      if (!cardsByStatus[cell.status]) continue;
      cardsByStatus[cell.status].push({
        enrollmentId: cell.enrollmentId,
        providerName,
        providerId: row.provider.id,
        payerName: payer?.name || 'Unknown',
        daysSinceUpdate: cell.daysSinceUpdate,
        applicationDate: cell.applicationDate,
      });
    }
  }

  // Sort each column by days since update (stale items first)
  for (const cards of Object.values(cardsByStatus)) {
    cards.sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);
  }

  const visibleColumns = statusFilter === 'all'
    ? columns
    : columns.filter((c) => c.status === statusFilter);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[400px]">
      {visibleColumns.map((col) => {
        const cards = cardsByStatus[col.status] || [];
        return (
          <div
            key={col.status}
            className="flex-shrink-0 w-72 bg-gray-50 rounded-xl"
          >
            {/* Column header */}
            <div className="px-4 py-3 border-b border-gray-200/60">
              <div className="flex items-center gap-2">
                <div className={clsx('w-2.5 h-2.5 rounded-full', col.color)} />
                <h3 className="text-sm font-semibold text-gray-700">{col.label}</h3>
                <span className="ml-auto text-xs font-medium text-gray-400 bg-white px-2 py-0.5 rounded-full">
                  {cards.length}
                </span>
              </div>
            </div>

            {/* Cards */}
            <div className="p-3 space-y-2 max-h-[500px] overflow-y-auto">
              {cards.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">No enrollments</p>
              ) : (
                cards.map((card) => (
                  <Link
                    key={card.enrollmentId}
                    to={`/enrollments/${card.enrollmentId}`}
                    className="block bg-white rounded-lg border border-gray-200/60 p-3 hover:shadow-md hover:border-primary-200 transition-all"
                  >
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {card.providerName}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {card.payerName}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className={clsx(
                        'text-xs',
                        card.daysSinceUpdate > 14 ? 'text-red-500 font-medium' :
                        card.daysSinceUpdate > 7 ? 'text-amber-500' : 'text-gray-400',
                      )}>
                        {card.daysSinceUpdate}d ago
                      </span>
                      {card.applicationDate && (
                        <span className="text-xs text-gray-400">
                          Applied {new Date(card.applicationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
