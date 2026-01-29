import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import {
  CheckCircleIcon,
  ClockIcon,
  DocumentArrowUpIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';

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
    createdAt: string;
  }>;
}

interface ProviderChecklistProps {
  providerId: string;
  onUploadDocument: (documentType: string) => void;
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  not_started: { label: 'Not Started', icon: ClockIcon, color: 'text-gray-400' },
  pending_upload: { label: 'Pending Upload', icon: DocumentArrowUpIcon, color: 'text-yellow-500' },
  pending_review: { label: 'Pending Review', icon: ClockIcon, color: 'text-blue-500' },
  approved: { label: 'Approved', icon: CheckCircleIcon, color: 'text-green-500' },
  rejected: { label: 'Rejected', icon: XCircleIcon, color: 'text-red-500' },
};

const CHECKLIST_ITEMS = [
  {
    key: 'w9',
    label: 'W-9 Form',
    description: 'Request for Taxpayer Identification Number and Certification',
    required: true,
  },
  {
    key: 'coi',
    label: 'Certificate of Insurance (COI)',
    description: 'Professional liability/malpractice insurance certificate',
    required: true,
  },
  {
    key: 'cp575',
    label: 'IRS CP575',
    description: 'IRS letter confirming your Employer Identification Number (EIN)',
    required: true,
  },
];

export function ProviderChecklist({ providerId, onUploadDocument }: ProviderChecklistProps) {
  const queryClient = useQueryClient();
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

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
      <div className="animate-pulse space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-gray-200 rounded-lg"></div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-600 p-4 bg-red-50 rounded-lg">
        Failed to load checklist. Please try again.
      </div>
    );
  }

  const checklist = data?.data as ChecklistData | undefined;
  if (!checklist) return null;

  const getItemStatus = (key: string): string => {
    const checklistRecord = checklist as unknown as Record<string, unknown>;
    return checklistRecord[`${key}Status`] as string || 'not_started';
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

  return (
    <div className="space-y-6">
      {/* Progress Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900">Credentialing Checklist</h3>
          <span className="text-sm text-gray-500">
            {completedCount} of {CHECKLIST_ITEMS.length} completed
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-blue-600 h-3 rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {checklist.overallComplete && (
          <div className="mt-4 flex items-center text-green-600">
            <CheckCircleIcon className="h-5 w-5 mr-2" />
            <span className="font-medium">All required documents approved!</span>
          </div>
        )}
      </div>

      {/* Checklist Items */}
      <div className="space-y-4">
        {CHECKLIST_ITEMS.map((item) => {
          const status = getItemStatus(item.key);
          const statusConfig = STATUS_CONFIG[status];
          const document = getItemDocument(item.key);
          const notes = (checklist as unknown as Record<string, unknown>)[`${item.key}Notes`] as string | null;
          const isExpanded = expandedItem === item.key;
          const StatusIcon = statusConfig.icon;

          return (
            <div
              key={item.key}
              className="bg-white rounded-lg shadow overflow-hidden"
            >
              <div
                className="p-4 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedItem(isExpanded ? null : item.key)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <StatusIcon className={`h-8 w-8 ${statusConfig.color}`} />
                    <div>
                      <h4 className="font-medium text-gray-900">
                        {item.label}
                        {item.required && (
                          <span className="ml-1 text-red-500">*</span>
                        )}
                      </h4>
                      <p className="text-sm text-gray-500">{item.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        status === 'approved'
                          ? 'bg-green-100 text-green-800'
                          : status === 'rejected'
                          ? 'bg-red-100 text-red-800'
                          : status === 'pending_review'
                          ? 'bg-blue-100 text-blue-800'
                          : status === 'pending_upload'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {statusConfig.label}
                    </span>
                    <svg
                      className={`h-5 w-5 text-gray-400 transform transition-transform ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-100 pt-4">
                  {/* Document Info */}
                  {document ? (
                    <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">
                            {document.fileName}
                          </p>
                          <p className="text-sm text-gray-500">
                            Uploaded{' '}
                            {new Date(document.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onUploadDocument(item.key);
                          }}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          Replace
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mb-4">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onUploadDocument(item.key);
                        }}
                        className="w-full py-3 px-4 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center justify-center space-x-2"
                      >
                        <DocumentArrowUpIcon className="h-5 w-5" />
                        <span>Upload {item.label}</span>
                      </button>
                    </div>
                  )}

                  {/* Notes */}
                  {notes && (
                    <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-sm text-yellow-800">
                        <strong>Note:</strong> {notes}
                      </p>
                    </div>
                  )}

                  {/* Action Buttons for Admin/Staff */}
                  {status === 'pending_review' && (
                    <div className="flex space-x-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updateMutation.mutate({
                            [`${item.key}Status`]: 'approved',
                          });
                        }}
                        disabled={updateMutation.isPending}
                        className="flex-1 py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const note = prompt('Enter rejection reason:');
                          if (note) {
                            updateMutation.mutate({
                              [`${item.key}Status`]: 'rejected',
                              [`${item.key}Notes`]: note,
                            });
                          }
                        }}
                        disabled={updateMutation.isPending}
                        className="flex-1 py-2 px-4 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}

                  {status === 'rejected' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onUploadDocument(item.key);
                      }}
                      className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                      Upload New Document
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Status Legend</h4>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {Object.entries(STATUS_CONFIG).map(([key, config]) => {
            const Icon = config.icon;
            return (
              <div key={key} className="flex items-center space-x-2 text-sm">
                <Icon className={`h-4 w-4 ${config.color}`} />
                <span className="text-gray-600">{config.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ProviderChecklist;
