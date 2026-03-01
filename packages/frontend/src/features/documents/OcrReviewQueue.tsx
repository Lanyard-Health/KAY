import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DocumentMagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import PageTransition from '../../components/ui/PageTransition';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import OcrReviewModal from './OcrReviewModal';
import { useOcrReviewQueue } from '../../hooks/useOcrReviewQueue';
import { useOcrReviewCount } from '../../hooks/useOcrReviewCount';

function getConfidenceBadge(confidence: number | null) {
  if (confidence == null) return null;
  const pct = Math.round(confidence * 100);
  if (pct >= 90) return { variant: 'success' as const, label: `${pct}%` };
  if (pct >= 70) return { variant: 'warning' as const, label: `${pct}%` };
  return { variant: 'danger' as const, label: `${pct}%` };
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  license: 'License',
  board_certification: 'Board Certification',
  malpractice_certificate: 'Malpractice Insurance',
  diploma: 'Diploma',
  transcript: 'Transcript',
  cv_resume: 'CV / Resume',
  photo: 'Photo',
  government_id: 'Government ID',
  dea_certificate: 'DEA Certificate',
  cds_certificate: 'CDS Certificate',
  cme_certificate: 'CME Certificate',
  hospital_letter: 'Hospital Letter',
  reference_letter: 'Reference Letter',
  w9: 'W-9 Form',
  coi: 'COI',
  cp575: 'CP575 / IRS Letter',
  other: 'Other',
};

export default function OcrReviewQueue() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [search, setSearch] = useState('');
  const [reviewingDoc, setReviewingDoc] = useState<any>(null);

  const { data, isLoading } = useOcrReviewQueue(page, pageSize);
  const { data: totalCount } = useOcrReviewCount();

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  // Client-side filter on provider name / file name
  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(item =>
      item.originalFileName.toLowerCase().includes(q) ||
      `${item.provider.firstName} ${item.provider.lastName}`.toLowerCase().includes(q) ||
      item.provider.npi.includes(q)
    );
  }, [items, search]);

  const handleReviewClose = () => {
    setReviewingDoc(null);
    // Invalidate queue so approved items disappear
    queryClient.invalidateQueries({ queryKey: ['ocr-review-queue'] });
    queryClient.invalidateQueries({ queryKey: ['ocr-review-count'] });
  };

  return (
    <PageTransition>
      <div>
        {/* Header */}
        <div className="sm:flex sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">OCR Review Queue</h1>
            <p className="mt-1 text-sm text-gray-500">
              {totalCount != null && totalCount > 0
                ? `${totalCount} document${totalCount === 1 ? '' : 's'} awaiting review`
                : 'All documents reviewed'}
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Filter by provider name, file name, or NPI..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden animate-pulse">
            <div className="bg-gray-50 px-6 py-3 flex gap-8">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="h-3 w-20 bg-gray-200 rounded" />
              ))}
            </div>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="px-6 py-4 flex gap-8 border-t border-gray-100">
                <div className="h-4 w-40 bg-gray-200 rounded" />
                <div className="h-4 w-32 bg-gray-200 rounded" />
                <div className="h-4 w-24 bg-gray-200 rounded" />
                <div className="h-4 w-16 bg-gray-200 rounded" />
                <div className="h-4 w-24 bg-gray-200 rounded" />
                <div className="h-4 w-16 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 py-12">
            <EmptyState
              illustration="folder"
              title={search ? 'No matching documents' : 'Queue is clear'}
              description={search ? 'Try adjusting your search terms.' : 'All documents have been reviewed.'}
            />
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50/80">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Document
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Provider
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Confidence
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Uploaded
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredItems.map(item => {
                  const confBadge = getConfidenceBadge(item.ocrConfidence);
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-gray-50/50 transition-colors cursor-pointer"
                      onClick={() => setReviewingDoc(item)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-sm font-medium text-gray-900 truncate max-w-[200px]">
                          {item.originalFileName}
                        </p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-900">
                          {item.provider.firstName} {item.provider.lastName}
                        </p>
                        <p className="text-xs text-gray-500">{item.provider.npi}</p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {DOCUMENT_TYPE_LABELS[item.documentType] ?? item.documentType}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {confBadge ? (
                          <StatusBadge label={confBadge.label} variant={confBadge.variant} dot />
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {format(new Date(item.createdAt), 'MMM d, yyyy')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setReviewingDoc(item);
                          }}
                          className="text-primary-600 hover:text-primary-900 inline-flex items-center gap-1 text-sm font-medium"
                          title="Review"
                        >
                          <DocumentMagnifyingGlassIcon className="h-4 w-4" />
                          Review
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-gray-50/50">
                <p className="text-sm text-gray-500">
                  Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* OCR Review Modal */}
        <OcrReviewModal
          isOpen={!!reviewingDoc}
          onClose={handleReviewClose}
          document={reviewingDoc}
        />
      </div>
    </PageTransition>
  );
}
