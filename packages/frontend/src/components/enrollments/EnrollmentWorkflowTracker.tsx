/**
 * EnrollmentWorkflowTracker
 *
 * Renders the step-by-step workflow for a payer enrollment.
 *
 * Usage:
 *   <EnrollmentWorkflowTracker enrollmentId={enrollment.id} />
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ForwardIcon,
  DocumentTextIcon,
  PhoneIcon,
  CircleStackIcon,
  GlobeAltIcon,
  ArrowUpTrayIcon,
  ShieldCheckIcon,
  ArrowPathIcon,
  NoSymbolIcon,
  ArrowUturnLeftIcon,
  InboxArrowDownIcon,
  CogIcon,
  UsersIcon,
  PencilSquareIcon,
  EnvelopeIcon,
  EyeIcon,
  MapPinIcon,
  CpuChipIcon,
  ArrowsRightLeftIcon,
  UserPlusIcon,
} from '@heroicons/react/24/outline';

// ============================================================
// Types
// ============================================================

interface WorkflowStep {
  id: string;
  templateStepId: string;
  stepOrder: number;
  name: string;
  description: string;
  actionType: string;
  url: string | null;
  owner: string;
  estimatedDays: number;
  dependencies: string[];
  documentsNeeded: string[];
  warnings: string[];
  status: 'not_started' | 'in_progress' | 'completed' | 'skipped' | 'blocked';
  startedAt: string | null;
  completedAt: string | null;
  completedBy: { id: string; firstName: string; lastName: string } | null;
  skippedReason: string | null;
  notes: string | null;
}

interface WorkflowProgress {
  totalSteps: number;
  completedSteps: number;
  inProgressSteps: number;
  blockedSteps: number;
  skippedSteps: number;
  percentComplete: number;
  estimatedDaysRemaining: number;
  currentStep: {
    id: string;
    name: string;
    owner: string;
    estimatedDays: number;
  } | null;
}

interface EnrollmentInfo {
  id: string;
  status: string;
  workflowType: string | null;
  payerName: string;
  payerWorkflowKey: string | null;
  providerName: string;
  providerType: string;
}

interface WorkflowResponse {
  enrollment: EnrollmentInfo;
  steps: WorkflowStep[];
  progress: WorkflowProgress | null;
  actionTypeConfig: Record<string, { label: string; icon: string; color: string }>;
}

interface EnrollmentWorkflowTrackerProps {
  enrollmentId: string;
  /** Called when enrollment status changes due to workflow progress */
  onEnrollmentStatusChange?: (newStatus: string) => void;
  /** Compact mode for embedding in a table row or card */
  compact?: boolean;
}

// ============================================================
// Constants
// ============================================================

const STATUS_CONFIG: Record<string, {
  label: string;
  color: string;
  bg: string;
  border: string;
  Icon: React.ElementType;
  ring: string;
}> = {
  not_started: {
    label: 'Not Started',
    color: 'text-slate-400',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    Icon: ClockIcon,
    ring: 'ring-slate-200',
  },
  in_progress: {
    label: 'In Progress',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    Icon: ClockIcon,
    ring: 'ring-blue-300',
  },
  completed: {
    label: 'Completed',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    Icon: CheckCircleIcon,
    ring: 'ring-emerald-300',
  },
  skipped: {
    label: 'Skipped',
    color: 'text-amber-500',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    Icon: ForwardIcon,
    ring: 'ring-amber-200',
  },
  blocked: {
    label: 'Blocked',
    color: 'text-red-500',
    bg: 'bg-red-50',
    border: 'border-red-200',
    Icon: NoSymbolIcon,
    ring: 'ring-red-200',
  },
};

