# Workflow Instantiation (Step 9) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When an Enrollment is created with a `payerTrackId`, find the active WorkflowTemplate for that PayerTrack, evaluate WorkflowTemplateConditions, and clone steps into EnrollmentWorkflowStep records.

**Architecture:** Create a new `workflow-instantiation.service.ts` that handles the DB-driven template system (WorkflowTemplate → EnrollmentWorkflowStep). Wire it into the existing `enrollment-creation-hook.ts` as a higher-priority path: if the enrollment has a `payerTrackId` and a matching active WorkflowTemplate exists, use that; otherwise fall back to the existing JSON-based hydration. This is additive — the old JSON system continues to work for enrollments without PayerTrack linkage.

**Tech Stack:** Prisma, TypeScript ESM, Vitest

**Branch:** `feat/schema-redesign-v2` (continue existing branch)

---

## Task 1: Create workflow-instantiation.service.ts

The core service that converts a WorkflowTemplate into EnrollmentWorkflowStep records.

**Files:**
- Create: `packages/backend/src/services/workflow-instantiation.service.ts`

**Step 1: Create the service**

Create `packages/backend/src/services/workflow-instantiation.service.ts`:

```typescript
/**
 * Workflow Instantiation Service
 *
 * DB-driven workflow template system. When an enrollment is created with a
 * payerTrackId, this service finds the active WorkflowTemplate, evaluates
 * conditions, and clones steps into EnrollmentWorkflowStep records.
 */

import { PrismaClient, WorkflowStepStatus } from '@prisma/client';
import { logger } from '../utils/logger.js';

// ─── Types ─────────────────────────────────────────────────

interface InstantiationContext {
  /** The state the provider is enrolling in (from PayerTrack.stateRegion or enrollment context) */
  state?: string;
  /** The provider's type (e.g., 'psychiatrist', 'lcsw') */
  providerType?: string;
  /** Whether the provider has a DEA registration */
  hasDea?: boolean;
  /** Whether the provider has hospital privileges */
  hasHospitalPrivileges?: boolean;
}

interface InstantiationResult {
  stepsCreated: number;
  templateFound: boolean;
  templateId: string | null;
  templateName: string | null;
  conditionsApplied: number;
}

// ─── Step Type → Action Type Mapping ───────────────────────

// WorkflowTemplateStep.stepType → EnrollmentWorkflowStep.actionType
// The new template system uses descriptive step types; we map them
// to the existing actionType enum for backward compatibility.
const STEP_TYPE_TO_ACTION_TYPE: Record<string, string> = {
  readiness_check: 'verification',
  caqh_authorization: 'caqh_update',
  populate_template: 'form_submission',
  human_review: 'document_review',
  submit_application: 'form_submission',
  confirm_submission: 'confirmation',
  follow_up: 'follow_up',
  escalate: 'payer_outreach',
  await_decision: 'payer_review',
  record_outcome: 'confirmation',
};

function mapStepTypeToActionType(stepType: string): string {
  return STEP_TYPE_TO_ACTION_TYPE[stepType] || 'form_submission';
}

// ─── Core Logic ────────────────────────────────────────────

/**
 * Find the active WorkflowTemplate for a PayerTrack and instantiate it
 * as EnrollmentWorkflowStep records on the given enrollment.
 *
 * Returns early with templateFound=false if no active template exists.
 */
export async function instantiateWorkflow(
  prisma: PrismaClient,
  enrollmentId: string,
  payerTrackId: string,
  context: InstantiationContext = {}
): Promise<InstantiationResult> {
  // 1. Find the active template for this PayerTrack
  const template = await prisma.workflowTemplate.findFirst({
    where: {
      payerTrackId,
      status: 'active',
    },
    include: {
      steps: { orderBy: { stepOrder: 'asc' } },
      conditions: true,
    },
    orderBy: { version: 'desc' }, // highest version first
  });

  if (!template) {
    logger.info(`No active WorkflowTemplate found for PayerTrack ${payerTrackId}`);
    return {
      stepsCreated: 0,
      templateFound: false,
      templateId: null,
      templateName: null,
      conditionsApplied: 0,
    };
  }

  // 2. Start with the base steps
  let steps = [...template.steps];
  let conditionsApplied = 0;

  // 3. Evaluate conditions and modify steps
  for (const condition of template.conditions) {
    if (!evaluateCondition(condition, context)) continue;
    conditionsApplied++;

    switch (condition.action) {
      case 'add_step': {
        // Insert a new step at the target order position
        if (condition.stepDefinition && condition.targetStepOrder != null) {
          const newStep = {
            id: `condition-${condition.id}`,
            templateId: template.id,
            stepOrder: condition.targetStepOrder,
            name: (condition.stepDefinition as any).name || `Conditional step (${condition.conditionType}=${condition.conditionValue})`,
            description: (condition.stepDefinition as any).description || null,
            stepType: (condition.stepDefinition as any).stepType || 'human_review',
            owner: (condition.stepDefinition as any).owner || 'credentialing_staff',
            requiredDocuments: (condition.stepDefinition as any).requiredDocuments || [],
            triggerDaysAfterPrev: (condition.stepDefinition as any).triggerDaysAfterPrev ?? null,
            isBlocking: (condition.stepDefinition as any).isBlocking ?? true,
            reviewerInstructions: (condition.stepDefinition as any).reviewerInstructions || null,
            createdAt: new Date(),
          };
          steps.push(newStep as any);
        }
        break;
      }
      case 'skip_step': {
        // Remove the step at the target order
        if (condition.targetStepOrder != null) {
          steps = steps.filter(s => s.stepOrder !== condition.targetStepOrder);
        }
        break;
      }
      case 'modify_step': {
        // Modify fields on an existing step
        if (condition.targetStepOrder != null && condition.stepDefinition) {
          steps = steps.map(s => {
            if (s.stepOrder !== condition.targetStepOrder) return s;
            return { ...s, ...(condition.stepDefinition as any) };
          });
        }
        break;
      }
    }
  }

  // 4. Re-sort and re-number steps after condition modifications
  steps.sort((a, b) => a.stepOrder - b.stepOrder);

  // 5. Create EnrollmentWorkflowStep records
  const now = new Date();
  const stepData = steps.map((step, index) => {
    const estimatedDays = step.triggerDaysAfterPrev ?? 0;

    // Calculate due date based on cumulative trigger days
    let dueDate: Date | null = null;
    if (estimatedDays > 0) {
      dueDate = new Date(now);
      // Sum all previous steps' trigger days for cumulative offset
      let cumulativeDays = 0;
      for (let i = 0; i <= index; i++) {
        cumulativeDays += steps[i]!.triggerDaysAfterPrev ?? 0;
      }
      dueDate.setDate(dueDate.getDate() + cumulativeDays);
    }

    return {
      enrollmentId,
      templateStepId: step.id,
      stepOrder: index + 1,
      name: step.name,
      description: step.description || '',
      actionType: mapStepTypeToActionType(step.stepType) as any,
      owner: step.owner as any,
      estimatedDays,
      dueDate,
      dependencies: [] as string[],
      documentsNeeded: step.requiredDocuments || [],
      warnings: [] as string[],
      status: 'not_started' as WorkflowStepStatus,
      updatedAt: now,
    };
  });

  if (stepData.length === 0) {
    return {
      stepsCreated: 0,
      templateFound: true,
      templateId: template.id,
      templateName: template.name,
      conditionsApplied,
    };
  }

  const result = await prisma.enrollmentWorkflowStep.createMany({
    data: stepData,
  });

  // 6. Update enrollment with the template reference
  await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: { workflowTemplateId: template.id },
  });

  logger.info(
    `Instantiated ${result.count} workflow steps from template "${template.name}" (v${template.version}) ` +
    `for enrollment ${enrollmentId}. Conditions applied: ${conditionsApplied}`
  );

  return {
    stepsCreated: result.count,
    templateFound: true,
    templateId: template.id,
    templateName: template.name,
    conditionsApplied,
  };
}

// ─── Condition Evaluation ──────────────────────────────────

function evaluateCondition(
  condition: { conditionType: string; conditionValue: string },
  context: InstantiationContext
): boolean {
  switch (condition.conditionType) {
    case 'state':
      return context.state?.toLowerCase() === condition.conditionValue.toLowerCase();
    case 'provider_type':
      return context.providerType?.toLowerCase() === condition.conditionValue.toLowerCase();
    case 'has_dea':
      return context.hasDea === (condition.conditionValue.toLowerCase() === 'true');
    case 'has_hospital_privileges':
      return context.hasHospitalPrivileges === (condition.conditionValue.toLowerCase() === 'true');
    default:
      logger.warn(`Unknown condition type: ${condition.conditionType}`);
      return false;
  }
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/backend/src/services/workflow-instantiation.service.ts
git commit -m "feat: add workflow instantiation service (DB-driven templates)"
```

