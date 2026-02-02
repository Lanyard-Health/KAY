import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
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
} from '@heroicons/react/24/outline';
import { usePdmStatus } from '../../hooks/usePdmStatus';
import { PdmStatusBadgeForEnrollment } from '../../components/PdmAttestationBadge';

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
  payer: Payer;
  // Follow-up automation fields
  followUpEnabled: boolean;
  followUpEmail: string | null;
  followUpFrequencyDays: number;
  lastFollowUpSentAt: string | null;
  nextFollowUpDate: string | null;
}

interface FollowUpSettings {
  enabled: boolean;
  email: string;
  frequencyDays: number;
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
  { value: 'submitted', label: 'Submitted', color: 'bg-blue-100 text-blue-800' },
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
}

const initialFormData: EnrollmentFormData = {
  payerName: '',
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
};

export function ProviderEnrollments({ providerId }: ProviderEnrollmentsProps) {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEnrollment, setEditingEnrollment] = useState<Enrollment | null>(null);

  // Follow-up modal state
  const [followUpModalOpen, setFollowUpModalOpen] = useState(false);
  const [followUpEnrollment, setFollowUpEnrollment] = useState<Enrollment | null>(null);
  const [followUpSettings, setFollowUpSettings] = useState<FollowUpSettings>({
    enabled: false,
    email: '',
    frequencyDays: 14,
  });
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
  const [formData, setFormData] = useState<EnrollmentFormData>(initialFormData);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [payerSearch, setPayerSearch] = useState('');
  const [showPayerDropdown, setShowPayerDropdown] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['enrollments', providerId],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: Enrollment[] }>(`/enrollments/provider/${providerId}`);
      return response.data;
    },
  });

  // Fetch PDM status for all enrollments
  const { data: pdmData } = usePdmStatus(providerId);
  const pdmStatuses = pdmData?.data?.statuses || [];

  // Fetch all payers for dropdown
  const { data: payersData } = useQuery({
    queryKey: ['payers'],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: Payer[] }>('/enrollments/payers');
      return response.data;
    },
  });

  const payers = (payersData?.data as Payer[] | undefined) || [];

  // Filter payers based on search
  const filteredPayers = useMemo(() => {
    if (!payerSearch.trim()) return payers.slice(0, 50); // Show first 50 if no search
    const search = payerSearch.toLowerCase();
    return payers
      .filter((p) => p.name.toLowerCase().includes(search))
      .slice(0, 50); // Limit to 50 results
  }, [payers, payerSearch]);

  const createMutation = useMutation({
    mutationFn: (data: EnrollmentFormData) =>
      api.post(`/enrollments/provider/${providerId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', providerId] });
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EnrollmentFormData> }) =>
      api.put(`/enrollments/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', providerId] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/enrollments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', providerId] });
      setDeleteConfirm(null);
    },
  });

  // Follow-up settings mutation
  const followUpMutation = useMutation({
    mutationFn: ({ id, settings }: { id: string; settings: FollowUpSettings }) =>
      api.put(`/follow-up/enrollment/${id}/settings`, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', providerId] });
      setFollowUpModalOpen(false);
      setFollowUpEnrollment(null);
    },
  });

  const openFollowUpModal = async (enrollment: Enrollment) => {
    setFollowUpEnrollment(enrollment);
    setFollowUpSettings({
      enabled: enrollment.followUpEnabled || false,
      email: enrollment.followUpEmail || '',
      frequencyDays: enrollment.followUpFrequencyDays || 14,
    });
    setTestEmailResult(null);
    setRecipientEmail('');
    setCustomMessage('');
    setAttachment(null);
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

  const handleSaveFollowUpSettings = () => {
    if (!followUpEnrollment) return;
    followUpMutation.mutate({
      id: followUpEnrollment.id,
      settings: followUpSettings,
    });
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
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = response.data.data.html;
        setEditableEmailBody(tempDiv.innerText || '');
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

      const response = await fetch(`/api/v1/follow-up/enrollment/${followUpEnrollment.id}/send`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

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
    setShowPayerDropdown(false);
    setIsModalOpen(true);
  };

  const openEditModal = (enrollment: Enrollment) => {
    setEditingEnrollment(enrollment);
    setFormData({
      payerName: enrollment.payer.name,
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
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingEnrollment(null);
    setFormData(initialFormData);
    setPayerSearch('');
    setShowPayerDropdown(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingEnrollment) {
      updateMutation.mutate({ id: editingEnrollment.id, data: formData });
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
      <div className="text-red-600 p-4 bg-red-50 rounded-lg">
        Failed to load enrollments. Please try again.
      </div>
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
        <button
          onClick={openCreateModal}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <PlusIcon className="h-5 w-5 mr-2" />
          Add Enrollment
        </button>
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
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            Add First Enrollment
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
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
                  Last Follow Up
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Recredentialing
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  PDM Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Attested
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {enrollments.map((enrollment) => {
                const statusConfig = getStatusConfig(enrollment.status);
                return (
                  <tr key={enrollment.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">
                        {enrollment.payer.name}
                      </div>
                      {enrollment.groupNumber && (
                        <div className="text-sm text-gray-500">
                          Group: {enrollment.groupNumber}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {enrollment.productTypes && enrollment.productTypes.length > 0 ? (
                          enrollment.productTypes.map((type) => (
                            <span
                              key={type}
                              className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
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
                      <PdmStatusBadgeForEnrollment
                        enrollmentId={enrollment.id}
                        statuses={pdmStatuses}
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                      {pdmStatuses.find((s) => s.enrollmentId === enrollment.id)?.lastAttestedAt
                        ? new Date(pdmStatuses.find((s) => s.enrollmentId === enrollment.id)!.lastAttestedAt!).toLocaleDateString()
                        : 'Never'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      {/* Follow-up button - only for active enrollments */}
                      {!['approved', 'denied', 'terminated'].includes(enrollment.status) && (
                        <button
                          onClick={() => openFollowUpModal(enrollment)}
                          className={`mr-3 ${
                            enrollment.followUpEnabled
                              ? 'text-green-600 hover:text-green-800'
                              : 'text-gray-400 hover:text-blue-600'
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
                        className="text-blue-600 hover:text-blue-800 mr-3"
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
              className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
              onClick={closeModal}
            />

            <div className="relative z-10 inline-block w-full max-w-lg p-6 my-8 text-left align-middle bg-white rounded-lg shadow-xl">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                {editingEnrollment ? 'Edit Enrollment' : 'Add New Enrollment'}
              </h3>

              <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payer Name *
                  </label>
                  {editingEnrollment ? (
                    <input
                      type="text"
                      value={formData.payerName}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 text-gray-600"
                      disabled
                    />
                  ) : (
                    <div className="relative">
                      <div className="relative">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                          type="text"
                          value={payerSearch}
                          onChange={(e) => {
                            setPayerSearch(e.target.value);
                            setShowPayerDropdown(true);
                          }}
                          onFocus={() => setShowPayerDropdown(true)}
                          placeholder="Search payers..."
                          className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      {formData.payerName && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-sm text-gray-600">Selected:</span>
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                            {formData.payerName}
                            <button
                              type="button"
                              onClick={() => {
                                setFormData({ ...formData, payerName: '' });
                                setPayerSearch('');
                              }}
                              className="ml-2 text-blue-600 hover:text-blue-800"
                            >
                              &times;
                            </button>
                          </span>
                        </div>
                      )}
                      {showPayerDropdown && !formData.payerName && (
                        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                          {filteredPayers.length > 0 ? (
                            filteredPayers.map((payer) => (
                              <button
                                key={payer.id}
                                type="button"
                                onClick={() => {
                                  setFormData({ ...formData, payerName: payer.name });
                                  setPayerSearch('');
                                  setShowPayerDropdown(false);
                                }}
                                className="w-full text-left px-4 py-2 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
                              >
                                <div className="font-medium text-gray-900">{payer.name}</div>
                                <div className="text-xs text-gray-500">{payer.payerType}</div>
                              </button>
                            ))
                          ) : (
                            <div className="px-4 py-3 text-sm text-gray-500">
                              No payers found. Type to search from 3,000+ payers.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
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
                            ? 'bg-blue-100 border-blue-500 text-blue-800'
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
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
              className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
              onClick={() => setFollowUpModalOpen(false)}
            />

            <div className="relative z-10 inline-block w-full max-w-lg p-6 my-8 text-left align-middle bg-white rounded-lg shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">
                  Send Follow-up Email
                </h3>
                <button
                  onClick={() => setFollowUpModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircleIcon className="h-6 w-6" />
                </button>
              </div>

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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Attachment */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Attachment (optional)
                  </label>
                  <div className="mt-1">
                    {attachment ? (
                      <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center gap-2">
                          <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          <span className="text-sm text-blue-800 font-medium">{attachment.name}</span>
                          <span className="text-xs text-blue-600">({(attachment.size / 1024).toFixed(1)} KB)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAttachment(null)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <XCircleIcon className="h-5 w-5" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center w-full p-4 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
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
                <button
                  type="button"
                  onClick={handlePreviewEmail}
                  disabled={previewLoading}
                  className="inline-flex items-center px-4 py-2 text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 disabled:opacity-50"
                >
                  <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  {previewLoading ? 'Loading...' : 'Preview Email'}
                </button>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setFollowUpModalOpen(false)}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSendFollowUpEmail}
                    disabled={!recipientEmail || testEmailSending}
                    className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <PaperAirplaneIcon className="h-4 w-4 mr-2" />
                    {testEmailSending ? 'Sending...' : 'Send Email'}
                  </button>
                </div>
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
              className="fixed inset-0 transition-opacity bg-gray-900 bg-opacity-75"
              onClick={() => setShowEmailPreview(false)}
            />

            <div className="relative z-10 inline-block w-full max-w-2xl my-8 text-left align-middle bg-white rounded-lg shadow-xl overflow-hidden">
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
                          ? 'bg-blue-100 text-blue-700'
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
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
                    dangerouslySetInnerHTML={{ __html: emailPreviewHtml }}
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
                      className="px-4 py-2 text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100"
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
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
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
