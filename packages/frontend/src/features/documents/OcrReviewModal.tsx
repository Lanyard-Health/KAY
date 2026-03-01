import { Fragment, useState, useMemo } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { CheckIcon, DocumentIcon } from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import StatusBadge from '../../components/ui/StatusBadge';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useOcrResults, useUpdateOcrResults } from '../../hooks/useOcrResults';
import { api } from '../../services/api';
import { format } from 'date-fns';

interface OcrReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: {
    id: string;
    documentType: string;
    originalFileName: string;
    mimeType?: string;
  } | null;
}

const FIELD_LABELS: Record<string, string> = {
  licenseNumber: 'License Number',
  licenseType: 'License Type',
  state: 'State',
  issueDate: 'Issue Date',
  expirationDate: 'Expiration Date',
  boardName: 'Board Name',
  specialty: 'Specialty',
  initialCertificationDate: 'Initial Certification Date',
  certificationNumber: 'Certification Number',
  carrierName: 'Carrier Name',
  policyNumber: 'Policy Number',
  perClaimAmount: 'Per Claim Amount',
  aggregateAmount: 'Aggregate Amount',
  effectiveDate: 'Effective Date',
  firstName: 'First Name',
  lastName: 'Last Name',
  npi: 'NPI',
  deaNumber: 'DEA Number',
  dateOfBirth: 'Date of Birth',
  degree: 'Degree',
  school: 'School',
  graduationDate: 'Graduation Date',
};