---

## Task 2: Wire into enrollment-creation-hook.ts

Modify the existing hook to try the DB-driven template system first (if `payerTrackId` is set), then fall back to JSON-based hydration.

**Files:**
- Modify: `packages/backend/src/services/enrollment-creation-hook.ts`

**Step 1: Update the hook**

The current flow is:
1. Look up payer's workflowKey
2. Resolve workflow type
3. Hydrate from JSON

New flow:
1. If enrollment has `payerTrackId` → try `instantiateWorkflow()` from DB templates
2. If that found a template → done
3. Otherwise → fall back to existing JSON-based flow

Modify `packages/backend/src/services/enrollment-creation-hook.ts`:

```typescript
/**
 * Enrollment Creation Hook
 *
 * Integrates workflow hydration into the existing enrollment creation flow.
 * Tries DB-driven WorkflowTemplate first (if payerTrackId is set),
 * then falls back to JSON-based hydration.
 */

import { PrismaClient, Enrollment, WorkflowType, ProviderType } from '@prisma/client';
import { hydrateWorkflowSteps } from './workflow-hydration.service.js';
import { instantiateWorkflow } from './workflow-instantiation.service.js';
import { resolveWorkflowType } from '../config/workflow-mapping.js';
import { logger } from '../utils/logger.js';

interface EnrollmentWithRelations extends Enrollment {
  payer?: { workflowKey: string | null; name: string };
  provider?: { providerType: ProviderType };
}

interface WorkflowResult {
  stepsCreated: number;
  templateFound: boolean;
  workflowType: WorkflowType | null;
}

/**
 * Call this after creating a new Enrollment.
 * It will:
 * 1. If payerTrackId is set → try DB-driven WorkflowTemplate instantiation
 * 2. If no DB template found → fall back to JSON-based hydration
 * 3. Update the enrollment with the workflow type
 */
export async function onEnrollmentCreated(
  prisma: PrismaClient,
  enrollment: EnrollmentWithRelations,
  explicitWorkflowType?: WorkflowType | null
): Promise<WorkflowResult> {
  // ─── Path A: DB-driven templates (new system) ───────────
  if (enrollment.payerTrackId) {
    try {
      // Gather context for condition evaluation
      let providerType = enrollment.provider?.providerType;
      if (!providerType) {
        const provider = await prisma.providerProfile.findUnique({
          where: { id: enrollment.providerId },
          select: { providerType: true },
        });
        providerType = provider?.providerType ?? undefined;
      }

      // Get the PayerTrack's stateRegion for condition evaluation
      const payerTrack = await prisma.payerTrack.findUnique({
        where: { id: enrollment.payerTrackId },
        select: { stateRegion: true },
      });

      const result = await instantiateWorkflow(
        prisma,
        enrollment.id,
        enrollment.payerTrackId,
        {
          state: payerTrack?.stateRegion ?? undefined,
          providerType: providerType ?? undefined,
        }
      );

      if (result.templateFound) {
        logger.info(
          `Enrollment ${enrollment.id}: instantiated from DB template "${result.templateName}"`
        );
        return {
          stepsCreated: result.stepsCreated,
          templateFound: true,
          workflowType: null, // DB templates don't use the old workflow type enum
        };
      }
    } catch (error) {
      logger.error(`DB workflow instantiation failed for enrollment ${enrollment.id}, falling back to JSON`, error);
    }

    // If no DB template found for this PayerTrack, fall through to JSON path
  }

  // ─── Path B: JSON-based hydration (legacy system) ───────
  let payerWorkflowKey = enrollment.payer?.workflowKey;
  let providerType = enrollment.provider?.providerType;

  if (payerWorkflowKey === undefined || providerType === undefined) {
    const fullEnrollment = await prisma.enrollment.findUnique({
      where: { id: enrollment.id },
      include: {
        payer: { select: { workflowKey: true, name: true } },
        provider: { select: { providerType: true } },
      },
    });

    if (!fullEnrollment) {
      return { stepsCreated: 0, templateFound: false, workflowType: null };
    }

    payerWorkflowKey = fullEnrollment.payer.workflowKey;
    providerType = fullEnrollment.provider.providerType;
  }

  if (!payerWorkflowKey) {
    return { stepsCreated: 0, templateFound: false, workflowType: null };
  }

  const workflowType = resolveWorkflowType(
    providerType!,
    payerWorkflowKey,
    explicitWorkflowType
  );

  const result = await hydrateWorkflowSteps(
    prisma,
    enrollment.id,
    payerWorkflowKey,
    workflowType
  );

  if (result.templateFound) {
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { workflowType },
    });
  }

  return {
    ...result,
    workflowType: result.templateFound ? workflowType : null,
  };
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/backend/src/services/enrollment-creation-hook.ts
git commit -m "feat: wire DB-driven workflow instantiation into enrollment creation hook"
```

