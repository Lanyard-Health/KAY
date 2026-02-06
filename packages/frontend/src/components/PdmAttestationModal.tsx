import { useState, useEffect } from 'react';
import { XMarkIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import {
  usePdmAttestation,
  AVAILITY_PDM_URL,
  type PdmAttestationStatus,
} from '../hooks/usePdmStatus';
import { PdmAttestationBadge } from './PdmAttestationBadge';
import toast from 'react-hot-toast';

interface PdmAttestationModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  statuses: PdmAttestationStatus[];
}

export function PdmAttestationModal({
  isOpen,
  onClose,
  providerId,
  statuses,
}: PdmAttestationModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const attestMutation = usePdmAttestation();

  // Pre-select enrollments that are due, overdue, or need update
  useEffect(() => {
    if (isOpen) {
      const needsAttention = statuses
        .filter(
          (s) =>
            s.status === 'overdue' ||
            s.status === 'due_soon' ||
            s.status === 'never_attested' ||
            s.needsUpdate
        )
        .map((s) => s.enrollmentId);
      setSelectedIds(new Set(needsAttention));
    }
  }, [isOpen, statuses]);

  const handleToggle = (enrollmentId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(enrollmentId)) {
        next.delete(enrollmentId);
      } else {
        next.add(enrollmentId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === statuses.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(statuses.map((s) => s.enrollmentId)));
    }
  };

  const handleSubmit = async () => {
    if (selectedIds.size === 0) return;

    try {
      await attestMutation.mutateAsync({
        providerId,
        enrollmentIds: Array.from(selectedIds),
      });
      toast.success(`Recorded attestation for ${selectedIds.size} enrollment(s)`);
      onClose();
    } catch (error) {
      console.error('Failed to record attestation:', error);
      toast.error('Failed to record attestation');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="relative bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Record PDM Attestation</h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Select the enrollments you have attested in Availity PDM. Per CAA 2021, attestation
              is required every 90 days.
            </p>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* Availity link */}
            <div className="mb-4 p-3 bg-primary-50 rounded-lg border border-primary-200">
              <div className="flex items-center justify-between">
                <span className="text-sm text-primary-800">
                  Complete attestation in Availity PDM first, then record it here.
                </span>
                <a
                  href={AVAILITY_PDM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-sm font-medium text-primary-600 hover:text-primary-800"
                >
                  Open Availity PDM
                  <ArrowTopRightOnSquareIcon className="ml-1 h-4 w-4" />
                </a>
              </div>
            </div>

            {/* Select all */}
            <div className="mb-3 pb-3 border-b border-gray-200">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={selectedIds.size === statuses.length && statuses.length > 0}
                  onChange={handleSelectAll}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm font-medium text-gray-700">
                  Select All ({statuses.length} enrollments)
                </span>
              </label>
            </div>

            {/* Enrollment list */}
            <div className="space-y-2">
              {statuses.map((status) => (
                <label
                  key={status.enrollmentId}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer"
                >
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(status.enrollmentId)}
                      onChange={() => handleToggle(status.enrollmentId)}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <div className="ml-3">
                      <div className="text-sm font-medium text-gray-900">{status.payerName}</div>
                      <div className="text-xs text-gray-500">
                        Last attested:{' '}
                        {status.lastAttestedAt
                          ? new Date(status.lastAttestedAt).toLocaleDateString()
                          : 'Never'}
                      </div>
                    </div>
                  </div>
                  <PdmAttestationBadge
                    status={status.status}
                    daysUntilDue={status.daysUntilDue}
                    needsUpdate={status.needsUpdate}
                    showDays
                    size="sm"
                  />
                </label>
              ))}
            </div>

            {statuses.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No PDM-enabled enrollments found
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">
                {selectedIds.size} enrollment(s) selected
              </span>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={selectedIds.size === 0 || attestMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {attestMutation.isPending ? 'Recording...' : 'Confirm Attestation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PdmAttestationModal;
