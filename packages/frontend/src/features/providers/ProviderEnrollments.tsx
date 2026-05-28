import React, { useState } from 'react';
import DOMPurify from 'dompurify';
import { Combobox } from '@headlessui/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import ErrorState from '../../components/ui/ErrorState';
import { usePayerTrackOptions } from '../../hooks/usePayerTrackOptions';
import type { PayerTrackOption } from '../../hooks/usePayerTrackOptions';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  BellIcon,
  BellAlertIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  XCircleIcon,
  SparklesIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { useLaunchWorkflow, isUuid } from '../../hooks/useAgentWorkflows';
import TerminationConfirmDialog from './TerminationConfirmDialog';
import FollowUpConfigPanel from './FollowUpConfigPanel';
import FollowUpHistory from './FollowUpHistory';
import AiEmailPreviewModal from '../ai-agent/AiEmailPreviewModal';
import { useGenerateEmail } from '../../hooks/useAi';
import { useSendFollowUp } from '../../hooks/useFollowUp';
import type { GeneratedEmail } from '../../hooks/useAi';
import { notify } from '../../utils/notify';
import EnrollmentWorkflowTracker from '../../components/enrollments/EnrollmentWorkflowTracker';

interface Payer {
  id: string;
  name: string;
  payerId: string;
  payerType: string;
}

interface Enrollment {
  id: string;
  providerId: string;
  payerId: string;
  status: string;
  productTypes: string[];
  applicationDate: string | null;
  effectiveDate: string | null;
  terminationDate: string | null;
  dateContractReceived: string | null;
  dateContractSigned: string | null;
  lastFollowUpDate: string | null;
  recredentialingDate: string | null;
  providerNumber: string | null;
  groupNumber: string | null;
  notes: string | null;
  payerEmail: string | null;
  payer: Payer;
  // Follow-up automation fields
  followUpEnabled: boolean;
  followUpEmail: string | null;
  followUpFrequencyDays: number;
  lastFollowUpSentAt: string | null;
  nextFollowUpDate: string | null;
}

interface EmailPreviewData {
  providerName: string;
  providerNpi: string;
  groupNpi: string;
  practiceName: string;
  practiceCity: string;
  practiceState: string;
  payerName: string;
}

interface ProviderEnrollmentsProps {
  providerId: string;
}

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not Started', color: 'bg-gray-100 text-gray-800' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'submitted', label: 'Submitted', color: 'bg-primary-100 text-primary-800' },
  { value: 'pending_review', label: 'Pending Review', color: 'bg-purple-100 text-purple-800' },
  { value: 'approved', label: 'Approved', color: 'bg-green-100 text-green-800' },
  { value: 'denied', label: 'Denied', color: 'bg-red-100 text-red-800' },
  { value: 'terminated', label: 'Terminated', color: 'bg-gray-100 text-gray-800' },
];

const getStatusConfig = (status: string) => {
  return STATUS_OPTIONS.find((s) => s.value === status) || STATUS_OPTIONS[0];
};

const PRODUCT_TYPE_OPTIONS = [
  'Commercial',
  'Medicare',
  'Medicaid',
  'Medicare Advantage',
  'Managed Medicaid',
  'EAP',
  'Tricare',
  'Workers Comp',
];

interface EnrollmentFormData {
  payerName: string;
  payerTrackId: string | null;
  status: string;
  productTypes: string[];
  applicationDate: string;
  effectiveDate: string;
  dateContractReceived: string;
  dateContractSigned: string;
  lastFollowUpDate: string;
  recredentialingDate: string;
  providerNumber: string;
  groupNumber: string;
  notes: string;
  terminationDate: string;
  payerEmail: string;
}

const initialFormData: EnrollmentFormData = {
  payerName: '',
  payerTrackId: null,
  status: 'not_started',
  productTypes: [],
  applicationDate: '',
  effectiveDate: '',
  dateContractReceived: '',
  dateContractSigned: '',
  lastFollowUpDate: '',
  recredentialingDate: '',
  providerNumber: '',
  groupNumber: '',
  notes: '',
  terminationDate: '',
  payerEmail: '',
};

