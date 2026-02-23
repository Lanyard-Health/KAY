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