function getFieldLabel(key: string): string {
  return FIELD_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

function getConfidenceBadge(confidence: number) {
  const pct = Math.round(confidence * 100);
  if (pct >= 90) return { variant: 'success' as const, label: `${pct}% High` };
  if (pct >= 70) return { variant: 'warning' as const, label: `${pct}% Medium` };
  return { variant: 'danger' as const, label: `${pct}% Low` };
}

function isDateField(key: string): boolean {
  return key.toLowerCase().endsWith('date');
}

function isImageMime(mime: string) {
  return mime.startsWith('image/');
}

function isPdfMime(mime: string) {
  return mime === 'application/pdf';
}

export default function OcrReviewModal({ isOpen, onClose, document: doc }: OcrReviewModalProps) {
  const { data: ocrData, isLoading } = useOcrResults(doc?.id ?? null);
  const updateMutation = useUpdateOcrResults();
  const [editedFields, setEditedFields] = useState<Record<string, { value: string; confidence: number }>>({});
  const [verifiedFields, setVerifiedFields] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);

  // Fetch download URL for document preview
  const { data: downloadData, isLoading: isUrlLoading } = useQuery({
    queryKey: ['document-download-url', doc?.id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { downloadUrl: string } }>(
        `/documents/${doc!.id}/download-url`
      );
      return res.data.data;
    },
    enabled: isOpen && !!doc,
    staleTime: 30 * 60 * 1000, // 30 min (URLs expire in 1 hour)
  });

  // Merge server data with local edits
  const fields = useMemo(() => {
    if (!ocrData?.ocrData) return {};
    return { ...ocrData.ocrData, ...editedFields };
  }, [ocrData?.ocrData, editedFields]);

  // Sort fields: low confidence first
  const sortedFieldKeys = useMemo(() => {
    return Object.keys(fields).sort((a, b) => {
      const confA = fields[a]?.confidence ?? 0;
      const confB = fields[b]?.confidence ?? 0;
      return confA - confB;
    });
  }, [fields]);

  const overallConfidence = ocrData?.ocrConfidence;
  const mimeType = doc?.mimeType ?? '';

  const handleFieldChange = (key: string, value: string) => {
    const original = ocrData?.ocrData?.[key];
    setEditedFields(prev => ({
      ...prev,
      [key]: { value, confidence: original?.confidence ?? 0 },
    }));
  };

  const toggleVerified = (key: string) => {
    setVerifiedFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleApprove = () => {
    if (!doc) return;
    updateMutation.mutate(
      { documentId: doc.id, extractedFields: fields },
      {
        onSuccess: () => {
          setShowConfirm(false);
          setEditedFields({});
          setVerifiedFields(new Set());
          onClose();
        },
      }
    );
  };

  const handleClose = () => {
    setEditedFields({});
    setVerifiedFields(new Set());
    onClose();
  };

  if (!doc) return null;

  return (
    <>
      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={handleClose}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-7xl rounded-2xl bg-white p-6 shadow-xl">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-1">
                    <Dialog.Title className="text-lg font-semibold text-gray-900">
                      OCR Review — {doc.originalFileName}
                    </Dialog.Title>
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    <StatusBadge label={getFieldLabel(doc.documentType)} variant="info" />
                    {overallConfidence != null && (
                      <span className="text-sm text-gray-500">
                        Overall: {Math.round(overallConfidence * 100)}%
                      </span>
                    )}
                  </div>

                  {ocrData?.ocrReviewedAt && (
                    <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
                      Previously reviewed on {format(new Date(ocrData.ocrReviewedAt), 'MMM d, yyyy h:mm a')}
                    </div>
                  )}

                  {/* Two-column layout */}
                  <div className="flex flex-col lg:flex-row gap-6">
                    {/* Left: Document Preview */}
                    <div className="lg:w-1/2 min-h-[24rem] lg:min-h-[32rem] bg-gray-50 rounded-xl border border-gray-200 overflow-hidden flex items-center justify-center">
                      {isUrlLoading ? (
                        <div className="flex flex-col items-center gap-2 text-gray-400">
                          <div className="h-8 w-8 border-2 border-gray-300 border-t-primary-500 rounded-full animate-spin" />
                          <span className="text-sm">Loading preview...</span>
                        </div>
                      ) : downloadData?.downloadUrl ? (
                        isPdfMime(mimeType) ? (
                          <iframe
                            src={downloadData.downloadUrl}
                            className="w-full h-full min-h-[24rem] lg:min-h-[32rem]"
                            title={doc.originalFileName}
                          />
                        ) : isImageMime(mimeType) ? (
                          <img
                            src={downloadData.downloadUrl}
                            alt={doc.originalFileName}
                            className="max-w-full max-h-full object-contain p-4"
                          />
                        ) : (
                          <div className="text-center p-6">
                            <DocumentIcon className="mx-auto h-12 w-12 text-gray-400" />
                            <p className="mt-2 text-sm text-gray-500">
                              Preview not available for this file type.
                            </p>
                            <a
                              href={downloadData.downloadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-3 inline-block text-sm font-medium text-primary-600 hover:text-primary-700"
                            >
                              Download to view
                            </a>
                          </div>
                        )
                      ) : (
                        <div className="text-center p-6">
                          <DocumentIcon className="mx-auto h-12 w-12 text-gray-400" />
                          <p className="mt-2 text-sm text-gray-500">Unable to load document preview.</p>
                        </div>
                      )}
                    </div>

                    {/* Right: Field List */}
                    <div className="lg:w-1/2">
                      {isLoading ? (
                        <div className="space-y-4 animate-pulse">
                          {[1, 2, 3].map(i => (
                            <div key={i} className="h-16 bg-gray-100 rounded-xl" />
                          ))}
                        </div>
                      ) : sortedFieldKeys.length === 0 ? (
                        <p className="text-gray-500 text-sm py-8 text-center">No OCR data available for this document.</p>
                      ) : (
                        <div className="max-h-[28rem] lg:max-h-[32rem] overflow-y-auto space-y-3 pr-1">
                          {sortedFieldKeys.map(key => {
                            const field = fields[key];
                            if (!field) return null;
                            const badge = getConfidenceBadge(field.confidence);
                            return (
                              <div key={key} className="flex items-start gap-3">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <label className="text-sm font-medium text-gray-700">
                                      {getFieldLabel(key)}
                                    </label>
                                    <StatusBadge label={badge.label} variant={badge.variant} dot />
                                  </div>
                                  <input
                                    type={isDateField(key) ? 'date' : 'text'}
                                    value={field.value}
                                    onChange={e => handleFieldChange(key, e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => toggleVerified(key)}
                                  className={`mt-7 flex-shrink-0 rounded-lg p-1.5 transition-colors ${
                                    verifiedFields.has(key)
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                                  }`}
                                  title={verifiedFields.has(key) ? 'Verified' : 'Mark as verified'}
                                >
                                  <CheckIcon className="h-4 w-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={handleClose}
                      className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowConfirm(true)}
                      disabled={sortedFieldKeys.length === 0}
                      className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 transition-colors disabled:opacity-50"
                    >
                      Approve Extraction
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleApprove}
        title="Approve OCR Extraction"
        message="This will save the reviewed fields and mark the extraction as completed. Continue?"
        confirmLabel="Approve"
        variant="info"
        isLoading={updateMutation.isPending}
      />
    </>
  );
}
