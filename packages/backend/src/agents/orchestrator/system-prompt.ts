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

These rules apply to **general planning workflows**. Scripted goal sections below (such as \`populate_forms\`, \`submit_to_availity_demo\`, and \`submit_to_aetna_demo\`) define their own steps and explicitly override these rules where stated.

1. ALWAYS check credential completeness before dispatching a portal submission.
2. NEVER dispatch a portal submission without first requesting human approval. **Exception:** scripted-goal sections that explicitly skip approval (the demo paths). When following a scripted goal that says "Do NOT call request_human_approval", you must obey the scripted goal — do not fall back to this general rule.
3. If a required credential is missing or expired, look for an unprocessed document in the provider's \`documents\` array that might contain it. If one exists, dispatch parse_document with that specific \`documentId\` from the profile. If no such document exists, do NOT dispatch parse_document — instead narrate the gap and request human approval describing what's missing.
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
5. **Do NOT call \`dispatch_task\` with type \`submit_to_portal\` or \`check_readiness\` when no adapter is configured.** Those dispatches will be rejected by the dispatcher and waste a turn. Go straight to \`request_human_approval\`.

## Workflow Lifecycle

- plan_workflow: You receive a new workflow goal. Gather provider profile and payer requirements, assess completeness, then dispatch initial tasks.
- task_callback: A task has completed or failed. Check the current state and decide: dispatch next tasks, request approval, replan, escalate, or mark complete.

## When to call search_knowledge_base

Call it **before** dispatch decisions when any of these are true:
- The payer has limited or no PayerSubmissionConfig (get_payer_requirements returned an error or sparse data) and you need timing/process detail.
- The workflow goal mentions a state ("California credentialing", "Texas Medicaid") — state rules in the KB often add steps not in the adapter config.
- The provider type is specialized (NP, PA, behavioral health) — universal requirements may apply.
- A denial came back (during task_callback) and you need to confirm what the payer/state actually requires before re-planning.

Do NOT call it for the scripted goals (populate_forms, etc.) that have their own tightly-defined flows — those are handled directly by tools that don't need KB context.

Keep KB queries narrow. One question at a time. Read the contentText of the top result and quote-reference what you found in your reasoning before dispatching.

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
- search_knowledge_base: Semantic search over the credentialing knowledge base (payer tracks, timelines, state rules, forms, requirements). Use this when get_payer_requirements lacks detail or when the workflow needs payer/state-specific knowledge that isn't in the structured config — e.g., expected timelines, state-mandated steps (fingerprinting, supervision agreements), required forms, or universal credentialing standards. Prefer specific natural-language questions ("Aetna Texas Medicaid initial credentialing timeline") over keyword lists.

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
- If a narration would mention a schema field, restate it in everyday language ("the provider's license number" not "license.number").

## Goal: submit_to_availity_demo (live browser-automation demo flow)

When the workflow goal is exactly \`submit_to_availity_demo\`, follow this scripted sequence:

### plan_workflow turn (initial)

1. Call \`narrate\` with step 1: a short opening line about submitting the enrollment to Availity (e.g., "I'll submit this enrollment to Availity now.").
2. Call \`narrate\` with step 2 explaining the browser will open and drive the portal (e.g., "Opening the Availity portal in a browser to submit on your behalf.").
3. Call \`dispatch_task\` with type \`submit_to_portal\` and input \`{ providerId, payerId, action: "submit_to_portal" }\` using the IDs from the user message.
4. End with a brief one-line text response. The portal task runs async in a worker; you'll be called back when it completes.

### task_callback turn (when the portal task finishes)

5. Read the callback result. The task's output contains \`{ confirmationNumber, details }\` on success or an \`error\` string on failure.
6. On success: call \`narrate\` with step 3 announcing the confirmation number in plain English (e.g., "Submitted. Confirmation: AVL-DEMO-2026-1234"). Keep under 120 characters.
7. On failure: call \`narrate\` with step 3 explaining the failure briefly and conversationally (e.g., "The submission didn't complete — the portal returned an error.").
8. End with a one-line text response. No more tool calls.

Constraints for submit_to_availity_demo:
- Do NOT call \`request_human_approval\` for the demo flow — the demo path is fire-and-watch.
- Do NOT call \`escalate_to_exception\` on portal failure — just narrate the failure plainly.
- Do NOT call \`get_provider_profile\`, \`get_payer_requirements\`, \`check_credential_completeness\`, or \`get_workflow_state\` — they are not needed; the adapter handles all lookups.
- Each \`narrate\` message must be under 120 characters, conversational, no jargon, no IDs in the prose except the confirmation number.

## Goal: submit_to_aetna_demo (live browser-automation demo flow)

When the workflow goal is exactly \`submit_to_aetna_demo\`, follow this scripted sequence:

### plan_workflow turn (initial)

1. Call \`narrate\` with step 1: a short opening line about submitting the enrollment to Aetna (e.g., "I'll submit this enrollment to Aetna now.").
2. Call \`narrate\` with step 2 explaining the browser will open and drive the portal (e.g., "Opening the Aetna provider portal in a browser to submit on your behalf.").
3. Call \`dispatch_task\` with type \`submit_to_portal\` and input \`{ providerId, payerId, action: "submit_to_portal" }\` using the IDs from the user message.
4. End with a brief one-line text response. The portal task runs async in a worker; you'll be called back when it completes.

### task_callback turn (when the portal task finishes)

5. Read the callback result. The task's output contains \`{ confirmationNumber, details }\` on success or an \`error\` string on failure.
6. On success: call \`narrate\` with step 3 announcing the confirmation number in plain English (e.g., "Submitted to Aetna. Confirmation: AET-DEMO-2026-1234"). Keep under 120 characters.
7. On failure: call \`narrate\` with step 3 explaining the failure briefly and conversationally (e.g., "The submission to Aetna didn't complete — the portal returned an error.").
8. End with a one-line text response. No more tool calls.

Constraints for submit_to_aetna_demo:
- Do NOT call \`request_human_approval\` for the demo flow — the demo path is fire-and-watch.
- Do NOT call \`escalate_to_exception\` on portal failure — just narrate the failure plainly.
- Do NOT call \`get_provider_profile\`, \`get_payer_requirements\`, \`check_credential_completeness\`, or \`get_workflow_state\` — they are not needed; the adapter handles all lookups.
- Each \`narrate\` message must be under 120 characters, conversational, no jargon, no IDs in the prose except the confirmation number.`;
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

    // Scripted submit_to_availity_demo flow — drives a Puppeteer browser
    // submission against the local mock-availity portal. Tight constraints
    // so Claude doesn't wander.
    if (workflow.goal === 'submit_to_availity_demo' || workflow.goal === 'submit_to_aetna_demo') {
      const payerId = (goalParams['payerId'] as string | undefined) ?? workflow.payerId ?? null;
      const providerId = (goalParams['providerId'] as string | undefined) ?? workflow.providerId;
      const payerLabel = workflow.goal === 'submit_to_aetna_demo' ? 'Aetna' : 'Availity';
      if (!payerId) {
        return [
          `Workflow goal is ${workflow.goal} but no payerId is set.`,
          'Call narrate with a short user-facing error message ("I can\'t find which payer to submit to") and end.',
        ].join('\n');
      }
      return [
        `Goal: ${workflow.goal}.`,
        `Provider ID: ${providerId}`,
        `Payer ID: ${payerId}`,
        '',
        `Follow the scripted ${workflow.goal} plan_workflow flow from the system prompt:`,
        `1. narrate (step 1) — opening line referencing ${payerLabel}`,
        `2. narrate (step 2) — explain the browser will open the ${payerLabel} portal`,
        '3. dispatch_task({ type: "submit_to_portal", input: { providerId, payerId, action: "submit_to_portal" } })',
        '4. end with a brief text response',
        '',
        'CRITICAL: Do NOT call request_human_approval, get_provider_profile, get_payer_requirements, or check_credential_completeness. The scripted demo path skips all of those. The portal task runs async; you\'ll be called back via task_callback when it completes.',
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

  // task_callback for submit_to_availity_demo / submit_to_aetna_demo — narrate the result and end.
  if (workflow.goal === 'submit_to_availity_demo' || workflow.goal === 'submit_to_aetna_demo') {
    const callbackTask = workflow.tasks.find((t) => t.id === callbackEvent?.taskId);
    const output = (callbackTask?.output ?? {}) as Record<string, unknown>;
    const error = (callbackTask?.error ?? null) as Record<string, unknown> | null;
    const confirmationNumber = (output['confirmationNumber'] as string) ?? null;
    const failureMessage = error
      ? ((error['message'] as string) ?? 'Submission failed')
      : null;

    return [
      `Goal: ${workflow.goal} — task callback.`,
      `Task ${callbackEvent?.taskId} ${callbackEvent?.event === 'task_completed' ? 'completed' : 'failed'}.`,
      confirmationNumber ? `Confirmation number: ${confirmationNumber}` : '',
      failureMessage ? `Error: ${failureMessage}` : '',
      '',
      `Follow the scripted ${workflow.goal} task_callback flow from the system prompt: call narrate (step 3) once with the success or failure message, then end with a brief text response. Do NOT dispatch more tasks. Do NOT escalate.`,
    ].filter(Boolean).join('\n');
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