const ACTION_ICONS: Record<string, React.ElementType> = {
  form_submission: DocumentTextIcon,
  phone_call: PhoneIcon,
  caqh_update: CircleStackIcon,
  portal_registration: GlobeAltIcon,
  document_upload: ArrowUpTrayIcon,
  waiting_period: ClockIcon,
  follow_up: ArrowPathIcon,
  verification: ShieldCheckIcon,
  payer_review: ClockIcon,
  payer_outreach: InboxArrowDownIcon,
  payer_internal: CogIcon,
  committee_review: UsersIcon,
  contract_execution: PencilSquareIcon,
  contract_delivery: EnvelopeIcon,
  document_review: EyeIcon,
  site_visit: MapPinIcon,
  system_processing: CpuChipIcon,
  routing_decision: ArrowsRightLeftIcon,
  confirmation: CheckCircleIcon,
  account_creation: UserPlusIcon,
};

const OWNER_LABELS: Record<string, string> = {
  provider: 'Provider',
  credentialing_staff: 'Staff',
  payer: 'Payer',
  cvo: 'CVO',
};

const OWNER_COLORS: Record<string, string> = {
  provider: 'bg-violet-100 text-violet-700',
  credentialing_staff: 'bg-sky-100 text-sky-700',
  payer: 'bg-orange-100 text-orange-700',
  cvo: 'bg-teal-100 text-teal-700',
};

// ============================================================
// Component
// ============================================================

