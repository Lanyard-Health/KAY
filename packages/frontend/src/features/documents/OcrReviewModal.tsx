import { useState, useEffect } from 'react';
import { Dialog } from '@headlessui/react';
import { XMarkIcon, CheckIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../services/api';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface OcrReviewModalProps {
  documentId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onApproved: () => void;
}

interface OcrData {
  id: string;
  ocrStatus: string;
  ocrConfidence: number | null;
  ocrReviewedAt: string | null;
  ocrData: Record<string, any> | null;
}

function useOcrResults(documentId: string | null) {
  return useQuery({
    queryKey: ['ocr-results', documentId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: OcrData }>(
        `/documents/${documentId}/ocr-results`,
      );
      return res.data.data;
    },
    enabled: !!documentId,
  });
}

function FieldConfidence({ value }: { value: number | undefined }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  return (
    <span
      className={clsx(
        'text-[10px] font-medium px-1.5 py-0.5 rounded',
        pct >= 90 ? 'bg-green-50 text-green-600' :
        pct >= 70 ? 'bg-amber-50 text-amber-600' :
        'bg-red-50 text-red-600',
      )}
    >
      {pct}%
    </span>
  );
}

export default function OcrReviewModal({ documentId, isOpen, onClose, onApproved }: OcrReviewModalProps) {
  const { data: ocrResult, isLoading } = useOcrResults(isOpen ? documentId : null);
  const [fields, setFields] = useState<Record<string, string>>({});

  // Populate editable fields when OCR data loads
  useEffect(() => {
    if (ocrResult?.ocrData) {
      const flat: Record<string, string> = {};
      for (const [key, val] of Object.entries(ocrResult.ocrData)) {
        if (key.startsWith('_')) continue; // skip internal fields
        if (typeof val === 'object' && val !== null && 'value' in val) {
          flat[key] = String(val.value ?? '');
        } else {
          flat[key] = String(val ?? '');
        }
      }
      setFields(flat);
    }
  }, [ocrResult]);

  const approve = useMutation({
    mutationFn: async () => {
      await api.put(`/documents/${documentId}/ocr-results`, {
        extractedFields: fields,
      });
    },
    onSuccess: () => {
      toast.success('OCR data approved and saved');
      onApproved();
    },
    onError: () => {
      toast.error('Failed to save OCR review');
    },
  });

  const handleFieldChange = (key: string, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const confidenceMap: Record<string, number> = {};
  if (ocrResult?.ocrData) {
    for (const [key, val] of Object.entries(ocrResult.ocrData)) {
      if (typeof val === 'object' && val !== null && 'confidence' in val) {
        confidenceMap[key] = val.confidence as number;
      }
    }
  }

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="mx-auto max-w-2xl w-full max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <Dialog.Title className="text-lg font-semibold text-gray-900">
                Review OCR Extraction
              </Dialog.Title>
              {ocrResult?.ocrConfidence != null && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Overall confidence: {Math.round(ocrResult.ocrConfidence * 100)}%
                </p>
              )}
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {isLoading ? (
              <div className="space-y-4 animate-pulse">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-1">
                    <div className="h-3 w-24 bg-gray-200 rounded" />
                    <div className="h-9 bg-gray-100 rounded-lg" />
                  </div>
                ))}
              </div>
            ) : Object.keys(fields).length === 0 ? (
              <div className="flex flex-col items-center py-10">
                <ExclamationTriangleIcon className="h-10 w-10 text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No extracted fields found.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(fields).map(([key, value]) => (
                  <div key={key}>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs font-medium text-gray-500 capitalize">
                        {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
                      </label>
                      <FieldConfidence value={confidenceMap[key]} />
                    </div>
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => handleFieldChange(key, e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => approve.mutate()}
              disabled={approve.isPending || Object.keys(fields).length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <CheckIcon className="h-4 w-4" />
              {approve.isPending ? 'Saving...' : 'Approve & Save'}
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