export function ProviderEnrollments({ providerId }: ProviderEnrollmentsProps) {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEnrollment, setEditingEnrollment] = useState<Enrollment | null>(null);

  // Follow-up modal state
  const [followUpModalOpen, setFollowUpModalOpen] = useState(false);
  const [followUpEnrollment, setFollowUpEnrollment] = useState<Enrollment | null>(null);
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<{ success: boolean; message: string } | null>(null);
  const [emailPreviewData, setEmailPreviewData] = useState<EmailPreviewData | null>(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [emailPreviewHtml, setEmailPreviewHtml] = useState('');
  const [emailPreviewSubject, setEmailPreviewSubject] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [editableEmailBody, setEditableEmailBody] = useState('');
  const [followUpTab, setFollowUpTab] = useState<'send' | 'settings' | 'history'>('send');
  const [aiPreviewOpen, setAiPreviewOpen] = useState(false);
  const [aiGeneratedEmail, setAiGeneratedEmail] = useState<GeneratedEmail | null>(null);
  const generateEmail = useGenerateEmail();
  const sendFollowUp = useSendFollowUp();
  const [formData, setFormData] = useState<EnrollmentFormData>(initialFormData);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [terminationConfirm, setTerminationConfirm] = useState(false);
  const [payerSearch, setPayerSearch] = useState('');
  const [isCustomPayer, setIsCustomPayer] = useState(false);
  const [selectedPayerTrack, setSelectedPayerTrack] = useState<PayerTrackOption | null>(null);
  const [expandedWorkflow, setExpandedWorkflow] = useState<string | null>(null);
  const [launchAgentFor, setLaunchAgentFor] = useState<Enrollment | null>(null);
  const launchWorkflow = useLaunchWorkflow();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['enrollments', providerId],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: Enrollment[] }>(`/enrollments/provider/${providerId}`);
      return response.data;
    },
  });

  // Fetch payer track options for the Combobox dropdown
  const { data: payerTrackData } = usePayerTrackOptions(payerSearch);
  const payerTrackOptions = payerTrackData?.data || [];

  const createMutation = useMutation({
    mutationFn: (data: EnrollmentFormData) =>
      api.post(`/enrollments/provider/${providerId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', providerId] });
      queryClient.invalidateQueries({ queryKey: ['all-enrollments'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-full'] });
      closeModal();
      notify.success('Enrollment created');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || 'Failed to create enrollment';
      notify.error(message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EnrollmentFormData> }) =>
      api.put(`/enrollments/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', providerId] });
      queryClient.invalidateQueries({ queryKey: ['all-enrollments'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-full'] });
      closeModal();
      notify.success('Enrollment updated');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || 'Failed to update enrollment';
      notify.error(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/enrollments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', providerId] });
      queryClient.invalidateQueries({ queryKey: ['all-enrollments'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-full'] });
      setDeleteConfirm(null);
      notify.success('Enrollment deleted');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || 'Failed to delete enrollment';
      notify.error(message);
    },
  });

  const openFollowUpModal = async (enrollment: Enrollment) => {
    setFollowUpEnrollment(enrollment);
    setTestEmailResult(null);
    setRecipientEmail('');
    setCustomMessage('');
    setAttachment(null);
    setFollowUpTab('send');
    setAiGeneratedEmail(null);
    setFollowUpModalOpen(true);

    // Fetch email preview data
    try {
      const response = await api.get<{ success: boolean; data: EmailPreviewData }>(
        `/follow-up/enrollment/${enrollment.id}/preview`
      );
      if (response.data.success) {
        setEmailPreviewData(response.data.data);
      }
    } catch (err) {
      console.error('Failed to load preview data:', err);
    }
  };

  const handleAiDraft = () => {
    if (!followUpEnrollment) return;
    generateEmail.mutate(
      { enrollmentId: followUpEnrollment.id },
      {
        onSuccess: (result) => {
          setAiGeneratedEmail(result.data.email);
          setAiPreviewOpen(true);
        },
      }
    );
  };

  const handleAiSend = (email: GeneratedEmail) => {
    if (!followUpEnrollment || !recipientEmail) {
      notify.error('Enter a recipient email first');
      return;
    }
    sendFollowUp.mutate(
      {
        enrollmentId: followUpEnrollment.id,
        email: recipientEmail,
        customMessage: email.body,
      },
      {
        onSuccess: () => {
          setAiPreviewOpen(false);
          setAiGeneratedEmail(null);
          setTestEmailResult({ success: true, message: 'AI-generated email sent!' });
        },
      }
    );
  };

  const handlePreviewEmail = async () => {
    if (!followUpEnrollment) return;
    setPreviewLoading(true);
    try {
      const response = await api.post<{ success: boolean; data: { subject: string; html: string } }>(
        `/follow-up/enrollment/${followUpEnrollment.id}/preview-html`,
        { customMessage }
      );
      if (response.data.success) {
        setEmailPreviewSubject(response.data.data.subject);
        setEmailPreviewHtml(response.data.data.html);
        // Convert HTML to plain text for editing (extract the body content)
        const parser = new DOMParser();
        const doc = parser.parseFromString(DOMPurify.sanitize(response.data.data.html), 'text/html');
        setEditableEmailBody(doc.body.innerText || '');
        setEditingEmail(false);
        setShowEmailPreview(true);
      }
    } catch (err) {
      console.error('Failed to generate preview:', err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSendFollowUpEmail = async () => {
    if (!followUpEnrollment || !recipientEmail) return;
    setTestEmailSending(true);
    setTestEmailResult(null);

    try {
      const formData = new FormData();
      formData.append('email', recipientEmail);
      if (customMessage) {
        formData.append('customMessage', customMessage);
      }
      if (attachment) {
        formData.append('attachment', attachment);
      }

      const response = await api.upload(`/follow-up/enrollment/${followUpEnrollment.id}/send`, formData);
      const result = response.data;

      if (result.success) {
        setTestEmailResult({ success: true, message: 'Follow-up email sent successfully!' });
        // Refresh the enrollments to show updated last follow-up date
        queryClient.invalidateQueries({ queryKey: ['enrollments', providerId] });
      } else {
        setTestEmailResult({ success: false, message: result.error || 'Failed to send email' });
      }
    } catch (err) {
      setTestEmailResult({ success: false, message: 'Failed to send email' });
    } finally {
      setTestEmailSending(false);
    }
  };

  const openCreateModal = () => {
    setEditingEnrollment(null);
    setFormData(initialFormData);
    setPayerSearch('');
    setIsCustomPayer(false);
    setSelectedPayerTrack(null);
    setIsModalOpen(true);
  };

  const openEditModal = (enrollment: Enrollment) => {
    setEditingEnrollment(enrollment);
    setFormData({
      payerName: enrollment.payer.name,
      payerTrackId: null,
      status: enrollment.status,
      productTypes: enrollment.productTypes || [],
      applicationDate: enrollment.applicationDate?.split('T')[0] || '',
      effectiveDate: enrollment.effectiveDate?.split('T')[0] || '',
      dateContractReceived: enrollment.dateContractReceived?.split('T')[0] || '',
      dateContractSigned: enrollment.dateContractSigned?.split('T')[0] || '',
      lastFollowUpDate: enrollment.lastFollowUpDate?.split('T')[0] || '',
      recredentialingDate: enrollment.recredentialingDate?.split('T')[0] || '',
      providerNumber: enrollment.providerNumber || '',
      groupNumber: enrollment.groupNumber || '',
      notes: enrollment.notes || '',
      terminationDate: enrollment.terminationDate?.split('T')[0] || '',
      payerEmail: enrollment.payerEmail || '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingEnrollment(null);
    setFormData(initialFormData);
    setPayerSearch('');
    setIsCustomPayer(false);
    setSelectedPayerTrack(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // If setting terminationDate for the first time, show confirmation dialog
    if (
      editingEnrollment &&
      formData.terminationDate &&
      !editingEnrollment.terminationDate
    ) {
      setTerminationConfirm(true);
      return;
    }
    submitForm();
  };

  const submitForm = () => {
    if (!formData.payerName.trim()) {
      notify.error('Please select or enter a payer name');
      return;
    }
    if (editingEnrollment) {
      updateMutation.mutate(
        { id: editingEnrollment.id, data: formData },
        {
          onSuccess: () => {
            if (formData.terminationDate && !editingEnrollment.terminationDate) {
              notify.success('Enrollment updated. Termination workflow tasks have been created.');
            }
          },
        }
      );
    } else {
      createMutation.mutate(formData);
    }
  };

  const enrollments = (data?.data as Enrollment[] | undefined) || [];

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-gray-200 rounded-lg"></div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Couldn't load enrollments"
        message="Check your connection and try again."
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Insurance Payer Enrollments</h3>
          <p className="text-sm text-gray-500">
            Track enrollment status with insurance payers
          </p>
        </div>
        {enrollments.length > 0 && (
          <button
            onClick={openCreateModal}
            className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Add Enrollment
          </button>
        )}
      </div>

      {/* Summary Stats */}
      {enrollments.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-green-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-600">
              {enrollments.filter((e) => e.status === 'approved').length}
            </div>
            <div className="text-sm text-green-800">Approved</div>
          </div>
          <div className="bg-yellow-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-yellow-600">
              {enrollments.filter((e) => ['in_progress', 'submitted', 'pending_review'].includes(e.status)).length}
            </div>
            <div className="text-sm text-yellow-800">In Progress</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-600">
              {enrollments.filter((e) => e.status === 'not_started').length}
            </div>
            <div className="text-sm text-gray-800">Not Started</div>
          </div>
          <div className="bg-red-50 rounded-lg p-4">
            <div className="text-2xl font-bold text-red-600">
              {enrollments.filter((e) => ['denied', 'terminated'].includes(e.status)).length}
            </div>
            <div className="text-sm text-red-800">Denied/Terminated</div>
          </div>
        </div>
      )}

      {/* Enrollments List */}
      {enrollments.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <ExclamationTriangleIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Enrollments</h3>
          <p className="text-gray-500 mb-4">
            Start tracking insurance payer enrollments for this provider.
          </p>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Add First Enrollment
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Payer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Product Types
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Provider #
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Effective Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Termination Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Follow Up
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Recredentialing
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Workflow
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {enrollments.map((enrollment) => {
                const statusConfig = getStatusConfig(enrollment.status);
                const isWorkflowExpanded = expandedWorkflow === enrollment.id;
                return (
                  <React.Fragment key={enrollment.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-gray-900">
                          {enrollment.payer.name}
                        </div>
                        {enrollment.groupNumber && (
                          <div className="text-sm text-gray-500">
                            Group: {enrollment.groupNumber}
                          </div>
                        )}
                        {enrollment.payerEmail && (
                          <div className="text-xs text-gray-400">
                            {enrollment.payerEmail}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {enrollment.productTypes && enrollment.productTypes.length > 0 ? (
                            enrollment.productTypes.map((type) => (
                              <span
                                key={type}
                                className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800"
                              >
                                {type}
                              </span>
                            ))
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-medium ${statusConfig.color}`}
                        >
                          {statusConfig.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-900">
                        {enrollment.providerNumber || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                        {enrollment.effectiveDate
                          ? new Date(enrollment.effectiveDate).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                        {enrollment.terminationDate
                          ? new Date(enrollment.terminationDate).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                        {enrollment.lastFollowUpDate
                          ? new Date(enrollment.lastFollowUpDate).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                        {enrollment.recredentialingDate
                          ? new Date(enrollment.recredentialingDate).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => setExpandedWorkflow(isWorkflowExpanded ? null : enrollment.id)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-800 transition-colors"
                          title="View workflow steps"
                        >
                          {isWorkflowExpanded ? (
                            <ChevronDownIcon className="w-4 h-4" />
                          ) : (
                            <ChevronRightIcon className="w-4 h-4" />
                          )}
                          Steps
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        {/* Agent workflow button - for non-terminal enrollments with UUID provider */}
                        {!['approved', 'denied', 'terminated'].includes(enrollment.status) && isUuid(providerId) && (
                          <button
                            onClick={() => setLaunchAgentFor(enrollment)}
                            className="mr-3 text-purple-500 hover:text-purple-700"
                            title="Launch AI Agent"
                          >
                            <SparklesIcon className="h-5 w-5" />
                          </button>
                        )}
                        {/* Follow-up button - only for active enrollments */}
                        {!['approved', 'denied', 'terminated'].includes(enrollment.status) && (
                          <button
                            onClick={() => openFollowUpModal(enrollment)}
                            className={`mr-3 ${
                              enrollment.followUpEnabled
                                ? 'text-green-600 hover:text-green-800'
                                : 'text-gray-400 hover:text-primary-600'
                            }`}
                            title={enrollment.followUpEnabled ? 'Follow-up enabled' : 'Set up follow-up'}
                          >
                            {enrollment.followUpEnabled ? (
                              <BellAlertIcon className="h-5 w-5" />
                            ) : (
                              <BellIcon className="h-5 w-5" />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => openEditModal(enrollment)}
                          className="text-primary-600 hover:text-primary-800 mr-3"
                          title="Edit"
                        >
                          <PencilIcon className="h-5 w-5" />
                        </button>
                        {deleteConfirm === enrollment.id ? (
                          <span className="space-x-2">
                            <button
                              onClick={() => deleteMutation.mutate(enrollment.id)}
                              className="text-red-600 hover:text-red-800 text-sm font-medium"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="text-gray-600 hover:text-gray-800 text-sm"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(enrollment.id)}
                            className="text-red-600 hover:text-red-800"
                            title="Delete"
                          >
                            <TrashIcon className="h-5 w-5" />
                          </button>
                        )}
                      </td>
                    </tr>
                    {/* Expandable Workflow Row */}
                    {isWorkflowExpanded && (
                      <tr>
                        <td colSpan={12} className="px-6 py-4 bg-slate-50">
                          <EnrollmentWorkflowTracker
                            enrollmentId={enrollment.id}
                            onEnrollmentStatusChange={() => {
                              queryClient.invalidateQueries({ queryKey: ['enrollments', providerId] });
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div
              className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm"
              onClick={closeModal}
            />

            <div className="relative z-10 inline-block w-full max-w-lg p-6 my-8 text-left align-middle bg-white rounded-2xl shadow-xl">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                {editingEnrollment ? 'Edit Enrollment' : 'Add New Enrollment'}
              </h3>

              <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payer *
                  </label>
                  {editingEnrollment ? (
                    <input
                      type="text"
                      value={formData.payerName}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 text-gray-600"
                      disabled
                    />
                  ) : isCustomPayer ? (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-gray-500">Custom payer</span>
                        <button
                          type="button"
                          onClick={() => {
                            setIsCustomPayer(false);
                            setFormData({ ...formData, payerName: '', payerTrackId: null });
                            setSelectedPayerTrack(null);
                            setPayerSearch('');
                          }}
                          className="text-xs text-primary-600 hover:text-primary-800 underline"
                        >
                          Back to search
                        </button>
                      </div>
                      <input
                        type="text"
                        value={formData.payerName}
                        onChange={(e) => setFormData({ ...formData, payerName: e.target.value, payerTrackId: null })}
                        placeholder="Enter payer name..."
                        required
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  ) : (
                    <Combobox
                      value={selectedPayerTrack}
                      onChange={(option: PayerTrackOption | { id: 'custom' } | null) => {
                        if (!option) return;
                        if (option.id === 'custom') {
                          setIsCustomPayer(true);
                          setSelectedPayerTrack(null);
                          setFormData({ ...formData, payerName: '', payerTrackId: null });
                        } else {
                          const track = option as PayerTrackOption;
                          setSelectedPayerTrack(track);
                          setFormData({
                            ...formData,
                            payerName: track.payerName,
                            payerTrackId: track.id,
                          });
                        }
                        setPayerSearch('');
                      }}
                    >
                      <div className="relative">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none z-10" />
                        <Combobox.Input
                          className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                          placeholder="Search payers..."
                          displayValue={(opt: PayerTrackOption | null) =>
                            opt ? `${opt.payerName} \u2014 ${opt.track} (${opt.stateRegion})` : ''
                          }
                          onChange={(e) => setPayerSearch(e.target.value)}
                        />
                        <Combobox.Options className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                          {payerTrackOptions.length > 0 ? (
                            payerTrackOptions.map((opt) => (
                              <Combobox.Option
                                key={opt.id}
                                value={opt}
                                className={({ active }) =>
                                  `cursor-pointer select-none px-4 py-2 ${active ? 'bg-primary-50' : ''}`
                                }
                              >
                                <div className="font-medium text-gray-900">{opt.payerName}</div>
                                <div className="text-xs text-gray-500">
                                  {opt.track} &middot; {opt.stateRegion} &middot; {opt.submissionMethod}
                                </div>
                              </Combobox.Option>
                            ))
                          ) : (
                            <div className="px-4 py-3 text-sm text-gray-500">
                              No payer tracks found. Try a different search or use &ldquo;Custom&rdquo; below.
                            </div>
                          )}
                          <Combobox.Option
                            value={{ id: 'custom' as const }}
                            className={({ active }) =>
                              `cursor-pointer select-none px-4 py-2 border-t border-gray-200 ${active ? 'bg-gray-50' : ''}`
                            }
                          >
                            <div className="text-sm text-gray-500 italic">Custom / Not Listed</div>
                          </Combobox.Option>
                        </Combobox.Options>
                      </div>
                    </Combobox>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Product Types
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PRODUCT_TYPE_OPTIONS.map((type) => (
                      <label
                        key={type}
                        className={`inline-flex items-center px-3 py-1 rounded-full text-sm cursor-pointer border ${
                          formData.productTypes.includes(type)
                            ? 'bg-primary-100 border-primary-500 text-primary-800'
                            : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.productTypes.includes(type)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                productTypes: [...formData.productTypes, type],
                              });
                            } else {
                              setFormData({
                                ...formData,
                                productTypes: formData.productTypes.filter((t) => t !== type),
                              });
                            }
                          }}
                          className="sr-only"
                        />
                        {type}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData({ ...formData, status: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Provider Number
                    </label>
                    <input
                      type="text"
                      value={formData.providerNumber}
                      onChange={(e) =>
                        setFormData({ ...formData, providerNumber: e.target.value })
                      }
                      placeholder="Assigned provider #"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Group Number
                    </label>
                    <input
                      type="text"
                      value={formData.groupNumber}
                      onChange={(e) =>
                        setFormData({ ...formData, groupNumber: e.target.value })
                      }
                      placeholder="Group #"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>

                <div className="border-t pt-4 mt-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-3">Key Dates</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Submission Date
                      </label>
                      <input
                        type="date"
                        value={formData.applicationDate}
                        onChange={(e) =>
                          setFormData({ ...formData, applicationDate: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Effective Date
                      </label>
                      <input
                        type="date"
                        value={formData.effectiveDate}
                        onChange={(e) =>
                          setFormData({ ...formData, effectiveDate: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Contract Received
                      </label>
                      <input
                        type="date"
                        value={formData.dateContractReceived}
                        onChange={(e) =>
                          setFormData({ ...formData, dateContractReceived: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Contract Signed
                      </label>
                      <input
                        type="date"
                        value={formData.dateContractSigned}
                        onChange={(e) =>
                          setFormData({ ...formData, dateContractSigned: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Last Follow Up
                      </label>
                      <input
                        type="date"
                        value={formData.lastFollowUpDate}
                        onChange={(e) =>
                          setFormData({ ...formData, lastFollowUpDate: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Recredentialing Date
                      </label>
                      <input
                        type="date"
                        value={formData.recredentialingDate}
                        onChange={(e) =>
                          setFormData({ ...formData, recredentialingDate: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Termination Date
                      </label>
                      <input
                        type="date"
                        value={formData.terminationDate}
                        onChange={(e) =>
                          setFormData({ ...formData, terminationDate: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                      {formData.terminationDate && editingEnrollment && !editingEnrollment.terminationDate && (
                        <p className="text-xs text-yellow-600 mt-1">
                          Setting a termination date will create workflow tasks.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Payer Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payer Email
                  </label>
                  <input
                    type="email"
                    value={formData.payerEmail}
                    onChange={(e) =>
                      setFormData({ ...formData, payerEmail: e.target.value })
                    }
                    placeholder="payer-credentialing@insurance.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Used for sending termination letters to this payer.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                    rows={3}
                    placeholder="Any additional notes..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                  >
                    {createMutation.isPending || updateMutation.isPending
                      ? 'Saving...'
                      : editingEnrollment
                      ? 'Update'
                      : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Follow-up Email Modal */}
      {followUpModalOpen && followUpEnrollment && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div
              className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm"
              onClick={() => setFollowUpModalOpen(false)}
            />

            <div className="relative z-10 inline-block w-full max-w-lg p-6 my-8 text-left align-middle bg-white rounded-2xl shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">
                  Follow-Up: {followUpEnrollment.payer.name}
                </h3>
                <button
                  onClick={() => setFollowUpModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircleIcon className="h-6 w-6" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-200 mb-4">
                {(['send', 'settings', 'history'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setFollowUpTab(tab)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                      followUpTab === tab
                        ? 'border-primary-600 text-primary-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {tab === 'send' ? 'Send' : tab === 'settings' ? 'Settings' : 'History'}
                  </button>
                ))}
              </div>

              {/* Tab: Send */}
              {followUpTab === 'send' && (
                <>
                  {/* Provider Data Preview */}
                  {emailPreviewData && (
                    <div className="mb-5 p-4 bg-slate-50 rounded-lg border border-slate-200">
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                        Provider Information (included in email)
                      </h4>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-slate-500">Name:</span>
                          <p className="font-medium text-slate-900">{emailPreviewData.providerName}</p>
                        </div>
                        <div>
                          <span className="text-slate-500">Provider NPI:</span>
                          <p className="font-medium text-slate-900">{emailPreviewData.providerNpi}</p>
                        </div>
                        {emailPreviewData.groupNpi && (
                          <div>
                            <span className="text-slate-500">Group NPI:</span>
                            <p className="font-medium text-slate-900">{emailPreviewData.groupNpi}</p>
                          </div>
                        )}
                        {emailPreviewData.practiceName && (
                          <div>
                            <span className="text-slate-500">Practice:</span>
                            <p className="font-medium text-slate-900">{emailPreviewData.practiceName}</p>
                          </div>
                        )}
                        {(emailPreviewData.practiceCity || emailPreviewData.practiceState) && (
                          <div>
                            <span className="text-slate-500">Location:</span>
                            <p className="font-medium text-slate-900">
                              {emailPreviewData.practiceCity}{emailPreviewData.practiceCity && emailPreviewData.practiceState && ', '}{emailPreviewData.practiceState}
                            </p>
                          </div>
                        )}
                        <div>
                          <span className="text-slate-500">Payer:</span>
                          <p className="font-medium text-slate-900">{emailPreviewData.payerName}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    {/* Recipient Email */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Send to (Payer Email) *
                      </label>
                      <input
                        type="email"
                        value={recipientEmail}
                        onChange={(e) => setRecipientEmail(e.target.value)}
                        placeholder="payer-credentialing@insurance.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>

                    {/* Custom Message */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Additional Message (optional)
                      </label>
                      <textarea
                        value={customMessage}
                        onChange={(e) => setCustomMessage(e.target.value)}
                        rows={3}
                        placeholder="Add any specific notes or questions..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>

                    {/* Attachment */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Attachment (optional)
                      </label>
                      <div className="mt-1">
                        {attachment ? (
                          <div className="flex items-center justify-between p-3 bg-primary-50 border border-primary-200 rounded-lg">
                            <div className="flex items-center gap-2">
                              <svg className="h-5 w-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                              </svg>
                              <span className="text-sm text-primary-800 font-medium">{attachment.name}</span>
                              <span className="text-xs text-primary-600">({(attachment.size / 1024).toFixed(1)} KB)</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setAttachment(null)}
                              className="text-primary-600 hover:text-primary-800"
                            >
                              <XCircleIcon className="h-5 w-5" />
                            </button>
                          </div>
                        ) : (
                          <label className="flex items-center justify-center w-full p-4 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors">
                            <div className="text-center">
                              <svg className="mx-auto h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                              </svg>
                              <p className="mt-1 text-sm text-gray-600">Click to upload a file</p>
                              <p className="text-xs text-gray-500">PDF, DOC, or image (max 10MB)</p>
                            </div>
                            <input
                              type="file"
                              className="hidden"
                              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) setAttachment(file);
                              }}
                            />
                          </label>
                        )}
                      </div>
                    </div>

                    {/* Last sent info */}
                    {followUpEnrollment.lastFollowUpSentAt && (
                      <div className="p-3 bg-gray-50 rounded-lg text-sm">
                        <p className="text-gray-600">
                          <strong>Last follow-up sent:</strong>{' '}
                          {new Date(followUpEnrollment.lastFollowUpSentAt).toLocaleString()}
                        </p>
                      </div>
                    )}

                    {/* Result Message */}
                    {testEmailResult && (
                      <div
                        className={`p-3 rounded-lg flex items-center gap-2 ${
                          testEmailResult.success
                            ? 'bg-green-50 text-green-800'
                            : 'bg-red-50 text-red-800'
                        }`}
                      >
                        {testEmailResult.success ? (
                          <CheckCircleIcon className="h-5 w-5 text-green-500" />
                        ) : (
                          <XCircleIcon className="h-5 w-5 text-red-500" />
                        )}
                        <span className="text-sm">{testEmailResult.message}</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-6 flex justify-between">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handlePreviewEmail}
                        disabled={previewLoading}
                        className="inline-flex items-center px-3 py-2 text-primary-600 bg-primary-50 rounded-md hover:bg-primary-100 disabled:opacity-50 text-sm"
                      >
                        <svg className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        {previewLoading ? 'Loading...' : 'Preview'}
                      </button>
                      <button
                        type="button"
                        onClick={handleAiDraft}
                        disabled={generateEmail.isPending}
                        className="inline-flex items-center px-3 py-2 text-purple-700 bg-purple-50 rounded-md hover:bg-purple-100 disabled:opacity-50 text-sm"
                      >
                        <SparklesIcon className="h-4 w-4 mr-1.5" />
                        {generateEmail.isPending ? 'Generating...' : 'AI Draft'}
                      </button>
                    </div>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setFollowUpModalOpen(false)}
                        className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSendFollowUpEmail}
                        disabled={!recipientEmail || testEmailSending}
                        className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                      >
                        <PaperAirplaneIcon className="h-4 w-4 mr-2" />
                        {testEmailSending ? 'Sending...' : 'Send Email'}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* Tab: Settings */}
              {followUpTab === 'settings' && (
                <FollowUpConfigPanel enrollmentId={followUpEnrollment.id} />
              )}

              {/* Tab: History */}
              {followUpTab === 'history' && (
                <FollowUpHistory enrollmentId={followUpEnrollment.id} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Termination Confirmation Dialog */}
      {terminationConfirm && (
        <TerminationConfirmDialog
          enrollmentCount={enrollments.filter((e) => e.effectiveDate).length}
          onConfirm={() => {
            setTerminationConfirm(false);
            submitForm();
          }}
          onCancel={() => setTerminationConfirm(false)}
        />
      )}

      {/* AI Email Preview Modal */}
      {aiPreviewOpen && aiGeneratedEmail && followUpEnrollment && (
        <AiEmailPreviewModal
          isOpen={aiPreviewOpen}
          onClose={() => { setAiPreviewOpen(false); setAiGeneratedEmail(null); }}
          email={aiGeneratedEmail}
          enrollmentId={followUpEnrollment.id}
          recommendationId=""
          providerName={emailPreviewData?.providerName || ''}
          payerName={followUpEnrollment.payer.name}
          onSend={handleAiSend}
          sendPending={sendFollowUp.isPending}
        />
      )}

      {/* Agent Launch Confirmation Modal */}
      {launchAgentFor && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div
              className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm"
              onClick={() => setLaunchAgentFor(null)}
            />
            <div className="relative z-10 inline-block w-full max-w-md p-6 my-8 text-left align-middle bg-white rounded-2xl shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center justify-center h-10 w-10 rounded-full bg-purple-100">
                  <SparklesIcon className="h-5 w-5 text-purple-600" />
                </div>
                <h3 className="text-lg font-medium text-gray-900">Launch AI Agent</h3>
              </div>
              <p className="text-sm text-gray-600 mb-2">
                Launch an AI agent to automate the enrollment process with{' '}
                <span className="font-medium">{launchAgentFor.payer.name}</span>.
              </p>
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-3 mb-4">
                The agent will analyze requirements, gather documents, and fill forms. You'll be asked to approve key actions before they execute.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setLaunchAgentFor(null)}
                  className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const goal = `Complete payer enrollment with ${launchAgentFor.payer.name}`;
                    const enrollmentId = launchAgentFor.id;
                    launchWorkflow.mutateAsync({
                      goal,
                      providerId,
                      payerId: launchAgentFor.payerId,
                      enrollmentId,
                    }).then(() => {
                      setLaunchAgentFor(null);
                      setExpandedWorkflow(enrollmentId);
                    });
                  }}
                  disabled={launchWorkflow.isPending}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  <SparklesIcon className="h-4 w-4 mr-2" />
                  {launchWorkflow.isPending ? 'Launching...' : 'Launch Agent'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Email Preview Modal */}
      {showEmailPreview && (
        <div className="fixed inset-0 z-[60] overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div
              className="fixed inset-0 transition-opacity bg-gray-900/40 backdrop-blur-sm"
              onClick={() => setShowEmailPreview(false)}
            />

            <div className="relative z-10 inline-block w-full max-w-2xl my-8 text-left align-middle bg-white rounded-2xl shadow-xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-b">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-medium text-gray-900">
                      {editingEmail ? 'Edit Email' : 'Email Preview'}
                    </h3>
                    <button
                      onClick={() => setEditingEmail(!editingEmail)}
                      className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded ${
                        editingEmail
                          ? 'bg-primary-100 text-primary-700'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      <PencilIcon className="h-3 w-3 mr-1" />
                      {editingEmail ? 'Editing' : 'Edit'}
                    </button>
                  </div>
                  {!editingEmail && (
                    <p className="text-sm text-gray-500 mt-1">
                      <strong>Subject:</strong> {emailPreviewSubject}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setShowEmailPreview(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircleIcon className="h-6 w-6" />
                </button>
              </div>

              {editingEmail ? (
                <div className="p-4">
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Subject
                    </label>
                    <input
                      type="text"
                      value={emailPreviewSubject}
                      onChange={(e) => setEmailPreviewSubject(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email Body
                    </label>
                    <textarea
                      value={editableEmailBody}
                      onChange={(e) => setEditableEmailBody(e.target.value)}
                      rows={16}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                    />
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    Note: Editing the email will send it as plain text instead of the formatted HTML version.
                  </p>
                </div>
              ) : (
                <div className="p-4 bg-gray-100 max-h-[70vh] overflow-y-auto">
                  <div
                    className="bg-white rounded-lg shadow-sm"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailPreviewHtml) }}
                  />
                </div>
              )}

              <div className="flex justify-between gap-3 px-6 py-4 bg-gray-50 border-t">
                <button
                  type="button"
                  onClick={() => {
                    setShowEmailPreview(false);
                    setEditingEmail(false);
                  }}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Close
                </button>
                <div className="flex gap-3">
                  {editingEmail && (
                    <button
                      type="button"
                      onClick={() => handlePreviewEmail()}
                      className="px-4 py-2 text-primary-600 bg-primary-50 rounded-md hover:bg-primary-100"
                    >
                      Reset to Template
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmailPreview(false);
                      setEditingEmail(false);
                    }}
                    className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
                  >
                    {editingEmail ? 'Done Editing' : 'Looks Good'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProviderEnrollments;