export default function EnrollmentWorkflowTracker({
  enrollmentId,
  onEnrollmentStatusChange,
  compact = false,
}: EnrollmentWorkflowTrackerProps) {
  const queryClient = useQueryClient();
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [skipModalStep, setSkipModalStep] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState('');

  // Fetch workflow data
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['enrollment-workflow', enrollmentId],
    queryFn: async () => {
      const response = await api.get<WorkflowResponse>(
        `/enrollments/${enrollmentId}/workflow`
      );
      return response.data as WorkflowResponse;
    },
    enabled: !!enrollmentId,
  });

  // Update step mutation
  const updateStepMutation = useMutation({
    mutationFn: async ({
      stepId,
      status,
      extra,
    }: {
      stepId: string;
      status: string;
      extra?: Record<string, string>;
    }) => {
      const response = await api.put(
        `/enrollments/${enrollmentId}/workflow/${stepId}`,
        { status, ...extra }
      );
      return response.data;
    },
    onSuccess: async () => {
      // Refresh workflow data
      const result = await refetch();
      // Check if enrollment status changed
      if (onEnrollmentStatusChange && data && result.data) {
        const newData = result.data as WorkflowResponse;
        if (newData.enrollment.status !== data.enrollment.status) {
          onEnrollmentStatusChange(newData.enrollment.status);
          queryClient.invalidateQueries({ queryKey: ['enrollments'] });
        }
      }
    },
  });

  const toggleExpanded = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  // ============================================================
  // Render: Loading / Error / No Workflow
  // ============================================================

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-400">
        <ArrowPathIcon className="w-5 h-5 animate-spin mr-2" />
        Loading workflow...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
        <ExclamationTriangleIcon className="w-4 h-4 inline mr-1" />
        Failed to load workflow
        <button
          onClick={() => refetch()}
          className="ml-2 underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data || !data.steps || data.steps.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
        <DocumentTextIcon className="w-8 h-8 mx-auto mb-2 text-slate-300" />
        <p className="font-medium">No workflow template available</p>
        <p className="mt-1 text-xs">
          This payer doesn&apos;t have a predefined enrollment workflow.
          Track progress using the enrollment status field.
        </p>
      </div>
    );
  }

  const { enrollment, steps, progress } = data;

  // ============================================================
  // Render: Compact Mode (progress bar only)
  // ============================================================

  if (compact && progress) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${progress.percentComplete}%` }}
          />
        </div>
        <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
          {progress.completedSteps}/{progress.totalSteps} steps
        </span>
      </div>
    );
  }

  // ============================================================
  // Render: Full Workflow Tracker
  // ============================================================

  return (
    <div className="space-y-4">
      {/* Progress Summary */}
      {progress && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                {enrollment.payerName} &mdash; {enrollment.workflowType === 'behavioral_health' ? 'Behavioral Health' : 'Medical'} Enrollment
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {enrollment.providerName} &middot; {progress.estimatedDaysRemaining} days remaining (est.)
              </p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-slate-800">
                {progress.percentComplete}%
              </span>
              <p className="text-xs text-slate-400">
                {progress.completedSteps} of {progress.totalSteps} complete
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${progress.percentComplete}%`,
                background: progress.percentComplete === 100
                  ? '#10b981'
                  : 'linear-gradient(90deg, #3b82f6, #6366f1)',
              }}
            />
          </div>

          {/* Status badges */}
          <div className="flex gap-4 mt-3 text-xs">
            {progress.inProgressSteps > 0 && (
              <span className="flex items-center gap-1 text-blue-600">
                <ClockIcon className="w-3 h-3" /> {progress.inProgressSteps} in progress
              </span>
            )}
            {progress.blockedSteps > 0 && (
              <span className="flex items-center gap-1 text-red-500">
                <NoSymbolIcon className="w-3 h-3" /> {progress.blockedSteps} blocked
              </span>
            )}
            {progress.skippedSteps > 0 && (
              <span className="flex items-center gap-1 text-amber-500">
                <ForwardIcon className="w-3 h-3" /> {progress.skippedSteps} skipped
              </span>
            )}
            {progress.currentStep && (
              <span className="flex items-center gap-1 text-slate-500 ml-auto">
                Next: <span className="font-medium">{progress.currentStep.name}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${OWNER_COLORS[progress.currentStep.owner] || 'bg-slate-100 text-slate-600'}`}>
                  {OWNER_LABELS[progress.currentStep.owner] || progress.currentStep.owner}
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Step List */}
      <div className="space-y-1">
        {steps.map((step) => {
          const config = STATUS_CONFIG[step.status] || STATUS_CONFIG.not_started;
          const StatusIcon = config.Icon;
          const ActionIcon = ACTION_ICONS[step.actionType] || DocumentTextIcon;
          const isExpanded = expandedSteps.has(step.id);
          const isUpdating = updateStepMutation.isPending && updateStepMutation.variables?.stepId === step.id;

          return (
            <div
              key={step.id}
              className={`
                rounded-lg border transition-all duration-200
                ${config.border} ${config.bg}
                ${step.status === 'in_progress' ? 'ring-2 ' + config.ring : ''}
                ${step.status === 'blocked' ? 'opacity-60' : ''}
              `}
            >
              {/* Step Header */}
              <button
                onClick={() => toggleExpanded(step.id)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-black/[0.02] transition-colors rounded-lg"
              >
                {/* Status Icon */}
                <div className="flex-shrink-0">
                  {isUpdating ? (
                    <ArrowPathIcon className={`w-5 h-5 animate-spin ${config.color}`} />
                  ) : (
                    <StatusIcon className={`w-5 h-5 ${config.color}`} />
                  )}
                </div>

                {/* Step Number & Name */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Step {step.stepOrder}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${OWNER_COLORS[step.owner] || 'bg-slate-100 text-slate-600'}`}>
                      {OWNER_LABELS[step.owner] || step.owner}
                    </span>
                    <ActionIcon className="w-3 h-3 text-slate-400" />
                  </div>
                  <p className="text-sm font-medium text-slate-800 mt-0.5 truncate">
                    {step.name}
                  </p>
                </div>

                {/* Estimated Days */}
                <span className="text-xs text-slate-400 flex-shrink-0">
                  ~{step.estimatedDays}d
                </span>

                {/* Expand/Collapse */}
                {isExpanded ? (
                  <ChevronDownIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
                ) : (
                  <ChevronRightIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
                )}
              </button>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-0 space-y-3 border-t border-slate-200/60 mt-0">
                  {/* Description */}
                  <p className="text-sm text-slate-600 mt-3 leading-relaxed">
                    {step.description}
                  </p>

                  {/* Warnings */}
                  {step.warnings.length > 0 && (
                    <div className="space-y-1">
                      {step.warnings.map((w, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2"
                        >
                          <ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Portal URL */}
                  {step.url && (
                    <a
                      href={step.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 px-2.5 py-1.5 rounded-md hover:bg-blue-100 transition-colors"
                    >
                      <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                      Open Portal
                    </a>
                  )}

                  {/* Required Documents */}
                  {step.documentsNeeded.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        Documents Needed
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {step.documentsNeeded.map((doc) => (
                          <span
                            key={doc}
                            className="px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded"
                          >
                            {doc.replace('doc-', '').replace(/-/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Dependencies */}
                  {step.dependencies.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        Depends On
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {step.dependencies.map((dep) => {
                          const depStep = steps.find((s) => s.templateStepId === dep);
                          const depCompleted = depStep?.status === 'completed';
                          return (
                            <span
                              key={dep}
                              className={`px-2 py-0.5 text-xs rounded flex items-center gap-1 ${
                                depCompleted
                                  ? 'bg-emerald-50 text-emerald-600 line-through'
                                  : 'bg-red-50 text-red-600'
                              }`}
                            >
                              {depCompleted ? (
                                <CheckCircleIcon className="w-3 h-3" />
                              ) : (
                                <ClockIcon className="w-3 h-3" />
                              )}
                              {depStep?.name || dep}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Completion info */}
                  {step.completedAt && step.completedBy && (
                    <p className="text-xs text-slate-400">
                      Completed by {step.completedBy.firstName} {step.completedBy.lastName}{' '}
                      on {new Date(step.completedAt).toLocaleDateString()}
                    </p>
                  )}

                  {step.skippedReason && (
                    <p className="text-xs text-amber-600">
                      Skipped: {step.skippedReason}
                    </p>
                  )}

                  {/* Notes */}
                  {step.notes && (
                    <p className="text-xs text-slate-500 italic">
                      Note: {step.notes}
                    </p>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-1">
                    {step.status === 'not_started' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updateStepMutation.mutate({ stepId: step.id, status: 'in_progress' });
                        }}
                        disabled={updateStepMutation.isPending}
                        className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                      >
                        Start Step
                      </button>
                    )}

                    {step.status === 'in_progress' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updateStepMutation.mutate({ stepId: step.id, status: 'completed' });
                        }}
                        disabled={updateStepMutation.isPending}
                        className="px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-colors disabled:opacity-50"
                      >
                        Mark Complete
                      </button>
                    )}

                    {(step.status === 'not_started' || step.status === 'in_progress') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSkipModalStep(step.id);
                          setSkipReason('');
                        }}
                        disabled={updateStepMutation.isPending}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-md hover:bg-slate-200 transition-colors disabled:opacity-50"
                      >
                        Skip
                      </button>
                    )}

                    {(step.status === 'completed' || step.status === 'skipped') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updateStepMutation.mutate({ stepId: step.id, status: 'not_started' });
                        }}
                        disabled={updateStepMutation.isPending}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-500 rounded-md hover:bg-slate-200 transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        <ArrowUturnLeftIcon className="w-3 h-3" /> Undo
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Skip Reason Modal */}
      {skipModalStep && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-5 w-full max-w-sm mx-4">
            <h4 className="text-sm font-semibold text-slate-800 mb-2">
              Skip this step?
            </h4>
            <p className="text-xs text-slate-500 mb-3">
              Please provide a reason for skipping. This will be recorded for audit purposes.
            </p>
            <textarea
              value={skipReason}
              onChange={(e) => setSkipReason(e.target.value)}
              placeholder="e.g., Not required for this provider type"
              className="w-full text-sm border border-slate-300 rounded-md p-2 mb-3 focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none resize-none"
              rows={3}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSkipModalStep(null)}
                className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-md hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (skipReason.trim()) {
                    updateStepMutation.mutate({
                      stepId: skipModalStep,
                      status: 'skipped',
                      extra: { skippedReason: skipReason.trim() },
                    });
                    setSkipModalStep(null);
                  }
                }}
                disabled={!skipReason.trim()}
                className="px-3 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-md hover:bg-amber-600 disabled:opacity-50"
              >
                Skip Step
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
