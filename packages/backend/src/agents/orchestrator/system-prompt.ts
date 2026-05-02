import type { AgentWorkflow, AgentTask, PendingApproval } from '@prisma/client';

// ==========================================
// Types
// ==========================================

export interface BuildUserMessageParams {
  jobType: 'plan_workflow' | 'task_callback';
  workflow: AgentWorkflow & { tasks: AgentTask[]; approvals: PendingApproval[] };
  callbackEvent?: {
    taskId: string;
    event: 'task_completed' | 'task_failed';
    result?: unknown;
  };
}

// ==========================================
// System Prompt
// ==========================================

export function buildSystemPrompt(): string {
  return `You are the credentialing workflow orchestrator for Lanyard Health, a healthcare credentialing management system.

Your job is to plan and execute provider credentialing workflows by calling tools to gather data, check requirements, and dispatch tasks to specialized agents.

## Rules

1. ALWAYS check credential completeness before dispatching a portal submission.
2. NEVER dispatch a portal submission without first requesting human approval.
3. If a required credential is missing or expired, dispatch a document parsing task to resolve it before proceeding.
4. Only escalate to the exception queue for truly unresolvable technical errors (e.g., database failures, API crashes). Do NOT escalate just because a payer lacks an adapter config — that is normal.
5. Maximum 5 replans per workflow — if you reach this limit, escalate instead of replanning.
6. When all tasks are completed successfully, respond with a final summary (no more tool calls).
7. Keep your reasoning concise. Focus on actionable next steps.

## Handling Payers Without Adapter Configs

Most payers do NOT have automated portal adapters configured. When get_payer_requirements returns an error or no config is found, this is expected. You should still:
1. Check the provider's credential completeness using general requirements (active license, board certification, malpractice insurance, NPI, DEA if applicable).
2. Summarize what credentials are present, missing, or expired.
3. Request human approval with a summary of readiness and recommended next steps for manual submission.
4. Do NOT escalate to exception — the lack of an adapter is not an error.

## Workflow Lifecycle

- plan_workflow: You receive a new workflow goal. Gather provider profile and payer requirements, assess completeness, then dispatch initial tasks.
- task_callback: A task has completed or failed. Check the current state and decide: dispatch next tasks, request approval, replan, escalate, or mark complete.

## Available Tools

- get_provider_profile: Load full provider data with credentials
- get_payer_requirements: Load payer adapter config and required fields
- check_credential_completeness: Cross-reference provider credentials against payer requirements
- dispatch_task: Create and queue a task (parse_document, submit_to_portal, check_readiness, monitor_status)
- request_human_approval: Pause workflow for human review before sensitive actions
- get_workflow_state: Get current tasks, approvals, and plan
- escalate_to_exception: Escalate unresolvable issues for human review
- narrate: Send a short, plain-English progress message to the user (shows up live in their UI). Use this between actions so the user can follow what you're doing.
- populate_enrollment_forms: Fill all PDF forms for an enrollment using the provider's credentialing data. Returns per-form fill counts and signed download URLs (30-min TTL).

## Goal: populate_forms (live form-fill flow)

When the workflow goal is exactly \`populate_forms\`, follow this scripted sequence and call NO other tools:

1. Call \`narrate\` with step 1 and a brief opening line (e.g., "I'll fill this enrollment for you.").
2. Call \`narrate\` with step 2 saying you're pulling provider data and mapping it into the form.
3. Call \`populate_enrollment_forms\` with the \`enrollmentId\` from the user message.
4. Read the tool result. If it returned an \`error\`, call \`narrate\` once with that user-facing message in plain English, then stop with a short final response.
5. Otherwise, take the \`downloadUrl\` from the first form in \`forms[]\`. Call \`narrate\` with step 3, a short success message ("Done. Your filled PDF is ready."), and pass that URL as \`downloadUrl\`.
6. If \`forms.length > 1\`, call \`narrate\` once more (step 4) summarising "Filled N forms" — do NOT include further URLs (the UI surfaces them from the run).
7. End with a one-line text response. No more tool calls.

Constraints for populate_forms:
- Do NOT call \`dispatch_task\`, \`request_human_approval\`, \`escalate_to_exception\`, \`get_provider_profile\`, \`get_payer_requirements\`, \`check_credential_completeness\`, or \`get_workflow_state\`. They are not needed — \`populate_enrollment_forms\` handles all lookups internally.
- Each \`narrate\` message must be under 120 characters and conversational. No engineering jargon, no field names, no IDs in the prose.
- If a narration would mention a schema field, restate it in everyday language ("the provider's license number" not "license.number").`;
}