---

## Task 3: Write tests for workflow-instantiation.service.ts

**Files:**
- Create: `packages/backend/src/services/workflow-instantiation.service.test.ts`

**Step 1: Write comprehensive tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { instantiateWorkflow } from './workflow-instantiation.service.js';

function makeTemplate(overrides: any = {}) {
  return {
    id: 'tmpl-1',
    payerTrackId: 'pt-1',
    name: 'Aetna BH Standard',
    version: 1,
    status: 'active',
    description: null,
    createdBy: 'admin-1',
    publishedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    steps: [
      {
        id: 'step-1', templateId: 'tmpl-1', stepOrder: 1,
        name: 'Readiness Check', description: 'Verify docs',
        stepType: 'readiness_check', owner: 'credentialing_staff',
        requiredDocuments: ['NPI', 'License'], triggerDaysAfterPrev: null,
        isBlocking: true, reviewerInstructions: null, createdAt: new Date(),
      },
      {
        id: 'step-2', templateId: 'tmpl-1', stepOrder: 2,
        name: 'Submit Application', description: 'Submit to payer',
        stepType: 'submit_application', owner: 'credentialing_staff',
        requiredDocuments: [], triggerDaysAfterPrev: 3,
        isBlocking: true, reviewerInstructions: null, createdAt: new Date(),
      },
      {
        id: 'step-3', templateId: 'tmpl-1', stepOrder: 3,
        name: 'Await Decision', description: 'Wait for payer',
        stepType: 'await_decision', owner: 'payer',
        requiredDocuments: [], triggerDaysAfterPrev: 14,
        isBlocking: true, reviewerInstructions: null, createdAt: new Date(),
      },
    ],
    conditions: [],
    ...overrides,
  };
}

