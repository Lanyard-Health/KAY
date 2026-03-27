import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PageTransition from '../../components/ui/PageTransition';
import EmptyState from '../../components/ui/EmptyState';
import { DocumentMagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import { format } from 'date-fns';
import OcrReviewModal from './OcrReviewModal';

interface OcrQueueItem {
  id: string;
  originalFileName: string;
  documentType: string;
  mimeType: string;
  ocrStatus: string;
  ocrConfidence: number | null;
  createdAt: string;
  provider: {
    id: string;
    firstName: string;
    lastName: string;
    npi: string;
  };
}

function useOcrReviewQueue(page: number) {
  return useQuery({
    queryKey: ['ocr-review-queue', page],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: OcrQueueItem[]; total: number; page: number; pageSize: number };
      }>(`/documents/ocr-review-queue?page=${page}&pageSize=25`);
      return res.data.data;
    },
  });
}

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence == null) return <span className="text-xs text-gray-400">N/A</span>;
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 90 ? 'bg-green-50 text-green-700' :
    pct >= 70 ? 'bg-amber-50 text-amber-700' :
    'bg-red-50 text-red-700';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {pct}%
    </span>
  );
}

export default function OcrReviewQueue() {
  const [page, setPage] = useState(1);
  const [reviewingDocId, setReviewingDocId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useOcrReviewQueue(page);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 25;
  const totalPages = Math.ceil(total / pageSize);

  const handleReviewComplete = () => {
    setReviewingDocId(null);
    queryClient.invalidateQueries({ queryKey: ['ocr-review-queue'] });
    queryClient.invalidateQueries({ queryKey: ['ocr-review-count'] });
  };

  return (
    <PageTransition>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">OCR Review Queue</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review and approve extracted data from scanned documents.
            {total > 0 && <span className="font-medium"> {total} document{total !== 1 ? 's' : ''} pending review.</span>}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700">
            <p className="font-medium">Failed to load review queue</p>
          </div>
        )}

        {isLoading ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-gray-100 animate-pulse">
                <div className="h-10 w-10 bg-gray-200 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 bg-gray-200 rounded" />
                  <div className="h-3 w-32 bg-gray-100 rounded" />
                </div>
                <div className="h-6 w-16 bg-gray-100 rounded-full" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-12">
            <EmptyState
              icon={<DocumentMagnifyingGlassIcon className="h-12 w-12" />}
              title="No documents pending review"
              description="Documents requiring OCR review will appear here after upload and processing."
            />
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div className="col-span-4">Document</div>
                <div className="col-span-3">Provider</div>
                <div className="col-span-2">Type</div>
                <div className="col-span-1">Confidence</div>
                <div className="col-span-2 text-right">Uploaded</div>
              </div>

              {/* Rows */}
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setReviewingDocId(item.id)}
                  className="w-full grid grid-cols-12 gap-4 px-6 py-4 border-b border-gray-50 hover:bg-gray-50 transition-colors text-left last:border-0"
                >
                  <div className="col-span-4 flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 bg-primary-50 rounded-xl flex items-center justify-center flex-shrink-0">
                      <DocumentMagnifyingGlassIcon className="h-5 w-5 text-primary-600" />
                    </div>
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {item.originalFileName}
                    </span>
                  </div>
                  <div className="col-span-3 flex items-center">
                    <span className="text-sm text-gray-700 truncate">
                      {item.provider.firstName} {item.provider.lastName}
                    </span>
                  </div>
                  <div className="col-span-2 flex items-center">
                    <span className="text-xs text-gray-500 capitalize">
                      {item.documentType?.replace(/_/g, ' ') || 'Unknown'}
                    </span>
                  </div>
                  <div className="col-span-1 flex items-center">
                    <ConfidenceBadge confidence={item.ocrConfidence} />
                  </div>
                  <div className="col-span-2 flex items-center justify-end">
                    <span className="text-xs text-gray-400">
                      {format(new Date(item.createdAt), 'MMM d, yyyy')}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  Page {page} of {totalPages} ({total} total)
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Review Modal */}
        <OcrReviewModal
          documentId={reviewingDocId}
          isOpen={!!reviewingDocId}
          onClose={() => setReviewingDocId(null)}
          onApproved={handleReviewComplete}
        />
      </div>
    </PageTransition>
  );
}
