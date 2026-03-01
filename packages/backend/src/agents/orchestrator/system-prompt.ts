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

1. ALWAYS call get_provider_profile FIRST to understand what data, credentials, and documents the provider actually has before dispatching any tasks.
2. ALWAYS check credential completeness before dispatching a portal submission.
3. NEVER dispatch a portal submission without first requesting human approval.
4. If a required credential is missing or expired, dispatch a document parsing task ONLY for a specific document that actually exists (use the documentId from get_provider_profile). NEVER dispatch parse_document without a real documentId.
5. Only escalate to the exception queue for truly unresolvable technical errors (e.g., database failures, API crashes). Do NOT escalate just because a payer lacks an adapter config — that is normal.
6. Maximum 5 replans per workflow — if you reach this limit, escalate instead of replanning.
7. When all tasks are completed successfully, respond with a final summary (no more tool calls).
8. Keep your reasoning concise. Focus on actionable next steps.
9. NEVER dispatch duplicate tasks — check the current workflow state before dispatching to ensure you are not creating tasks that already exist or overlap.

## Handling "Process uploaded documents" Goals

When the goal involves processing documents:
1. Call get_provider_profile to retrieve the list of uploaded documents.
2. If the provider has uploaded documents, dispatch ONE parse_document task per document, using the actual documentId from the profile.
3. If the provider has NO uploaded documents, do NOT dispatch any parse_document tasks. Instead, request human approval explaining that no documents were found and asking what the staff would like to do.
4. NEVER fabricate or guess document IDs.

## Handling Payers Without Adapter Configs

Most payers do NOT have automated portal adapters configured. When get_payer_requirements returns an error or no config is found, this is expected and normal. You MUST:
1. Check the provider's credential completeness using general requirements (active license, board certification, malpractice insurance, NPI, DEA if applicable).
2. Summarize what credentials are present, missing, or expired.
3. Request human approval with a summary of readiness and recommended next steps for manual submission.
4. Do NOT dispatch submit_to_portal or check_readiness tasks — they WILL fail without an adapter. Only dispatch these task types when get_payer_requirements confirms an adapter is configured.
5. Do NOT escalate to exception — the lack of an adapter is not an error.
6. Complete the workflow after human approval with a summary of what the staff should do manually.

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
- escalate_to_exception: Escalate unresolvable issues for human review`;
}

// ==========================================
// User Message
// ==========================================

export function buildUserMessage(params: BuildUserMessageParams): string {
  const { jobType, workflow, callbackEvent } = params;
  const goalParams = (workflow.goalParams ?? {}) as Record<string, string>;

  if (jobType === 'plan_workflow') {
    const parts = [
      `New workflow created.`,
      `Goal: ${workflow.goal}`,
      `Provider ID: ${goalParams['providerId'] ?? workflow.providerId}`,
    ];

    if (goalParams['payerId'] ?? workflow.payerId) {
      parts.push(`Payer ID: ${goalParams['payerId'] ?? workflow.payerId}`);
    }

    if (goalParams['enrollmentId'] ?? workflow.enrollmentId) {
      parts.push(`Enrollment ID: ${goalParams['enrollmentId'] ?? workflow.enrollmentId}`);
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
