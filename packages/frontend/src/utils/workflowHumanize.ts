import type { AgentTask } from '../hooks/useAgentWorkflows';

// ===========================
// Agent Type Labels
// ===========================

export const AGENT_TYPE_LABELS: Record<
  string,
  { label: string; description: string; icon: string }
> = {
  portal_interaction: {
    label: 'Portal Interaction',
    description: 'Interacting with the payer enrollment portal',
    icon: 'globe',
  },
  portal: {
    label: 'Portal Submission',
    description: 'Submitting enrollment to the payer portal',
    icon: 'globe',
  },
  status_monitor: {
    label: 'Status Check',
    description: 'Monitoring enrollment application status',
    icon: 'magnifying-glass',
  },
  document_parser: {
    label: 'Document Processing',
    description: 'Extracting information from uploaded documents',
    icon: 'document',
  },
  document: {
    label: 'Document Processing',
    description: 'Parsing and extracting document data',
    icon: 'document',
  },
  orchestrator: {
    label: 'Planning',
    description: 'Planning the next steps for this workflow',
    icon: 'cog',
  },
  exception: {
    label: 'Issue Resolution',
    description: 'Resolving an issue that came up during processing',
    icon: 'exclamation',
  },
  coordinator: {
    label: 'Coordinator',
    description: 'Coordinating workflow tasks',
    icon: 'squares',
  },
  submit_to_portal: {
    label: 'Portal Submission',
    description: 'Submitting enrollment application to the payer portal',
    icon: 'globe',
  },
  check_readiness: {
    label: 'Readiness Check',
    description: 'Checking if the provider is ready for enrollment',
    icon: 'clipboard-check',
  },
  parse_document: {
    label: 'Document Parsing',
    description: 'Extracting data from an uploaded document',
    icon: 'document',
  },
};

function getAgentLabel(agentType: string): { label: string; description: string } {
  const entry = AGENT_TYPE_LABELS[agentType];
  if (entry) return entry;
  // Fallback: convert snake_case to Title Case
  const label = agentType
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return { label, description: label };
}

// ===========================
// Event Action Labels
// ===========================

export const EVENT_ACTION_LABELS: Record<string, string> = {
  workflow_created: 'Workflow started',
  workflow_cancelled: 'Workflow cancelled',
  orchestrator_turn_complete: 'AI finished planning next steps',
  task_dispatched: 'New task started',
  task_callback_enqueued: 'Processing task results',
  approval_requested: 'Waiting for your approval',
  approval_decided: 'Approval decision recorded',
  portal_submission_dispatched: 'Portal submission started',
  document_parsing_dispatched: 'Document processing started',
  task_completed: 'Task completed successfully',
  task_failed: 'Task encountered an error',
  portal_login: 'Logging into payer portal',
  portal_navigation: 'Navigating portal pages',
  portal_form_fill: 'Filling out enrollment form',
  portal_submit: 'Submitting enrollment application',
  credential_check: 'Verifying provider credentials',
  data_extraction: 'Extracting information from document',
};

export function humanizeEventAction(action: string): string {
  return EVENT_ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
}

// ===========================
// Human Summaries
// ===========================

export function summarizeTaskInput(agentType: string, input: Record<string, unknown>): string {
  const { label } = getAgentLabel(agentType);

  // Try to build a contextual sentence
  const payerId = input['payerId'] as string | undefined;
  const providerId = input['providerId'] as string | undefined;
  const action = input['action'] as string | undefined;
  const documentId = input['documentId'] as string | undefined;

  if (action === 'check_readiness') {
    return 'Checking if the provider is ready for enrollment';
  }
  if (action === 'submit_to_portal') {
    return 'Submitting enrollment application to the payer portal';
  }
  if (documentId) {
    return 'Processing and extracting data from the uploaded document';
  }
  if (payerId && providerId) {
    return `${label}: preparing enrollment submission`;
  }

  return getAgentLabel(agentType).description;
}

export function summarizeTaskOutput(
  agentType: string,
  output: Record<string, unknown> | null,
): string | null {
  if (!output) return null;

  const message = output['message'] as string | undefined;
  if (message) return message;

  const status = output['status'] as string | undefined;
  const result = output['result'] as string | undefined;

  if (status === 'success' || result === 'success') {
    const { label } = getAgentLabel(agentType);
    return `${label} completed successfully`;
  }
  if (status === 'error' || result === 'error') {
    const error = output['error'] as string | undefined;
    return error ?? 'An error occurred during processing';
  }

  // For outputs with extracted data
  const extracted = output['extractedFields'] as unknown[] | undefined;
  if (extracted) {
    return `Extracted ${extracted.length} field${extracted.length !== 1 ? 's' : ''} from document`;
  }

  return null;
}

// ===========================
// Progress
// ===========================

export function getWorkflowProgressPercent(tasks: AgentTask[]): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter(
    (t) =>
      t.status === 'completed' ||
      t.status === 'failed' ||
      t.status === 'skipped' ||
      t.status === 'cancelled',
  ).length;
  return Math.round((done / tasks.length) * 100);
}

// ===========================
// Elapsed Time
// ===========================

