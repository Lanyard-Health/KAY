import { useState } from 'react';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { usePdmStatus, AVAILITY_PDM_URL } from '../hooks/usePdmStatus';
import { PdmAttestationModal } from './PdmAttestationModal';

interface PdmComplianceCardProps {
  providerId: string;
}

export function PdmComplianceCard({ providerId }: PdmComplianceCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { data, isLoading, error } = usePdmStatus(providerId);

  if (isLoading) {
    return (
      <div className="card card-body">
        <h3 className="text-sm font-medium text-gray-500 mb-3">PDM Compliance</h3>
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className="card card-body">
        <h3 className="text-sm font-medium text-gray-500 mb-3">PDM Compliance</h3>
        <p className="text-sm text-red-600">Failed to load PDM status</p>
      </div>
    );
  }

  const { summary, statuses } = data.data;
  const hasIssues = summary.overdue > 0 || summary.dueSoon > 0 || summary.neverAttested > 0;
  const totalEnrollments = summary.current + summary.dueSoon + summary.overdue + summary.neverAttested;

  if (totalEnrollments === 0) {
    return (
      <div className="card card-body">
        <h3 className="text-sm font-medium text-gray-500 mb-3">PDM Compliance</h3>
        <p className="text-sm text-gray-500">No PDM-enabled enrollments</p>
      </div>
    );
  }

  return (
    <>
      <div className="card card-body">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-500">PDM Compliance</h3>
          {hasIssues && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
              Action Required
            </span>
          )}
        </div>

        {/* Summary counts */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="text-center p-2 bg-green-50 rounded">
            <div className="text-xl font-bold text-green-700">{summary.current}</div>
            <div className="text-xs text-green-600">Current</div>
          </div>
          <div className="text-center p-2 bg-yellow-50 rounded">
            <div className="text-xl font-bold text-yellow-700">{summary.dueSoon}</div>
            <div className="text-xs text-yellow-600">Due Soon</div>
          </div>
          <div className="text-center p-2 bg-red-50 rounded">
            <div className="text-xl font-bold text-red-700">{summary.overdue}</div>
            <div className="text-xs text-red-600">Overdue</div>
          </div>
          <div className="text-center p-2 bg-gray-50 rounded">
            <div className="text-xl font-bold text-gray-700">{summary.neverAttested}</div>
            <div className="text-xs text-gray-600">Never Attested</div>
          </div>
        </div>

        {/* Next due date */}
        {summary.daysUntilNextDue !== null && (
          <div className="mb-4 p-2 bg-gray-50 rounded text-center">
            <div className="text-xs text-gray-500">Next attestation due in</div>
            <div className="text-lg font-semibold text-gray-900">
              {summary.daysUntilNextDue < 0 ? (
                <span className="text-red-600">{Math.abs(summary.daysUntilNextDue)} days overdue</span>
              ) : (
                <span>{summary.daysUntilNextDue} days</span>
              )}
            </div>
          </div>
        )}

        {/* Update needed indicator */}
        {summary.needsUpdate > 0 && (
          <div className="mb-4 p-2 bg-orange-50 rounded border border-orange-200">
            <div className="text-xs text-orange-800">
              <strong>{summary.needsUpdate}</strong> enrollment(s) need re-attestation due to
              directory changes
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          <a
            href={AVAILITY_PDM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            <ArrowTopRightOnSquareIcon className="h-4 w-4 mr-2" />
            Open Availity PDM
          </a>

          <button
            onClick={() => setIsModalOpen(true)}
            className="w-full inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700"
          >
            Record Attestation
          </button>
        </div>
      </div>

      <PdmAttestationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        providerId={providerId}
        statuses={statuses}
      />
    </>
  );
}

export default PdmComplianceCard;
