import { useState } from 'react';
import { Tab } from '@headlessui/react';
import {
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  EnvelopeIcon,
  PhoneIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useWorkflowApprovals, useDecideApproval } from '../../hooks/useWorkflowApprovals';
import type { WorkflowApproval } from '../../hooks/useWorkflowApprovals';

const statusTabs = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'denied', label: 'Denied' },
  { key: undefined, label: 'All' },
];

function getProviderName(approval: WorkflowApproval): string {
  const step = approval.enrollmentWorkflowStep;
  const run = approval.followUpRun;
  if (step?.enrollment?.provider) {
    return `${step.enrollment.provider.firstName} ${step.enrollment.provider.lastName}`;
  }
  if (run?.enrollment?.provider) {
    return `${run.enrollment.provider.firstName} ${run.enrollment.provider.lastName}`;
  }
  return (approval.context?.providerName as string) || 'Unknown Provider';
}

function getPayerName(approval: WorkflowApproval): string {
  const step = approval.enrollmentWorkflowStep;
  const run = approval.followUpRun;
  if (step?.enrollment?.payer) return step.enrollment.payer.name;
  if (run?.enrollment?.payer) return run.enrollment.payer.name;
  return (approval.context?.payerName as string) || 'Unknown Payer';
}

function getStepName(approval: WorkflowApproval): string {
  if (approval.type === 'workflow_step' && approval.enrollmentWorkflowStep) {
    return approval.enrollmentWorkflowStep.name;
  }
  if (approval.type === 'follow_up_outreach') {
    return (approval.context?.stepName as string) || `Follow-up Step ${approval.followUpStepOrder || '?'}`;
  }
  return (approval.context?.stepName as string) || 'Unknown Step';
}

function ApprovalCard({ approval }: { approval: WorkflowApproval }) {
  const decideMutation = useDecideApproval();
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);

  const isPending = approval.status === 'pending';
  const isFollowUp = approval.type === 'follow_up_outreach';
  const channel = approval.context?.channel as string | undefined;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className={clsx(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            isFollowUp ? 'bg-blue-50 text-blue-600' : 'bg-primary-50 text-primary-600'
          )}>
            {isFollowUp ? (
              channel === 'phone_call' ? <PhoneIcon className="h-5 w-5" /> : <EnvelopeIcon className="h-5 w-5" />
            ) : (
              <ClipboardDocumentCheckIcon className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{getStepName(approval)}</p>
            <p className="text-sm text-gray-600 mt-0.5">{getProviderName(approval)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{getPayerName(approval)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {approval.status === 'approved' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
              <CheckCircleIcon className="h-3.5 w-3.5" /> Approved
            </span>
          )}
          {approval.status === 'denied' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
              <XCircleIcon className="h-3.5 w-3.5" /> Denied
            </span>
          )}
          {approval.status === 'pending' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
              <ClockIcon className="h-3.5 w-3.5" /> Pending
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
        <span className={clsx(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
          isFollowUp ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-600'
        )}>
          {isFollowUp ? 'Follow-up Outreach' : 'Workflow Step'}
        </span>
        <span>Requested {new Date(approval.requestedAt).toLocaleDateString()}</span>
        {approval.decider && (
          <span>Decided by {approval.decider.firstName} {approval.decider.lastName}</span>
        )}
      </div>

      {isPending && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          {showNotes ? (
            <div className="space-y-2">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes..."
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => decideMutation.mutate({ id: approval.id, decision: 'approved', decisionNotes: notes || undefined })}
                  disabled={decideMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  <CheckCircleIcon className="h-4 w-4" /> Approve
                </button>
                <button
                  onClick={() => decideMutation.mutate({ id: approval.id, decision: 'denied', decisionNotes: notes || undefined })}
                  disabled={decideMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  <XCircleIcon className="h-4 w-4" /> Deny
                </button>
                <button
                  onClick={() => setShowNotes(false)}
                  className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => decideMutation.mutate({ id: approval.id, decision: 'approved' })}
                disabled={decideMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                <CheckCircleIcon className="h-4 w-4" /> Approve
              </button>
              <button
                onClick={() => decideMutation.mutate({ id: approval.id, decision: 'denied' })}
                disabled={decideMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                <XCircleIcon className="h-4 w-4" /> Deny
              </button>
              <button
                onClick={() => setShowNotes(true)}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 transition-colors"
              >
                Add notes...
              </button>
            </div>
          )}
        </div>
      )}

      {approval.decisionNotes && (
        <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
          <span className="font-medium">Notes:</span> {approval.decisionNotes}
        </div>
      )}
    </div>
  );
}

export default function WorkflowQueue() {
  const [selectedTab, setSelectedTab] = useState(0);
  const statusFilter = statusTabs[selectedTab]?.key;

  const { data: approvals, isLoading } = useWorkflowApprovals({
    status: statusFilter,
  });

  const pendingCount = approvals?.filter(a => a.status === 'pending').length ?? 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Workflow Queue</h1>
        <p className="mt-1 text-sm text-gray-500">
          Review and approve pending workflow steps and follow-up outreach.
          {pendingCount > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {pendingCount} pending
            </span>
          )}
        </p>
      </div>

      <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
        <Tab.List className="flex gap-1 rounded-xl bg-gray-100 p-1 mb-6">
          {statusTabs.map((tab) => (
            <Tab
              key={tab.label}
              className={({ selected }) =>
                clsx(
                  'flex-1 rounded-lg py-2 text-sm font-medium transition-all',
                  selected
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                )
              }
            >
              {tab.label}
            </Tab>
          ))}
        </Tab.List>
      </Tab.Group>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-gray-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/3" />
                  <div className="h-3 bg-gray-100 rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : !approvals?.length ? (
        <div className="text-center py-16">
          <ClipboardDocumentCheckIcon className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-4 text-sm font-medium text-gray-900">No approvals</h3>
          <p className="mt-1 text-sm text-gray-500">
            {statusFilter === 'pending'
              ? 'No pending approvals. You\'re all caught up!'
              : 'No approvals match the current filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}
        </div>
      )}
    </div>
  );
}