export function getElapsedTime(startedAt: string | null): string {
  if (!startedAt) return '';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return '';

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (hours < 24) {
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatDurationBetween(
  startedAt: string | null,
  completedAt: string | null,
): string | null {
  if (!startedAt) return null;
  const end = completedAt ? new Date(completedAt) : new Date();
  const ms = end.getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

// ===========================
// Status helpers
// ===========================

export function getStatusVariant(
  status: string,
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'completed':
    case 'active':
      return 'success';
    case 'waiting_approval':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'planning':
      return 'info';
    case 'cancelled':
    default:
      return 'neutral';
  }
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case 'planning':
      return 'Planning';
    case 'active':
      return 'Active';
    case 'waiting_approval':
      return 'Waiting Approval';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status.replace(/_/g, ' ');
  }
}

export function getPriorityConfig(priority: number): {
  label: string;
  color: string;
  borderColor: string;
  bgColor: string;
} {
  switch (priority) {
    case 3:
      return {
        label: 'Urgent',
        color: 'text-red-600',
        borderColor: 'border-l-red-500',
        bgColor: 'bg-red-50',
      };
    case 2:
      return {
        label: 'High',
        color: 'text-amber-600',
        borderColor: 'border-l-amber-500',
        bgColor: 'bg-amber-50',
      };
    case 1:
      return {
        label: 'Normal',
        color: 'text-blue-600',
        borderColor: 'border-l-blue-500',
        bgColor: 'bg-blue-50',
      };
    case 0:
    default:
      return {
        label: 'Low',
        color: 'text-gray-500',
        borderColor: 'border-l-gray-300',
        bgColor: 'bg-gray-50',
      };
  }
}

export function getTaskStepLabel(agentType: string): string {
  return getAgentLabel(agentType).label;
}

export function getTaskStepDescription(agentType: string): string {
  return getAgentLabel(agentType).description;
}

// ===========================
// Approval Humanization
// ===========================

const APPROVAL_TYPE_LABELS: Record<string, string> = {
  portal_submission: 'Portal Submission',
  check_readiness: 'Readiness Check',
  follow_up: 'Follow-Up Action',
  enrollment_submission: 'Enrollment Submission',
  credential_verification: 'Credential Verification',
  manual_review: 'Manual Review',
};

/** Fields that should never be shown to users. */
const HIDDEN_CONTEXT_KEYS = new Set([
  'providerId', 'provider_id', 'payerId', 'payer_id',
  'enrollmentId', 'enrollment_id', 'workflowId', 'workflow_id',
]);

/** Fields that get special human-readable rendering. */
const FRIENDLY_KEY_LABELS: Record<string, string> = {
  notes: 'Summary',
  recommended_action: 'Recommended Action',
  recommendedAction: 'Recommended Action',
  provider_name: 'Provider',
  providerName: 'Provider',
  payer: 'Payer',
  payerName: 'Payer',
  action: 'Type',
  application_status: 'Application Status',
  applicationStatus: 'Application Status',
  application_date: 'Submitted',
  applicationDate: 'Submitted',
  days_pending: 'Days Pending',
  daysPending: 'Days Pending',
  documents_available: 'Documents on File',
  documentsAvailable: 'Documents on File',
  credential_completeness: 'Credential Completeness',
  credentialCompleteness: 'Credential Completeness',
  score: 'Score',
};

const ACTION_LABELS: Record<string, string> = {
  follow_up_pending_application: 'Follow up on pending application',
  submit_to_portal: 'Submit to payer portal',
  check_readiness: 'Check enrollment readiness',
  portal_submission: 'Submit portal enrollment',
  manual_submission: 'Manual submission required',
};

/**
 * Derive a human-friendly title for an approval card.
 * Prefers context.action over the approval.type since
 * the orchestrator often sets a generic type.
 */
export function humanizeApprovalTitle(
  approvalType: string,
  context: Record<string, unknown>,
): string {
  // Check if context has an action that gives a better label
  const action = context['action'] as string | undefined;
  if (action && ACTION_LABELS[action]) return ACTION_LABELS[action];
  if (action) return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // Fall back to approval type
  return APPROVAL_TYPE_LABELS[approvalType] ?? approvalType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Format a single context value for display.
 */
function formatContextValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    // e.g. ["License certificate", "Board certification"] → "License certificate, Board certification"
    return value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
  }
  if (typeof value === 'object') {
    // Special case: credential_completeness { score, missing, present }
    const obj = value as Record<string, unknown>;
    if ('score' in obj && 'present' in obj) {
      const present = Array.isArray(obj['present'])
        ? (obj['present'] as string[]).join(', ')
        : String(obj['present']);
      const missing = Array.isArray(obj['missing'])
        ? (obj['missing'] as string[]).join(', ')
        : obj['missing'] ? String(obj['missing']) : null;
      return `${obj['score']}${missing ? ` — Missing: ${missing}` : ''} — Present: ${present}`;
    }
    return null; // Don't dump raw JSON
  }
  return null;
}

/**
 * Extract user-facing fields from approval context, filtering out IDs
 * and technical internals.
 */
export function humanizeApprovalContext(
  context: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  const result: Array<{ label: string; value: string }> = [];

  // Show "notes" / "recommended_action" first as they're the most important
  const priorityKeys = ['notes', 'recommended_action', 'recommendedAction'];

  for (const key of priorityKeys) {
    if (key in context) {
      const formatted = formatContextValue(context[key]);
      if (formatted) {
        result.push({ label: FRIENDLY_KEY_LABELS[key] ?? key, value: formatted });
      }
    }
  }

  // Then show the rest in order
  for (const [key, value] of Object.entries(context)) {
    if (HIDDEN_CONTEXT_KEYS.has(key)) continue;
    if (priorityKeys.includes(key)) continue; // already shown
    if (key === 'action') continue; // used in the title

    const formatted = formatContextValue(value);
    if (!formatted) continue;

    const label = FRIENDLY_KEY_LABELS[key]
      ?? key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
    result.push({ label, value: formatted });
  }

  return result;
}
