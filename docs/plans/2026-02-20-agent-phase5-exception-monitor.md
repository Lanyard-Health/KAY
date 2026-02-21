# Phase 5: Exception Agent + Monitoring Agent — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the monitoring agent (status polling with backoff schedule) and exception agent (Claude-powered denial analysis) to complete the autonomous credentialing workflow loop.

**Architecture:** Monitor agent is a non-LLM BullMQ worker that checks enrollment status via payer adapters, self-schedules delayed re-checks using a backoff schedule, and notifies the orchestrator on status changes. Exception agent uses a single Claude call to analyze failures/denials and produce structured remediation suggestions, then routes back to the orchestrator for replanning. An hourly cron catches any monitor jobs that fell through the cracks.

**Tech Stack:** BullMQ, Prisma, Anthropic SDK, node-cron, vitest + vitest-mock-extended

**Prerequisite:** Phase 4 (PR #100) must be merged first — this plan depends on `notifyTaskCompletion` in coordinator.service.ts and the orchestrator processor in workers.ts.

---

### Task 1: StatusCheckResult Type + Backoff Utility

**Files:**
- Create: `src/agents/monitor/types.ts`
- Create: `src/agents/monitor/backoff.ts`
- Test: `src/agents/monitor/backoff.test.ts`

**What:** Define the `StatusCheckResult` interface and the backoff delay calculator.

```typescript
// types.ts
export interface StatusCheckResult {
  status: 'approved' | 'denied' | 'pending' | 'additional_info_needed';
  details?: string;
  denialReason?: string;
  denialCode?: string;
  effectiveDate?: string;
  confirmationId?: string;
}

export interface MonitorJobData {
  workflowId: string;
  taskId: string;
  enrollmentId?: string;
  providerId: string;
  payerId: string;
  submissionId?: string;
  submittedAt: string; // ISO date — when the submission was made
  nextCheckAt?: string; // ISO date — when to check next
  checkCount?: number;
}
```

```typescript
// backoff.ts
const FOUR_HOURS = 4 * 60 * 60 * 1000;
const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

export function calculateMonitorDelay(submittedAt: Date): { delayMs: number; isStalled: boolean } {
  const daysSinceSubmission = (Date.now() - submittedAt.getTime()) / (24 * 60 * 60 * 1000);

  if (daysSinceSubmission <= 7) return { delayMs: FOUR_HOURS, isStalled: false };
  if (daysSinceSubmission <= 14) return { delayMs: EIGHT_HOURS, isStalled: false };
  if (daysSinceSubmission <= 30) return { delayMs: TWENTY_FOUR_HOURS, isStalled: false };
  return { delayMs: FORTY_EIGHT_HOURS, isStalled: true };
}
```

**Tests:** Verify delay for day 1, day 8, day 15, day 31. Verify `isStalled` is true only at day 31+.

**Commit:** `feat: add monitor types and backoff utility`

---

### Task 2: Monitor Agent Worker

**Files:**
- Create: `src/agents/monitor/monitor-agent.ts`
- Test: `src/agents/monitor/monitor-agent.test.ts`

**What:** The core monitor agent processor. Loads payer adapter config, simulates status check (adapter-based when available, fallback to pending), handles each status outcome.

```typescript
export interface MonitorJobResult {
  taskId: string;
  status: string;
  nextCheckAt?: string;
  isStalled?: boolean;
}

export async function processMonitorJob(data: MonitorJobData): Promise<MonitorJobResult> {
  // 1. Load task from DB
  // 2. Mark task as in_progress
  // 3. Load payer adapter config (to determine adapter type)
  // 4. Check status:
  //    - For now: look at task.input for any externally-set status
  //    - Future: call adapter.checkStatus()
  //    - Default: { status: 'pending' }
  // 5. Handle result:
  //    - approved: update task completed, update enrollment status, notifyTaskCompletion('task_completed')
  //    - denied: update task failed with denial info, notifyTaskCompletion('task_failed')
  //    - pending: calculate next delay, schedule delayed re-check job, update nextCheckAt
  //    - additional_info_needed: update task failed, notifyTaskCompletion('task_failed')
  // 6. If stalled: log warning event, emit WebSocket
  // 7. Log event, return result
}
```

**Status check approach:** Since real adapter `checkStatus()` will be added per-payer over time, the monitor agent checks `PayerAdapterConfig.adapterType`:
- `caqh_directassure` → attempt CAQH status check (if CAQH service available)
- All others → return `{ status: 'pending' }` (status updated manually or via future adapters)

For the delayed re-check: enqueue a new `monitor_status` job to the monitor queue with `delay: delayMs` and updated `checkCount` and `nextCheckAt` in the job data.

**Tests (mock Prisma, mock queues, mock notifyTaskCompletion):**
1. Status `approved` → task completed, enrollment updated, notifyTaskCompletion called with `task_completed`
2. Status `denied` → task failed with denial details, notifyTaskCompletion called with `task_failed`
3. Status `pending` day 3 → schedules delayed job with 4hr delay, updates nextCheckAt
4. Status `pending` day 10 → schedules delayed job with 8hr delay
5. Status `pending` day 31 → schedules delayed job with 48hr delay, isStalled = true, warning event logged
6. Status `additional_info_needed` → task failed, notifyTaskCompletion called
7. Task not found → throws for BullMQ retry

**Commit:** `feat: add monitor agent worker`

---

### Task 3: Monitor Cron Scheduler

**Files:**
- Create: `src/agents/monitor/monitor-cron.ts`
- Test: `src/agents/monitor/monitor-cron.test.ts`

**What:** Hourly cron that scans for overdue monitor tasks and re-enqueues them.

```typescript
import { CronJob } from 'cron';

let isRunning = false;

export async function checkOverdueMonitors(): Promise<number> {
  if (isRunning) return 0; // concurrency guard
  isRunning = true;
  try {
    // Find in_progress monitor_status tasks where nextCheckAt <= now
    const overdueTasks = await prisma.agentTask.findMany({
      where: {
        type: 'monitor_status',
        status: 'in_progress',
        // nextCheckAt is stored in input JSON — use Prisma JSON filtering:
        input: { path: ['nextCheckAt'], lte: new Date().toISOString() },
      },
      take: 50,
      orderBy: { updatedAt: 'asc' },
    });

    for (const task of overdueTasks) {
      const input = task.input as Record<string, unknown>;
      await queue.add('monitor_status', {
        workflowId: task.workflowId,
        taskId: task.id,
        ...input,
      });
    }

    return overdueTasks.length;
  } finally {
    isRunning = false;
  }
}

export function startMonitorCron(): CronJob {
  return new CronJob('0 * * * *', checkOverdueMonitors, null, true);
}

export function stopMonitorCron(job: CronJob): void {
  job.stop();
}
```

**Note:** Prisma JSON path filtering (`input: { path: ['nextCheckAt'], lte: ... }`) works with PostgreSQL. If this proves unreliable in tests, fall back to raw SQL or `findMany` + JS filter.

**Tests (mock Prisma, mock queue):**
1. Finds 3 overdue tasks → enqueues 3 jobs
2. No overdue tasks → enqueues 0
3. Concurrency guard → second call returns 0 while first is running
4. Limits to 50 tasks per run

**Commit:** `feat: add monitor cron scheduler`

---

### Task 4: Exception Agent Types + Prompt

**Files:**
- Create: `src/agents/exception/types.ts`
- Create: `src/agents/exception/prompt.ts`
- Test: `src/agents/exception/prompt.test.ts`

**What:** Define exception types and build the Claude prompt for denial analysis.

```typescript
// types.ts
export type ExceptionCategory =
  | 'missing_document'
  | 'invalid_data'
  | 'expired_credential'
  | 'duplicate_submission'
  | 'portal_error'
  | 'captcha_blocked'
  | 'payer_system_outage'
  | 'unknown_denial'
  | 'timeout_stall';

export interface ExceptionAnalysis {
  category: ExceptionCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
  rootCause: string;
  autoRemediable: boolean;
  steps: Array<{ action: string; description: string }>;
}

export interface ExceptionJobData {
  workflowId: string;
  taskId?: string;
  issue: string;
  denialReason?: string;
  denialCode?: string;
}

export interface ExceptionJobResult {
  workflowId: string;
  category: ExceptionCategory;
  severity: string;
  analysis: ExceptionAnalysis;
}
```

```typescript
// prompt.ts
export function buildExceptionSystemPrompt(): string
// Returns role prompt: "You are a healthcare credentialing expert analyzing
// enrollment exceptions..." with the 9 categories and JSON output format.

export function buildExceptionUserMessage(params: {
  issue: string;
  denialReason?: string;
  denialCode?: string;
  providerCredentials: object;
  payerRequirements: object;
  taskError?: object;
}): string
// Returns structured context for Claude to analyze
```

**Tests:** Verify system prompt includes all 9 categories. Verify user message includes issue text, denial reason when present, provider credentials.

**Commit:** `feat: add exception agent types and prompt builder`

---

### Task 5: Exception Agent Worker

**Files:**
- Create: `src/agents/exception/exception-agent.ts`
- Test: `src/agents/exception/exception-agent.test.ts`

**What:** The exception agent processor. Loads context, calls Claude once, parses analysis, saves to task, notifies orchestrator.

```typescript
export async function processExceptionJob(data: ExceptionJobData): Promise<ExceptionJobResult> {
  // 1. Load workflow with tasks
  // 2. Load failed task (if taskId provided) — get error/output
  // 3. Load provider credentials (licenses, certs, insurance, DEA, education)
  // 4. Load payer requirements (PayerAdapterConfig.requiredFields)
  // 5. Build prompt with context
  // 6. Single Claude call (max_tokens: 1500)
  // 7. Parse JSON response (try/catch — if malformed, store raw text)
  // 8. Create or update exception task:
  //    - Create AgentTask if no taskId
  //    - Update existing task output if taskId provided
  // 9. Track tokens on workflow.totalTokensUsed
  // 10. Log event with analysis summary
  // 11. Emit WebSocket notification
  // 12. notifyTaskCompletion('task_failed') — orchestrator decides next steps
  // 13. Return result
}
```

**Anthropic client:** Use same pattern as orchestrator — lazy singleton with `setAnthropicClient()` for test injection.

**Tests (mock Prisma, mock Anthropic client):**
1. Denial with valid context → Claude returns structured JSON → saved to task output, notifyTaskCompletion called
2. Claude returns malformed JSON → raw text stored in output, warning logged, still notifies orchestrator
3. Token tracking → workflow.totalTokensUsed incremented
4. Workflow not found → throws for BullMQ retry
5. No taskId → creates new AgentTask for the exception analysis
6. With taskId → updates existing task's output

**Commit:** `feat: add exception agent worker`

---

### Task 6: Wire Monitor + Exception into Workers

**Files:**
- Modify: `src/agents/workers.ts`
- Modify: `src/agents/workers.test.ts`

**What:** Replace placeholder processors for `monitor` and `exception` with real processors. Start monitor cron in `initializeWorkers()`. Stop cron in `closeAllWorkers()`.

```typescript
import { processMonitorJob } from './monitor/monitor-agent.js';
import type { MonitorJobData } from './monitor/types.js';
import { processExceptionJob } from './exception/exception-agent.js';
import type { ExceptionJobData } from './exception/types.js';
import { startMonitorCron, stopMonitorCron } from './monitor/monitor-cron.js';

// In getProcessor():
if (agentName === 'monitor') {
  return async (job: Job) => {
    const data = job.data as MonitorJobData;
    return processMonitorJob(data);
  };
}
if (agentName === 'exception') {
  return async (job: Job) => {
    const data = job.data as ExceptionJobData;
    return processExceptionJob(data);
  };
}

// In initializeWorkers(): start cron
// In closeAllWorkers(): stop cron
```

**Note:** `workers.ts` on master still uses `createPlaceholderProcessor` for all queues. Phase 4 PR adds `getProcessor()` routing for `orchestrator`. This task adds `monitor` and `exception` to that routing. If Phase 4 isn't merged yet, create `getProcessor()` fresh with all three.

**Tests:** Add mocks for monitor and exception modules. Verify 6 workers still created. Verify cron starts/stops.

**Commit:** `feat: wire monitor and exception processors into workers`

---

### Task 7: Integration Verification

**Files:** All test files

**Step 1:** Run full agent test suite
```bash
npx vitest run src/agents/ src/routes/agent.routes.test.ts
```

**Step 2:** Run TypeScript build check
```bash
npx tsc --noEmit
```

**Step 3:** Fix any failures

**Step 4:** Final commit if fixes needed
```bash
git commit -m "fix: Phase 5 integration test fixes"
```
