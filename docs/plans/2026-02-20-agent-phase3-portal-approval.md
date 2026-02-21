# Phase 3: Portal Agent + Approval Gate — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the portal agent (payer adapter pattern with CAQH DirectAssure + manual adapters) and the approval gate service (CRUD, approve/deny, WebSocket push, workflow pause/resume).

**Architecture:** Payer Adapter interface with a registry keyed by `PayerAdapterConfig.adapterType`. Portal agent BullMQ worker dispatches to the appropriate adapter. Approval service manages `PendingApproval` lifecycle and wires into the coordinator for workflow pause/resume. WebSocket already has `emitApprovalRequest`/`emitApprovalDecision` helpers.

**Tech Stack:** Express, Prisma, BullMQ, Zod, Socket.io (existing), vitest + vitest-mock-extended + supertest

---

## Task 1: Payer Adapter Interface + Registry

**Files:**
- Create: `src/agents/portal/payer-adapter.ts`
- Test: `src/agents/portal/payer-adapter.test.ts`

### Step 1: Write the adapter interface and registry

```typescript
// payer-adapter.ts
export interface PayerAdapterResult {
  success: boolean;
  submissionId?: string;
  confirmationNumber?: string;
  statusUrl?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface ReadinessCheck {
  ready: boolean;
  missingFields: string[];
  warnings: string[];
}

export interface PayerAdapter {
  readonly adapterType: string;
  checkReadiness(input: SubmissionInput): Promise<ReadinessCheck>;
  submit(input: SubmissionInput): Promise<PayerAdapterResult>;
}

export interface SubmissionInput {
  workflowId: string;
  taskId: string;
  providerId: string;
  payerId: string;
  enrollmentId?: string;
  config: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}

// Registry
const adapterRegistry = new Map<string, PayerAdapter>();

export function registerAdapter(type: string, adapter: PayerAdapter): void {
  adapterRegistry.set(type, adapter);
}

export function getAdapter(type: string): PayerAdapter | undefined {
  return adapterRegistry.get(type);
}

export function listAdapterTypes(): string[] {
  return Array.from(adapterRegistry.keys());
}
```

### Step 2: Write tests

Test `registerAdapter`, `getAdapter`, `listAdapterTypes`. Verify unknown type returns undefined.

### Step 3: Run tests, verify pass

```bash
npx vitest run src/agents/portal/payer-adapter.test.ts
```

### Step 4: Commit

```bash
git add src/agents/portal/
git commit -m "feat: add payer adapter interface and registry"
```

---

## Task 2: CAQH DirectAssure Adapter

**Files:**
- Create: `src/agents/portal/caqh-adapter.ts`
- Test: `src/agents/portal/caqh-adapter.test.ts`

### Step 1: Write the CAQH adapter

Wraps existing `CaqhService` methods. `checkReadiness()` verifies the provider has a CAQH provider ID and the service is configured. `submit()` calls `addToRoster()` then `syncProvider()`.

```typescript
export class CaqhDirectAssureAdapter implements PayerAdapter {
  readonly adapterType = 'caqh_directassure';

  async checkReadiness(input: SubmissionInput): Promise<ReadinessCheck> {
    // Check CaqhService.isConfigured()
    // Check provider has caqhProviderId
    // Return { ready, missingFields, warnings }
  }

  async submit(input: SubmissionInput): Promise<PayerAdapterResult> {
    // CaqhService.addToRoster(provider)
    // CaqhService.syncProvider(providerId, caqhProviderId)
    // Return { success, submissionId, confirmationNumber }
  }
}
```

### Step 2: Write tests (mock CaqhService)

Test readiness when not configured, when provider missing caqhProviderId, happy path. Test submit success and error paths.

### Step 3: Run tests, verify pass

### Step 4: Commit

```bash
git commit -m "feat: add CAQH DirectAssure payer adapter"
```

---

## Task 3: Manual Submission Adapter

