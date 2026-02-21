# Approval Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the human-in-the-loop approval gate — backend worker + expiry, REST API routes, orchestrator resume, and frontend Approvals tab on the Agent Dashboard.

**Architecture:** The approval BullMQ worker schedules delayed expiry jobs. REST endpoints let staff list/decide approvals. `notifyTaskCompletion` resumes the orchestrator after decisions. The frontend adds an "Approvals" tab to the existing Agent Dashboard with real-time WebSocket updates.

**Tech Stack:** Express, Prisma, BullMQ, Vitest, React, TanStack Query, Socket.io, Tailwind CSS, Headless UI

---

## Task 1: Approval Agent Types

**Files:**
- Create: `packages/backend/src/agents/approval/types.ts`

**Step 1: Create types file**

```typescript
// packages/backend/src/agents/approval/types.ts

export interface ApprovalJobData {
  approvalId: string;
  workflowId: string;
  taskId: string;
  type: string;
  expiresAt: string; // ISO date string
}

export interface ApprovalJobResult {
  approvalId: string;
  action: 'scheduled_expiry' | 'auto_denied' | 'already_decided';
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to approval/types.ts

**Step 3: Commit**

```bash
git add packages/backend/src/agents/approval/types.ts
git commit -m "feat(approval): add approval agent type definitions"
```

---

## Task 2: Approval Agent Worker

**Files:**
- Create: `packages/backend/src/agents/approval/approval-agent.ts`
- Create: `packages/backend/src/agents/approval/approval-agent.test.ts`
- Test: `packages/backend/src/agents/approval/approval-agent.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/backend/src/agents/approval/approval-agent.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApprovalJobData } from './types.js';

// ==========================================
// Mocks
// ==========================================

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

const mockAdd = vi.fn().mockResolvedValue({ id: 'job-123' });

vi.mock('../queues.js', () => ({
  getQueue: vi.fn(() => ({ add: mockAdd })),
  QUEUE_NAMES: {
    ORCHESTRATOR: 'agent-orchestrator',
    DOCUMENT: 'agent-document',
    PORTAL: 'agent-portal',
    MONITOR: 'agent-monitor',
    EXCEPTION: 'agent-exception',
    APPROVAL: 'agent-approval',
  },
}));

vi.mock('../event-logger.js', () => ({
  logAgentEvent: vi.fn().mockResolvedValue(null),
}));