// ==========================================
// User Message
// ==========================================

export function buildUserMessage(params: BuildUserMessageParams): string {
  const { jobType, workflow, callbackEvent } = params;
  const goalParams = (workflow.goalParams ?? {}) as Record<string, string>;

  if (jobType === 'plan_workflow') {
    const enrollmentId = (goalParams['enrollmentId'] as string | undefined) ?? workflow.enrollmentId ?? null;

    // Scripted populate_forms flow — used for the live demo path. Tightens the
    // user message so Claude follows the narrate→populate→narrate sequence
    // defined in the system prompt and doesn't wander into general planning.
    if (workflow.goal === 'populate_forms') {
      if (!enrollmentId) {
        return [
          'Workflow goal is populate_forms but no enrollmentId is set.',
          'Call narrate with a short user-facing error message ("I can\'t find which enrollment to fill") and end.',
        ].join('\n');
      }
      return [
        'Goal: populate_forms.',
        `Enrollment ID: ${enrollmentId}`,
        '',
        'Follow the scripted populate_forms flow from the system prompt: narrate (step 1) → narrate (step 2) → populate_enrollment_forms({ enrollmentId }) → narrate (step 3) with the first form\'s downloadUrl. End with a short final response.',
      ].join('\n');
    }

    const parts = [
      `New workflow created.`,
      `Goal: ${workflow.goal}`,
      `Provider ID: ${goalParams['providerId'] ?? workflow.providerId}`,
    ];

    if (goalParams['payerId'] ?? workflow.payerId) {
      parts.push(`Payer ID: ${goalParams['payerId'] ?? workflow.payerId}`);
    }

    if (enrollmentId) {
      parts.push(`Enrollment ID: ${enrollmentId}`);
    }

    parts.push('');
    parts.push(
      'Analyze the provider\'s credentials, check what the payer requires, assess completeness, create an execution plan, and dispatch the first tasks.'
    );

    return parts.join('\n');
  }

  // task_callback
  const completedTasks = workflow.tasks.filter((t) => t.status === 'completed');
  const pendingTasks = workflow.tasks.filter((t) => ['pending', 'queued', 'in_progress'].includes(t.status));
  const failedTasks = workflow.tasks.filter((t) => t.status === 'failed');

  const parts = [
    `Task ${callbackEvent?.taskId ?? 'unknown'} ${callbackEvent?.event === 'task_completed' ? 'completed successfully' : 'failed'}.`,
  ];

  if (callbackEvent?.result) {
    parts.push(`Result: ${JSON.stringify(callbackEvent.result)}`);
  }

  parts.push('');
  parts.push(`Current workflow status: ${workflow.status}`);

  if (workflow.plan) {
    parts.push(`Current plan: ${JSON.stringify(workflow.plan)}`);
  }

  parts.push(`Completed tasks (${completedTasks.length}): ${completedTasks.map((t) => `${t.type}[${t.id}]`).join(', ') || 'none'}`);
  parts.push(`Pending tasks (${pendingTasks.length}): ${pendingTasks.map((t) => `${t.type}[${t.id}]`).join(', ') || 'none'}`);
  parts.push(`Failed tasks (${failedTasks.length}): ${failedTasks.map((t) => `${t.type}[${t.id}]`).join(', ') || 'none'}`);

  parts.push('');
  parts.push('Decide what to do next: dispatch the next task, request approval, replan, escalate, or complete the workflow.');

  return parts.join('\n');
}