**Files:**
- Create: `src/agents/portal/manual-adapter.ts`
- Test: `src/agents/portal/manual-adapter.test.ts`

### Step 1: Write the manual adapter

For payers without API/RPA. `checkReadiness()` always returns ready (human handles it). `submit()` generates a JSON manifest of required credentials/documents and creates a `PendingApproval` record for human handoff.

```typescript
export class ManualSubmissionAdapter implements PayerAdapter {
  readonly adapterType = 'manual_submission';

  async checkReadiness(input: SubmissionInput): Promise<ReadinessCheck> {
    return { ready: true, missingFields: [], warnings: ['Manual submission — requires human handoff'] };
  }

  async submit(input: SubmissionInput): Promise<PayerAdapterResult> {
    // Build manifest: gather provider credentials, documents from DB
    // Create PendingApproval record with type 'manual_submission'
    // Return { success: true, submissionId: approval.id, details: { manifest } }
  }
}
```

### Step 2: Write tests

Test readiness always returns ready with warning. Test submit creates PendingApproval and returns manifest.

### Step 3: Run tests, verify pass

### Step 4: Commit

```bash
git commit -m "feat: add manual submission payer adapter"
```

---

## Task 4: Portal Agent Worker (BullMQ Processor)

**Files:**
- Create: `src/agents/portal/portal-agent.ts`
- Test: `src/agents/portal/portal-agent.test.ts`
- Modify: `src/agents/workers.ts` (wire processor)

### Step 1: Write the portal agent processor

```typescript
export interface PortalJobData {
  workflowId: string;
  taskId: string;
  providerId: string;
  payerId: string;
  enrollmentId?: string;
  action: 'submit_to_portal' | 'check_readiness';
}

export async function processPortalJob(data: PortalJobData): Promise<PortalJobResult> {
  // 1. Load PayerAdapterConfig for this payer
  // 2. Get adapter from registry by adapterType
  // 3. Update task status to in_progress
  // 4. If action is check_readiness: call adapter.checkReadiness()
  // 5. If action is submit_to_portal: call adapter.submit()
  // 6. Update task with output, mark completed/failed
  // 7. Log agent event
  // 8. Emit WebSocket event
}
```

### Step 2: Wire into workers.ts

Replace placeholder processor for `portal_interaction` agent with `processPortalJob`.

### Step 3: Write tests (mock adapters, prisma, event logger)

Test: loads adapter config, dispatches to correct adapter, handles missing adapter gracefully, updates task status on success/failure.

### Step 4: Run tests, verify pass

### Step 5: Commit

```bash
git commit -m "feat: add portal agent BullMQ worker"
```

---

## Task 5: Adapter Registration (Bootstrap)

**Files:**
- Create: `src/agents/portal/index.ts`
- Modify: `src/agents/workers.ts` (import and call registration)

### Step 1: Create portal/index.ts

Registers both adapters at module load:

```typescript
import { registerAdapter } from './payer-adapter.js';
import { CaqhDirectAssureAdapter } from './caqh-adapter.js';
import { ManualSubmissionAdapter } from './manual-adapter.js';

export function registerPortalAdapters(): void {
  registerAdapter('caqh_directassure', new CaqhDirectAssureAdapter());
  registerAdapter('manual_submission', new ManualSubmissionAdapter());
}

export { getAdapter, listAdapterTypes } from './payer-adapter.js';
```

### Step 2: Call `registerPortalAdapters()` in `initializeWorkers()`

### Step 3: Write test — verify both adapters registered after calling init

### Step 4: Commit

```bash
git commit -m "feat: register portal adapters on worker init"
```

---

## Task 6: Coordinator — dispatchPortalSubmission

**Files:**
- Modify: `src/agents/coordinator.service.ts`
- Modify: `src/agents/coordinator.service.test.ts`

### Step 1: Add `dispatchPortalSubmission` function

Follows the same pattern as `dispatchDocumentParsing`:

```typescript
export interface DispatchPortalInput {
  workflowId: string;
  providerId: string;
  payerId: string;
  enrollmentId?: string;
  action?: 'submit_to_portal' | 'check_readiness';
}

export async function dispatchPortalSubmission(input: DispatchPortalInput) {
  // 1. Create AgentTask (type: 'submit_to_portal', agentType: 'portal')
  // 2. Enqueue to PORTAL queue
  // 3. Update task with bullmqJobId
  // 4. Log event
  // Return task
}
```

### Step 2: Write tests mirroring dispatchDocumentParsing tests

### Step 3: Run tests, verify pass

### Step 4: Commit

```bash
git commit -m "feat: add dispatchPortalSubmission to coordinator"
```

---

## Task 7: Approval Service

**Files:**
- Create: `src/agents/approval.service.ts`
- Test: `src/agents/approval.service.test.ts`

### Step 1: Write approval service

```typescript
export async function requestApproval(input: RequestApprovalInput): Promise<PendingApproval>
// Creates PendingApproval, emits WebSocket approval:requested, logs event
// Pauses the workflow (status -> waiting_approval)

export async function decideApproval(id: string, decision: DecideApprovalInput): Promise<PendingApproval>
// Updates PendingApproval status + decidedBy/decidedAt/decisionNotes
// If approved: resumes workflow (status -> active), enqueues next task
// If denied: cancels workflow or marks task failed
// Emits WebSocket approval:decided

export async function listPendingApprovals(filters?: ApprovalFilters): Promise<PendingApproval[]>
// Paginated list of pending approvals with workflow + provider context

export async function getApproval(id: string): Promise<PendingApproval | null>
// Single approval with full context
```

### Step 2: Write tests

Test: creates approval + pauses workflow, approve resumes workflow, deny cancels workflow, lists with filters, expiry check.

### Step 3: Run tests, verify pass

### Step 4: Commit

```bash
git commit -m "feat: add approval gate service"
```

---

## Task 8: Approval API Routes

**Files:**
- Create: `src/routes/approval.routes.ts`
- Test: `src/routes/approval.routes.test.ts`
- Modify: `src/index.ts` (mount routes)

### Step 1: Write routes

```
GET    /approvals          — list pending approvals
GET    /approvals/:id      — get single approval
POST   /approvals/:id/decide — approve or deny
```

All protected by `authenticate + authorize('admin', 'credentialing_staff', 'practice_admin')`.

Zod validation for decide: `{ decision: 'approved' | 'denied', notes?: string }`.

### Step 2: Write tests using `createTestApp` + supertest

Test: list returns 200, get returns 404/200, decide approve returns 200, decide deny returns 200, invalid decision returns 400.

### Step 3: Run tests, verify pass

### Step 4: Mount at `/api/v1/agent/approvals` in index.ts

### Step 5: Commit

```bash
git commit -m "feat: add approval gate API routes"
```

---

## Task 9: Portal Submission API Route

**Files:**
- Modify: `src/routes/agent.routes.ts`
- Modify: `src/routes/agent.routes.test.ts`

### Step 1: Add POST /workflows/:id/submit-to-portal endpoint

Zod schema: `{ providerId: uuid, payerId: uuid, enrollmentId?: uuid, action?: enum }`. Calls `dispatchPortalSubmission`.

### Step 2: Write tests (dispatches + returns 201, validation errors)

### Step 3: Run tests, verify pass

### Step 4: Commit

```bash
git commit -m "feat: add portal submission API endpoint"
```

---

## Task 10: Integration Verification

**Files:** All test files

### Step 1: Run full agent test suite

```bash
npx vitest run src/agents/ src/routes/agent.routes.test.ts src/routes/approval.routes.test.ts
```

### Step 2: Run TypeScript build check

```bash
npx tsc --noEmit
```

### Step 3: Fix any failures

### Step 4: Final commit if fixes needed

```bash
git commit -m "fix: Phase 3 integration test fixes"
```