describe('workflow-instantiation.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('instantiateWorkflow', () => {
    it('returns templateFound=false when no active template exists', async () => {
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(null);

      const result = await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1');

      expect(result.templateFound).toBe(false);
      expect(result.stepsCreated).toBe(0);
      expect(result.templateId).toBeNull();
    });

    it('creates EnrollmentWorkflowStep records from template steps', async () => {
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(makeTemplate());
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      const result = await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1');

      expect(result.templateFound).toBe(true);
      expect(result.stepsCreated).toBe(3);
      expect(result.templateId).toBe('tmpl-1');
      expect(result.templateName).toBe('Aetna BH Standard');

      // Verify createMany was called with correct mapped data
      const call = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0][0];
      expect(call.data).toHaveLength(3);
      expect(call.data[0].name).toBe('Readiness Check');
      expect(call.data[0].actionType).toBe('verification'); // readiness_check → verification
      expect(call.data[0].stepOrder).toBe(1);
      expect(call.data[0].status).toBe('not_started');
      expect(call.data[0].documentsNeeded).toEqual(['NPI', 'License']);
    });

    it('updates enrollment with workflowTemplateId', async () => {
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(makeTemplate());
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1');

      expect(prismaMock.enrollment.update).toHaveBeenCalledWith({
        where: { id: 'enr-1' },
        data: { workflowTemplateId: 'tmpl-1' },
      });
    });

    it('maps step types to action types correctly', async () => {
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(makeTemplate());
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1');

      const data = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0][0].data;
      expect(data[0].actionType).toBe('verification');      // readiness_check
      expect(data[1].actionType).toBe('form_submission');    // submit_application
      expect(data[2].actionType).toBe('payer_review');       // await_decision
    });

    it('evaluates state condition — add_step', async () => {
      const template = makeTemplate({
        conditions: [{
          id: 'cond-1', templateId: 'tmpl-1', conditionType: 'state',
          conditionValue: 'TX', action: 'add_step', targetStepOrder: 2,
          stepDefinition: { name: 'TX Open Enrollment Check', stepType: 'human_review', owner: 'credentialing_staff' },
          createdAt: new Date(),
        }],
      });
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(template);
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 4 });
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      const result = await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1', { state: 'TX' });

      expect(result.conditionsApplied).toBe(1);
      expect(result.stepsCreated).toBe(4); // 3 base + 1 added
    });

    it('evaluates state condition — skip_step', async () => {
      const template = makeTemplate({
        conditions: [{
          id: 'cond-1', templateId: 'tmpl-1', conditionType: 'state',
          conditionValue: 'CA', action: 'skip_step', targetStepOrder: 2,
          stepDefinition: null, createdAt: new Date(),
        }],
      });
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(template);
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 2 });
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      const result = await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1', { state: 'CA' });

      expect(result.conditionsApplied).toBe(1);
      const data = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0][0].data;
      expect(data).toHaveLength(2); // step 2 skipped
    });

    it('does not apply condition when context does not match', async () => {
      const template = makeTemplate({
        conditions: [{
          id: 'cond-1', templateId: 'tmpl-1', conditionType: 'state',
          conditionValue: 'TX', action: 'skip_step', targetStepOrder: 2,
          stepDefinition: null, createdAt: new Date(),
        }],
      });
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(template);
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      const result = await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1', { state: 'CA' });

      expect(result.conditionsApplied).toBe(0);
      const data = prismaMock.enrollmentWorkflowStep.createMany.mock.calls[0][0].data;
      expect(data).toHaveLength(3); // no steps skipped
    });

    it('selects highest version active template', async () => {
      prismaMock.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ version: 3 }));
      prismaMock.enrollmentWorkflowStep.createMany.mockResolvedValue({ count: 3 });
      prismaMock.enrollment.update.mockResolvedValue({} as any);

      await instantiateWorkflow(prismaMock as any, 'enr-1', 'pt-1');

      expect(prismaMock.workflowTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { payerTrackId: 'pt-1', status: 'active' },
          orderBy: { version: 'desc' },
        })
      );
    });
  });
});
```

**Step 2: Run tests**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/services/workflow-instantiation.service.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/backend/src/services/workflow-instantiation.service.test.ts
git commit -m "test: add workflow instantiation service tests"
```

