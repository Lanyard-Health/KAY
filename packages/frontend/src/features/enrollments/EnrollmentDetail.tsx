import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import ErrorState from '../../components/ui/ErrorState';
import LoadingState from '../../components/ui/LoadingState';
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  ArrowRightIcon,
  DocumentTextIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import EnrollmentEditModal from './EnrollmentEditModal';
import EnrollmentWorkflowTracker from '../../components/enrollments/EnrollmentWorkflowTracker';
import AiSidebar from '../../components/AiSidebar';
import { PopulateFormsPanel } from '../../components/enrollments/PopulateFormsPanel';
import { SubmitToPortalPanel } from '../../components/enrollments/SubmitToPortalPanel';

/** Shows the payer-assigned tracking/confirmation number (e.g. the Aetna
 * Request ID) captured by the most recent submission run. */
function PayerReferenceCard({ enrollmentId }: { enrollmentId: string }) {
  const { data: runs } = useQuery({
    queryKey: ['enrollment-runs', enrollmentId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Array<{ id: string; status: string; startedAt: string; submittedAt?: string | null; externalReference?: string | null; confirmationNumber?: string | null }> }>(
        `/enrollments/${enrollmentId}/runs`
      );
      return res.data.data ?? [];
    },
  });
  const withRef = (runs ?? []).find((r) => r.confirmationNumber || (r as any).externalReference);
  if (!withRef) return null;
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Payer Reference</h2>
      </div>
      <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-gray-500">Request ID</p>
          <p className="font-mono font-medium text-gray-900">{withRef.confirmationNumber || (withRef as any).externalReference}</p>
        </div>
        <div>
          <p className="text-gray-500">Run status</p>
          <p className="text-gray-900">{withRef.status.replace(/_/g, ' ')}</p>
        </div>
        <div>
          <p className="text-gray-500">Submitted</p>
          <p className="text-gray-900">{withRef.submittedAt ? new Date(withRef.submittedAt).toLocaleString() : '—'}</p>
        </div>
      </div>
    </div>
  );
}
import AgentWorkflowPanel from '../../components/enrollments/AgentWorkflowPanel';

// Dev-only demo payer lookup. The endpoint returns 404 in production, so the
// query gracefully resolves to undefined and the demo button stays hidden.
function useDemoAvailityPayerId(): string | undefined {
  const isDev = import.meta.env.DEV;
  const { data } = useQuery({
    queryKey: ['demo-availity-payer'],
    queryFn: async () => {
      try {
        const res = await api.get<{ success: boolean; data: { id: string } }>('/payers/demo-availity');
        return res.data.data.id;
      } catch {
        return null;
      }
    },
    enabled: isDev,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return data ?? undefined;
}

function useDemoAetnaPayerId(): string | undefined {
  const isDev = import.meta.env.DEV;
  const { data } = useQuery({
    queryKey: ['demo-aetna-payer'],
    queryFn: async () => {
      try {
        const res = await api.get<{ success: boolean; data: { id: string } }>('/payers/demo-aetna');
        return res.data.data.id;
      } catch {
        return null;
      }
    },
    enabled: isDev,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return data ?? undefined;
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
  // Dates are stored as UTC midnight; render in UTC or they display one day early.
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export default function EnrollmentDetail() {
  const { id } = useParams<{ id: string }>();
  const demoAvailityPayerId = useDemoAvailityPayerId();
  const demoAetnaPayerId = useDemoAetnaPayerId();
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
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
        <LoadingState label="Loading enrollment…" />
      </div>
    );
  }

  if (error || !enrollment) {
    const isNotFound = !error;
    return (
      <div className="p-6">
        <Link to="/enrollments" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
          <ArrowLeftIcon className="h-4 w-4 mr-1" /> Back to Enrollments
        </Link>
        <ErrorState
          title={isNotFound ? 'Enrollment not found' : "Couldn't load enrollment"}
          message={isNotFound ? 'This enrollment may have been deleted.' : 'Check your connection and try again.'}
          onRetry={isNotFound ? undefined : () => refetch()}
        />
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
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${status.color}`}>
              <StatusIcon className="h-4 w-4" />
              {status.label}
            </span>
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <PencilSquareIcon className="h-4 w-4" />
              Edit
            </button>
          </div>
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

      {/* Payer reference from submission runs (e.g. Aetna Request ID) */}
      <PayerReferenceCard enrollmentId={enrollment.id} />

      {/* Workflow Tracker */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Workflow Progress</h2>
        </div>
        <div className="px-6 py-4">
          <EnrollmentWorkflowTracker enrollmentId={enrollment.id} />
        </div>
      </div>

      {/* Populate Forms — generic recipe-driven PDF fill */}
      <PopulateFormsPanel enrollmentId={enrollment.id} />

      {/* Submit to payer portal — v2 submission pipeline (Aetna via Libretto Cloud) */}
      <SubmitToPortalPanel
        enrollmentId={enrollment.id}
        providerId={enrollment.providerId}
        payerId={enrollment.payer?.id}
        payerName={enrollment.payer?.name ?? 'payer'}
      />

      {/* Agent Workflow */}
      <AgentWorkflowPanel
        enrollmentId={enrollment.id}
        providerId={enrollment.providerId}
        payerId={enrollment.payer?.id}
        providerName={`${enrollment.provider?.firstName ?? ''} ${enrollment.provider?.lastName ?? ''}`.trim()}
        payerName={enrollment.payer?.name ?? ''}
        demoAvailityPayerId={demoAvailityPayerId}
        demoAetnaPayerId={demoAetnaPayerId}
      />

      {/* AI Sidebar */}
      <AiSidebar entityType="enrollment" entityId={enrollment.id} />

      {/* Edit Modal */}
      <EnrollmentEditModal enrollment={enrollment} isOpen={editOpen} onClose={() => setEditOpen(false)} />
    </div>
  );
}
