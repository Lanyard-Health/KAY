import type Anthropic from '@anthropic-ai/sdk';

/**
 * 7 Claude tool_use JSON schemas for the orchestrator agent.
 * Passed to claude.messages.create({ tools }).
 */

export const ORCHESTRATOR_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_provider_profile',
    description:
      'Retrieve a provider\'s full profile including licenses, board certifications, malpractice insurance, education, documents, addresses, and enrollments.',
    input_schema: {
      type: 'object' as const,
      properties: {
        providerId: { type: 'string', description: 'UUID of the provider' },
      },
      required: ['providerId'],
    },
  },
  {
    name: 'get_payer_requirements',
    description:
      'Retrieve a payer\'s adapter configuration including adapter type, submission method, required credential fields, and active status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        payerId: { type: 'string', description: 'UUID of the payer' },
      },
      required: ['payerId'],
    },
  },
  {
    name: 'check_credential_completeness',
    description:
      'Cross-reference a provider\'s credentials against a payer\'s required fields. Returns completeness score, present fields, missing fields, and expired fields.',
    input_schema: {
      type: 'object' as const,
      properties: {
        providerId: { type: 'string', description: 'UUID of the provider' },
        payerId: { type: 'string', description: 'UUID of the payer' },
      },
      required: ['providerId', 'payerId'],
    },
  },
  {
    name: 'dispatch_task',
    description:
      'Create and enqueue an agent task for execution. The task is queued to the appropriate worker based on its type.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['parse_document', 'submit_to_portal', 'check_readiness', 'monitor_status'],
          description: 'The type of task to dispatch',
        },
        input: {
          type: 'object',
          description: 'Task-specific input data (e.g., documentId, providerId, payerId)',
        },
      },
      required: ['type', 'input'],
    },
  },
  {
    name: 'request_human_approval',
    description:
      'Request human approval before proceeding with a sensitive action (e.g., portal submission). Pauses the workflow until approved or denied.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', description: 'Type of approval needed (e.g., "portal_submission", "credential_override")' },
        context: {
          type: 'object',
          description: 'Context data for the approver (e.g., provider name, payer, what will be submitted)',
        },
      },
      required: ['type', 'context'],
    },
  },
  {
    name: 'get_workflow_state',
    description:
      'Retrieve the current workflow state including all tasks with their statuses, the execution plan, and pending approvals. The workflowId is automatically injected.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'escalate_to_exception',
    description:
      'Escalate an issue to the exception handling queue for human review. Use when the workflow cannot proceed automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        issue: { type: 'string', description: 'Description of the issue requiring escalation' },
        taskId: { type: 'string', description: 'Optional ID of the task that caused the issue' },
      },
      required: ['issue'],
    },
  },
];
