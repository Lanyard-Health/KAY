import type Anthropic from '@anthropic-ai/sdk';

/**
 * Claude tool_use JSON schemas for the orchestrator agent.
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
  {
    name: 'narrate',
    description:
      'Send a short, plain-English status message to the user describing what you are about to do or have just done. Used for live progress narration in the UI. Keep messages under 120 characters and conversational. Optional step number for ordering and optional downloadUrl when a result artifact is ready.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'The narration text shown to the user. Plain English, conversational, no jargon.',
        },
        step: {
          type: 'integer',
          description: 'Optional 1-based step number for ordering (e.g., 1, 2, 3).',
        },
        downloadUrl: {
          type: 'string',
          description: 'Optional URL when a downloadable artifact is ready (e.g., a filled PDF).',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'populate_enrollment_forms',
    description:
      'Fill all PDF forms configured for an enrollment\'s payer using the provider\'s credential data. Returns the enrollmentRunId, per-form fill counts, missing required fields, and signed download URLs (30-min TTL) for each filled PDF. Reuses the same form-fill pipeline as the manual Populate Forms button.',
    input_schema: {
      type: 'object' as const,
      properties: {
        enrollmentId: {
          type: 'string',
          description: 'UUID of the enrollment whose forms should be filled',
        },
      },
      required: ['enrollmentId'],
    },
  },
  {
    name: 'search_knowledge_base',
    description:
      'Semantic search over the credentialing knowledge base — payer tracks, timelines, state rules, forms, requirements, and universal requirements. Use this to look up payer-specific timelines, state-level rules (e.g., "does Texas require fingerprinting?"), required forms, or general credentialing standards before deciding next steps. Returns ranked results with similarity scores. Prefer specific natural-language questions over keyword lists ("Aetna Texas Medicaid initial credentialing timeline" beats "Aetna timeline TX").',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'A specific natural-language question or topic. Be specific about payer, state, and what aspect (timeline, requirements, forms, etc.).',
        },
        limit: {
          type: 'integer',
          description: 'Max number of results to return (default 5, max 20). Lower is better when the question is narrow.',
        },
      },
      required: ['query'],
    },
  },
];
