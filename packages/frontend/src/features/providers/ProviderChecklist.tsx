import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import {
  CheckCircleIcon,
  ClockIcon,
  DocumentArrowUpIcon,
  XCircleIcon,
  ArrowRightIcon,
  DocumentIcon,
  EyeIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';

interface ChecklistData {
  id: string;
  providerId: string;
  w9Status: string;
  w9DocumentId: string | null;
  w9Notes: string | null;
  coiStatus: string;
  coiDocumentId: string | null;
  coiNotes: string | null;
  cp575Status: string;
  cp575DocumentId: string | null;
  cp575Notes: string | null;
  licenseVerified: boolean;
  credentialsComplete: boolean;
  backgroundCheckComplete: boolean;
  overallComplete: boolean;
  completedAt: string | null;
  documents: Array<{
    id: string;
    documentType: string;
    fileName: string;
    fileUrl?: string;
    createdAt: string;
  }>;
}

interface ProviderChecklistProps {
  providerId: string;
  onUploadDocument: (documentType: string) => void;
}

type ItemStatus = 'not_started' | 'pending_upload' | 'pending_review' | 'approved' | 'rejected';

const STATUS_CONFIG: Record<ItemStatus, { label: string; icon: React.ComponentType<{ className?: string }>; color: string; bgColor: string; borderColor: string }> = {
  not_started: { label: 'Not Started', icon: ClockIcon, color: 'text-gray-400', bgColor: 'bg-gray-100', borderColor: 'border-gray-300' },
  pending_upload: { label: 'Pending Upload', icon: DocumentArrowUpIcon, color: 'text-yellow-600', bgColor: 'bg-yellow-50', borderColor: 'border-yellow-300' },
  pending_review: { label: 'Under Review', icon: ClockIcon, color: 'text-primary-600', bgColor: 'bg-primary-50', borderColor: 'border-primary-300' },
  approved: { label: 'Approved', icon: CheckCircleIcon, color: 'text-green-600', bgColor: 'bg-green-50', borderColor: 'border-green-300' },
  rejected: { label: 'Needs Resubmission', icon: XCircleIcon, color: 'text-red-600', bgColor: 'bg-red-50', borderColor: 'border-red-300' },
};

const CHECKLIST_ITEMS = [
  {
    key: 'w9',
    label: 'W-9 Form',
    description: 'Request for Taxpayer Identification Number and Certification',
    helpText: 'Download the W-9 form from IRS.gov, complete and sign it, then upload the signed document.',
    required: true,
  },
  {
    key: 'coi',
    label: 'Certificate of Insurance (COI)',
    description: 'Professional liability/malpractice insurance certificate',
    helpText: 'Contact your insurance provider to obtain a certificate of insurance showing your coverage details.',
    required: true,
  },
  {
    key: 'cp575',
    label: 'IRS CP575',
    description: 'IRS letter confirming your Employer Identification Number (EIN)',
    helpText: 'This is the official letter you received from the IRS when your EIN was assigned.',
    required: true,
  },
];

export function ProviderChecklist({ providerId, onUploadDocument }: ProviderChecklistProps) {
  const queryClient = useQueryClient();
  const [previewDoc, setPreviewDoc] = useState<{ url: string; name: string; type: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['checklist', providerId],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: ChecklistData }>(`/checklist/provider/${providerId}`);
      return response.data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: (updates: Record<string, unknown>) =>
      api.put(`/checklist/provider/${providerId}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist', providerId] });
    },
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-6 bg-gray-200 rounded w-1/3"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start space-x-4">
              <div className="h-10 w-10 bg-gray-200 rounded-full"></div>
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6">
        <div className="flex items-center space-x-3">
          <XCircleIcon className="h-6 w-6 text-red-500" />
          <div>
            <h3 className="font-medium text-red-800">Failed to load checklist</h3>
            <p className="text-sm text-red-600">Please refresh the page and try again.</p>
          </div>
        </div>
      </div>
    );
  }

  const checklist = data?.data as ChecklistData | undefined;
  if (!checklist) return null;

  const getItemStatus = (key: string): ItemStatus => {
    const checklistRecord = checklist as unknown as Record<string, unknown>;
    return (checklistRecord[`${key}Status`] as ItemStatus) || 'not_started';
  };

  const getItemDocument = (key: string) => {
    const checklistRecord = checklist as unknown as Record<string, unknown>;
    const docId = checklistRecord[`${key}DocumentId`] as string | null;
    if (!docId) return null;
    return checklist.documents?.find((d: { id: string }) => d.id === docId);
  };

  const completedCount = CHECKLIST_ITEMS.filter(
    (item) => getItemStatus(item.key) === 'approved'
  ).length;

  const progressPercent = (completedCount / CHECKLIST_ITEMS.length) * 100;

  // Find the "Up Next" item - first incomplete item that needs action
  const getUpNextIndex = (): number => {
    for (let i = 0; i < CHECKLIST_ITEMS.length; i++) {
      // eslint-disable-next-line security/detect-object-injection -- i is a bounded loop index
      const status = getItemStatus(CHECKLIST_ITEMS[i].key);
      if (status !== 'approved' && status !== 'pending_review') {
        return i;
      }
    }
    return -1; // All complete or in review
  };

  const upNextIndex = getUpNextIndex();

  const handlePreviewDocument = async (doc: { id: string; fileName: string }) => {
    try {
      const response = await api.get<{ success: boolean; data: { downloadUrl: string } }>(
        `/documents/${doc.id}/download-url`
      );
      const extension = doc.fileName.split('.').pop()?.toLowerCase() || '';
      setPreviewDoc({
        url: response.data.data.downloadUrl,
        name: doc.fileName,
        type: ['pdf'].includes(extension) ? 'pdf' : ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension) ? 'image' : 'other',
      });
    } catch (err) {
      console.error('Failed to get download URL:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Progress Header Card */}
      <div className="bg-gradient-to-r from-primary-600 to-primary-700 rounded-xl shadow-lg p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-semibold">Credentialing Checklist</h3>
            <p className="text-primary-100 text-sm mt-1">
              Complete all required documents to finish credentialing
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">{completedCount}/{CHECKLIST_ITEMS.length}</div>
            <div className="text-primary-100 text-sm">Completed</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="relative">
          <div className="w-full bg-primary-400/30 rounded-full h-3">
            <div
              className="bg-white h-3 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-primary-100">
            <span>Start</span>
            <span>{Math.round(progressPercent)}% Complete</span>
          </div>
        </div>

        {checklist.overallComplete && (
          <div className="mt-4 flex items-center bg-green-500/20 rounded-lg p-3">
            <CheckCircleSolidIcon className="h-6 w-6 text-green-300 mr-3" />
            <span className="font-medium">All required documents approved!</span>
          </div>
        )}
      </div>

      {/* Vertical Stepper */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <h4 className="font-semibold text-gray-900">Required Documents</h4>
          <p className="text-sm text-gray-500 mt-1">Upload each document in order to complete your credentialing</p>
        </div>

        <div className="p-6">
          {CHECKLIST_ITEMS.map((item, index) => {
            const status = getItemStatus(item.key);
            // eslint-disable-next-line security/detect-object-injection -- status is from getItemStatus which returns a typed string
            const statusConfig = STATUS_CONFIG[status];
            const document = getItemDocument(item.key);
            const notes = (checklist as unknown as Record<string, unknown>)[`${item.key}Notes`] as string | null;
            const isUpNext = index === upNextIndex;
            const isLast = index === CHECKLIST_ITEMS.length - 1;
            const isComplete = status === 'approved';
            const needsAction = status === 'not_started' || status === 'pending_upload' || status === 'rejected';

            return (
              <div key={item.key} className="relative">
                {/* Connecting Line */}
                {!isLast && (
                  <div
                    className={`absolute left-5 top-10 w-0.5 h-full -ml-px ${
                      isComplete ? 'bg-green-400' : 'bg-gray-200'
                    }`}
                    style={{ height: 'calc(100% - 2.5rem)' }}
                  />
                )}

                <div className={`relative flex items-start pb-8 ${isLast ? 'pb-0' : ''}`}>
                  {/* Step Indicator */}
                  <div className="relative z-10">
                    {isComplete ? (
                      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-500 shadow-sm">
                        <CheckCircleSolidIcon className="h-6 w-6 text-white" />
                      </div>
                    ) : isUpNext ? (
                      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary-600 shadow-lg ring-4 ring-primary-100 animate-pulse">
                        <span className="text-white font-bold">{index + 1}</span>
                      </div>
                    ) : (
                      <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                        status === 'pending_review' ? 'border-primary-400 bg-primary-50' :
                        status === 'rejected' ? 'border-red-400 bg-red-50' :
                        'border-gray-300 bg-white'
                      }`}>
                        <span className={`font-medium ${
                          status === 'pending_review' ? 'text-primary-600' :
                          status === 'rejected' ? 'text-red-600' :
                          'text-gray-400'
                        }`}>{index + 1}</span>
                      </div>
                    )}
                  </div>

                  {/* Content Card */}
                  <div className={`ml-4 flex-1 ${isUpNext ? 'transform scale-[1.02]' : ''} transition-transform duration-200`}>
                    <div className={`rounded-xl border-2 overflow-hidden transition-all duration-200 ${
                      isUpNext ? 'border-primary-400 shadow-lg shadow-primary-100' :
                      isComplete ? 'border-green-200 bg-green-50/30' :
                      status === 'pending_review' ? 'border-primary-200 bg-primary-50/30' :
                      status === 'rejected' ? 'border-red-200 bg-red-50/30' :
                      'border-gray-200 hover:border-gray-300'
                    }`}>
                      {/* Header */}
                      <div className={`p-4 ${isUpNext ? 'bg-primary-50' : ''}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              {isUpNext && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-primary-600 text-white">
                                  UP NEXT
                                </span>
                              )}
                              <h5 className={`font-semibold ${isComplete ? 'text-green-800' : 'text-gray-900'}`}>
                                {item.label}
                                {item.required && <span className="text-red-500 ml-1">*</span>}
                              </h5>
                            </div>
                            <p className="text-sm text-gray-500 mt-1">{item.description}</p>
                          </div>
                          <span className={`ml-4 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${statusConfig.bgColor} ${statusConfig.color}`}>
                            {statusConfig.label}
                          </span>
                        </div>
                      </div>

                      {/* Expanded Content */}
                      <div className="px-4 pb-4 space-y-4">
                        {/* Help Text for items needing action */}
                        {needsAction && item.helpText && (
                          <div className="flex items-start space-x-2 p-3 bg-gray-50 rounded-lg">
                            <svg className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-sm text-gray-600">{item.helpText}</p>
                          </div>
                        )}

                        {/* Document Display */}
                        {document ? (
                          <div className={`flex items-center justify-between p-3 rounded-lg ${
                            isComplete ? 'bg-green-100' : 'bg-gray-100'
                          }`}>
                            <div className="flex items-center space-x-3">
                              <DocumentIcon className={`h-8 w-8 ${isComplete ? 'text-green-600' : 'text-gray-500'}`} />
                              <div>
                                <p className="font-medium text-gray-900">{document.fileName}</p>
                                <p className="text-xs text-gray-500">
                                  Uploaded {new Date(document.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => handlePreviewDocument(document)}
                                className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                title="Preview"
                              >
                                <EyeIcon className="h-5 w-5" />
                              </button>
                              {!isComplete && (
                                <button
                                  onClick={() => onUploadDocument(item.key)}
                                  className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                  title="Replace"
                                >
                                  <ArrowPathIcon className="h-5 w-5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ) : needsAction ? (
                          <button
                            onClick={() => onUploadDocument(item.key)}
                            className={`w-full py-4 px-4 border-2 border-dashed rounded-xl transition-all duration-200 flex items-center justify-center space-x-3 ${
                              isUpNext
                                ? 'border-primary-400 bg-primary-50 text-primary-700 hover:bg-primary-100'
                                : 'border-gray-300 text-gray-600 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50'
                            }`}
                          >
                            <DocumentArrowUpIcon className="h-6 w-6" />
                            <span className="font-medium">Upload {item.label}</span>
                            {isUpNext && <ArrowRightIcon className="h-5 w-5" />}
                          </button>
                        ) : null}

                        {/* Rejection Notes */}
                        {notes && status === 'rejected' && (
                          <div className="flex items-start space-x-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                            <XCircleIcon className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-sm font-medium text-red-800">Resubmission Required</p>
                              <p className="text-sm text-red-600 mt-1">{notes}</p>
                            </div>
                          </div>
                        )}

                        {/* Admin Review Actions */}
                        {status === 'pending_review' && (
                          <div className="flex items-center space-x-3 pt-2 border-t border-gray-100">
                            <span className="text-sm text-gray-500">Admin Actions:</span>
                            <button
                              onClick={() => updateMutation.mutate({ [`${item.key}Status`]: 'approved' })}
                              disabled={updateMutation.isPending}
                              className="flex-1 py-2 px-4 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium text-sm transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => {
                                const note = prompt('Enter rejection reason:');
                                if (note) {
                                  updateMutation.mutate({
                                    [`${item.key}Status`]: 'rejected',
                                    [`${item.key}Notes`]: note,
                                  });
                                }
                              }}
                              disabled={updateMutation.isPending}
                              className="flex-1 py-2 px-4 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium text-sm transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Completion Message */}
      {checklist.overallComplete && (
        <div className="bg-gradient-to-r from-green-500 to-green-600 rounded-xl shadow-lg p-6 text-white">
          <div className="flex items-center space-x-4">
            <div className="flex-shrink-0">
              <CheckCircleSolidIcon className="h-12 w-12" />
            </div>
            <div>
              <h3 className="text-xl font-semibold">Credentialing Complete!</h3>
              <p className="text-green-100 mt-1">
                All required documents have been submitted and approved. The provider is now fully credentialed.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Document Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div
              className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"
              onClick={() => setPreviewDoc(null)}
            />
            <div className="relative inline-block bg-white rounded-2xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:max-w-4xl sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">{previewDoc.name}</h3>
                  <button
                    onClick={() => setPreviewDoc(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="border rounded-lg overflow-hidden bg-gray-50" style={{ height: '70vh' }}>
                  {previewDoc.type === 'pdf' ? (
                    <iframe
                      src={previewDoc.url}
                      className="w-full h-full"
                      title="Document Preview"
                    />
                  ) : previewDoc.type === 'image' ? (
                    <img
                      src={previewDoc.url}
                      alt={previewDoc.name}
                      className="max-w-full max-h-full object-contain mx-auto"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <DocumentIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-500">Preview not available for this file type</p>
                        <a
                          href={previewDoc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-4 inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                        >
                          Download File
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProviderChecklist;