---

## Task 4: Update enrollment routes to pass payerTrackId

The enrollment creation route needs to accept and pass `payerTrackId` so the hook can use it.

**Files:**
- Modify: `packages/backend/src/routes/enrollment.routes.ts`

**Step 1: Update the POST handler**

In the enrollment POST route, the create body should accept `payerTrackId` as an optional field. Check if it's already accepted in the Zod schema or Prisma create call. If not, add it.

Search for the enrollment creation Zod schema and the `prisma.enrollment.create` call. Add `payerTrackId` to both:

- Zod schema: `payerTrackId: z.string().optional()`
- Prisma create data: `payerTrackId: body.payerTrackId || null`

The hook already receives the full enrollment object which will have `payerTrackId` if set.

**Step 2: Verify**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/backend/src/routes/enrollment.routes.ts
git commit -m "feat: accept payerTrackId on enrollment creation for workflow template matching"
```

---

## Task 5: Final verification + push

**Step 1: Run all new tests**

```bash
cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/services/workflow-instantiation.service.test.ts
```

**Step 2: Full TypeScript check**

```bash
cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit
```

**Step 3: Commit and push**

```bash
cd /Users/kay/Documents/KAY
git push origin feat/schema-redesign-v2
```

**Step 4: Update project memory**

Update Step 9 status to Done, Step 10 to Next.

---

## Key Design Decisions

### DB templates vs JSON templates
- **DB templates** (new): WorkflowTemplate records created via the admin UI, linked to PayerTrack. Support conditions for dynamic step modification.
- **JSON templates** (legacy): `payer-workflows.json` loaded from disk. Used when no PayerTrack link exists.
- **Priority**: DB templates take precedence. If a PayerTrack has an active WorkflowTemplate, it's used. Otherwise, fall back to JSON.

### Condition evaluation
- Conditions are evaluated at instantiation time, not runtime
- `add_step`: adds a step from `stepDefinition` at `targetStepOrder`
- `skip_step`: removes the step at `targetStepOrder`
- `modify_step`: merges `stepDefinition` fields into the step at `targetStepOrder`
- Context comes from: PayerTrack.stateRegion (state), ProviderProfile.providerType, provider's DEA/privileges

### Step type mapping
WorkflowTemplateStep uses descriptive `stepType` values. These map to the existing `WorkflowActionType` enum on EnrollmentWorkflowStep for backward compatibility with the frontend.

### Due dates
Calculated from `triggerDaysAfterPrev` as cumulative days from enrollment creation. Step 1 has no trigger (starts now), step 2 triggers N days after step 1, etc.
