import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  ArrowRightIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import EnrollmentWorkflowTracker from '../../components/enrollments/EnrollmentWorkflowTracker';
import AiSidebar from '../../components/AiSidebar';
import { AetnaReadinessPanel } from '../../components/enrollments/AetnaReadinessPanel';
import { AetnaReviewPanel } from '../../components/enrollments/AetnaReviewPanel';
import AgentWorkflowPanel from '../../components/enrollments/AgentWorkflowPanel';
import { useAetnaRuns } from '../../hooks/useAetnaEnrollment';

/** Only renders Aetna panels when the payer is Aetna — prevents unnecessary API calls */
function AetnaSection({ enrollmentId, payerName }: { enrollmentId: string; payerName: string }) {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const { data: runs } = useAetnaRuns(enrollmentId);

  useEffect(() => {
    if (!runs || activeRunId) return;
    const active = runs.find(r =>
      ['pending', 'filling', 'awaiting_review', 'submitting'].includes(r.status)
    );
    if (active) setActiveRunId(active.id);
  }, [runs, activeRunId]);

  return (
    <>
      <AetnaReadinessPanel
        enrollmentId={enrollmentId}
        payerName={payerName}
        onRunStarted={(runId) => setActiveRunId(runId)}
      />
      {activeRunId && (
        <AetnaReviewPanel
          enrollmentId={enrollmentId}
          runId={activeRunId}
          onClose={() => setActiveRunId(null)}
        />
      )}
    </>
  );
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof ClockIcon }> = {
  not_started: { label: 'Not Started', color: 'bg-gray-100 text-gray-800', icon: ClockIcon },
  in_progress: { label: 'In Progress', color: 'bg-yellow-100 text-yellow-800', icon: ArrowRightIcon },
  submitted: { label: 'Submitted', color: 'bg-primary-100 text-primary-800', icon: ArrowRightIcon },
  pending_review: { label: 'Pending Review', color: 'bg-purple-100 text-purple-800', icon: ClockIcon },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800', icon: CheckCircleIcon },
  denied: { label: 'Denied', color: 'bg-red-100 text-red-800', icon: XCircleIcon },
  terminated: { label: 'Terminated', color: 'bg-gray-100 text-gray-800', icon: XCircleIcon },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function EnrollmentDetail() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['enrollment', id],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: any }>(`/enrollments/${id}`);
      return response.data;
    },
    enabled: !!id,
  });

  const enrollment = data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error || !enrollment) {
    return (
      <div className="p-6">
        <Link to="/enrollments" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
          <ArrowLeftIcon className="h-4 w-4 mr-1" /> Back to Enrollments
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Enrollment not found.
        </div>
      </div>
    );
  }

  const status = STATUS_CONFIG[enrollment.status] || STATUS_CONFIG.not_started;
  const StatusIcon = status.icon;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link to="/enrollments" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ArrowLeftIcon className="h-4 w-4 mr-1" /> Back to Enrollments
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {enrollment.payer?.name || 'Unknown Payer'}
            </h1>
            {enrollment.provider && (
              <p className="text-sm text-gray-500 mt-1">
                Provider:{' '}
                <Link to={`/providers/${enrollment.providerId}`} className="text-primary-600 hover:underline">
                  {enrollment.provider.firstName} {enrollment.provider.lastName}
                </Link>
                {enrollment.provider.npi && <span className="ml-2 text-gray-400">NPI: {enrollment.provider.npi}</span>}
              </p>
            )}
          </div>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${status.color}`}>
            <StatusIcon className="h-4 w-4" />
            {status.label}
          </span>
        </div>
      </div>

      {/* Details Grid */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <DocumentTextIcon className="h-5 w-5 text-gray-400" />
            Enrollment Details
          </h2>
        </div>
        <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-4">
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Payer Type</dt>
            <dd className="mt-1 text-sm text-gray-900">{enrollment.payer?.payerType || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Payer ID</dt>
            <dd className="mt-1 text-sm text-gray-900">{enrollment.payer?.payerId || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Provider #</dt>
            <dd className="mt-1 text-sm text-gray-900">{enrollment.providerNumber || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Group #</dt>
            <dd className="mt-1 text-sm text-gray-900">{enrollment.groupNumber || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Product Types</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {enrollment.productTypes?.length > 0 ? enrollment.productTypes.join(', ') : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Status</dt>
            <dd className="mt-1 text-sm text-gray-900">{status.label}</dd>
          </div>
        </div>
      </div>

      {/* Dates */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <CalendarDaysIcon className="h-5 w-5 text-gray-400" />
            Key Dates
          </h2>
        </div>
        <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-4">
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Application Date</dt>
            <dd className="mt-1 text-sm text-gray-900">{formatDate(enrollment.applicationDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Effective Date</dt>
            <dd className="mt-1 text-sm text-gray-900">{formatDate(enrollment.effectiveDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Termination Date</dt>
            <dd className="mt-1 text-sm text-gray-900">{formatDate(enrollment.terminationDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Contract Received</dt>
            <dd className="mt-1 text-sm text-gray-900">{formatDate(enrollment.dateContractReceived)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Contract Signed</dt>
            <dd className="mt-1 text-sm text-gray-900">{formatDate(enrollment.dateContractSigned)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Recredentialing</dt>
            <dd className="mt-1 text-sm text-gray-900">{formatDate(enrollment.recredentialingDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Last Follow-up</dt>
            <dd className="mt-1 text-sm text-gray-900">{formatDate(enrollment.lastFollowUpDate)}</dd>
          </div>
        </div>
      </div>

      {/* Notes */}
      {enrollment.notes && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Notes</h2>
          </div>
          <div className="px-6 py-4">
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{enrollment.notes}</p>
          </div>
        </div>
      )}

      {/* Workflow Tracker */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Workflow Progress</h2>
        </div>
        <div className="px-6 py-4">
          <EnrollmentWorkflowTracker enrollmentId={enrollment.id} />
        </div>
      </div>

      {/* Aetna Enrollment Automation — only rendered for Aetna payers */}
      {enrollment.payer?.name?.toLowerCase().includes('aetna') && (
        <AetnaSection enrollmentId={enrollment.id} payerName={enrollment.payer.name} />
      )}

      {/* Agent Workflow */}
      <AgentWorkflowPanel
        enrollmentId={enrollment.id}
        providerId={enrollment.providerId}
        payerId={enrollment.payer?.id}
        providerName={`${enrollment.provider?.firstName ?? ''} ${enrollment.provider?.lastName ?? ''}`.trim()}
        payerName={enrollment.payer?.name ?? ''}
      />

      {/* AI Sidebar */}
      <AiSidebar entityType="enrollment" entityId={enrollment.id} />
    </div>
  );
}