vi.mock('../websocket.js', () => ({
  emitWorkflowEvent: vi.fn(),
  emitApprovalDecision: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { mockNotifyTaskCompletion } = vi.hoisted(() => ({
  mockNotifyTaskCompletion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../coordinator.service.js', () => ({
  notifyTaskCompletion: mockNotifyTaskCompletion,
}));

// ==========================================
// Imports (after mocks)
// ==========================================

import { prismaMock } from '../../../tests/helpers/mock-prisma.js';
import { logAgentEvent } from '../event-logger.js';
import { emitApprovalDecision } from '../websocket.js';
import { processApprovalJob } from './approval-agent.js';

// ==========================================
// Fixtures
// ==========================================

const baseJobData: ApprovalJobData = {
  approvalId: 'appr-1',
  workflowId: 'wf-1',
  taskId: 'task-1',
  type: 'submission_review',
  expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
};

// ==========================================
// Tests
// ==========================================

describe('processApprovalJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('schedules a delayed expiry-check job based on expiresAt', async () => {
    prismaMock.pendingApproval.findUnique.mockResolvedValue({
      id: 'appr-1',
      status: 'pending',
      expiresAt: new Date(baseJobData.expiresAt),
      workflowId: 'wf-1',
      taskId: 'task-1',
    } as any);

    const result = await processApprovalJob(baseJobData);

    expect(result.action).toBe('scheduled_expiry');
    expect(mockAdd).toHaveBeenCalledWith(
      'check_expiry',
      expect.objectContaining({ approvalId: 'appr-1' }),
      expect.objectContaining({ delay: expect.any(Number) })
    );

    // Verify delay is approximately 48 hours (within 5 seconds tolerance)
    const delay = mockAdd.mock.calls[0]![2].delay;
    expect(delay).toBeGreaterThan(47 * 60 * 60 * 1000);
    expect(delay).toBeLessThanOrEqual(48 * 60 * 60 * 1000);
  });

  it('auto-denies expired approval that is still pending', async () => {
    const expiredData: ApprovalJobData = {
      ...baseJobData,
      expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
    };

    prismaMock.pendingApproval.findUnique.mockResolvedValue({
      id: 'appr-1',
      status: 'pending',
      expiresAt: new Date(expiredData.expiresAt),
      workflowId: 'wf-1',
      taskId: 'task-1',
    } as any);
    prismaMock.pendingApproval.update.mockResolvedValue({} as any);
    prismaMock.agentWorkflow.update.mockResolvedValue({} as any);
    prismaMock.agentTask.updateMany.mockResolvedValue({ count: 0 } as any);

    const result = await processApprovalJob(expiredData);

    expect(result.action).toBe('auto_denied');

    // Should update approval to denied
    expect(prismaMock.pendingApproval.update).toHaveBeenCalledWith({
      where: { id: 'appr-1' },
      data: expect.objectContaining({
        status: 'denied',
        decisionNotes: 'Auto-denied: approval expired after 48h without decision',
      }),
    });

    // Should fail workflow
    expect(prismaMock.agentWorkflow.update).toHaveBeenCalledWith({
      where: { id: 'wf-1' },
      data: { status: 'failed' },
    });

    // Should notify orchestrator
    expect(mockNotifyTaskCompletion).toHaveBeenCalledWith('wf-1', 'task-1', 'task_failed');

    // Should emit WebSocket event
    expect(emitApprovalDecision).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: 'appr-1', decision: 'expired' })
    );
  });

  it('skips already-decided approvals', async () => {
    prismaMock.pendingApproval.findUnique.mockResolvedValue({
      id: 'appr-1',
      status: 'approved',
      expiresAt: new Date(baseJobData.expiresAt),
      workflowId: 'wf-1',
      taskId: 'task-1',
    } as any);

    const result = await processApprovalJob(baseJobData);

    expect(result.action).toBe('already_decided');
    expect(prismaMock.pendingApproval.update).not.toHaveBeenCalled();
    expect(mockNotifyTaskCompletion).not.toHaveBeenCalled();
  });

  it('throws when approval not found', async () => {
    prismaMock.pendingApproval.findUnique.mockResolvedValue(null);

    await expect(processApprovalJob(baseJobData)).rejects.toThrow('Approval appr-1 not found');
  });

  it('logs agent event for scheduled expiry', async () => {
    prismaMock.pendingApproval.findUnique.mockResolvedValue({
      id: 'appr-1',
      status: 'pending',
      expiresAt: new Date(baseJobData.expiresAt),
      workflowId: 'wf-1',
      taskId: 'task-1',
    } as any);

    await processApprovalJob(baseJobData);

    expect(logAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        agent: 'approval',
        action: 'expiry_scheduled',
      })
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/agents/approval/approval-agent.test.ts 2>&1 | tail -15`
Expected: FAIL — cannot find module `./approval-agent.js`

**Step 3: Implement the approval agent**

```typescript
// packages/backend/src/agents/approval/approval-agent.ts

import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { getQueue, QUEUE_NAMES } from '../queues.js';
import { logAgentEvent } from '../event-logger.js';
import { emitApprovalDecision } from '../websocket.js';
import { notifyTaskCompletion } from '../coordinator.service.js';
import type { ApprovalJobData, ApprovalJobResult } from './types.js';

// ==========================================
// Constants
// ==========================================

const EXPIRY_NOTE = 'Auto-denied: approval expired after 48h without decision';

// ==========================================
// Main processor
// ==========================================

export async function processApprovalJob(data: ApprovalJobData): Promise<ApprovalJobResult> {
  const { approvalId, workflowId, taskId, expiresAt } = data;

  // 1. Load the approval record
  const approval = await prisma.pendingApproval.findUnique({
    where: { id: approvalId },
    select: { id: true, status: true, expiresAt: true, workflowId: true, taskId: true },
  });

  if (!approval) {
    throw new Error(`Approval ${approvalId} not found`);
  }

  // 2. If already decided, nothing to do
  if (approval.status !== 'pending') {
    logger.info('Approval already decided, skipping', { approvalId, status: approval.status });
    return { approvalId, action: 'already_decided' };
  }

  // 3. Check if expired
  const expiresAtDate = new Date(expiresAt);
  const now = new Date();

  if (expiresAtDate <= now) {
    // Auto-deny the expired approval
    await prisma.pendingApproval.update({
      where: { id: approvalId },
      data: {
        status: 'denied',
        decidedAt: now,
        decisionNotes: EXPIRY_NOTE,
      },
    });

    // Fail the workflow
    await prisma.agentWorkflow.update({
      where: { id: workflowId },
      data: { status: 'failed' },
    });

    // Cancel pending tasks
    await prisma.agentTask.updateMany({
      where: {
        workflowId,
        status: { in: ['pending', 'queued'] },
      },
      data: { status: 'cancelled' },
    });

    // Notify orchestrator
    await notifyTaskCompletion(workflowId, taskId, 'task_failed');

    // Log event
    await logAgentEvent({
      workflowId,
      taskId,
      agent: 'approval',
      action: 'approval_auto_denied',
      data: { approvalId, reason: 'expired' },
    });

    // WebSocket
    emitApprovalDecision({
      approvalId,
      workflowId,
      decision: 'expired',
    });

    logger.info('Approval auto-denied (expired)', { approvalId, workflowId });

    return { approvalId, action: 'auto_denied' };
  }

  // 4. Not expired yet — schedule a delayed expiry check
  const delayMs = expiresAtDate.getTime() - now.getTime();
  const approvalQueue = getQueue(QUEUE_NAMES.APPROVAL);

  await approvalQueue.add(
    'check_expiry',
    { approvalId, workflowId, taskId, type: data.type, expiresAt },
    { delay: delayMs, jobId: `expiry-${approvalId}` }
  );

  await logAgentEvent({
    workflowId,
    taskId,
    agent: 'approval',
    action: 'expiry_scheduled',
    data: { approvalId, expiresAt, delayMs },
  });

  logger.info('Approval expiry check scheduled', { approvalId, delayMs });

  return { approvalId, action: 'scheduled_expiry' };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/agents/approval/approval-agent.test.ts 2>&1 | tail -15`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add packages/backend/src/agents/approval/
git commit -m "feat(approval): add approval agent worker with expiry scheduling and auto-deny"
```

---

## Task 3: Wire Approval Worker into workers.ts

**Files:**
- Modify: `packages/backend/src/agents/workers.ts` (lines 8-18, 84-116, 126-133)
- Modify: `packages/backend/src/agents/workers.test.ts` (add approval mock)

**Step 1: Update workers.test.ts — add approval mock**

Add after line 71 (the exception mock) in `workers.test.ts`:

```typescript
vi.mock('./approval/approval-agent.js', () => ({
  processApprovalJob: vi.fn().mockResolvedValue({ action: 'scheduled_expiry' }),
}));
```

**Step 2: Run existing tests to verify they still pass**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/agents/workers.test.ts 2>&1 | tail -15`
Expected: All tests PASS (the mock just needs to exist, the placeholder processor is replaced)

**Step 3: Add import and processor to workers.ts**

Add import after line 18 (`import type { ExceptionJobData } from './exception/types.js';`):

```typescript
import { processApprovalJob } from './approval/approval-agent.js';
import type { ApprovalJobData } from './approval/types.js';
```

Add processor case in `getProcessor()` after the exception block (after line 114, before the `return createPlaceholderProcessor`):

```typescript
  if (agentName === 'approval') {
    return async (job: Job) => {
      const data = job.data as ApprovalJobData;
      return processApprovalJob(data);
    };
  }
```

**Step 4: Run tests to verify**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/agents/workers.test.ts 2>&1 | tail -15`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/backend/src/agents/workers.ts packages/backend/src/agents/workers.test.ts
git commit -m "feat(approval): wire approval processor into BullMQ workers"
```

---

## Task 4: Add notifyTaskCompletion to decideApproval

**Files:**
- Modify: `packages/backend/src/agents/approval.service.ts` (lines 1-4, 35, 89-172)
- Modify: `packages/backend/src/agents/approval.service.test.ts`

**Step 1: Update tests to expect notifyTaskCompletion calls**

In `approval.service.test.ts`, add the coordinator mock. After the websocket mock (line 23), add:

```typescript
const { mockNotifyTaskCompletion } = vi.hoisted(() => ({
  mockNotifyTaskCompletion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../agents/coordinator.service.js', () => ({
  notifyTaskCompletion: mockNotifyTaskCompletion,
}));
```

**IMPORTANT:** The approval.service.ts is at `src/agents/approval.service.ts`, so the mock path from the test is `./coordinator.service.js` (same directory). Fix the mock path:

```typescript
vi.mock('./coordinator.service.js', () => ({
  notifyTaskCompletion: mockNotifyTaskCompletion,
}));
```

Add to the "approves and resumes workflow" test (after the `emitApprovalDecision` assertion):

```typescript
    // Should notify orchestrator to resume
    expect(mockNotifyTaskCompletion).toHaveBeenCalledWith('wf-1', 'task-1', 'task_completed');
```

Add to the "denies and fails workflow" test (after the `logAgentEvent` assertion):

```typescript
    // Should notify orchestrator about failure
    expect(mockNotifyTaskCompletion).toHaveBeenCalledWith('wf-1', 'task-1', 'task_failed');
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/agents/approval.service.test.ts 2>&1 | tail -20`
Expected: FAIL — `notifyTaskCompletion` was not called

**Step 3: Update approval.service.ts**

Add import at top (after line 4):

```typescript
import { notifyTaskCompletion } from './coordinator.service.js';
```

Change `DEFAULT_EXPIRY_MS` (line 35) from 7 days to 48 hours:

```typescript
const DEFAULT_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours
```

In `decideApproval`, after resuming workflow on approve (after line 128, the `agentWorkflow.update`), add:

```typescript
    // Notify orchestrator to resume processing
    await notifyTaskCompletion(workflowId, approval.taskId, 'task_completed');
```

In `decideApproval`, after cancelling pending tasks on deny (after line 151, the `agentTask.updateMany`), add:

```typescript
    // Notify orchestrator about failure
    await notifyTaskCompletion(workflowId, approval.taskId, 'task_failed');
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/agents/approval.service.test.ts 2>&1 | tail -15`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/backend/src/agents/approval.service.ts packages/backend/src/agents/approval.service.test.ts
git commit -m "feat(approval): notify orchestrator on approval decision, set 48h default expiry"
```

---

## Task 5: Add Approval REST API Routes

**Files:**
- Modify: `packages/backend/src/routes/agent.routes.ts`
- Reference: `packages/backend/src/agents/approval.service.ts` (already has listPendingApprovals, getApproval, decideApproval)

**Step 1: Add Zod schemas and route handlers**

At the top of `agent.routes.ts`, add to the imports (after line 16):

```typescript
import {
  listPendingApprovals,
  getApproval,
  decideApproval,
} from '../agents/approval.service.js';
```

Add Zod schemas after the existing ones (after `patchWorkflowSchema`, around line 53):

```typescript
const listApprovalsSchema = z.object({
  status: z.enum(['pending', 'approved', 'denied']).optional(),
  workflowId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const decideApprovalSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  notes: z.string().max(1000).optional(),
});
```

Add route handlers at the end of the file (before the closing of the module, after line 291):

```typescript
// ==========================================
// Approval routes
// ==========================================

// GET /approvals — list approvals
agentRoutes.get(
  '/approvals',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = listApprovalsSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const approvals = await listPendingApprovals(parsed.data);
      res.status(200).json(approvals);
    } catch (err) {
      next(err);
    }
  }
);

// GET /approvals/:id — get single approval
agentRoutes.get(
  '/approvals/:id',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const approval = await getApproval(req.params['id']!);
      if (!approval) {
        res.status(404).json({ error: 'Approval not found' });
        return;
      }
      res.status(200).json(approval);
    } catch (err) {
      next(err);
    }
  }
);

// POST /approvals/:id/decide — approve or deny
agentRoutes.post(
  '/approvals/:id/decide',
  ...auth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = decideApprovalSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const approval = await decideApproval(req.params['id']!, {
        decision: parsed.data.decision,
        decidedBy: req.user!.id,
        notes: parsed.data.notes,
      });

      res.status(200).json(approval);
    } catch (err) {
      next(err);
    }
  }
);
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/backend/src/routes/agent.routes.ts
git commit -m "feat(approval): add REST API routes for listing and deciding approvals"
```

---

## Task 6: Enqueue Approval Job on Creation

When `requestApproval` creates a PendingApproval, it should enqueue a job on the approval queue so the worker can schedule the expiry check.

**Files:**
- Modify: `packages/backend/src/agents/approval.service.ts`
- Modify: `packages/backend/src/agents/approval.service.test.ts`

**Step 1: Update test to expect queue job**

In `approval.service.test.ts`, add a queue mock. After the websocket mock:

```typescript
const mockQueueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });

vi.mock('./queues.js', () => ({
  getQueue: vi.fn(() => ({ add: mockQueueAdd })),
  QUEUE_NAMES: {
    ORCHESTRATOR: 'agent-orchestrator',
    DOCUMENT: 'agent-document',
    PORTAL: 'agent-portal',
    MONITOR: 'agent-monitor',
    EXCEPTION: 'agent-exception',
    APPROVAL: 'agent-approval',
  },
}));
```

Add assertion in the `requestApproval` test (after `emitApprovalRequest` assertion):

```typescript
      // Should enqueue approval job for expiry scheduling
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'process_approval',
        expect.objectContaining({
          approvalId: 'appr-1',
          workflowId: 'wf-1',
          taskId: 'task-1',
        })
      );
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/agents/approval.service.test.ts 2>&1 | tail -20`
Expected: FAIL — `mockQueueAdd` was not called

**Step 3: Add queue enqueue to requestApproval**

In `approval.service.ts`, add import:

```typescript
import { getQueue, QUEUE_NAMES } from './queues.js';
```

After the WebSocket emit (after line 78, `emitApprovalRequest({...})`), add:

```typescript
  // Enqueue approval job for expiry scheduling
  const approvalQueue = getQueue(QUEUE_NAMES.APPROVAL);
  await approvalQueue.add('process_approval', {
    approvalId: approval.id,
    workflowId,
    taskId,
    type,
    expiresAt: approval.expiresAt.toISOString(),
  });
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/agents/approval.service.test.ts 2>&1 | tail -15`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/backend/src/agents/approval.service.ts packages/backend/src/agents/approval.service.test.ts
git commit -m "feat(approval): enqueue approval job on creation for expiry scheduling"
```

---

## Task 7: Run Full Backend Test Suite

**Step 1: Run all tests**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run 2>&1 | tail -30`
Expected: All tests pass (1854+ tests)

**Step 2: Run TypeScript check**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Fix any failures before proceeding**

---

## Task 8: Frontend Approval Hooks

**Files:**
- Create: `packages/frontend/src/hooks/useApprovals.ts`

**Step 1: Create the hooks file**

```typescript
// packages/frontend/src/hooks/useApprovals.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import toast from 'react-hot-toast';

// ==========================================
// Types
// ==========================================

export interface ApprovalWorkflow {
  id: string;
  goal: string;
  status: string;
  provider: { id: string; firstName: string; lastName: string; npi: string } | null;
  payer: { id: string; name: string } | null;
}

export interface Approval {
  id: string;
  workflowId: string;
  taskId: string;
  type: string;
  status: 'pending' | 'approved' | 'denied';
  context: Record<string, unknown>;
  requestedAt: string;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
  workflow: ApprovalWorkflow;
}

// ==========================================
// Query hooks
// ==========================================

export function useApprovals(status?: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const qs = params.toString();
  const endpoint = `/agent/approvals${qs ? `?${qs}` : ''}`;

  return useQuery({
    queryKey: ['approvals', status ?? 'all'],
    queryFn: async () => {
      const { data } = await api.get<Approval[]>(endpoint);
      return data;
    },
    refetchInterval: 30_000, // Poll every 30s as fallback to WebSocket
  });
}

export function useApprovalDetail(id: string | null) {
  return useQuery({
    queryKey: ['approval', id],
    queryFn: async () => {
      if (!id) return null;
      const { data } = await api.get<Approval>(`/agent/approvals/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

// ==========================================
// Mutation hooks
// ==========================================

export function useDecideApproval() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      decision,
      notes,
    }: {
      id: string;
      decision: 'approved' | 'denied';
      notes?: string;
    }) => {
      const { data } = await api.post<Approval>(`/agent/approvals/${id}/decide`, {
        decision,
        notes,
      });
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['approval', variables.id] });
      toast.success(
        variables.decision === 'approved' ? 'Approval granted' : 'Approval denied'
      );
    },
    onError: (error: any) => {
      const message =
        error.response?.data?.error || error.message || 'Failed to decide approval';
      toast.error(message);
    },
  });
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/kay/Documents/KAY/packages/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useApprovals.ts
git commit -m "feat(approval): add React Query hooks for approval CRUD"
```

---

## Task 9: Frontend Approvals Tab Component

**Files:**
- Create: `packages/frontend/src/features/ai-agent/ApprovalsTab.tsx`

**Step 1: Create the component**

```tsx
// packages/frontend/src/features/ai-agent/ApprovalsTab.tsx

