import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

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
  applicationDate: string | null;
  effectiveDate: string | null;
  terminationDate: string | null;
  providerNumber: string | null;
  groupNumber: string | null;
  notes: string | null;
  payer: Payer;
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

interface EnrollmentFormData {
  payerName: string;
  status: string;
  applicationDate: string;
  effectiveDate: string;
  providerNumber: string;
  groupNumber: string;
  notes: string;
}

const initialFormData: EnrollmentFormData = {
  payerName: '',
  status: 'not_started',
  applicationDate: '',
  effectiveDate: '',
  providerNumber: '',
  groupNumber: '',
  notes: '',
};

export function ProviderEnrollments({ providerId }: ProviderEnrollmentsProps) {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEnrollment, setEditingEnrollment] = useState<Enrollment | null>(null);
  const [formData, setFormData] = useState<EnrollmentFormData>(initialFormData);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['enrollments', providerId],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: Enrollment[] }>(`/enrollments/provider/${providerId}`);
      return response.data;
    },
  });

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

  const openCreateModal = () => {
    setEditingEnrollment(null);
    setFormData(initialFormData);
    setIsModalOpen(true);
  };

  const openEditModal = (enrollment: Enrollment) => {
    setEditingEnrollment(enrollment);
    setFormData({
      payerName: enrollment.payer.name,
      status: enrollment.status,
      applicationDate: enrollment.applicationDate?.split('T')[0] || '',
      effectiveDate: enrollment.effectiveDate?.split('T')[0] || '',
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
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Payer
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
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button
                        onClick={() => openEditModal(enrollment)}
                        className="text-blue-600 hover:text-blue-800 mr-4"
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

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payer Name *
                  </label>
                  <input
                    type="text"
                    value={formData.payerName}
                    onChange={(e) =>
                      setFormData({ ...formData, payerName: e.target.value })
                    }
                    placeholder="e.g., Blue Cross Blue Shield, Aetna, UnitedHealthcare"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                    disabled={!!editingEnrollment}
                  />
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
                      Application Date
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
    </div>
  );
}

export default ProviderEnrollments;