import { useState, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { clsx } from 'clsx';
import { useApprovals, useApprovalDetail, useDecideApproval } from '../../hooks/useApprovals';
import type { Approval } from '../../hooks/useApprovals';

// ==========================================
// Status helpers
// ==========================================

function statusBadge(status: string) {
  switch (status) {
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700">
          <ClockIcon className="h-3 w-3" /> Pending
        </span>
      );
    case 'approved':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
          <CheckCircleIcon className="h-3 w-3" /> Approved
        </span>
      );
    case 'denied':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
          <XCircleIcon className="h-3 w-3" /> Denied
        </span>
      );
    default:
      return <span className="text-xs text-gray-500">{status}</span>;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function timeUntilExpiry(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))}m`;
}

// ==========================================
// Detail Panel
// ==========================================

function ApprovalDetailPanel({
  approvalId,
  onClose,
}: {
  approvalId: string;
  onClose: () => void;
}) {
  const { data: approval, isLoading } = useApprovalDetail(approvalId);
  const decideMutation = useDecideApproval();
  const [notes, setNotes] = useState('');

  const handleDecide = (decision: 'approved' | 'denied') => {
    decideMutation.mutate(
      { id: approvalId, decision, notes: notes.trim() || undefined },
      { onSuccess: () => onClose() }
    );
  };

  return (
    <Transition appear show as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-start justify-end">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="translate-x-full"
              enterTo="translate-x-0"
              leave="ease-in duration-150"
              leaveFrom="translate-x-0"
              leaveTo="translate-x-full"
            >
              <Dialog.Panel className="w-full max-w-md transform bg-white shadow-xl transition-all min-h-screen p-6">
                <div className="flex items-center justify-between mb-6">
                  <Dialog.Title className="text-lg font-semibold text-gray-900">
                    Approval Detail
                  </Dialog.Title>
                  <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                {isLoading || !approval ? (
                  <div className="text-center py-8 text-gray-500">Loading...</div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium text-gray-500">Type</p>
                      <p className="text-sm text-gray-900">{approval.type.replace(/_/g, ' ')}</p>
                    </div>

                    <div>
                      <p className="text-sm font-medium text-gray-500">Status</p>
                      <div className="mt-1">{statusBadge(approval.status)}</div>
                    </div>

                    {approval.workflow?.provider && (
                      <div>
                        <p className="text-sm font-medium text-gray-500">Provider</p>
                        <p className="text-sm text-gray-900">
                          {approval.workflow.provider.firstName}{' '}
                          {approval.workflow.provider.lastName}
                          <span className="text-gray-400 ml-1">
                            (NPI: {approval.workflow.provider.npi})
                          </span>
                        </p>
                      </div>
                    )}

                    {approval.workflow?.payer && (
                      <div>
                        <p className="text-sm font-medium text-gray-500">Payer</p>
                        <p className="text-sm text-gray-900">{approval.workflow.payer.name}</p>
                      </div>
                    )}

                    <div>
                      <p className="text-sm font-medium text-gray-500">Requested</p>
                      <p className="text-sm text-gray-900">{formatDate(approval.requestedAt)}</p>
                    </div>

                    <div>
                      <p className="text-sm font-medium text-gray-500">Expires</p>
                      <p className="text-sm text-gray-900">
                        {formatDate(approval.expiresAt)}
                        {approval.status === 'pending' && (
                          <span className="text-yellow-600 ml-2">
                            ({timeUntilExpiry(approval.expiresAt)})
                          </span>
                        )}
                      </p>
                    </div>

                    {approval.context && Object.keys(approval.context).length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-gray-500 mb-1">Context</p>
                        <pre className="text-xs bg-gray-50 rounded p-3 overflow-auto max-h-48 text-gray-700">
                          {JSON.stringify(approval.context, null, 2)}
                        </pre>
                      </div>
                    )}

                    {approval.decisionNotes && (
                      <div>
                        <p className="text-sm font-medium text-gray-500">Decision Notes</p>
                        <p className="text-sm text-gray-900">{approval.decisionNotes}</p>
                      </div>
                    )}

                    {approval.status === 'pending' && (
                      <div className="border-t pt-4 mt-6">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Notes (optional)
                        </label>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                          rows={3}
                          placeholder="Add decision notes..."
                        />
                        <div className="flex gap-3 mt-4">
                          <button
                            onClick={() => handleDecide('approved')}
                            disabled={decideMutation.isPending}
                            className="flex-1 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            {decideMutation.isPending ? 'Processing...' : 'Approve'}
                          </button>
                          <button
                            onClick={() => handleDecide('denied')}
                            disabled={decideMutation.isPending}
                            className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {decideMutation.isPending ? 'Processing...' : 'Deny'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

// ==========================================
// Main Component
// ==========================================

export default function ApprovalsTab() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const { data: approvals, isLoading } = useApprovals(statusFilter);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);

  const pendingCount = approvals?.filter((a) => a.status === 'pending').length ?? 0;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!approvals) return;
    if (selectedIds.size === approvals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(approvals.map((a) => a.id)));
    }
  };

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {(['all', 'pending', 'approved', 'denied'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s === 'all' ? undefined : s)}
              className={clsx(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                (s === 'all' && !statusFilter) || statusFilter === s
                  ? 'bg-primary-100 text-primary-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
              {s === 'pending' && pendingCount > 0 && (
                <span className="ml-1 rounded-full bg-yellow-400 px-1.5 text-xs text-yellow-900">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading approvals...</div>
      ) : !approvals?.length ? (
        <div className="text-center py-12 text-gray-400">No approvals found</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === approvals.length && approvals.length > 0}
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Type
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Provider / Payer
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Requested
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Expires
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {approvals.map((approval: Approval) => (
                <tr
                  key={approval.id}
                  onClick={() => setDetailId(approval.id)}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(approval.id)}
                      onChange={() => toggleSelect(approval.id)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-900">
                    {approval.type.replace(/_/g, ' ')}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700">
                    <div>
                      {approval.workflow?.provider
                        ? `${approval.workflow.provider.firstName} ${approval.workflow.provider.lastName}`
                        : '—'}
                    </div>
                    {approval.workflow?.payer && (
                      <div className="text-xs text-gray-400">{approval.workflow.payer.name}</div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-500">
                    {formatDate(approval.requestedAt)}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-500">
                    {approval.status === 'pending' ? (
                      <span className={clsx(
                        new Date(approval.expiresAt).getTime() - Date.now() < 4 * 60 * 60 * 1000
                          ? 'text-red-600 font-medium'
                          : ''
                      )}>
                        {timeUntilExpiry(approval.expiresAt)}
                      </span>
                    ) : (
                      formatDate(approval.expiresAt)
                    )}
                  </td>
                  <td className="px-3 py-3">{statusBadge(approval.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail slide-out */}
      {detailId && (
        <ApprovalDetailPanel
          approvalId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/kay/Documents/KAY/packages/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/features/ai-agent/ApprovalsTab.tsx
git commit -m "feat(approval): add ApprovalsTab component with table, filters, and detail panel"
```

---

## Task 10: Wire Approvals Tab into Agent Dashboard

**Files:**
- Modify: `packages/frontend/src/features/ai-agent/AiAgentDashboard.tsx`

**Step 1: Add the Approvals tab**

Import ApprovalsTab at the top of the file:

```typescript
import ApprovalsTab from './ApprovalsTab';
```

Import the `ShieldCheckIcon` from heroicons (add to the existing heroicons import):

```typescript
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
```

Change the `activeTab` state type to include 'approvals':

```typescript
const [activeTab, setActiveTab] = useState<'dashboard' | 'chat' | 'approvals'>('dashboard');
```

Add the Approvals tab button in the nav (after the Chat button, following the same pattern):

```tsx
<button
  onClick={() => setActiveTab('approvals')}
  className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
    activeTab === 'approvals'
      ? 'border-primary-600 text-primary-600'
      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
  }`}
>
  <ShieldCheckIcon className="h-4 w-4" />
  Approvals
</button>
```

Update the tab content rendering to handle the approvals tab. Change the conditional from:

```tsx
{activeTab === 'chat' ? (
  <ChatPanel />
) : (
```

To:

```tsx
{activeTab === 'chat' ? (
  <ChatPanel />
) : activeTab === 'approvals' ? (
  <ApprovalsTab />
) : (
```

**Step 2: Verify it compiles**

Run: `cd /Users/kay/Documents/KAY/packages/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/frontend/src/features/ai-agent/AiAgentDashboard.tsx
git commit -m "feat(approval): add Approvals tab to Agent Dashboard"
```

---

## Task 11: Full Test Suite + TypeScript Verification

**Step 1: Run backend tests**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run 2>&1 | tail -30`
Expected: All tests pass

**Step 2: Run backend TypeScript check**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Run frontend TypeScript check**

Run: `cd /Users/kay/Documents/KAY/packages/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 4: Fix any issues found**

---

## Task 12: Manual Smoke Test

**Step 1: Start dev environment**

Run: `cd /Users/kay/Documents/KAY && docker compose up -d && npm run dev --workspace=packages/backend & npm run dev --workspace=packages/frontend &`

**Step 2: Test approval REST API**

```bash
# List approvals (should return empty array)
curl -s http://localhost:3002/api/v1/agent/approvals -H 'Authorization: Bearer dev-token' | jq .

# Create a test workflow, then trigger an approval via the orchestrator
```

**Step 3: Test frontend**

Navigate to `http://localhost:5190/ai-agent` and verify:
- The "Approvals" tab appears in the nav
- Clicking it shows the approvals table (empty state)
- Filter buttons work

**Step 4: Test approval flow end-to-end**

Create a workflow that triggers `request_human_approval`, then verify:
- Approval appears in the table
- Clicking opens the detail panel
- Approve/Deny buttons work
- Workflow resumes/fails accordingly
