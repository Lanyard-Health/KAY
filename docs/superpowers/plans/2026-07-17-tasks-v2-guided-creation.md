# Tasks v2 — Guided Creation, Needs Review, Practice Check-ins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Tasks v2 on top of the live v1 Tasks page: (1) a dropdown-driven New Task modal (no typed titles) with a payer contact card and click-to-call, (2) an admin-only "Needs review" tab for missed deadlines with required reasons and a patterns strip, (3) a daily engine that auto-creates weekly check-in tasks when a practice goes 7 days untouched — per the approved architecture plan (`~/.claude/plans/radiant-skipping-pine.md`) and the Kay-approved UX contracts (`_bmad-output/planning-artifacts/ux-designs/ux-KAY-2026-07-17/{EXPERIENCE.md, DESIGN.md}`, D1–D25, status **final**).

**Architecture:** Extend the existing `Task` model and `task.routes.ts`/`staff-task.service.ts` (no second task system). One migration (PR-A) adds a `TaskGroup` enum, `payerId` FK, overdue-reason columns, and a new 1:1 `PayerContactInfo` model. Titles are composed **server-side** by a `composeTaskTitle()` helper in a new shared-package constants file; the frontend live preview uses the same function, so preview === persisted title. A new `practice-checkin.service.ts` runs daily under the proven scheduler advisory-lock pattern. Two PRs: PR-A "Guided creation + contact card" (Tasks 1–9), PR-B "Needs review + reasons + check-ins" (Tasks 10–14, code-only — schema fully lands in PR-A).

**Tech Stack:** Express 4 + Prisma 5 + Zod + node-cron (backend), React 18 + React Query 5 + Headless UI (Combobox/RadioGroup/Dialog/Tab) + react-hot-toast (frontend), shared TS package `@credential-management/shared`, Vitest + supertest + Testing Library + Playwright.

## Global Constraints

- **Task groups (D2, verbatim):** enum `TaskGroup` has 9 values. The 8 human-pickable groups and their labels are exactly: `FOLLOW_UP` "Follow Up" · `CALL_BACK` "Call Back" · `SUBMIT_APPLICATION` "Submit Application" · `REQUEST_DOCUMENTS` "Request Documents" · `CAQH_UPDATE` "CAQH Update / Re-attestation" · `VERIFY_INFORMATION` "Verify Information" · `ESCALATION` "Escalation" · `OTHER` "Other". The **spaced** "CAQH Update / Re-attestation" is canonical (EXPERIENCE.md accepted trade-offs). The 9th value `CHECK_IN` is **system-only**: the create API rejects it with 400; only the check-in engine writes it; its row pill reads "Auto · Check-in".
- **Title formula (D1, D3):** `[TASK_GROUP_LABELS[group], payerName, practiceName].filter(Boolean).join(' — ')` — em dash with surrounding spaces, parts in that order, missing parts simply omitted. Provider is **never** part of the title. No free-text title exists anywhere. A stray `title` key in the POST /tasks payload is **ignored, not rejected** (deploy-skew tolerance — Zod objects strip unknown keys; do NOT use `.strict()`). Preview === persisted title because both sides call the same shared `composeTaskTitle`.
- **Roles (unchanged from v1, D8, D14):** every new endpoint uses `authorize(...ADMIN_ROLES, 'lanyard_staff')` — NEVER `'credentialing_staff'` (practice-side role; `authorize()` auto-admits `lanyard_staff` where `credentialing_staff` is listed, not vice versa). The assignee restriction is unchanged: tasks may only be assigned to users with role `admin` or `lanyard_staff`, enforced server-side. Practice roles never see anything — no tab, no badge, no endpoint; **fail-closed**. `view=needs_review` and `GET /tasks/review-stats` carry an **explicit admin 403 gate in the route** (the recurring role-gate bug class — write the `lanyard_staff → 403` test for both).
- **Reason dialog strings (EXPERIENCE.md, final — ship verbatim):** heading "Before you dive in — 2 tasks missed their deadlines" (count-aware; singular "Before you dive in — 1 task missed its deadline"); subhead "A quick reason for each helps Kay review them. You can defer, but it'll ask again next time."; per-task prompt "What got in the way? One line is plenty."; quick-reason chips "Payer hasn't responded" · "Portal was down" · "Ran out of time" · "Waiting on documents"; submit "Save reasons"; deferral button "I'll answer later"; save failure "Couldn't save this reason — check your connection and try again. Your text is kept."; after deferral "Okay — we'll ask again next time you're here."; success closure announcement "Reasons saved — thanks".
- **Other final strings (verbatim):** empty contact card invitation "Be the first to add it — every teammate after you gets this automatically."; contact-card phone hint "· click to call"; check-in row meta "No contact in N days · added by Lanyard"; check-in title exactly `Weekly check-in — {practice name}`; tel-link accessible name pattern "Call {payer} credentialing, {number}"; Needs review empty state "Nothing needs review — every task met its deadline."; awaiting-reason pending chip "Awaiting reason…" (italic, **full opacity** — opacity-dimming is banned); reasons wrap, never truncate.
- **Check-in engine constants (D13, D17, D19, D20):** advisory lock key `73411003`; cron `'0 6 * * *'` via env `CHECK_IN_SCHEDULE`; quiet threshold **7 days**; due date **creation + 3 days**; eligibility `status: 'ACTIVE' AND isDemo: false AND deletedAt: null`; last touch = `max(completedAt of practice-linked COMPLETED tasks) ?? onboardedAt ?? createdAt`, derived fresh per run; dedup = skip when an open CHECK_IN task exists for the practice (at most one open check-in per practice); created task is unassigned (Task Pool), `createdById: null` (v1 system convention), `type: 'CUSTOM'`, no notification (pool tasks don't notify). D19: ANY completed practice-linked task resets the clock — the check-in task itself included.
- **Close = SKIPPED:** the Needs review "Close" action is the existing `status: 'SKIPPED'` (UI label says "Close"; the completed-filter already treats SKIPPED as closed; the reason is kept for audit).
- **Reason reset rule:** setting a `dueDate` in the future clears BOTH `overdueReason` and `overdueReasonAt` — that is how "New deadline" resolves a Needs-review row and re-arms the arrival dialog.
- **Migration:** generated locally with `npx prisma migrate dev` (local Docker DB); on staging/prod it MUST run with `DATABASE_URL_ADMIN` (least-privilege runtime role gets 42501 on pre-2026-06 tables — `tasks` and `payers` are both).
- **Shared package rebuild:** ANY change under `packages/shared/src` requires `npm run build --workspace=packages/shared` before backend/frontend typechecks or tests can see it (shared resolves from `dist/`).
- **Typecheck/test discipline (CLAUDE.md):** foreground only, Bash `timeout: 600000`, one package per invocation, repo-root binaries — `node ../../node_modules/typescript/bin/tsc --noEmit --incremental` and `../../node_modules/.bin/vitest run <file>` (always `vitest run`, never bare `vitest`; never wrap in npx), pipe to a log and echo the exit code, never background/poll.
- **Git:** run git from the repo root only (`/Users/kaysworld/dev/KAY` — `packages/backend` has a nested `.git`; use subshells `(cd packages/backend && …)` for non-git commands). Branches: PR-A on `feat/tasks-v2-guided-creation`, PR-B on `feat/tasks-v2-review-checkins`, both cut from `master`. Never push master; PR → Security Gate → Kay merges.
- **OpenAPI:** after backend route changes run `npm run openapi:generate --workspace=packages/backend` and commit `packages/backend/openapi.json` only if it changed. The generator is Phase 0.A-scoped (task/enrollment routes are intentionally absent — do NOT add them to the generator); regeneration should be a byte-identical no-op, and running it proves the CI drift gate stays green.
- **API envelope:** `{ success: true, data }` (+ `meta` for lists); frontend hooks return `response.data`, components read `data?.data`.
- **Prisma mock convention:** tests mock `../utils/prisma.js` via `tests/helpers/mock-prisma.js`; the new `payerContactInfo` model MUST be added to the `MODELS` list in `packages/backend/tests/helpers/mock-prisma.ts` (Task 1) or unstubbed calls return `undefined`.
- **CI note:** vitest is not merge-gating (`|| true`) — a red test still means fix it; before debugging, verify the failure isn't pre-existing on the base branch.

---

## PR-A — "Guided creation + contact card" (Tasks 1–9, branch `feat/tasks-v2-guided-creation`)

### Task 1: Schema — TaskGroup enum, Task columns, PayerContactInfo + migration

**Files:**
- Modify: `packages/backend/prisma/schema.prisma` (enums block ~L2376-2396, Task model ~L2404, Payer model ~L1858, User model ~L84)
- Create: `packages/backend/prisma/migrations/<timestamp>_tasks_v2_guided_creation/migration.sql` (generated)
- Modify: `packages/backend/tests/helpers/mock-prisma.ts` (MODELS list, ~L13)

**Interfaces:**
- Produces (later tasks rely on these exact names): `Task.taskGroup: TaskGroup?`, `Task.payerId: String?` (+ relation `Task.payer`), `Task.overdueReason: String?`, `Task.overdueReasonAt: DateTime?`; model `PayerContactInfo { id, payerId (unique), phone?, email?, bestWay?, hours?, notes?, updatedById?, createdAt, updatedAt }` with relations `payer` and `updatedBy`; `Payer.tasks: Task[]`, `Payer.contactInfo: PayerContactInfo?`.

- [ ] **Step 1: Create the branch (repo root)**

```bash
cd /Users/kaysworld/dev/KAY
git checkout master && git pull
git checkout -b feat/tasks-v2-guided-creation
```

- [ ] **Step 2: Edit schema.prisma**

Add the enum next to `TaskPriority` (~L2391):

```prisma
// Guided-creation task groups (Tasks v2). CHECK_IN is system-only: written by
// the practice check-in engine, rejected by the create API.
enum TaskGroup {
  FOLLOW_UP
  CALL_BACK
  SUBMIT_APPLICATION
  REQUEST_DOCUMENTS
  CAQH_UPDATE
  VERIFY_INFORMATION
  ESCALATION
  OTHER
  CHECK_IN
}
```

Replace the `Task` model (~L2404) with (four new fields, one new relation, two new indexes — everything else byte-identical to today):

```prisma
model Task {
  id              String       @id @default(uuid())
  providerId      String?      @map("provider_id")
  practiceId      String?      @map("practice_id")
  enrollmentId    String?      @map("enrollment_id")
  payerId         String?      @map("payer_id")
  title           String
  description     String?
  type            TaskType
  taskGroup       TaskGroup?   @map("task_group")
  status          TaskStatus   @default(PENDING)
  priority        TaskPriority @default(NORMAL)
  assignedToId    String?      @map("assigned_to_id")
  createdById     String?      @map("created_by_id")
  dueDate         DateTime?    @map("due_date")
  overdueReason   String?      @map("overdue_reason")
  overdueReasonAt DateTime?    @map("overdue_reason_at")
  completedAt     DateTime?    @map("completed_at")
  completedById   String?      @map("completed_by_id")
  createdAt       DateTime     @default(now()) @map("created_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")

  provider           ProviderProfile?    @relation(fields: [providerId], references: [id], onDelete: Cascade)
  practice           Practice?           @relation(fields: [practiceId], references: [id], onDelete: Cascade)
  enrollment         Enrollment?         @relation(fields: [enrollmentId], references: [id], onDelete: SetNull)
  payer              Payer?              @relation(fields: [payerId], references: [id], onDelete: SetNull)
  assignedTo         User?               @relation("TaskAssignedTo", fields: [assignedToId], references: [id])
  createdBy          User?               @relation("TaskCreatedBy", fields: [createdById], references: [id])
  completedBy        User?               @relation("TaskCompletedBy", fields: [completedById], references: [id])
  terminationLetters TerminationLetter[]

  @@index([providerId])
  @@index([enrollmentId])
  @@index([status])
  @@index([type])
  @@index([assignedToId])
  @@index([practiceId])
  @@index([priority])
  @@index([payerId])
  @@index([taskGroup])
  @@map("tasks")
}
```

Add the new model directly after `PracticePayer` (~L1932):

```prisma
// Staff-maintained contact info for a payer (Tasks v2 contact card).
// 1:1 with Payer; rows exist only where data exists (seeded once by
// scripts/seed-payer-contact-info.ts, staff-entered from there on).
model PayerContactInfo {
  id          String   @id @default(uuid())
  payerId     String   @unique @map("payer_id")
  phone       String?
  email       String?
  bestWay     String?  @map("best_way")
  hours       String?
  notes       String?
  updatedById String?  @map("updated_by_id")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  payer     Payer @relation(fields: [payerId], references: [id], onDelete: Cascade)
  updatedBy User? @relation("PayerContactInfoUpdatedBy", fields: [updatedById], references: [id])

  @@map("payer_contact_info")
}
```

In the `Payer` model's relation list (~L1886), add two lines:

```prisma
  tasks             Task[]
  contactInfo       PayerContactInfo?
```

In the `User` model's relation list (next to `tasksCreated`, ~L84), add:

```prisma
  payerContactInfoUpdates     PayerContactInfo[]       @relation("PayerContactInfoUpdatedBy")
```

- [ ] **Step 3: Register the new model in the prisma mock**

In `packages/backend/tests/helpers/mock-prisma.ts`, add `'payerContactInfo'` to the `MODELS` array (alphabetical slot, next to `'payerContact'`).

- [ ] **Step 4: Generate the migration (local Docker DB must be up)**

Run: `docker compose up -d && (cd packages/backend && npx prisma migrate dev --name tasks_v2_guided_creation)`
Expected: new folder under `prisma/migrations/`, SQL containing `CREATE TYPE "TaskGroup"`, `ALTER TABLE "tasks" ADD COLUMN "payer_id"`, `ADD COLUMN "task_group"`, `ADD COLUMN "overdue_reason"`, `ADD COLUMN "overdue_reason_at"`, `CREATE TABLE "payer_contact_info"`, the two new task indexes, and FKs to `payers`/`users`. All columns nullable — no backfill, no lock risk. Prisma client regenerates automatically.

- [ ] **Step 5: Backend typecheck (existing code must still compile)**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && node ../../node_modules/typescript/bin/tsc --noEmit --incremental > /tmp/tsc.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 0`

- [ ] **Step 6: Commit (repo root)**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/backend/prisma packages/backend/tests/helpers/mock-prisma.ts
git commit -m "feat(tasks): schema for tasks v2 (task groups, payer link, overdue reasons, payer contact info)"
```

---

### Task 2: Shared task-group constants + composeTaskTitle

**Files:**
- Create: `packages/shared/src/constants/taskGroups.ts`
- Modify: `packages/shared/src/constants/index.ts` (add one export line)
- Test: `packages/backend/src/services/task-groups.shared.test.ts` (shared has no vitest setup — test through the consuming backend package, which imports the compiled dist)

**Interfaces:**
- Produces (Tasks 3, 6, 8, 9, 12 consume these exact names from `@credential-management/shared`):

```ts
export type TaskGroup = 'FOLLOW_UP' | 'CALL_BACK' | 'SUBMIT_APPLICATION' | 'REQUEST_DOCUMENTS' | 'CAQH_UPDATE' | 'VERIFY_INFORMATION' | 'ESCALATION' | 'OTHER' | 'CHECK_IN';
export const TASK_GROUP_LABELS: Record<TaskGroup, string>;
export const HUMAN_TASK_GROUPS: readonly ['FOLLOW_UP','CALL_BACK','SUBMIT_APPLICATION','REQUEST_DOCUMENTS','CAQH_UPDATE','VERIFY_INFORMATION','ESCALATION','OTHER'];
export type HumanTaskGroup = (typeof HUMAN_TASK_GROUPS)[number];
export function composeTaskTitle(group: TaskGroup, payerName?: string, practiceName?: string): string;
```

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/services/task-groups.shared.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  composeTaskTitle, TASK_GROUP_LABELS, HUMAN_TASK_GROUPS,
} from '@credential-management/shared';

describe('TASK_GROUP_LABELS', () => {
  it('carries the eight human labels verbatim, including the spaced CAQH form', () => {
    expect(TASK_GROUP_LABELS.FOLLOW_UP).toBe('Follow Up');
    expect(TASK_GROUP_LABELS.CALL_BACK).toBe('Call Back');
    expect(TASK_GROUP_LABELS.SUBMIT_APPLICATION).toBe('Submit Application');
    expect(TASK_GROUP_LABELS.REQUEST_DOCUMENTS).toBe('Request Documents');
    expect(TASK_GROUP_LABELS.CAQH_UPDATE).toBe('CAQH Update / Re-attestation'); // spaced form is canonical
    expect(TASK_GROUP_LABELS.VERIFY_INFORMATION).toBe('Verify Information');
    expect(TASK_GROUP_LABELS.ESCALATION).toBe('Escalation');
    expect(TASK_GROUP_LABELS.OTHER).toBe('Other');
    expect(TASK_GROUP_LABELS.CHECK_IN).toBe('Check-in');
  });
  it('excludes CHECK_IN from the human-pickable groups', () => {
    expect(HUMAN_TASK_GROUPS).toHaveLength(8);
    expect(HUMAN_TASK_GROUPS).not.toContain('CHECK_IN');
  });
});

describe('composeTaskTitle', () => {
  it('group alone', () => {
    expect(composeTaskTitle('FOLLOW_UP')).toBe('Follow Up');
  });
  it('group + payer (em dash with spaces)', () => {
    expect(composeTaskTitle('FOLLOW_UP', 'Molina Healthcare of Texas'))
      .toBe('Follow Up — Molina Healthcare of Texas');
  });
  it('group + payer + practice, in that order', () => {
    expect(composeTaskTitle('CALL_BACK', 'Aetna Better Health', 'Sunrise Behavioral Health'))
      .toBe('Call Back — Aetna Better Health — Sunrise Behavioral Health');
  });
  it('group + practice (payer omitted, no dangling separator)', () => {
    expect(composeTaskTitle('OTHER', undefined, 'Sunrise Behavioral Health'))
      .toBe('Other — Sunrise Behavioral Health');
  });
  it('empty-string parts are omitted like undefined', () => {
    expect(composeTaskTitle('ESCALATION', '', '')).toBe('Escalation');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/services/task-groups.shared.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1` — `composeTaskTitle` is not exported from the shared package.

- [ ] **Step 3: Implement the shared constants**

Create `packages/shared/src/constants/taskGroups.ts`:

```ts
/**
 * Tasks v2 guided-creation task groups (UX contract D2).
 * The same label map drives the backend title composition AND the frontend
 * live preview, so the preview always equals the persisted title (D1, D3).
 */
export const TASK_GROUP_LABELS = {
  FOLLOW_UP: 'Follow Up',
  CALL_BACK: 'Call Back',
  SUBMIT_APPLICATION: 'Submit Application',
  REQUEST_DOCUMENTS: 'Request Documents',
  CAQH_UPDATE: 'CAQH Update / Re-attestation', // spaced form is canonical (EXPERIENCE.md accepted trade-offs)
  VERIFY_INFORMATION: 'Verify Information',
  ESCALATION: 'Escalation',
  OTHER: 'Other',
  CHECK_IN: 'Check-in', // system-only: rows render the "Auto · Check-in" pill
} as const;

export type TaskGroup = keyof typeof TASK_GROUP_LABELS;

/** The 8 groups a human may pick in the New Task modal — CHECK_IN is system-only (rejected by the create API). */
export const HUMAN_TASK_GROUPS = [
  'FOLLOW_UP',
  'CALL_BACK',
  'SUBMIT_APPLICATION',
  'REQUEST_DOCUMENTS',
  'CAQH_UPDATE',
  'VERIFY_INFORMATION',
  'ESCALATION',
  'OTHER',
] as const satisfies readonly TaskGroup[];

export type HumanTaskGroup = (typeof HUMAN_TASK_GROUPS)[number];

/**
 * Compose a task title from its picked parts (D1, D3):
 * `[Task Group] — [Payer] — [Practice]`, whichever parts are chosen, in that
 * order, em-dash separated. Provider is never part of the title.
 */
export function composeTaskTitle(group: TaskGroup, payerName?: string, practiceName?: string): string {
  return [TASK_GROUP_LABELS[group], payerName, practiceName].filter(Boolean).join(' — ');
}
```

Add to `packages/shared/src/constants/index.ts` (bottom, next to the rosterFields re-export):

```ts
// Tasks v2 guided-creation groups + title composition
export * from './taskGroups.js';
```

- [ ] **Step 4: Rebuild shared (required before any consumer sees the export)**

Run: `cd /Users/kaysworld/dev/KAY && npm run build --workspace=packages/shared > /tmp/shared-build.log 2>&1; echo "exit: $?"`
Expected: `exit: 0`

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/services/task-groups.shared.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"; tail -15 /tmp/vitest.log` (timeout 600000)
Expected: `exit: 0`, 7 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/shared/src/constants packages/backend/src/services/task-groups.shared.test.ts
git commit -m "feat(tasks): shared task-group labels + composeTaskTitle (preview === persisted title)"
```

---

### Task 3: Backend — guided create rewrite + taskGroup list filter

**Files:**
- Modify: `packages/backend/src/services/staff-task.service.ts`
- Modify: `packages/backend/src/routes/task.routes.ts` (staff routes block, L156-248)
- Test: `packages/backend/src/services/staff-task.service.test.ts` (extend), `packages/backend/src/routes/staff-task.routes.test.ts` (extend)

**Interfaces:**
- Consumes: `composeTaskTitle`, `HUMAN_TASK_GROUPS`, `TASK_GROUP_LABELS`, types `TaskGroup`/`HumanTaskGroup` from `@credential-management/shared` (Task 2); Task 1 schema fields.
- Produces (Tasks 6/8/10 rely on these):

```ts
export interface CreateStaffTaskInput {
  taskGroup: HumanTaskGroup;      // 8 human groups only — CHECK_IN rejected at the route
  note?: string;                  // maps to Task.description
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  dueDate?: Date; assignedToId?: string;
  payerId?: string; providerId?: string; practiceId?: string; enrollmentId?: string;
}
export interface ListStaffTasksOptions {
  view: 'my' | 'pool' | 'all'; userId: string;
  status?: 'open' | 'completed' | 'all'; priority?: string; practiceId?: string;
  taskGroup?: string;             // NEW: filter by group (all 9 values legal, incl. CHECK_IN)
  limit: number; offset: number;
}
// createStaffTask(input, creatorId) — title composed server-side; throws
// 'ENROLLMENT_LINK_EXCLUSIVE' | 'PROVIDER_PRACTICE_MISMATCH' | 'PAYER_NOT_FOUND'
// | 'PRACTICE_NOT_FOUND' | 'PROVIDER_NOT_FOUND' | 'ASSIGNEE_NOT_ALLOWED'
```

- API: `POST /tasks` body `{ taskGroup, note?, priority?, dueDate?, assignedToId?, payerId?, providerId?, practiceId?, enrollmentId? }` → 201 `{ success, data: task }`; `taskGroup: 'CHECK_IN'` → 400. `GET /tasks` gains `&taskGroup=` filter. Task rows now include `payer: { id, name, phone, contactInfo: { phone } | null } | null`.

- [ ] **Step 1: Write the failing service tests**

Append to `packages/backend/src/services/staff-task.service.test.ts` (keep the existing file's vi.mock header — it already mocks prisma + logger). Update the two v1 `createStaffTask` tests in place — they change semantics in v2:

Replace the v1 test `rejects more than one linked record` and `sets IN_PROGRESS when created with an assignee` with:

```ts
describe('createStaffTask (v2 guided)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects enrollment combined with a provider/practice link', async () => {
    await expect(createStaffTask(
      { taskGroup: 'FOLLOW_UP', priority: 'NORMAL', enrollmentId: TASK_ID, practiceId: TASK_ID },
      USER_ID,
    )).rejects.toThrow('ENROLLMENT_LINK_EXCLUSIVE');
  });

  it('rejects a provider that is not at the selected practice', async () => {
    prismaMock.practice.findUnique.mockResolvedValue({ name: 'Sunrise Behavioral Health' } as any);
    prismaMock.providerProfile.findUnique.mockResolvedValue({ practiceId: 'a-different-practice' } as any);
    await expect(createStaffTask(
      { taskGroup: 'CALL_BACK', priority: 'NORMAL', practiceId: 'practice-1', providerId: 'provider-1' },
      USER_ID,
    )).rejects.toThrow('PROVIDER_PRACTICE_MISMATCH');
  });

  it('allows payer + practice + provider to coexist when the provider belongs to the practice', async () => {
    prismaMock.payer.findUnique.mockResolvedValue({ name: 'Aetna Better Health' } as any);
    prismaMock.practice.findUnique.mockResolvedValue({ name: 'Sunrise Behavioral Health' } as any);
    prismaMock.providerProfile.findUnique.mockResolvedValue({ practiceId: 'practice-1' } as any);
    prismaMock.task.create.mockResolvedValue({ id: TASK_ID } as any);
    await createStaffTask(
      { taskGroup: 'CALL_BACK', priority: 'NORMAL', payerId: 'payer-1', practiceId: 'practice-1', providerId: 'provider-1' },
      USER_ID,
    );
    expect(prismaMock.task.create.mock.calls[0][0].data.title)
      .toBe('Call Back — Aetna Better Health — Sunrise Behavioral Health');
  });

  it('composes group-only and group+payer titles (provider never in the title)', async () => {
    prismaMock.task.create.mockResolvedValue({ id: TASK_ID } as any);
    await createStaffTask({ taskGroup: 'ESCALATION', priority: 'NORMAL' }, USER_ID);
    expect(prismaMock.task.create.mock.calls[0][0].data.title).toBe('Escalation');

    prismaMock.payer.findUnique.mockResolvedValue({ name: 'Molina Healthcare of Texas' } as any);
    await createStaffTask({ taskGroup: 'FOLLOW_UP', priority: 'NORMAL', payerId: 'payer-1' }, USER_ID);
    expect(prismaMock.task.create.mock.calls[1][0].data.title).toBe('Follow Up — Molina Healthcare of Texas');
  });

  it('maps note to description, keeps auto-IN_PROGRESS on assignment, and notifies the assignee', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'assignee-1', role: 'lanyard_staff', isActive: true } as any);
    prismaMock.task.create.mockResolvedValue({ id: TASK_ID } as any);
    prismaMock.inAppNotification.create.mockResolvedValue({} as any);
    await createStaffTask(
      { taskGroup: 'REQUEST_DOCUMENTS', priority: 'NORMAL', note: 'Chase the W-9', assignedToId: 'assignee-1' },
      USER_ID,
    );
    const data = prismaMock.task.create.mock.calls[0][0].data;
    expect(data.description).toBe('Chase the W-9');
    expect(data.status).toBe('IN_PROGRESS');
    expect(data.taskGroup).toBe('REQUEST_DOCUMENTS');
    expect(prismaMock.inAppNotification.create).toHaveBeenCalled();
  });

  it('400-class error when the payer id does not exist', async () => {
    prismaMock.payer.findUnique.mockResolvedValue(null);
    await expect(createStaffTask({ taskGroup: 'FOLLOW_UP', priority: 'NORMAL', payerId: 'nope' }, USER_ID))
      .rejects.toThrow('PAYER_NOT_FOUND');
  });
});

describe('listStaffTasks taskGroup filter', () => {
  it('passes taskGroup into the where clause', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as any);
    prismaMock.task.count.mockResolvedValue(0);
    await listStaffTasks({ view: 'all', userId: USER_ID, taskGroup: 'CHECK_IN', limit: 50, offset: 0 });
    expect(prismaMock.task.findMany.mock.calls[0][0].where.taskGroup).toBe('CHECK_IN');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/services/staff-task.service.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1` (createStaffTask still requires `title`; new error codes don't exist).

- [ ] **Step 3: Rewrite the service create path**

In `packages/backend/src/services/staff-task.service.ts`:

1. Add the import: `import { composeTaskTitle, type HumanTaskGroup } from '@credential-management/shared';`
2. Replace `CreateStaffTaskInput` and `ListStaffTasksOptions` with the Interfaces versions above.
3. Extend `TASK_INCLUDE` with the payer (rows need name + phone for the tel: link; contactInfo.phone wins over the raw Stedi phone):

```ts
const TASK_INCLUDE = {
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  completedBy: { select: { id: true, firstName: true, lastName: true } },
  provider: { select: { id: true, firstName: true, lastName: true } },
  practice: { select: { id: true, name: true } },
  enrollment: { select: { id: true, payer: { select: { name: true } } } },
  payer: { select: { id: true, name: true, phone: true, contactInfo: { select: { phone: true } } } },
} as const;
```

4. Delete `assertSingleLink` and replace `createStaffTask` with:

```ts
/**
 * v2 link rules (relaxes v1's assertSingleLink): payer link is independent of
 * everything; provider+practice may coexist iff the provider belongs to that
 * practice; enrollment stays exclusive of provider/practice.
 * Returns the names needed for server-side title composition.
 */
async function resolveLinks(input: Pick<CreateStaffTaskInput, 'payerId' | 'providerId' | 'practiceId' | 'enrollmentId'>) {
  if (input.enrollmentId && (input.providerId || input.practiceId)) throw new Error('ENROLLMENT_LINK_EXCLUSIVE');
  let payerName: string | undefined;
  let practiceName: string | undefined;
  if (input.payerId) {
    const payer = await prisma.payer.findUnique({ where: { id: input.payerId }, select: { name: true } });
    if (!payer) throw new Error('PAYER_NOT_FOUND');
    payerName = payer.name;
  }
  if (input.practiceId) {
    const practice = await prisma.practice.findUnique({ where: { id: input.practiceId }, select: { name: true } });
    if (!practice) throw new Error('PRACTICE_NOT_FOUND');
    practiceName = practice.name;
  }
  if (input.providerId) {
    const provider = await prisma.providerProfile.findUnique({ where: { id: input.providerId }, select: { practiceId: true } });
    if (!provider) throw new Error('PROVIDER_NOT_FOUND');
    if (input.practiceId && provider.practiceId !== input.practiceId) throw new Error('PROVIDER_PRACTICE_MISMATCH');
  }
  return { payerName, practiceName };
}

export async function createStaffTask(input: CreateStaffTaskInput, creatorId: string) {
  const { payerName, practiceName } = await resolveLinks(input);
  if (input.assignedToId) await assertAssignableUser(input.assignedToId);
  const title = composeTaskTitle(input.taskGroup, payerName, practiceName); // server-side — preview === persisted
  const task = await prisma.task.create({
    data: {
      title,
      description: input.note,
      taskGroup: input.taskGroup,
      type: 'CUSTOM', priority: input.priority,
      status: input.assignedToId ? 'IN_PROGRESS' : 'PENDING', // v1 behavior untouched
      dueDate: input.dueDate, assignedToId: input.assignedToId,
      payerId: input.payerId, providerId: input.providerId,
      practiceId: input.practiceId, enrollmentId: input.enrollmentId,
      createdById: creatorId,
    },
    include: TASK_INCLUDE,
  });
  if (input.assignedToId && input.assignedToId !== creatorId) notifyAssignee(input.assignedToId, task.id, title);
  return task;
}
```

5. In `listStaffTasks`, after the `practiceId` filter line, add: `if (opts.taskGroup) where['taskGroup'] = opts.taskGroup;`

`claimTask`, `getMyTaskCounts`, `listAssignees`, `assertAssignableUser`, `notifyAssignee` stay byte-identical (v1 atomic claim untouched).

- [ ] **Step 4: Run service tests to verify they pass**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/services/staff-task.service.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"; tail -15 /tmp/vitest.log` (timeout 600000)
Expected: `exit: 0`.

- [ ] **Step 5: Write the failing route tests**

In `packages/backend/src/routes/staff-task.routes.test.ts`, replace the v1 `POST /tasks` describe with (keep the mock header exactly as is — the `staff-task.service.js` mock factory must also gain the same exports it has today; no new service functions are added in this task):

```ts
describe('POST /tasks (guided create)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a guided task and returns 201', async () => {
    vi.mocked(staffSvc.createStaffTask).mockResolvedValue({ id: 't1', title: 'Follow Up — Aetna Better Health' } as any);
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post('/tasks').send({ taskGroup: 'FOLLOW_UP', payerId: PROVIDER_ID });
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Follow Up — Aetna Better Health');
  });

  it('400s on taskGroup CHECK_IN (system-only)', async () => {
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post('/tasks').send({ taskGroup: 'CHECK_IN' });
    expect(res.status).toBe(400);
    expect(vi.mocked(staffSvc.createStaffTask)).not.toHaveBeenCalled();
  });

  it('ignores a stray title (deploy-skew tolerance) — 201, composed title wins', async () => {
    vi.mocked(staffSvc.createStaffTask).mockResolvedValue({ id: 't1', title: 'Escalation' } as any);
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post('/tasks').send({ taskGroup: 'ESCALATION', title: 'typed title from a stale client' });
    expect(res.status).toBe(201);
    const svcInput = vi.mocked(staffSvc.createStaffTask).mock.calls[0][0] as Record<string, unknown>;
    expect(svcInput['title']).toBeUndefined();
  });

  it('400s when the provider is not at the selected practice', async () => {
    vi.mocked(staffSvc.createStaffTask).mockRejectedValue(new Error('PROVIDER_PRACTICE_MISMATCH'));
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post('/tasks').send({ taskGroup: 'CALL_BACK', practiceId: PROVIDER_ID, providerId: STAFF_USER_UUID });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("That provider isn't at the selected practice");
  });

  it('400s when assignee is not admin/lanyard_staff (v1 rule unchanged)', async () => {
    vi.mocked(staffSvc.createStaffTask).mockRejectedValue(new Error('ASSIGNEE_NOT_ALLOWED'));
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post('/tasks').send({ taskGroup: 'FOLLOW_UP', assignedToId: STAFF_USER_UUID });
    expect(res.status).toBe(400);
  });

  it('403s for practice-side credentialing_staff (fail closed)', async () => {
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'credentialing_staff' });
    const res = await request(app).post('/tasks').send({ taskGroup: 'FOLLOW_UP' });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/routes/staff-task.routes.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1` (route still requires `title`, no CHECK_IN gate, old error map).

- [ ] **Step 7: Rewrite the route**

In `packages/backend/src/routes/task.routes.ts`:

1. Add import: `import { HUMAN_TASK_GROUPS, type HumanTaskGroup } from '@credential-management/shared';`
2. Replace `staffCreateTaskSchema` with:

```ts
// Guided create (Tasks v2). NOT .strict(): a stray `title` from a
// not-yet-refreshed client is silently dropped (deploy-skew tolerance).
const guidedCreateTaskSchema = z.object({
  taskGroup: z.enum(HUMAN_TASK_GROUPS as unknown as [HumanTaskGroup, ...HumanTaskGroup[]]),
  note: z.string().max(2000).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  dueDate: z.string().datetime().optional(),
  assignedToId: z.string().uuid().optional(),
  payerId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  practiceId: z.string().uuid().optional(),
  enrollmentId: z.string().uuid().optional(),
});

const CREATE_ERROR_MESSAGES: Record<string, string> = {
  ENROLLMENT_LINK_EXCLUSIVE: 'A task can link to an enrollment or to a provider/practice, not both',
  PROVIDER_PRACTICE_MISMATCH: "That provider isn't at the selected practice",
  PAYER_NOT_FOUND: 'Payer not found',
  PRACTICE_NOT_FOUND: 'Practice not found',
  PROVIDER_NOT_FOUND: 'Provider not found',
  ASSIGNEE_NOT_ALLOWED: 'Tasks can only be assigned to Lanyard admin or credentialing staff',
};
```

3. Replace the `POST /tasks` handler body with:

```ts
router.post('/tasks', authenticate, staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // CHECK_IN is system-only (D17): explicit 400 before Zod so the message is human, not a schema error.
    if (req.body?.taskGroup === 'CHECK_IN') {
      res.status(400).json({ success: false, error: { message: 'Check-in tasks are created automatically by the system — pick another task group' } });
      return;
    }
    const v = guidedCreateTaskSchema.parse(req.body);
    const task = await createStaffTask(
      { ...v, dueDate: v.dueDate ? new Date(v.dueDate) : undefined },
      req.user!.id,
    );
    res.status(201).json({ success: true, data: task });
  } catch (error) {
    if (error instanceof Error && error.message in CREATE_ERROR_MESSAGES) {
      res.status(400).json({ success: false, error: { message: CREATE_ERROR_MESSAGES[error.message] } });
      return;
    }
    next(error);
  }
});
```

4. Extend `listTasksQuerySchema` with one line (after `practiceId`):

```ts
  taskGroup: z.enum(['FOLLOW_UP', 'CALL_BACK', 'SUBMIT_APPLICATION', 'REQUEST_DOCUMENTS', 'CAQH_UPDATE', 'VERIFY_INFORMATION', 'ESCALATION', 'OTHER', 'CHECK_IN']).optional(),
```

(`GET /tasks` already spreads the parsed query into `listStaffTasks`, so the filter flows through with no handler change.)

- [ ] **Step 8: Run route tests + full task-suite regression**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/routes/staff-task.routes.test.ts src/routes/task.routes.test.ts src/services/staff-task.service.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 0`.

- [ ] **Step 9: Backend typecheck**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && node ../../node_modules/typescript/bin/tsc --noEmit --incremental > /tmp/tsc.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 0`

- [ ] **Step 10: OpenAPI no-op check**

Run: `npm run openapi:generate --workspace=packages/backend > /tmp/openapi.log 2>&1; echo "exit: $?"; git status --short packages/backend/openapi.json`
Expected: `exit: 0` and no diff (task routes are Phase 0.A-absent by design). If a diff appears, commit it.

- [ ] **Step 11: Commit**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/backend/src/services/staff-task.service.ts packages/backend/src/services/staff-task.service.test.ts packages/backend/src/routes/task.routes.ts packages/backend/src/routes/staff-task.routes.test.ts
git commit -m "feat(tasks): guided create — server-composed titles, relaxed link rules, CHECK_IN rejected, group filter"
```

---

### Task 4: Payer contact-info endpoints

**Files:**
- Create: `packages/backend/src/routes/payer-contact-info.routes.ts`
- Modify: `packages/backend/src/index.ts` (mount at `/api/v1/enrollments`, ~L282 — BEFORE the `enrollmentRoutes` mount so `/payers/:payerId/contact-info` can never be captured by an enrollment `/payers/:payerId` param route)
- Test: `packages/backend/src/routes/payer-contact-info.routes.test.ts`

**Interfaces:**
- Consumes: Task 1 `PayerContactInfo` model; `ADMIN_ROLES` from `../constants/roles.js`.
- Produces (Task 7 hooks call these): `GET /enrollments/payers/:payerId/contact-info` → 200 `{ success, data: PayerContactInfo | null }` (null = designed empty state), 404 unknown payer; `PUT /enrollments/payers/:payerId/contact-info` body `{ phone?, email?, bestWay?, hours?, notes? }` (each `string | null`; `''` treated as null) → 200 upserted row with `updatedById` stamped. Both `authorize(...ADMIN_ROLES, 'lanyard_staff')` — practice roles 403.

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/src/routes/payer-contact-info.routes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn((...allowedRoles: string[]) => (req: any, res: any, next: any) => {
    if (!allowedRoles.includes(req.user?.role)) {
      return res.status(403).json({ success: false, error: { message: 'Forbidden' } });
    }
    next();
  }),
}));

import contactInfoRoutes from './payer-contact-info.routes.js';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, staffUser, practiceAdminUser } from '../../tests/helpers/fixtures.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const PAYER_ID = '22222222-2222-4222-a222-222222222222';

describe('GET /payers/:payerId/contact-info', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the row for lanyard_staff', async () => {
    prismaMock.payer.findUnique.mockResolvedValue({ id: PAYER_ID } as any);
    prismaMock.payerContactInfo.findUnique.mockResolvedValue({ payerId: PAYER_ID, phone: '(800) 555-0142' } as any);
    const app = createTestApp(contactInfoRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).get(`/payers/${PAYER_ID}/contact-info`);
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe('(800) 555-0142');
  });

  it('returns data null when nothing is on file (designed empty state)', async () => {
    prismaMock.payer.findUnique.mockResolvedValue({ id: PAYER_ID } as any);
    prismaMock.payerContactInfo.findUnique.mockResolvedValue(null);
    const app = createTestApp(contactInfoRoutes, adminUser);
    const res = await request(app).get(`/payers/${PAYER_ID}/contact-info`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('404s on an unknown payer', async () => {
    prismaMock.payer.findUnique.mockResolvedValue(null);
    const app = createTestApp(contactInfoRoutes, adminUser);
    const res = await request(app).get(`/payers/${PAYER_ID}/contact-info`);
    expect(res.status).toBe(404);
  });

  it('403s for practice-side roles (fail closed)', async () => {
    for (const user of [{ ...staffUser, role: 'credentialing_staff' }, practiceAdminUser]) {
      const app = createTestApp(contactInfoRoutes, user);
      const res = await request(app).get(`/payers/${PAYER_ID}/contact-info`);
      expect(res.status).toBe(403);
    }
  });
});

describe('PUT /payers/:payerId/contact-info', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts and stamps updatedById', async () => {
    prismaMock.payer.findUnique.mockResolvedValue({ id: PAYER_ID } as any);
    prismaMock.payerContactInfo.upsert.mockResolvedValue({ payerId: PAYER_ID, phone: '(800) 555-0142' } as any);
    const app = createTestApp(contactInfoRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).put(`/payers/${PAYER_ID}/contact-info`)
      .send({ phone: '(800) 555-0142', email: '', bestWay: 'Phone, ask for credentialing dept' });
    expect(res.status).toBe(200);
    const args = prismaMock.payerContactInfo.upsert.mock.calls[0][0];
    expect(args.create.updatedById).toBe('staff-user-id');
    expect(args.update.updatedById).toBe('staff-user-id');
    expect(args.create.email).toBeNull(); // '' → null
  });

  it('403s for practice-side credentialing_staff', async () => {
    const app = createTestApp(contactInfoRoutes, { ...staffUser, role: 'credentialing_staff' });
    const res = await request(app).put(`/payers/${PAYER_ID}/contact-info`).send({ phone: 'x' });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/routes/payer-contact-info.routes.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1` (module not found).

- [ ] **Step 3: Implement the routes**

Create `packages/backend/src/routes/payer-contact-info.routes.ts`:

```ts
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { ADMIN_ROLES } from '../constants/roles.js';

// Internal Lanyard team ONLY — never 'credentialing_staff' (practice-side).
const internalOnly = authorize(...ADMIN_ROLES, 'lanyard_staff');

const router = Router();

// '' from a cleared form field means "no value" — store null, never ''.
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );

const contactInfoSchema = z.object({
  phone: optionalText(50),
  email: optionalText(200),
  bestWay: optionalText(200),
  hours: optionalText(200),
  notes: optionalText(1000),
});

// GET /enrollments/payers/:payerId/contact-info — row or null (null = the
// designed "Nothing on file" empty state; runtime does NOT fall back to
// Payer.phone — the seeding script materializes that fallback as real rows).
router.get('/payers/:payerId/contact-info', authenticate, internalOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payerId = req.params['payerId']!;
    const payer = await prisma.payer.findUnique({ where: { id: payerId }, select: { id: true } });
    if (!payer) {
      res.status(404).json({ success: false, error: { message: 'Payer not found' } });
      return;
    }
    const info = await prisma.payerContactInfo.findUnique({ where: { payerId } });
    res.json({ success: true, data: info });
  } catch (error) { next(error); }
});

// PUT /enrollments/payers/:payerId/contact-info — staff upsert (D6: staff-entered from seeding on).
router.put('/payers/:payerId/contact-info', authenticate, internalOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payerId = req.params['payerId']!;
    const v = contactInfoSchema.parse(req.body);
    const payer = await prisma.payer.findUnique({ where: { id: payerId }, select: { id: true } });
    if (!payer) {
      res.status(404).json({ success: false, error: { message: 'Payer not found' } });
      return;
    }
    const fields = {
      phone: v.phone ?? null,
      email: v.email ?? null,
      bestWay: v.bestWay ?? null,
      hours: v.hours ?? null,
      notes: v.notes ?? null,
      updatedById: req.user!.id,
    };
    const row = await prisma.payerContactInfo.upsert({
      where: { payerId },
      create: { payerId, ...fields },
      update: fields,
    });
    res.json({ success: true, data: row });
  } catch (error) { next(error); }
});

export default router;
```

In `packages/backend/src/index.ts`: add `import payerContactInfoRoutes from './routes/payer-contact-info.routes.js';` next to the enrollment imports (~L44), and mount it immediately BEFORE the existing enrollment mount (~L282):

```ts
app.use('/api/v1/enrollments', payerContactInfoRoutes);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/routes/payer-contact-info.routes.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"; tail -10 /tmp/vitest.log` (timeout 600000)
Expected: `exit: 0`, 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/backend/src/routes/payer-contact-info.routes.ts packages/backend/src/routes/payer-contact-info.routes.test.ts packages/backend/src/index.ts
git commit -m "feat(tasks): payer contact-info GET/PUT endpoints (internal team only)"
```

---

### Task 5: Seeding script — payer contact info from existing data

**Files:**
- Create: `packages/backend/src/utils/payer-contact-seed.ts` (pure, testable matching logic)
- Create: `packages/backend/scripts/seed-payer-contact-info.ts` (thin CLI wrapper; NOT part of the migration)
- Test: `packages/backend/src/utils/payer-contact-seed.test.ts`

**Interfaces:**
- Consumes: `Payer` (Stedi catalog: name, phone), `PayerContact` (track-level rows via `payerTrack.payerName`, contactType 'Credentialing' | 'Provider Services' | 'Status Check'), existing `PayerContactInfo` rows.
- Produces:

```ts
export function normalizePayerName(name: string): string;
export interface ContactSeedSource { trackName: string; contactType: string; phone: string | null; email: string | null; hours: string | null; notes: string | null; }
export interface SeedPlanRow { payerId: string; payerName: string; source: 'payer_contact' | 'payer_phone'; phone: string | null; email: string | null; hours: string | null; notes: string | null; }
export function planContactSeeds(
  payers: { id: string; name: string; phone: string | null }[],
  contacts: ContactSeedSource[],
  existingPayerIds: Set<string>,
): SeedPlanRow[];
```

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/src/utils/payer-contact-seed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizePayerName, planContactSeeds } from './payer-contact-seed.js';

describe('normalizePayerName', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizePayerName('Aetna Better Health, Inc.')).toBe('aetna better health');
    expect(normalizePayerName('MOLINA   HEALTHCARE-OF TEXAS')).toBe('molina healthcare of texas');
  });
  it('strips trailing corporate suffixes only', () => {
    expect(normalizePayerName('Cigna Corp')).toBe('cigna');
    expect(normalizePayerName('Company Health Plan')).toBe('company health plan'); // suffix only when trailing
  });
});

describe('planContactSeeds', () => {
  const payers = [
    { id: 'p1', name: 'Aetna Better Health, Inc.', phone: null },
    { id: 'p2', name: 'Molina Healthcare of Texas', phone: '(800) 555-0111' },
    { id: 'p3', name: 'Unmatched Payer', phone: null },
    { id: 'p4', name: 'Already Seeded', phone: '(800) 555-0999' },
  ];
  const contacts = [
    { trackName: 'Aetna Better Health', contactType: 'Provider Services', phone: '(800) 555-0100', email: null, hours: null, notes: null },
    { trackName: 'Aetna Better Health', contactType: 'Credentialing', phone: '(800) 555-0142', email: 'cred@aetna.com', hours: 'M-F 8-5 CT', notes: null },
  ];

  it('matches by exact normalized name only, preferring the Credentialing contact', () => {
    const plan = planContactSeeds(payers, contacts, new Set());
    const aetna = plan.find((r) => r.payerId === 'p1')!;
    expect(aetna.source).toBe('payer_contact');
    expect(aetna.phone).toBe('(800) 555-0142'); // Credentialing beats Provider Services
    expect(aetna.email).toBe('cred@aetna.com');
  });

  it('falls back to Payer.phone when no contact matches', () => {
    const plan = planContactSeeds(payers, contacts, new Set());
    const molina = plan.find((r) => r.payerId === 'p2')!;
    expect(molina.source).toBe('payer_phone');
    expect(molina.phone).toBe('(800) 555-0111');
  });

  it('produces no row when there is no data (rows exist only where data exists)', () => {
    const plan = planContactSeeds(payers, contacts, new Set());
    expect(plan.find((r) => r.payerId === 'p3')).toBeUndefined();
  });

  it('is idempotent — skips payers that already have a row', () => {
    const plan = planContactSeeds(payers, contacts, new Set(['p4']));
    expect(plan.find((r) => r.payerId === 'p4')).toBeUndefined();
  });

  it('never fuzzy-matches (a wrong number on click-to-call is worse than the empty state)', () => {
    const near = [{ id: 'p9', name: 'Aetna Better Health of Ohio', phone: null }];
    const plan = planContactSeeds(near, contacts, new Set());
    expect(plan).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/utils/payer-contact-seed.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1` (module not found).

- [ ] **Step 3: Implement the matching logic**

Create `packages/backend/src/utils/payer-contact-seed.ts`:

```ts
/**
 * Payer contact-info seeding logic (Tasks v2). Exact-normalized matching ONLY
 * — no fuzzy matching: a wrong number on click-to-call is worse than the
 * designed empty state. Misses simply fall back to "Nothing on file".
 */

const CORPORATE_SUFFIXES = new Set(['inc', 'incorporated', 'llc', 'corp', 'corporation', 'co', 'company']);

export function normalizePayerName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  while (words.length > 1 && CORPORATE_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join(' ');
}

export interface ContactSeedSource {
  trackName: string;
  contactType: string;
  phone: string | null;
  email: string | null;
  hours: string | null;
  notes: string | null;
}

export interface SeedPlanRow {
  payerId: string;
  payerName: string;
  source: 'payer_contact' | 'payer_phone';
  phone: string | null;
  email: string | null;
  hours: string | null;
  notes: string | null;
}

export function planContactSeeds(
  payers: { id: string; name: string; phone: string | null }[],
  contacts: ContactSeedSource[],
  existingPayerIds: Set<string>,
): SeedPlanRow[] {
  // Group contacts by normalized track name; a Credentialing-type contact wins.
  const byName = new Map<string, ContactSeedSource>();
  for (const contact of contacts) {
    const key = normalizePayerName(contact.trackName);
    const current = byName.get(key);
    if (!current || (contact.contactType === 'Credentialing' && current.contactType !== 'Credentialing')) {
      byName.set(key, contact);
    }
  }

  const plan: SeedPlanRow[] = [];
  for (const payer of payers) {
    if (existingPayerIds.has(payer.id)) continue; // idempotent — never touch existing rows
    const match = byName.get(normalizePayerName(payer.name));
    if (match && (match.phone || match.email)) {
      plan.push({ payerId: payer.id, payerName: payer.name, source: 'payer_contact', phone: match.phone, email: match.email, hours: match.hours, notes: match.notes });
    } else if (payer.phone) {
      plan.push({ payerId: payer.id, payerName: payer.name, source: 'payer_phone', phone: payer.phone, email: null, hours: null, notes: null });
    }
    // else: no data → no row → designed empty state
  }
  return plan;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/utils/payer-contact-seed.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"; tail -10 /tmp/vitest.log` (timeout 600000)
Expected: `exit: 0`, 7 passed.

- [ ] **Step 5: Write the CLI wrapper**

Create `packages/backend/scripts/seed-payer-contact-info.ts`:

```ts
/**
 * Seed PayerContactInfo from existing data (Tasks v2). Idempotent; skips
 * payers that already have a row. NOT part of the migration — run per env:
 *
 *   cd packages/backend && npx tsx scripts/seed-payer-contact-info.ts --dry-run
 *   cd packages/backend && npx tsx scripts/seed-payer-contact-info.ts
 *
 * ALWAYS review the --dry-run report before each live run (per env).
 */
import { prisma } from '../src/utils/prisma.js';
import { planContactSeeds, type ContactSeedSource } from '../src/utils/payer-contact-seed.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const [payers, payerContacts, existing] = await Promise.all([
    prisma.payer.findMany({ select: { id: true, name: true, phone: true } }),
    prisma.payerContact.findMany({
      select: {
        contactType: true, phone: true, email: true, hours: true, notes: true,
        payerTrack: { select: { payerName: true } },
      },
    }),
    prisma.payerContactInfo.findMany({ select: { payerId: true } }),
  ]);

  const contacts: ContactSeedSource[] = payerContacts.map((c) => ({
    trackName: c.payerTrack.payerName,
    contactType: c.contactType,
    phone: c.phone, email: c.email, hours: c.hours, notes: c.notes,
  }));

  const plan = planContactSeeds(payers, contacts, new Set(existing.map((e) => e.payerId)));
  const fromContacts = plan.filter((r) => r.source === 'payer_contact');
  const fromPhone = plan.filter((r) => r.source === 'payer_phone');

  console.log(`Payers in catalog:        ${payers.length}`);
  console.log(`Already seeded (skipped): ${existing.length}`);
  console.log(`Planned rows:             ${plan.length}  (${fromContacts.length} from PayerContact, ${fromPhone.length} from Payer.phone)`);
  for (const row of fromContacts) {
    console.log(`  [contact] ${row.payerName}  phone=${row.phone ?? '—'}  email=${row.email ?? '—'}`);
  }
  console.log(`  [phone-only] ${fromPhone.length} rows (Payer.phone fallback)`);

  if (dryRun) {
    console.log('\nDRY RUN — nothing written. Re-run without --dry-run after reviewing.');
    return;
  }

  let created = 0;
  for (const row of plan) {
    await prisma.payerContactInfo.create({
      data: {
        payerId: row.payerId,
        phone: row.phone, email: row.email, hours: row.hours, notes: row.notes,
        updatedById: null, // system-seeded
      },
    });
    created++;
  }
  console.log(`\nCreated ${created} PayerContactInfo rows.`);
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 6: Dry-run against the local DB**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && npx tsx scripts/seed-payer-contact-info.ts --dry-run`
Expected: a report ending in `DRY RUN — nothing written.` with plausible counts (local DB may have few PayerContacts — zero matched rows is fine locally; the report format is what's being verified).

- [ ] **Step 7: Commit**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/backend/src/utils/payer-contact-seed.ts packages/backend/src/utils/payer-contact-seed.test.ts packages/backend/scripts/seed-payer-contact-info.ts
git commit -m "feat(tasks): payer contact-info seeding (exact-normalized match, dry-run, idempotent)"
```

---

### Task 6: Frontend — PayerCombobox, AutoTitlePreview, TaskGroupPill + type/hook extensions

**Files:**
- Create: `packages/frontend/src/features/tasks/PayerCombobox.tsx`, `packages/frontend/src/features/tasks/AutoTitlePreview.tsx`, `packages/frontend/src/features/tasks/TaskGroupPill.tsx`
- Modify: `packages/frontend/src/hooks/useStaffTasks.ts` (StaffTask type + taskGroup filter)
- Test: `packages/frontend/src/features/tasks/TaskGroupPill.test.tsx`, `packages/frontend/src/features/tasks/AutoTitlePreview.test.tsx`, `packages/frontend/src/features/tasks/PayerCombobox.test.tsx`

**Interfaces:**
- Consumes: `TASK_GROUP_LABELS`, `composeTaskTitle`, type `TaskGroup` from `@credential-management/shared` (Task 2); `GET /enrollments/payers?q=` (existing Stedi word-order search, envelope `{ success, data: Payer[], pagination }`).
- Produces (Tasks 8, 9, 12 consume):

```ts
// PayerCombobox.tsx
export interface PayerOption { id: string; name: string; }
export default function PayerCombobox(props: { value: PayerOption | null; onChange: (p: PayerOption | null) => void; }): JSX.Element;
// AutoTitlePreview.tsx
export default function AutoTitlePreview(props: { group: TaskGroup | ''; payerName?: string; practiceName?: string; }): JSX.Element;
// TaskGroupPill.tsx
export default function TaskGroupPill(props: { group: TaskGroup }): JSX.Element;
// useStaffTasks.ts — StaffTask gains:
//   taskGroup?: TaskGroup | null;
//   payer?: { id: string; name: string; phone?: string | null; contactInfo?: { phone?: string | null } | null } | null;
//   overdueReason?: string | null; overdueReasonAt?: string | null;
// useStaffTasks(view, filters) — filters gains taskGroup?: string
```

- [ ] **Step 1: Extend the hook types**

In `packages/frontend/src/hooks/useStaffTasks.ts`: add `import type { TaskGroup } from '@credential-management/shared';` at the top; add the four fields above to `StaffTask` (after `enrollment`); add `taskGroup?: string` to the `filters` parameter type of `useStaffTasks` and one line in its queryFn: `if (filters?.taskGroup) params.set('taskGroup', filters.taskGroup);`

- [ ] **Step 2: Write the failing pill + preview tests**

Create `packages/frontend/src/features/tasks/TaskGroupPill.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TaskGroupPill from './TaskGroupPill';

describe('TaskGroupPill', () => {
  it('renders the group label verbatim, including the spaced CAQH form', () => {
    render(<TaskGroupPill group="CAQH_UPDATE" />);
    expect(screen.getByText('CAQH Update / Re-attestation')).toBeInTheDocument();
  });
  it('renders the system variant for check-ins', () => {
    render(<TaskGroupPill group="CHECK_IN" />);
    expect(screen.getByText('Auto · Check-in')).toBeInTheDocument();
  });
});
```

Create `packages/frontend/src/features/tasks/AutoTitlePreview.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import AutoTitlePreview from './AutoTitlePreview';

describe('AutoTitlePreview', () => {
  afterEach(() => vi.useRealTimers());

  it('is a read-only polite status region labeled "Task title, automatic"', async () => {
    vi.useFakeTimers();
    render(<AutoTitlePreview group="FOLLOW_UP" payerName="Molina Healthcare of Texas" />);
    await act(async () => { vi.advanceTimersByTime(400); });
    const region = screen.getByRole('status', { name: 'Task title, automatic' });
    expect(region).toHaveTextContent('Follow Up — Molina Healthcare of Texas');
  });

  it('debounces recomposition — one settled announcement, not per keystroke', async () => {
    vi.useFakeTimers();
    const { rerender } = render(<AutoTitlePreview group="FOLLOW_UP" />);
    await act(async () => { vi.advanceTimersByTime(400); });
    rerender(<AutoTitlePreview group="FOLLOW_UP" payerName="Aet" />);
    rerender(<AutoTitlePreview group="FOLLOW_UP" payerName="Aetna Better Health" />);
    // before settle, still the old value
    expect(screen.getByRole('status')).toHaveTextContent(/^Follow Up$/);
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.getByRole('status')).toHaveTextContent('Follow Up — Aetna Better Health');
  });
});
```

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/TaskGroupPill.test.tsx src/features/tasks/AutoTitlePreview.test.tsx > /tmp/vitest-fe.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1` (modules not found).

- [ ] **Step 3: Implement TaskGroupPill.tsx**

Design tokens (DESIGN.md): indigo tint = Tailwind `indigo-50`/`indigo-700` (#eef2ff / #4338ca — exactly the spec hexes); the check-in green uses the app's rebranded primary scale ({colors.green-50}/{colors.green-600} are the repo system tokens the `primary-*` Tailwind scale maps to). Tinted pill pattern: bg + same-hue text + inset ring at ~10-20% opacity.

```tsx
import { TASK_GROUP_LABELS, type TaskGroup } from '@credential-management/shared';

// Indigo = task-group identity only (DESIGN.md); green variant marks
// system-created check-in rows ("Auto · Check-in", D17).
export default function TaskGroupPill({ group }: { group: TaskGroup }) {
  if (group === 'CHECK_IN') {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700 ring-1 ring-inset ring-primary-700/20">
        Auto · Check-in
      </span>
    );
  }
  return (
    <span className="inline-flex w-fit items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-700/10">
      {TASK_GROUP_LABELS[group]}
    </span>
  );
}
```

- [ ] **Step 4: Implement AutoTitlePreview.tsx**

```tsx
import { useEffect, useState } from 'react';
import { composeTaskTitle, type TaskGroup } from '@credential-management/shared';

interface AutoTitlePreviewProps {
  group: TaskGroup | '';
  payerName?: string;
  practiceName?: string;
}

// Read-only preview of the server-composed title (D1, D3). role="status" +
// polite live region; the rendered text is debounced 300ms so screen readers
// hear one settled recomposition, not one per keystroke. Styled per
// {components.auto-title-preview}: green-50 panel, green-100 border, must NOT
// look like an input (it must not invite typing).
export default function AutoTitlePreview({ group, payerName, practiceName }: AutoTitlePreviewProps) {
  const composed = group ? composeTaskTitle(group, payerName, practiceName) : '—';
  const [settled, setSettled] = useState(composed);

  useEffect(() => {
    const handle = setTimeout(() => setSettled(composed), 300);
    return () => clearTimeout(handle);
  }, [composed]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Task title, automatic"
      className="rounded-xl border border-primary-100 bg-primary-50 px-3.5 py-2.5"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[.05em] text-gray-500">Task title (automatic)</p>
      <p className="mt-0.5 text-[13px] font-semibold text-primary-800">{settled}</p>
    </div>
  );
}
```

- [ ] **Step 5: Implement PayerCombobox.tsx**

Cloned from the `ProviderEnrollments.tsx:770-831` async-picker precedent, upgraded to the Accessibility Floor (Headless UI Combobox provides the ARIA 1.2 combobox/listbox semantics, `aria-activedescendant`, arrow keys, Enter-select; we add the settled-result live region and the Esc-doesn't-close-the-modal guard):

```tsx
import { useEffect, useState } from 'react';
import { Combobox } from '@headlessui/react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';

export interface PayerOption {
  id: string;
  name: string;
}

interface PayerComboboxProps {
  value: PayerOption | null;
  onChange: (payer: PayerOption | null) => void;
}

// Same Stedi-backed word-order search the enrollment screens use (D4), over
// the full payer catalog. Loading + "No payers match" states per the
// enrollment screens; result counts announced once per settled debounced
// result set — never per keystroke.
export default function PayerCombobox({ value, onChange }: PayerComboboxProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(handle);
  }, [query]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['payer-search', debounced],
    queryFn: async () =>
      (await api.get(`/enrollments/payers?q=${encodeURIComponent(debounced)}&pageSize=20`)).data.data as PayerOption[],
    enabled: debounced.length > 0,
  });

  // Settled-result announcement: fires once per resolved result set; pending
  // announcements are implicitly cancelled because a new query flips isFetching.
  useEffect(() => {
    if (!debounced) { setAnnouncement(''); return; }
    if (isFetching) return;
    setAnnouncement(results.length === 0 ? 'No payers match' : `${results.length} payer${results.length === 1 ? '' : 's'} found`);
  }, [results, isFetching, debounced]);

  return (
    <Combobox value={value} onChange={onChange} nullable>
      {({ open }) => (
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <Combobox.Input
            id="task-payer"
            className="input pl-10"
            placeholder="Search payers…"
            displayValue={(payer: PayerOption | null) => payer?.name ?? ''}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Esc closes the listbox WITHOUT bubbling into the modal's close handler.
              if (e.key === 'Escape' && open) e.stopPropagation();
            }}
          />
          <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
          {debounced.length > 0 && (
            <Combobox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
              {isFetching && (
                <div className="px-4 py-2.5 text-sm text-gray-500">Searching payers…</div>
              )}
              {!isFetching && results.length === 0 && (
                <div className="px-4 py-3 text-sm text-gray-500">No payers match</div>
              )}
              {results.map((payer) => (
                <Combobox.Option
                  key={payer.id}
                  value={payer}
                  className={({ active }) => `cursor-pointer select-none px-4 py-2 text-sm text-gray-900 ${active ? 'bg-primary-50' : ''}`}
                >
                  {payer.name}
                </Combobox.Option>
              ))}
            </Combobox.Options>
          )}
        </div>
      )}
    </Combobox>
  );
}
```

- [ ] **Step 6: Write + run the combobox test**

Create `packages/frontend/src/features/tasks/PayerCombobox.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PayerCombobox from './PayerCombobox';

vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn(async (url: string) =>
      url.includes('q=aet')
        ? { data: { data: [{ id: 'p1', name: 'Aetna Better Health' }] } }
        : { data: { data: [] } }),
  },
}));

function renderBox(onChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PayerCombobox value={null} onChange={onChange} />
    </QueryClientProvider>,
  );
}

describe('PayerCombobox', () => {
  it('shows debounced matches and announces the settled count', async () => {
    renderBox();
    await userEvent.type(screen.getByRole('combobox'), 'aet');
    await waitFor(() => expect(screen.getByText('Aetna Better Health')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 payer found'));
  });

  it('shows the "No payers match" empty row and announces it', async () => {
    renderBox();
    await userEvent.type(screen.getByRole('combobox'), 'zzz');
    await waitFor(() => expect(screen.getByText('No payers match')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No payers match'));
  });

  it('selects an option via the listbox', async () => {
    const onChange = vi.fn();
    renderBox(onChange);
    await userEvent.type(screen.getByRole('combobox'), 'aet');
    await waitFor(() => expect(screen.getByText('Aetna Better Health')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Aetna Better Health'));
    expect(onChange).toHaveBeenCalledWith({ id: 'p1', name: 'Aetna Better Health' });
  });
});
```

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/TaskGroupPill.test.tsx src/features/tasks/AutoTitlePreview.test.tsx src/features/tasks/PayerCombobox.test.tsx > /tmp/vitest-fe.log 2>&1; echo "exit: $?"; tail -15 /tmp/vitest-fe.log` (timeout 600000)
Expected: `exit: 0`, 7 passed.

- [ ] **Step 7: Frontend typecheck**

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && node ../../node_modules/typescript/bin/tsc --noEmit --incremental > /tmp/tsc-fe.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 0`

- [ ] **Step 8: Commit**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/frontend/src/features/tasks/PayerCombobox.tsx packages/frontend/src/features/tasks/AutoTitlePreview.tsx packages/frontend/src/features/tasks/TaskGroupPill.tsx packages/frontend/src/features/tasks/*.test.tsx packages/frontend/src/hooks/useStaffTasks.ts
git commit -m "feat(tasks): payer combobox, auto-title preview, task-group pills"
```

---

### Task 7: PayerContactCard + contact-info hooks

**Files:**
- Create: `packages/frontend/src/features/tasks/PayerContactCard.tsx`
- Modify: `packages/frontend/src/hooks/useStaffTasks.ts` (contact-info hooks)
- Test: `packages/frontend/src/features/tasks/PayerContactCard.test.tsx`

**Interfaces:**
- Consumes: Task 4 endpoints; `notify` from `../../utils/notify`.
- Produces (Tasks 8 and 9 mount this):

```ts
// useStaffTasks.ts additions:
export interface PayerContactInfoData { phone?: string | null; email?: string | null; bestWay?: string | null; hours?: string | null; notes?: string | null; }
export function usePayerContactInfo(payerId: string | undefined); // GET, enabled: !!payerId, key ['payer-contact-info', payerId], data: PayerContactInfoData | null
export function useSavePayerContactInfo();                        // PUT mutation ({ payerId, data }), invalidates ['payer-contact-info', payerId]
// PayerContactCard.tsx:
export default function PayerContactCard(props: { payerId: string; payerName: string }): JSX.Element;
```

- [ ] **Step 1: Add the hooks**

Append to `packages/frontend/src/hooks/useStaffTasks.ts`:

```ts
export interface PayerContactInfoData {
  phone?: string | null;
  email?: string | null;
  bestWay?: string | null;
  hours?: string | null;
  notes?: string | null;
}

export function usePayerContactInfo(payerId: string | undefined) {
  return useQuery({
    queryKey: ['payer-contact-info', payerId],
    queryFn: async () =>
      (await api.get(`/enrollments/payers/${payerId}/contact-info`)).data.data as PayerContactInfoData | null,
    enabled: !!payerId,
  });
}

export function useSavePayerContactInfo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ payerId, data }: { payerId: string; data: PayerContactInfoData }) =>
      (await api.put(`/enrollments/payers/${payerId}/contact-info`, data)).data.data as PayerContactInfoData,
    onSuccess: (_data, { payerId }) => queryClient.invalidateQueries({ queryKey: ['payer-contact-info', payerId] }),
  });
}
```

- [ ] **Step 2: Write the failing component tests**

Create `packages/frontend/src/features/tasks/PayerContactCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  usePayerContactInfo: vi.fn(),
  useSavePayerContactInfo: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock('../../hooks/useStaffTasks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePayerContactInfo: mocks.usePayerContactInfo,
  useSavePayerContactInfo: mocks.useSavePayerContactInfo,
}));
vi.mock('../../utils/notify', () => ({ notify: { error: mocks.notifyError, success: vi.fn() } }));

import PayerContactCard from './PayerContactCard';

describe('PayerContactCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('on-file state: tel link carries the payer + consequence in its accessible name', () => {
    mocks.usePayerContactInfo.mockReturnValue({ data: { phone: '(800) 555-0142', email: 'cred@aetna.com', bestWay: 'Phone, ask for credentialing dept', hours: 'M-F 8-5 CT', notes: null }, isLoading: false, isError: false });
    mocks.useSavePayerContactInfo.mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<PayerContactCard payerId="p1" payerName="Aetna Better Health" />);
    expect(screen.getByText('On file')).toBeInTheDocument();
    const tel = screen.getByRole('link', { name: 'Call Aetna Better Health credentialing, (800) 555-0142' });
    expect(tel).toHaveAttribute('href', 'tel:(800) 555-0142');
    expect(screen.getByRole('button', { name: 'Edit contact info' })).toBeInTheDocument();
  });

  it('empty state: invitation copy verbatim + labeled add form', () => {
    mocks.usePayerContactInfo.mockReturnValue({ data: null, isLoading: false, isError: false });
    mocks.useSavePayerContactInfo.mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<PayerContactCard payerId="p1" payerName="Molina Healthcare of Texas" />);
    expect(screen.getByText('Nothing on file')).toBeInTheDocument();
    expect(screen.getByText('Be the first to add it — every teammate after you gets this automatically.')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toBeInTheDocument();
    expect(screen.getByLabelText('Best way to contact')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save contact info' })).toBeInTheDocument();
  });

  it('a failed save shows a toast and keeps the entered values', async () => {
    mocks.usePayerContactInfo.mockReturnValue({ data: null, isLoading: false, isError: false });
    const mutate = vi.fn((_vars: unknown, opts?: { onError?: (e: unknown) => void }) => opts?.onError?.(new Error('network')));
    mocks.useSavePayerContactInfo.mockReturnValue({ mutate, isPending: false });
    render(<PayerContactCard payerId="p1" payerName="Molina Healthcare of Texas" />);
    await userEvent.type(screen.getByLabelText('Phone'), '(800) 555-0111');
    await userEvent.click(screen.getByRole('button', { name: 'Save contact info' }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalled());
    expect(screen.getByLabelText('Phone')).toHaveValue('(800) 555-0111'); // values kept, task creation unaffected
  });
});
```

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/PayerContactCard.test.tsx > /tmp/vitest-fe.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1` (module not found).

- [ ] **Step 3: Implement PayerContactCard.tsx**

```tsx
import { useEffect, useState } from 'react';
import { usePayerContactInfo, useSavePayerContactInfo, type PayerContactInfoData } from '../../hooks/useStaffTasks';
import { notify } from '../../utils/notify';

interface PayerContactCardProps {
  payerId: string;
  payerName: string;
}

const EMPTY_FORM: Required<{ [K in keyof PayerContactInfoData]: string }> = {
  phone: '', email: '', bestWay: '', hours: '', notes: '',
};

const FIELD_LABELS: { key: keyof PayerContactInfoData; label: string }[] = [
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'bestWay', label: 'Best way to contact' },
  { key: 'hours', label: 'Hours' },
  { key: 'notes', label: 'Notes' },
];

// The contact card (D5, D6, D7): appears when a payer is selected; on-file /
// empty(add form) / edit states share one inline form. Saving is optional —
// a failed save shows a toast, keeps the values, and NEVER affects task
// creation. Shared by NewTaskModal and TaskDetailPanel.
export default function PayerContactCard({ payerId, payerName }: PayerContactCardProps) {
  const { data: info, isLoading } = usePayerContactInfo(payerId);
  const saveMutation = useSavePayerContactInfo();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [announcement, setAnnouncement] = useState('');

  // Announce the card's appearance once per payer (Accessibility Floor).
  useEffect(() => {
    if (isLoading) return;
    setAnnouncement(info
      ? `Contact info on file for ${payerName}`
      : `No contact info on file for ${payerName} — you can add it below`);
  }, [info, isLoading, payerName]);

  // Seed the form from the row when entering edit mode or switching payers.
  useEffect(() => {
    setEditing(false);
    setForm({
      phone: info?.phone ?? '', email: info?.email ?? '', bestWay: info?.bestWay ?? '',
      hours: info?.hours ?? '', notes: info?.notes ?? '',
    });
  }, [info, payerId]);

  const handleSave = () => {
    saveMutation.mutate(
      { payerId, data: form },
      {
        onSuccess: () => {
          setEditing(false);
          setAnnouncement(`Contact info saved for ${payerName}`);
        },
        onError: () => {
          // Entered values are kept (state untouched); creation flow unaffected.
          setAnnouncement(`Couldn't save contact info for ${payerName}`);
          notify.error("Couldn't save contact info", { description: 'Your entries are kept — try again in a moment.' });
        },
      },
    );
  };

  const showForm = editing || (!isLoading && !info);

  return (
    <div className="rounded-xl border border-gray-200/80 bg-[#fafcfb] px-3.5 py-3">
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
      <div className="flex items-center justify-between border-b border-gray-100 pb-2">
        <p className="text-[12.5px] font-semibold text-gray-900">{payerName}</p>
        {isLoading ? (
          <span className="text-[11px] text-gray-500">Loading…</span>
        ) : info ? (
          <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700 ring-1 ring-inset ring-primary-700/20">On file</span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-700/20">Nothing on file</span>
        )}
      </div>

      {isLoading ? null : showForm ? (
        <div className="mt-2 space-y-2">
          {!info && (
            <p className="text-[13px] text-gray-600">Be the first to add it — every teammate after you gets this automatically.</p>
          )}
          {FIELD_LABELS.map(({ key, label }) => (
            <div key={key}>
              {/* Visible labels always — never placeholder-only (Accessibility Floor). */}
              <label htmlFor={`contact-${key}`} className="text-sm font-medium text-gray-600">{label}</label>
              <input
                id={`contact-${key}`}
                className="input mt-0.5"
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={handleSave} disabled={saveMutation.isPending}
              className="rounded-lg border border-primary-200 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-50">
              {saveMutation.isPending ? 'Saving…' : 'Save contact info'}
            </button>
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <dl className="mt-2 grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5 text-[13px]">
          {info?.phone && (
            <>
              <dt className="text-gray-500">Phone</dt>
              <dd>
                <a
                  href={`tel:${info.phone}`}
                  aria-label={`Call ${payerName} credentialing, ${info.phone}`}
                  className="font-semibold text-primary-700 underline decoration-dashed decoration-primary-700/40 underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {info.phone}
                </a>
                <span className="ml-1 text-gray-500">· click to call</span>
              </dd>
            </>
          )}
          {info?.email && (
            <>
              <dt className="text-gray-500">Email</dt>
              <dd>
                <a href={`mailto:${info.email}`} aria-label={`Email ${payerName} credentialing, ${info.email}`}
                  className="font-semibold text-primary-700 underline decoration-dashed decoration-primary-700/40 underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  {info.email}
                </a>
              </dd>
            </>
          )}
          {info?.bestWay && (<><dt className="text-gray-500">Best way</dt><dd className="text-gray-800">{info.bestWay}</dd></>)}
          {info?.hours && (<><dt className="text-gray-500">Hours</dt><dd className="text-gray-800">{info.hours}</dd></>)}
          {info?.notes && (<><dt className="text-gray-500">Notes</dt><dd className="text-gray-800">{info.notes}</dd></>)}
          <dt className="sr-only">Actions</dt>
          <dd className="col-span-2 pt-1">
            <button type="button" onClick={() => setEditing(true)}
              className="text-xs font-semibold text-primary-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              Edit contact info
            </button>
          </dd>
        </dl>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/PayerContactCard.test.tsx > /tmp/vitest-fe.log 2>&1; echo "exit: $?"; tail -10 /tmp/vitest-fe.log` (timeout 600000)
Expected: `exit: 0`, 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/frontend/src/features/tasks/PayerContactCard.tsx packages/frontend/src/features/tasks/PayerContactCard.test.tsx packages/frontend/src/hooks/useStaffTasks.ts
git commit -m "feat(tasks): payer contact card (on-file/empty/edit, click-to-call, optional save)"
```

---

### Task 8: NewTaskModal rewrite — guided creation

**Files:**
- Modify: `packages/frontend/src/features/tasks/NewTaskModal.tsx` (full rewrite of the form body; the Transition/Dialog shell, dirty-guard, and validation-keeps-open behaviors carry over from v1)
- Modify: `e2e/tests/tasks.spec.ts` (the v1 lifecycle test fills a Title input that no longer exists — rewrite its create section to the guided flow so the suite stays green after PR-A)
- Test: `packages/frontend/src/features/tasks/NewTaskModal.test.tsx` (new)

**Interfaces:**
- Consumes: `PayerCombobox`/`PayerOption`, `AutoTitlePreview` (Task 6), `PayerContactCard` (Task 7), `useCreateStaffTask`, `useAssignees` (v1 hooks), `composeTaskTitle`, `HUMAN_TASK_GROUPS`, `TASK_GROUP_LABELS` from `@credential-management/shared`; `GET /providers?practiceId=<id>&pageSize=100` (provider.routes.ts supports `practiceId`; response nests `data.data.data`), `GET /practices` (cached under `['staff-tasks','practice-options']`).
- Produces: `<NewTaskModal isOpen onClose />` — unchanged mount signature (TasksPage untouched in this task). POST body: `{ taskGroup, note?, priority, dueDate?, assignedToId?, payerId?, practiceId?, providerId? }`.

- [ ] **Step 1: Write the failing tests**

Create `packages/frontend/src/features/tasks/NewTaskModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  createMutate: vi.fn(),
  providersByPractice: {
    'practice-1': [{ id: 'prov-1', firstName: 'Dana', lastName: 'Reyes' }],
    'practice-2': [] as { id: string; firstName: string; lastName: string }[],
  } as Record<string, { id: string; firstName: string; lastName: string }[]>,
}));

vi.mock('../../hooks/useStaffTasks', () => ({
  useCreateStaffTask: vi.fn(() => ({ mutate: mocks.createMutate, isPending: false })),
  useAssignees: vi.fn(() => ({ data: [{ id: 'u1', firstName: 'Kay', lastName: 'Ward', role: 'admin' }] })),
  usePayerContactInfo: vi.fn(() => ({ data: null, isLoading: false, isError: false })),
  useSavePayerContactInfo: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('../../stores/auth.store', () => ({ useAuthStore: vi.fn((sel: any) => sel({ user: { id: 'u1', role: 'admin' } })) }));
vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      if (url.startsWith('/practices')) return { data: { data: [{ id: 'practice-1', name: 'Sunrise Behavioral Health' }, { id: 'practice-2', name: 'Lakeside Counseling' }] } };
      if (url.startsWith('/providers')) {
        const practiceId = new URLSearchParams(url.split('?')[1]).get('practiceId')!;
        return { data: { data: { data: mocks.providersByPractice[practiceId] ?? [] } } };
      }
      if (url.startsWith('/enrollments/payers')) return { data: { data: [{ id: 'payer-1', name: 'Aetna Better Health' }] } };
      return { data: { data: [] } };
    }),
  },
}));
vi.mock('../../utils/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NewTaskModal from './NewTaskModal';

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NewTaskModal isOpen onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('NewTaskModal (guided)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has no free-text title input anywhere; shows the automatic title preview', () => {
    renderModal();
    expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Task title, automatic' })).toBeInTheDocument();
    // the 8 human groups, verbatim
    const groupSelect = screen.getByLabelText('Task group *');
    expect(groupSelect).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'CAQH Update / Re-attestation' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /check-in/i })).not.toBeInTheDocument(); // system-only
  });

  it('requires a task group — validation keeps the modal open', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText("Pick a task group — it's the only required field.")).toBeInTheDocument();
    expect(mocks.createMutate).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'New Task' })).toBeInTheDocument();
  });

  it('submits the guided payload (no title key)', async () => {
    renderModal();
    await userEvent.selectOptions(screen.getByLabelText('Task group *'), 'CALL_BACK');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(mocks.createMutate).toHaveBeenCalled());
    const payload = mocks.createMutate.mock.calls[0][0];
    expect(payload.taskGroup).toBe('CALL_BACK');
    expect(payload.title).toBeUndefined();
  });

  it('cascade rule: changing Practice clears an incompatible Provider and announces it', async () => {
    renderModal();
    await userEvent.selectOptions(screen.getByLabelText('Task group *'), 'CALL_BACK');
    await userEvent.selectOptions(screen.getByLabelText(/practice/i), 'practice-1');
    expect(await screen.findByText('Filtered to providers at the selected practice')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Dana Reyes' })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/provider/i), 'prov-1');
    await userEvent.selectOptions(screen.getByLabelText(/practice/i), 'practice-2');
    await waitFor(() =>
      expect(screen.getByTestId('cascade-announcement')).toHaveTextContent("Provider cleared — Dana Reyes isn't at Lakeside Counseling"));
    expect(screen.getByLabelText(/provider/i)).toHaveValue('');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/NewTaskModal.test.tsx > /tmp/vitest-fe.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1` (v1 modal still has the Title input).

- [ ] **Step 3: Rewrite NewTaskModal.tsx**

Replace the file's contents with the guided version. Keep the exact v1 Transition/Dialog shell (Transition.Root → backdrop Transition.Child → Dialog.Panel `rounded-2xl … sm:max-w-lg`, close X `aria-label="Close"`) — only the form body changes. Full component:

```tsx
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, RadioGroup, Transition } from '@headlessui/react';
import { XMarkIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { composeTaskTitle, HUMAN_TASK_GROUPS, TASK_GROUP_LABELS, type HumanTaskGroup } from '@credential-management/shared';
import { useCreateStaffTask, useAssignees } from '../../hooks/useStaffTasks';
import PayerCombobox, { type PayerOption } from './PayerCombobox';
import AutoTitlePreview from './AutoTitlePreview';
import PayerContactCard from './PayerContactCard';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth.store';
import { notify } from '../../utils/notify';

type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const PRIORITY_LABELS: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

interface ProviderOption { id: string; firstName: string; lastName: string; }
interface PracticeOption { id: string; name: string; }

interface NewTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Guided creation (D1-D7): field order Task Group → Payer (+contact card) →
// Practice → Provider (filtered) → Note, then Priority / Due date / Assign-to
// unchanged from v1. No free-text title exists anywhere; "Other" + Note is the
// escape hatch. v1 behaviors carry over: dirty-close guard, validation keeps
// the modal open.
export default function NewTaskModal({ isOpen, onClose }: NewTaskModalProps) {
  const user = useAuthStore((s) => s.user);
  const createMutation = useCreateStaffTask();
  const { data: assignees } = useAssignees();

  const [taskGroup, setTaskGroup] = useState<HumanTaskGroup | ''>('');
  const [groupError, setGroupError] = useState('');
  const [payer, setPayer] = useState<PayerOption | null>(null);
  const [practiceId, setPracticeId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [note, setNote] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [dueDate, setDueDate] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [cascadeAnnouncement, setCascadeAnnouncement] = useState('');
  const providerLabelRef = useRef('');

  const { data: practiceOptions } = useQuery({
    queryKey: ['staff-tasks', 'practice-options'],
    queryFn: async () => (await api.get('/practices')).data.data as PracticeOption[],
    staleTime: 5 * 60_000,
  });

  // Provider list, filtered to the selected practice when one is chosen.
  // providersLoaded distinguishes "still loading" from "this practice has no
  // providers" — the cascade rule below must only judge settled data.
  const { data: providerOptions = [], isSuccess: providersLoaded } = useQuery({
    queryKey: ['staff-tasks', 'provider-options', practiceId],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: '100' });
      if (practiceId) params.set('practiceId', practiceId);
      const response = await api.get(`/providers?${params.toString()}`);
      return (response.data as { data: { data: ProviderOption[] } }).data.data;
    },
    staleTime: 60_000,
  });

  const practiceName = practiceOptions?.find((p) => p.id === practiceId)?.name;

  const isDirty = !!(taskGroup || payer || practiceId || providerId || note || dueDate || assignedToId || priority !== 'NORMAL');

  // Clean slate on every open (modal stays mounted between opens).
  useEffect(() => {
    if (isOpen) {
      setTaskGroup(''); setGroupError(''); setPayer(null); setPracticeId('');
      setProviderId(''); setNote(''); setPriority('NORMAL'); setDueDate('');
      setAssignedToId(''); setCascadeAnnouncement('');
      providerLabelRef.current = '';
    }
  }, [isOpen]);

  // Cascade rule (3.2.2): changing Practice clears an incompatible Provider
  // selection and announces it — never a silent mutation of an untouched field.
  useEffect(() => {
    if (!providerId || !providersLoaded) return; // judge on settled data only
    if (!providerOptions.some((p) => p.id === providerId)) {
      setProviderId('');
      setCascadeAnnouncement(`Provider cleared — ${providerLabelRef.current} isn't at ${practiceName ?? 'the selected practice'}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerOptions, providersLoaded, practiceName]);

  const guardedClose = () => {
    if (isDirty && !window.confirm('Discard this task?')) return;
    onClose();
  };

  const composedTitle = useMemo(
    () => (taskGroup ? composeTaskTitle(taskGroup, payer?.name, practiceName) : ''),
    [taskGroup, payer, practiceName],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskGroup) {
      setGroupError("Pick a task group — it's the only required field.");
      return; // validation keeps the modal open (v1 behavior)
    }
    createMutation.mutate(
      {
        taskGroup,
        note: note.trim() || undefined,
        priority,
        dueDate: dueDate ? new Date(dueDate + 'T12:00:00Z').toISOString() : undefined,
        assignedToId: assignedToId || undefined,
        payerId: payer?.id || undefined,
        practiceId: practiceId || undefined,
        providerId: providerId || undefined,
      },
      {
        onSuccess: () => {
          // Create-success toast repeats the final title (Accessibility Floor).
          notify.success('Task created', { description: composedTitle });
          onClose();
        },
        onError: (error: any) =>
          notify.error('Could not create the task', {
            description: error?.response?.data?.error?.message ?? 'Try again in a moment.',
          }),
      },
    );
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={guardedClose}>
        <Transition.Child as={Fragment}
          enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child as={Fragment}
              enter="ease-out duration-300" enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95" enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200" leaveFrom="opacity-100 translate-y-0 sm:scale-100" leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95">
              <Dialog.Panel className="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
                <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
                  <div className="mb-4 flex items-center justify-between">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">New Task</Dialog.Title>
                    <button type="button" onClick={guardedClose} className="text-gray-400 hover:text-gray-500" aria-label="Close">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4 text-left">
                    <div>
                      <label htmlFor="task-group" className="label">Task group *</label>
                      <select
                        id="task-group"
                        className="input"
                        value={taskGroup}
                        onChange={(e) => { setTaskGroup(e.target.value as HumanTaskGroup | ''); setGroupError(''); }}
                      >
                        <option value="">Pick a task group…</option>
                        {HUMAN_TASK_GROUPS.map((g) => (
                          <option key={g} value={g}>{TASK_GROUP_LABELS[g]}</option>
                        ))}
                      </select>
                      {groupError && <p className="mt-1 text-xs text-red-600">{groupError}</p>}
                    </div>

                    <div>
                      <label htmlFor="task-payer" className="label">Payer <span className="text-gray-500">· optional</span></label>
                      <PayerCombobox value={payer} onChange={setPayer} />
                      {payer && <div className="mt-2"><PayerContactCard payerId={payer.id} payerName={payer.name} /></div>}
                    </div>

                    <div>
                      <label htmlFor="task-practice" className="label">Practice <span className="text-gray-500">· optional</span></label>
                      <select id="task-practice" className="input" value={practiceId} onChange={(e) => setPracticeId(e.target.value)}>
                        <option value="">None</option>
                        {(practiceOptions ?? []).map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="task-provider" className="label">Provider <span className="text-gray-500">· optional</span></label>
                      <select
                        id="task-provider"
                        className="input"
                        value={providerId}
                        onChange={(e) => {
                          setProviderId(e.target.value);
                          const chosen = providerOptions.find((p) => p.id === e.target.value);
                          providerLabelRef.current = chosen ? `${chosen.firstName} ${chosen.lastName}` : '';
                        }}
                      >
                        <option value="">None</option>
                        {providerOptions.map((p) => (
                          <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                        ))}
                      </select>
                      {practiceId && (
                        <p className="mt-1 text-xs text-gray-500">Filtered to providers at the selected practice</p>
                      )}
                      <div role="status" aria-live="polite" data-testid="cascade-announcement" className="sr-only">
                        {cascadeAnnouncement}
                      </div>
                    </div>

                    <AutoTitlePreview group={taskGroup} payerName={payer?.name} practiceName={practiceName} />

                    <div>
                      <label htmlFor="task-note" className="label">Note <span className="text-gray-500">· optional</span></label>
                      <textarea id="task-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                    </div>

                    <div>
                      <RadioGroup value={priority} onChange={setPriority}>
                        <RadioGroup.Label className="label">Priority</RadioGroup.Label>
                        <div className="flex gap-2">
                          {PRIORITIES.map((p) => (
                            <RadioGroup.Option key={p} value={p} className={({ checked }) => clsx(
                              'flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                              checked ? 'border-primary-200 bg-primary-50 font-semibold text-primary-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                            )}>
                              {({ checked }) => (
                                <>
                                  {/* non-color selected cue (Accessibility Floor) */}
                                  {checked && <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />}
                                  {PRIORITY_LABELS[p]}
                                </>
                              )}
                            </RadioGroup.Option>
                          ))}
                        </div>
                      </RadioGroup>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="task-due-date" className="label">Due Date</label>
                        <input id="task-due-date" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                      </div>
                      <div>
                        <label htmlFor="task-assignee" className="label">Assign To</label>
                        <select id="task-assignee" className="input" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
                          <option value="">Leave in Task Pool</option>
                          {(assignees ?? []).map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.firstName} {a.lastName}{a.id === user?.id ? ' (you)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex justify-end gap-3 border-t pt-4">
                      <button type="button" onClick={guardedClose} className="btn-secondary">Cancel</button>
                      <button type="submit" disabled={createMutation.isPending} className="btn-primary">
                        {createMutation.isPending ? 'Creating…' : 'Create task'}
                      </button>
                    </div>
                  </form>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
```

- [ ] **Step 4: Run the modal tests**

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/NewTaskModal.test.tsx > /tmp/vitest-fe.log 2>&1; echo "exit: $?"; tail -15 /tmp/vitest-fe.log` (timeout 600000)
Expected: `exit: 0`, 4 passed.

- [ ] **Step 5: Update the e2e create section**

In `e2e/tests/tasks.spec.ts`, the v1 lifecycle test's create section fills `Title *` — replace that section (dialog open through `toBeHidden`) with the guided flow; the pool/claim/complete assertions that follow key off the composed title:

```ts
    // Guided create (v2): no title input — pick a group, title composes itself.
    await page.getByRole('button', { name: 'New Task' }).click();
    const dialog = page.getByRole('dialog');
    const dialogHeading = page.getByRole('heading', { name: 'New Task' });
    await expect(dialogHeading).toBeVisible();

    // Create with nothing picked → inline validation, modal stays open.
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByText("Pick a task group — it's the only required field.")).toBeVisible();
    await expect(dialogHeading).toBeVisible();

    // Pick Escalation (no payer/practice → title is just the group label),
    // and add a unique note so this run's task is identifiable.
    await dialog.getByLabel('Task group *').selectOption('ESCALATION');
    await expect(dialog.getByRole('status', { name: 'Task title, automatic' })).toContainText('Escalation');
    await dialog.getByLabel(/note/i).fill(`e2e run ${Date.now()}`);
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(dialogHeading).toBeHidden();
```

Then update the pool-row locator to `const poolRow = page.locator('div.group', { hasText: 'Escalation' }).first();` and the later complete-button name to `Mark complete: Escalation`. Keep every other assertion as-is.

- [ ] **Step 6: Manual verification in the dev app**

`docker compose up -d`, backend + frontend dev servers, log in as `admin@dev.local`:
- `n` opens the modal; no title input; picking Call Back + a payer + a practice live-composes "Call Back — {payer} — {practice}" in the green preview.
- Selecting a payer shows the contact card (empty state locally → invitation copy + form; saving then reopening shows "On file").
- Picking a practice filters the Provider dropdown and shows the hint; switching practice clears an incompatible provider.
- Create with nothing → inline group error, modal stays open. Esc after typing → confirm prompt. Create success toast shows the composed title.

Did it work? If anything renders wrong, paste the console/network error and fix before committing.

- [ ] **Step 7: Frontend typecheck**

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && node ../../node_modules/typescript/bin/tsc --noEmit --incremental > /tmp/tsc-fe.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 0`

- [ ] **Step 8: Commit**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/frontend/src/features/tasks/NewTaskModal.tsx packages/frontend/src/features/tasks/NewTaskModal.test.tsx e2e/tests/tasks.spec.ts
git commit -m "feat(tasks): guided New Task modal — dropdowns only, live title preview, contact card, cascade rules"
```

---

### Task 9: TaskRow + TaskDetailPanel deltas, group filter UI, PR-A wrap-up

**Files:**
- Modify: `packages/frontend/src/features/tasks/TaskRow.tsx` (group pill, tel: link, check-in meta)
- Modify: `packages/frontend/src/features/tasks/TaskDetailPanel.tsx` (contact card mount)
- Modify: `packages/frontend/src/features/tasks/TasksPage.tsx` (group filter select)
- Test: `packages/frontend/src/features/tasks/TasksPage.test.tsx` (extend)

**Interfaces:**
- Consumes: `TaskGroupPill` (Task 6), `PayerContactCard` (Task 7), `StaffTask.taskGroup`/`StaffTask.payer` (Task 6 types), `taskGroup` filter param (Tasks 3/6).
- Produces: rows render `TaskGroupPill` + payer `tel:` link; check-in rows show "{description} · added by Lanyard"; detail panel shows the contact card for payer-linked tasks; TasksPage has a "Group: Any" filter select.

- [ ] **Step 1: Write the failing tests**

In `packages/frontend/src/features/tasks/TasksPage.test.tsx`, extend the `useStaffTasks` mock's task fixture with v2 fields and add assertions. Update the mocked task to:

```tsx
{
  id: 't1', title: 'Follow Up — Aetna Better Health', status: 'IN_PROGRESS', priority: 'URGENT',
  dueDate: '2026-07-12T00:00:00Z', createdAt: '2026-07-10T00:00:00Z',
  taskGroup: 'FOLLOW_UP',
  payer: { id: 'p1', name: 'Aetna Better Health', phone: '(800) 555-0100', contactInfo: { phone: '(800) 555-0142' } },
  assignedTo: { id: 'u1', firstName: 'Kay', lastName: 'Ward' },
}
```

Add tests:

```tsx
  it('renders the group pill and the payer tel link on rows', () => {
    render(<MemoryRouter><TasksPage /></MemoryRouter>);
    expect(screen.getByText('Follow Up')).toBeInTheDocument(); // TaskGroupPill
    const tel = screen.getByRole('link', { name: 'Call Aetna Better Health credentialing, (800) 555-0142' });
    expect(tel).toHaveAttribute('href', 'tel:(800) 555-0142'); // contactInfo.phone wins over the raw Stedi phone
  });

  it('offers a group filter with all nine groups', () => {
    render(<MemoryRouter><TasksPage /></MemoryRouter>);
    const filter = screen.getByLabelText('Filter by group');
    expect(filter).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'CAQH Update / Re-attestation' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Check-in' })).toBeInTheDocument();
  });
```

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/TasksPage.test.tsx > /tmp/vitest-fe.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1`.

- [ ] **Step 2: TaskRow deltas**

In `packages/frontend/src/features/tasks/TaskRow.tsx`:

1. Add imports: `import TaskGroupPill from './TaskGroupPill';`
2. Add a helper above the component:

```tsx
export function payerPhone(task: StaffTask): string | null {
  return task.payer?.contactInfo?.phone ?? task.payer?.phone ?? null;
}
```

3. In the title cell (the `min-w-0` div), replace the record-chip block with a meta row that adds the pill, the tel: link, and the check-in meta:

```tsx
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {task.taskGroup && <TaskGroupPill group={task.taskGroup} />}
          {record ? (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{record}</span>
          ) : (
            <span className="text-[11px] text-gray-500">No linked record</span>
          )}
          {payerPhone(task) && task.payer && (
            // D7: one click to call without opening the task. Full accessible
            // name — activating this places a call.
            <a
              href={`tel:${payerPhone(task)}`}
              aria-label={`Call ${task.payer.name} credentialing, ${payerPhone(task)}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] font-semibold text-primary-700 underline decoration-dashed decoration-primary-700/40 underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {payerPhone(task)}
            </a>
          )}
          {task.taskGroup === 'CHECK_IN' && task.description && (
            <span className="text-[11px] text-gray-500">{task.description} · added by Lanyard</span>
          )}
        </div>
```

(`record` for a check-in task is the practice name chip — keep it; the meta reads e.g. "Lakeside Counseling · No contact in 9 days · added by Lanyard" across the two spans.)

- [ ] **Step 3: TaskDetailPanel delta**

In `packages/frontend/src/features/tasks/TaskDetailPanel.tsx`: add `import PayerContactCard from './PayerContactCard';` and, directly after the Description block (before "Linked record"), add:

```tsx
                    {task.payer && (
                      <div>
                        <h3 className="label">Payer contact</h3>
                        <PayerContactCard payerId={task.payer.id} payerName={task.payer.name} />
                      </div>
                    )}
```

- [ ] **Step 4: TasksPage group filter**

In `packages/frontend/src/features/tasks/TasksPage.tsx`:

1. Add import: `import { TASK_GROUP_LABELS } from '@credential-management/shared';`
2. Add state next to `priority`: `const [taskGroup, setTaskGroup] = useState('');`
3. Pass it through the query: `{ status, priority: priority || undefined, practiceId: practiceId || undefined, taskGroup: taskGroup || undefined }`
4. Reset the focus highlight on change: add `taskGroup` to the `setFocusIndex(-1)` effect deps.
5. Render next to the priority select:

```tsx
        <select value={taskGroup} onChange={(e) => setTaskGroup(e.target.value)} className="input w-56" aria-label="Filter by group">
          <option value="">Group: Any</option>
          {Object.entries(TASK_GROUP_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
```

- [ ] **Step 5: Run the page tests**

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/ > /tmp/vitest-fe.log 2>&1; echo "exit: $?"; tail -15 /tmp/vitest-fe.log` (timeout 600000)
Expected: `exit: 0` (all tasks-feature tests).

- [ ] **Step 6: PR-A full verification sweep** (each its own foreground command, timeout 600000)

- `cd /Users/kaysworld/dev/KAY/packages/backend && node ../../node_modules/typescript/bin/tsc --noEmit > /tmp/tsc-be.log 2>&1; echo "exit: $?"` → `exit: 0`
- `cd /Users/kaysworld/dev/KAY/packages/frontend && node ../../node_modules/typescript/bin/tsc --noEmit > /tmp/tsc-fe.log 2>&1; echo "exit: $?"` → `exit: 0`
- `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/services/staff-task.service.test.ts src/services/task-groups.shared.test.ts src/routes/staff-task.routes.test.ts src/routes/task.routes.test.ts src/routes/payer-contact-info.routes.test.ts src/utils/payer-contact-seed.test.ts > /tmp/vt-be.log 2>&1; echo "exit: $?"` → `exit: 0`
- `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/ > /tmp/vt-fe.log 2>&1; echo "exit: $?"` → `exit: 0`
- e2e (dev servers running): `cd /Users/kaysworld/dev/KAY/e2e && npx playwright test tests/tasks.spec.ts` → pass
- Invoke `superpowers:verification-before-completion` before claiming done.

- [ ] **Step 7: Commit, push, PR (repo root)**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/frontend/src/features/tasks
git commit -m "feat(tasks): row group pills + click-to-call, detail-panel contact card, group filter"
git push -u origin feat/tasks-v2-guided-creation
gh pr create --title "Tasks v2 PR-A: guided creation + payer contact card" --body "Approved plan: ~/.claude/plans/radiant-skipping-pine.md (tasks 1-9). UX contracts: _bmad-output/planning-artifacts/ux-designs/ux-KAY-2026-07-17 (D1-D25, final). Dropdown-driven New Task modal (no typed titles, server-composed via shared composeTaskTitle), payer contact card with click-to-call, task-group pills + filter. Migration: taskGroup/payerId/overdueReason columns + PayerContactInfo (all nullable). Seeding script ships but does NOT run in the migration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 8: Deploy path (after Kay merges)**

1. Merge PR-A branch to `develop` first → staging deploys. Staging migration runs via `DATABASE_URL_ADMIN` (never the runtime role).
2. On staging: `npx tsx scripts/seed-payer-contact-info.ts --dry-run` → review the report with Kay → run live.
3. Kay clicks through guided create on staging (Flow 2: group → payer "aet" → card → practice → create in ~15s).
4. Prod: migration via `DATABASE_URL_ADMIN`; seeding dry-run reviewed then live; verify BOTH Render deploys' live commit SHAs (kay-frontend webhook is a repeat misser — a manual POST deploy is the default step, not the fallback).

---

## PR-B — "Needs review + reasons + check-ins" (Tasks 10–14, branch `feat/tasks-v2-review-checkins`)

Code-only: the schema fully landed in PR-A. Cut the branch from `master` AFTER PR-A merges.

### Task 10: Backend — needs_review view, review-stats, overdue-mine

**Files:**
- Modify: `packages/backend/src/services/staff-task.service.ts`
- Modify: `packages/backend/src/routes/task.routes.ts`
- Test: `packages/backend/src/services/staff-task.service.test.ts` (extend), `packages/backend/src/routes/staff-task.routes.test.ts` (extend)

**Interfaces:**
- Produces (Tasks 12/13 consume):

```ts
// staff-task.service.ts
export interface ListStaffTasksOptions { view: 'my' | 'pool' | 'all' | 'needs_review'; /* rest unchanged */ }
export interface ReviewStats {
  needsReviewCount: number;
  missedLast30: number;
  mostMissedBy: { name: string; count: number } | null;
  slowestPayer: { name: string; count: number } | null;
}
export async function getReviewStats(now?: Date): Promise<ReviewStats>;
export async function listMyOverdueUnanswered(userId: string, now?: Date); // open, past due, overdueReason null; id/title/description/dueDate; dueDate asc
```

- API: `GET /tasks?view=needs_review` (admin ONLY — explicit 403 in the route; open + past due, most-overdue first); `GET /tasks/review-stats` (admin ONLY) → `{ success, data: ReviewStats }`; `GET /tasks/overdue-mine` (staffOnly — every internal user answers for their own tasks) → `{ success, data: OverdueTask[] }`. Both new routes registered BEFORE `GET /tasks/:taskId`.

- [ ] **Step 1: Write the failing service tests**

Append to `staff-task.service.test.ts`:

```ts
describe('listStaffTasks view=needs_review', () => {
  beforeEach(() => vi.clearAllMocks());
  it('filters to open past-due tasks and sorts most-overdue first', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as any);
    prismaMock.task.count.mockResolvedValue(0);
    await listStaffTasks({ view: 'needs_review', userId: USER_ID, limit: 50, offset: 0 });
    const args = prismaMock.task.findMany.mock.calls[0][0];
    expect(args.where.status).toEqual({ in: ['PENDING', 'IN_PROGRESS'] });
    expect(args.where.dueDate.lt).toBeInstanceOf(Date);
    expect(args.orderBy).toEqual({ dueDate: 'asc' }); // most overdue first
  });
});

describe('getReviewStats', () => {
  beforeEach(() => vi.clearAllMocks());
  const NOW = new Date('2026-07-17T12:00:00Z');
  const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

  it('window edges: [now-30d, now); open-past-due and completed-late count, completed-on-time does not', async () => {
    prismaMock.task.count.mockResolvedValue(2); // needsReviewCount
    prismaMock.task.findMany.mockResolvedValue([
      // open past due in window → missed
      { id: 'a', status: 'IN_PROGRESS', dueDate: days(5), completedAt: null,
        assignedTo: { id: 'u-dana', firstName: 'Dana', lastName: 'R' }, payer: { id: 'p-molina', name: 'Molina TX' } },
      // completed late → missed
      { id: 'b', status: 'COMPLETED', dueDate: days(10), completedAt: days(8),
        assignedTo: { id: 'u-dana', firstName: 'Dana', lastName: 'R' }, payer: { id: 'p-molina', name: 'Molina TX' } },
      // completed on time → NOT missed
      { id: 'c', status: 'COMPLETED', dueDate: days(3), completedAt: days(4),
        assignedTo: { id: 'u-marcus', firstName: 'Marcus', lastName: 'T' }, payer: null },
      // SKIPPED (closed by admin) open-state check: not PENDING/IN_PROGRESS and not completed late → NOT missed
      { id: 'd', status: 'SKIPPED', dueDate: days(2), completedAt: null, assignedTo: null, payer: null },
    ] as any);

    const stats = await getReviewStats(NOW);
    expect(stats.needsReviewCount).toBe(2);
    expect(stats.missedLast30).toBe(2);
    expect(stats.mostMissedBy).toEqual({ name: 'Dana R', count: 2 });
    expect(stats.slowestPayer).toEqual({ name: 'Molina TX', count: 2 });
    // the findMany where clause carries the rolling 30-day window (D21)
    const where = prismaMock.task.findMany.mock.calls[0][0].where;
    expect(where.dueDate.gte.getTime()).toBe(NOW.getTime() - 30 * 86_400_000);
    expect(where.dueDate.lt.getTime()).toBe(NOW.getTime());
  });

  it('returns null leaders when nothing missed', async () => {
    prismaMock.task.count.mockResolvedValue(0);
    prismaMock.task.findMany.mockResolvedValue([] as any);
    const stats = await getReviewStats(NOW);
    expect(stats).toEqual({ needsReviewCount: 0, missedLast30: 0, mostMissedBy: null, slowestPayer: null });
  });
});

describe('listMyOverdueUnanswered', () => {
  it('scopes to my open past-due tasks with no reason yet', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as any);
    await listMyOverdueUnanswered(USER_ID, new Date('2026-07-17T12:00:00Z'));
    const args = prismaMock.task.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      assignedToId: USER_ID,
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      overdueReason: null,
    });
    expect(args.where.dueDate.lt).toBeInstanceOf(Date);
    expect(args.orderBy).toEqual({ dueDate: 'asc' });
  });
});
```

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/services/staff-task.service.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1` (new functions/view missing).

- [ ] **Step 2: Implement in the service**

In `staff-task.service.ts`:

1. Widen the view union: `view: 'my' | 'pool' | 'all' | 'needs_review';`
2. In `listStaffTasks`, add a dedicated branch at the top of the function (needs_review skips the in-memory priority sort — its contract is most-overdue-first):

```ts
export async function listStaffTasks(opts: ListStaffTasksOptions) {
  if (opts.view === 'needs_review') {
    const where: Record<string, unknown> = {
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      dueDate: { lt: new Date() },
    };
    if (opts.priority) where['priority'] = opts.priority;
    if (opts.practiceId) where['practiceId'] = opts.practiceId;
    if (opts.taskGroup) where['taskGroup'] = opts.taskGroup;
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where, include: TASK_INCLUDE,
        orderBy: { dueDate: 'asc' }, // most overdue first
        take: opts.limit, skip: opts.offset,
      }),
      prisma.task.count({ where }),
    ]);
    return { tasks, total };
  }
  // ... existing my/pool/all body unchanged ...
}
```

3. Append the two new functions:

```ts
export interface ReviewStats {
  needsReviewCount: number;
  missedLast30: number;
  mostMissedBy: { name: string; count: number } | null;
  slowestPayer: { name: string; count: number } | null;
}

/**
 * Patterns strip + tab badge (D12, D16, D21). "Missed" = dueDate in
 * [now-30d, now) AND (open past due OR completed late). One findMany + JS
 * derivation — Prisma can't compare two columns (completedAt > dueDate) and
 * the volume is tiny (3-person team).
 */
export async function getReviewStats(now: Date = new Date()): Promise<ReviewStats> {
  const windowStart = new Date(now.getTime() - 30 * 86_400_000);
  const [needsReviewCount, windowTasks] = await Promise.all([
    prisma.task.count({ where: { status: { in: ['PENDING', 'IN_PROGRESS'] }, dueDate: { lt: now } } }),
    prisma.task.findMany({
      where: { dueDate: { gte: windowStart, lt: now } },
      select: {
        id: true, status: true, dueDate: true, completedAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        payer: { select: { id: true, name: true } },
      },
    }),
  ]);

  const missed = windowTasks.filter((t) => {
    const openPastDue = t.status === 'PENDING' || t.status === 'IN_PROGRESS';
    const completedLate = t.completedAt != null && t.dueDate != null && t.completedAt.getTime() > t.dueDate.getTime();
    return openPastDue || completedLate;
  });

  const top = (entries: Map<string, { name: string; count: number }>) => {
    let best: { name: string; count: number } | null = null;
    for (const value of entries.values()) if (!best || value.count > best.count) best = value;
    return best;
  };

  const byAssignee = new Map<string, { name: string; count: number }>();
  const byPayer = new Map<string, { name: string; count: number }>();
  for (const t of missed) {
    if (t.assignedTo) {
      const entry = byAssignee.get(t.assignedTo.id) ?? { name: `${t.assignedTo.firstName} ${t.assignedTo.lastName}`, count: 0 };
      entry.count++; byAssignee.set(t.assignedTo.id, entry);
    }
    if (t.payer) {
      const entry = byPayer.get(t.payer.id) ?? { name: t.payer.name, count: 0 };
      entry.count++; byPayer.set(t.payer.id, entry);
    }
  }

  return { needsReviewCount, missedLast30: missed.length, mostMissedBy: top(byAssignee), slowestPayer: top(byPayer) };
}

/** Feeds the prompt-on-arrival dialog (D18): my open overdue tasks with no reason yet. */
export async function listMyOverdueUnanswered(userId: string, now: Date = new Date()) {
  return prisma.task.findMany({
    where: {
      assignedToId: userId,
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      dueDate: { lt: now },
      overdueReason: null,
    },
    select: { id: true, title: true, description: true, dueDate: true },
    orderBy: { dueDate: 'asc' },
  });
}
```

- [ ] **Step 3: Run service tests**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/services/staff-task.service.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 0`.

- [ ] **Step 4: Write the failing route tests**

Append to `staff-task.routes.test.ts` (add `getReviewStats: vi.fn(), listMyOverdueUnanswered: vi.fn(),` to the existing `staff-task.service.js` mock factory):

```ts
describe('admin gates (the recurring role-gate 403 bug class)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('403s lanyard_staff on view=needs_review', async () => {
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).get('/tasks?view=needs_review');
    expect(res.status).toBe(403);
    expect(vi.mocked(staffSvc.listStaffTasks)).not.toHaveBeenCalled();
  });

  it('200s admin on view=needs_review', async () => {
    vi.mocked(staffSvc.listStaffTasks).mockResolvedValue({ tasks: [], total: 0 });
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).get('/tasks?view=needs_review');
    expect(res.status).toBe(200);
  });

  it('403s lanyard_staff on /tasks/review-stats', async () => {
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).get('/tasks/review-stats');
    expect(res.status).toBe(403);
  });

  it('200s admin on /tasks/review-stats', async () => {
    vi.mocked(staffSvc.getReviewStats).mockResolvedValue({ needsReviewCount: 3, missedLast30: 7, mostMissedBy: { name: 'Dana R', count: 4 }, slowestPayer: { name: 'Molina TX', count: 3 } });
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).get('/tasks/review-stats');
    expect(res.status).toBe(200);
    expect(res.body.data.needsReviewCount).toBe(3);
  });
});

describe('GET /tasks/overdue-mine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200s for lanyard_staff (their own dialog feed)', async () => {
    vi.mocked(staffSvc.listMyOverdueUnanswered).mockResolvedValue([{ id: 't1', title: 'Call Back — Aetna Better Health — Sunrise', description: null, dueDate: new Date('2026-07-10') }] as any);
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).get('/tasks/overdue-mine');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('403s practice-side credentialing_staff', async () => {
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'credentialing_staff' });
    const res = await request(app).get('/tasks/overdue-mine');
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 5: Run to verify failure, then implement the routes**

Run the route-test command (as Step 3 but `src/routes/staff-task.routes.test.ts`). Expected: `exit: 1`.

In `task.routes.ts`: extend the service import with `getReviewStats, listMyOverdueUnanswered`; widen the list schema: `view: z.enum(['my', 'pool', 'all', 'needs_review']).default('my'),`; add the admin gate inside the `GET /tasks` handler right after `parse`:

```ts
    // needs_review is admin-only (D16) — explicit route-level gate, the
    // recurring role-gate 403 bug class. lanyard_staff sees My/Pool/All only.
    if (q.view === 'needs_review' && req.user!.role !== 'admin') {
      throw new ForbiddenError('Only Lanyard admins can review missed deadlines');
    }
```

Register the two new routes directly after `GET /tasks/assignees` (BEFORE `GET /tasks/:taskId` — Express matches in order):

```ts
router.get('/tasks/review-stats', authenticate, staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user!.role !== 'admin') {
      throw new ForbiddenError('Only Lanyard admins can review missed deadlines');
    }
    res.json({ success: true, data: await getReviewStats() });
  } catch (error) { next(error); }
});

router.get('/tasks/overdue-mine', authenticate, staffOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listMyOverdueUnanswered(req.user!.id) });
  } catch (error) { next(error); }
});
```

- [ ] **Step 6: Run route tests + regression, typecheck, commit**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/routes/staff-task.routes.test.ts src/routes/task.routes.test.ts src/services/staff-task.service.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` (timeout 600000) → `exit: 0`
Run: `cd /Users/kaysworld/dev/KAY/packages/backend && node ../../node_modules/typescript/bin/tsc --noEmit --incremental > /tmp/tsc.log 2>&1; echo "exit: $?"` (timeout 600000) → `exit: 0`

```bash
cd /Users/kaysworld/dev/KAY
git checkout master && git pull && git checkout -b feat/tasks-v2-review-checkins   # if not already on the branch — PR-B branches from master AFTER PR-A merged
git add packages/backend/src/services/staff-task.service.ts packages/backend/src/services/staff-task.service.test.ts packages/backend/src/routes/task.routes.ts packages/backend/src/routes/staff-task.routes.test.ts
git commit -m "feat(tasks): needs_review view + review-stats (admin-gated) + overdue-mine endpoints"
```

(If the branch was already created at the start of Task 10, skip the checkout line.)

---

### Task 11: Reason writes + future-deadline reset rule

**Files:**
- Modify: `packages/backend/src/routes/task.routes.ts` (PATCH `/tasks/:taskId`, ~L292-421)
- Test: `packages/backend/src/routes/staff-task.routes.test.ts` (extend)

**Interfaces:**
- Produces: `PATCH /tasks/:taskId` accepts `overdueReason: string | null` (assignee-or-admin only → else 403; stamps `overdueReasonAt`); setting a `dueDate` in the future clears `overdueReason` + `overdueReasonAt` (any staff editor — this is how "New deadline" resolves a row and re-arms the dialog).

- [ ] **Step 1: Update the test file's authorize mock, then write the failing tests**

The existing PATCH `/tasks/:taskId` route is gated `authorize('admin', 'credentialing_staff')`; in production `authorize()` auto-admits `lanyard_staff` wherever `credentialing_staff` is listed, but the test file's literal-inclusion mock does NOT — so the assignee tests below (a `lanyard_staff` user) would 403 at the mock, never reaching the handler. Teach the mock the real inheritance (this only ADDS acceptance; existing tests are unaffected). In `staff-task.routes.test.ts`, replace the `authorize` factory inside the `vi.mock('../middleware/auth.middleware.js', ...)` block with:

```ts
  authorize: vi.fn((...allowedRoles: string[]) => (req: any, res: any, next: any) => {
    const role = req.user?.role;
    // Mirror production: lanyard_staff inherits anywhere credentialing_staff is allowed.
    const allowed = allowedRoles.includes(role) || (role === 'lanyard_staff' && allowedRoles.includes('credentialing_staff'));
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: 'Forbidden' } });
    }
    next();
  }),
```

Then append the new tests to `staff-task.routes.test.ts`:

```ts
describe('PATCH /tasks/:taskId — overdue reasons', () => {
  beforeEach(() => vi.clearAllMocks());
  const baseTask = { id: TASK_ID, providerId: null, status: 'IN_PROGRESS', assignedToId: 'staff-user-id', title: 'Call Back — Aetna', overdueReason: null } as any;

  it('assignee sets a reason; overdueReasonAt is stamped', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask);
    prismaMock.task.update.mockResolvedValue({ ...baseTask, overdueReason: 'Payer portal was down all week' } as any);
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' }); // fixture id = 'staff-user-id' = assignee
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ overdueReason: 'Payer portal was down all week' });
    expect(res.status).toBe(200);
    const data = prismaMock.task.update.mock.calls[0][0].data;
    expect(data.overdueReason).toBe('Payer portal was down all week');
    expect(data.overdueReasonAt).toBeInstanceOf(Date);
  });

  it('admin can set a reason on anyone\'s task', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask);
    prismaMock.task.update.mockResolvedValue(baseTask);
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ overdueReason: 'Resolved by email' });
    expect(res.status).toBe(200);
  });

  it('403s a lanyard_staff user who is NOT the assignee', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask, assignedToId: 'someone-else' });
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ overdueReason: 'not my task' });
    expect(res.status).toBe(403);
  });

  it('a FUTURE dueDate clears reason + timestamp (New deadline re-arms the dialog)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask, overdueReason: 'was down' });
    prismaMock.task.update.mockResolvedValue(baseTask);
    const app = createTestApp(taskRoutes, adminUser);
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ dueDate: future });
    expect(res.status).toBe(200);
    const data = prismaMock.task.update.mock.calls[0][0].data;
    expect(data.overdueReason).toBeNull();
    expect(data.overdueReasonAt).toBeNull();
  });

  it('a PAST dueDate does NOT clear the reason', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask, overdueReason: 'was down' });
    prismaMock.task.update.mockResolvedValue(baseTask);
    const app = createTestApp(taskRoutes, adminUser);
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const res = await request(app).patch(`/tasks/${TASK_ID}`).send({ dueDate: past });
    expect(res.status).toBe(200);
    const data = prismaMock.task.update.mock.calls[0][0].data;
    expect(data.overdueReason).toBeUndefined(); // untouched
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/routes/staff-task.routes.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1` (schema rejects `overdueReason`; no clearing logic).

- [ ] **Step 3: Implement in the PATCH handler**

In `task.routes.ts`:

1. Extend `updateTaskSchema` with: `overdueReason: z.string().trim().min(1).max(500).nullable().optional(),`
2. In the PATCH handler, after the existing `existing` fetch + access checks and before "Build update data", add:

```ts
      // Overdue reasons (D18): only the task's assignee or an admin may write
      // one. lanyard_staff can never answer for a teammate.
      if ('overdueReason' in req.body) {
        const isAssignee = existing.assignedToId != null && existing.assignedToId === req.user!.id;
        if (req.user!.role !== 'admin' && !isAssignee) {
          throw new ForbiddenError('Only the assignee or an admin can add an overdue reason');
        }
      }
```

3. In the "Build update data" block add:

```ts
      if (validated.overdueReason !== undefined) {
        updateData['overdueReason'] = validated.overdueReason;
        updateData['overdueReasonAt'] = validated.overdueReason === null ? null : new Date();
      }
      // "New deadline" resolves the row and re-arms the dialog: a future due
      // date clears the reason pair (explicit reason writes above still win —
      // both keys in one request is not a supported UI path).
      if (validated.dueDate !== undefined && validated.dueDate && new Date(validated.dueDate).getTime() > Date.now() && !('overdueReason' in req.body)) {
        updateData['overdueReason'] = null;
        updateData['overdueReasonAt'] = null;
      }
```

- [ ] **Step 4: Run tests + regression + typecheck**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/routes/staff-task.routes.test.ts src/routes/task.routes.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` (timeout 600000) → `exit: 0`
Run: `cd /Users/kaysworld/dev/KAY/packages/backend && node ../../node_modules/typescript/bin/tsc --noEmit --incremental > /tmp/tsc.log 2>&1; echo "exit: $?"` (timeout 600000) → `exit: 0`

- [ ] **Step 5: Commit**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/backend/src/routes/task.routes.ts packages/backend/src/routes/staff-task.routes.test.ts
git commit -m "feat(tasks): overdue reason writes (assignee-or-admin) + future-deadline reset rule"
```

---

### Task 12: NeedsReviewTab + admin-only 4th tab

**Files:**
- Create: `packages/frontend/src/features/tasks/NeedsReviewTab.tsx`
- Modify: `packages/frontend/src/hooks/useStaffTasks.ts` (view union + `useReviewStats`)
- Modify: `packages/frontend/src/features/tasks/TasksPage.tsx` (role-conditional 4th tab + badge)
- Test: `packages/frontend/src/features/tasks/NeedsReviewTab.test.tsx`, `packages/frontend/src/features/tasks/TasksPage.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 10 endpoints; `TaskGroupPill`; `useUpdateStaffTask`, `useAssignees` (v1); `useAuthStore`.
- Produces (Task 13 shares the hook file):

```ts
// useStaffTasks.ts
export function useStaffTasks(view: 'my' | 'pool' | 'all' | 'needs_review', filters?, limit?);
export interface ReviewStats { needsReviewCount: number; missedLast30: number; mostMissedBy: { name: string; count: number } | null; slowestPayer: { name: string; count: number } | null; }
export function useReviewStats(enabled: boolean); // admin-gated — callers pass role === 'admin'; key ['staff-tasks','review-stats'], polls 60s
// NeedsReviewTab.tsx
export default function NeedsReviewTab(props: { onOpenDetail: (task: StaffTask) => void }): JSX.Element;
```

- [ ] **Step 1: Extend the hooks**

In `useStaffTasks.ts`: widen the `useStaffTasks` view parameter to `'my' | 'pool' | 'all' | 'needs_review'` and append:

```ts
export interface ReviewStats {
  needsReviewCount: number;
  missedLast30: number;
  mostMissedBy: { name: string; count: number } | null;
  slowestPayer: { name: string; count: number } | null;
}

export function useReviewStats(enabled: boolean) {
  return useQuery({
    queryKey: ['staff-tasks', 'review-stats'],
    queryFn: async () => (await api.get('/tasks/review-stats')).data.data as ReviewStats,
    enabled, // admin only — the endpoint 403s everyone else (fail closed)
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/frontend/src/features/tasks/NeedsReviewTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ updateMutate: vi.fn() }));
vi.mock('../../hooks/useStaffTasks', () => ({
  useStaffTasks: vi.fn(() => ({
    data: {
      data: [
        { id: 't1', title: 'Follow Up — Molina Healthcare of Texas', status: 'IN_PROGRESS', priority: 'NORMAL',
          taskGroup: 'FOLLOW_UP', dueDate: new Date(Date.now() - 5 * 86_400_000).toISOString(), createdAt: '2026-07-01T00:00:00Z',
          assignedTo: { id: 'u2', firstName: 'Dana', lastName: 'Reyes' },
          overdueReason: 'Payer portal was down all week' },
        { id: 't2', title: 'Call Back — Aetna Better Health', status: 'PENDING', priority: 'NORMAL',
          taskGroup: 'CALL_BACK', dueDate: new Date(Date.now() - 2 * 86_400_000).toISOString(), createdAt: '2026-07-01T00:00:00Z',
          assignedTo: { id: 'u3', firstName: 'Marcus', lastName: 'Tate' },
          overdueReason: null },
      ],
      meta: { total: 2 },
    },
    isLoading: false, isError: false, refetch: vi.fn(),
  })),
  useReviewStats: vi.fn(() => ({ data: { needsReviewCount: 2, missedLast30: 7, mostMissedBy: { name: 'Dana Reyes', count: 4 }, slowestPayer: { name: 'Molina TX', count: 3 } } })),
  useUpdateStaffTask: vi.fn(() => ({ mutate: mocks.updateMutate, isPending: false })),
  useAssignees: vi.fn(() => ({ data: [{ id: 'u2', firstName: 'Dana', lastName: 'Reyes', role: 'lanyard_staff' }] })),
}));
vi.mock('../../utils/notify', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

import NeedsReviewTab from './NeedsReviewTab';

describe('NeedsReviewTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the patterns strip with full programmatic names', () => {
    render(<MemoryRouter><NeedsReviewTab onOpenDetail={vi.fn()} /></MemoryRouter>);
    expect(screen.getByLabelText('Missed: 7 tasks in the last 30 days')).toBeInTheDocument();
    expect(screen.getByLabelText('Most missed by: Dana Reyes, 4 missed tasks in the last 30 days')).toBeInTheDocument();
    expect(screen.getByLabelText('Slowest payer: Molina TX, 3 missed tasks in the last 30 days')).toBeInTheDocument();
  });

  it('shows the reason chip, and the full-opacity Awaiting reason pending variant', () => {
    render(<MemoryRouter><NeedsReviewTab onOpenDetail={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('Reason: "Payer portal was down all week"')).toBeInTheDocument();
    expect(screen.getByText('Awaiting reason…')).toBeInTheDocument();
  });

  it('row actions carry the task identity in their accessible names; Close = SKIPPED', async () => {
    render(<MemoryRouter><NeedsReviewTab onOpenDetail={vi.fn()} /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Close — Follow Up — Molina Healthcare of Texas' }));
    expect(mocks.updateMutate).toHaveBeenCalledWith(
      { taskId: 't1', data: { status: 'SKIPPED' } },
      expect.anything(),
    );
    expect(screen.getByRole('button', { name: 'New deadline — Call Back — Aetna Better Health' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reassign — Call Back — Aetna Better Health' })).toBeInTheDocument();
  });
});
```

In `TasksPage.test.tsx`, add an auth-store mock above the existing hook mock and import the mocked symbol so `vi.mocked(...)` can retarget it per test:

```tsx
vi.mock('../../stores/auth.store', () => ({
  useAuthStore: vi.fn((sel: any) => sel({ user: { id: 'u1', role: 'admin' } })),
}));
import { useAuthStore } from '../../stores/auth.store';
```

Extend the `useStaffTasks` hook mock factory with `useReviewStats: vi.fn(() => ({ data: { needsReviewCount: 3, missedLast30: 0, mostMissedBy: null, slowestPayer: null } }))` and `useMyOverdueUnanswered: vi.fn(() => ({ data: [], isSuccess: true, isError: false }))` (Task 13 retargets the latter), and add `import { useMyOverdueUnanswered } from '../../hooks/useStaffTasks';` next to the existing hook imports. Then add two tests:

```tsx
  it('admin sees the Needs review tab with its count in the accessible name', () => {
    render(<MemoryRouter><TasksPage /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: 'Needs review, 3 tasks' })).toBeInTheDocument();
  });

  it('the tab does not render for lanyard_staff (no "admin only" text ships)', () => {
    vi.mocked(useAuthStore).mockImplementation((sel: any) => sel({ user: { id: 'u9', role: 'lanyard_staff' } }));
    render(<MemoryRouter><TasksPage /></MemoryRouter>);
    expect(screen.queryByRole('tab', { name: /needs review/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/admin only/i)).not.toBeInTheDocument();
  });
```

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/NeedsReviewTab.test.tsx src/features/tasks/TasksPage.test.tsx > /tmp/vitest-fe.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1`.

- [ ] **Step 3: Implement NeedsReviewTab.tsx**

```tsx
import { useState } from 'react';
import { useStaffTasks, useReviewStats, useUpdateStaffTask, useAssignees, type StaffTask } from '../../hooks/useStaffTasks';
import TaskGroupPill from './TaskGroupPill';
import EmptyState from '../../components/ui/EmptyState';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import { notify } from '../../utils/notify';

function daysOverdue(dueDate: string): number {
  return Math.max(1, Math.ceil((Date.now() - new Date(dueDate).getTime()) / 86_400_000));
}

// Admin-only Needs review tab (D12, D16, D21, D22): patterns strip + every
// overdue task with its reason and three always-live actions. "Awaiting
// reason" is informational, never blocking. Actions resolve the row out of
// the tab (New deadline clears the reason server-side; Close = SKIPPED).
export default function NeedsReviewTab({ onOpenDetail }: { onOpenDetail: (task: StaffTask) => void }) {
  const { data, isLoading, isError, refetch } = useStaffTasks('needs_review', { status: 'open' });
  const { data: stats } = useReviewStats(true); // this component only renders for admins
  const updateMutation = useUpdateStaffTask();
  const { data: assignees } = useAssignees();
  const [deadlineFor, setDeadlineFor] = useState<string | null>(null);
  const [deadlineValue, setDeadlineValue] = useState('');
  const [reassignFor, setReassignFor] = useState<string | null>(null);

  const tasks: StaffTask[] = data?.data ?? [];

  const act = (taskId: string, patch: Record<string, unknown>) =>
    updateMutation.mutate(
      { taskId, data: patch },
      { onError: () => notify.error("Couldn't save that change", { description: 'The row is unchanged — try again in a moment.' }) },
    );

  const statCards = [
    { label: 'Missed · last 30 days', value: String(stats?.missedLast30 ?? '—'), sr: `Missed: ${stats?.missedLast30 ?? 0} tasks in the last 30 days` },
    { label: 'Most missed by', value: stats?.mostMissedBy ? `${stats.mostMissedBy.name} (${stats.mostMissedBy.count})` : '—', sr: stats?.mostMissedBy ? `Most missed by: ${stats.mostMissedBy.name}, ${stats.mostMissedBy.count} missed tasks in the last 30 days` : 'Most missed by: no one yet' },
    { label: 'Slowest payer', value: stats?.slowestPayer ? `${stats.slowestPayer.name} (${stats.slowestPayer.count})` : '—', sr: stats?.slowestPayer ? `Slowest payer: ${stats.slowestPayer.name}, ${stats.slowestPayer.count} missed tasks in the last 30 days` : 'Slowest payer: none yet' },
  ];

  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Missed-deadline patterns">
        {statCards.map((card) => (
          <li key={card.label} aria-label={card.sr} className="rounded-xl border border-gray-200/80 bg-[#fcfcfd] px-3 py-2.5">
            <p aria-hidden="true" className="text-[11px] text-gray-500">{card.label}</p>
            <p aria-hidden="true" className="text-[15px] font-semibold text-gray-900">{card.value}</p>
          </li>
        ))}
      </ul>

      <div className="card divide-y divide-gray-100">
        {isLoading ? (
          <LoadingState label="Loading overdue tasks…" />
        ) : isError ? (
          <ErrorState title="Couldn't load the review list" message="Something went wrong on our end." onRetry={refetch} />
        ) : tasks.length === 0 ? (
          <EmptyState illustration="clipboard" title="Nothing needs review" description="Nothing needs review — every task met its deadline." />
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="space-y-1.5 px-4 py-3 max-md:space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {task.taskGroup && <TaskGroupPill group={task.taskGroup} />}
                <button type="button" onClick={() => onOpenDetail(task)}
                  className="text-left text-sm font-medium text-gray-900 hover:text-primary-700 hover:underline underline-offset-2">
                  {task.title}
                </button>
                {task.dueDate && (
                  <span className="text-xs font-semibold text-red-600">
                    {daysOverdue(task.dueDate)} days overdue · {task.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}` : 'Unassigned'}
                  </span>
                )}
              </div>

              {/* Reason chip — wraps, never truncates; pending variant at FULL opacity */}
              {task.overdueReason ? (
                <p className="w-fit max-w-full whitespace-normal rounded-2xl bg-amber-50 px-2.5 py-1 text-[12.5px] font-medium text-amber-800 ring-1 ring-inset ring-amber-700/15">
                  Reason: &quot;{task.overdueReason}&quot;
                </p>
              ) : (
                <p className="w-fit rounded-2xl bg-amber-50 px-2.5 py-1 text-[12.5px] font-medium italic text-amber-800 ring-1 ring-inset ring-amber-700/15">
                  Awaiting reason…
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button type="button" aria-label={`New deadline — ${task.title}`}
                  onClick={() => { setDeadlineFor(deadlineFor === task.id ? null : task.id); setDeadlineValue(''); setReassignFor(null); }}
                  className="rounded-lg border border-primary-200 bg-white px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50">
                  New deadline
                </button>
                <button type="button" aria-label={`Reassign — ${task.title}`}
                  onClick={() => { setReassignFor(reassignFor === task.id ? null : task.id); setDeadlineFor(null); }}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  Reassign
                </button>
                <button type="button" aria-label={`Close — ${task.title}`}
                  onClick={() => act(task.id, { status: 'SKIPPED' })}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  Close
                </button>
              </div>

              {deadlineFor === task.id && (
                <div className="flex items-center gap-2 pt-1">
                  <label htmlFor={`deadline-${task.id}`} className="text-xs text-gray-600">New due date</label>
                  <input id={`deadline-${task.id}`} type="date" className="input w-40" value={deadlineValue}
                    onChange={(e) => setDeadlineValue(e.target.value)} />
                  <button type="button" disabled={!deadlineValue}
                    onClick={() => { act(task.id, { dueDate: new Date(deadlineValue + 'T12:00:00Z').toISOString() }); setDeadlineFor(null); }}
                    className="btn-primary px-3 py-1 text-xs disabled:opacity-50">
                    Save
                  </button>
                </div>
              )}

              {reassignFor === task.id && (
                <div className="flex items-center gap-2 pt-1">
                  <label htmlFor={`reassign-${task.id}`} className="text-xs text-gray-600">Assign to</label>
                  <select id={`reassign-${task.id}`} className="input w-48" defaultValue=""
                    onChange={(e) => { if (e.target.value) { act(task.id, { assignedToId: e.target.value }); setReassignFor(null); } }}>
                    <option value="" disabled>Pick a teammate…</option>
                    {(assignees ?? []).map((a) => (
                      <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the 4th tab into TasksPage**

In `TasksPage.tsx`:

1. Imports: `import NeedsReviewTab from './NeedsReviewTab';`, `import { useAuthStore } from '../../stores/auth.store';`, and add `useReviewStats` to the hook import.
2. Role-conditional views (replace the direct `VIEWS` usage):

```tsx
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const views = isAdmin ? [...VIEWS, { key: 'needs_review' as const, label: 'Needs review' }] : VIEWS;
  const { data: reviewStats } = useReviewStats(isAdmin);
  const view = views[tabIndex].key;
```

3. In the Tab.List, render from `views` and give the Needs review tab its count + badge:

```tsx
          {views.map((v) => (
            <Tab
              key={v.key}
              aria-label={v.key === 'needs_review' ? `Needs review, ${reviewStats?.needsReviewCount ?? 0} tasks` : undefined}
              className={({ selected }) => clsx(
                'flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium outline-none transition-colors',
                selected ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
              )}
            >
              {v.label}
              {v.key === 'needs_review' && (reviewStats?.needsReviewCount ?? 0) > 0 && (
                <span className="inline-flex items-center rounded-full bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                  {reviewStats!.needsReviewCount}
                </span>
              )}
            </Tab>
          ))}
```

4. Gate the list body: wrap the existing filters + card block so `view === 'needs_review'` renders `<NeedsReviewTab onOpenDetail={setSelectedTask} />` instead (filters row and bulk bar hidden on that tab; the useStaffTasks list query for the standard tabs should pass `view === 'needs_review' ? 'all' : view` or simply keep using `view` — the query is unused on that tab, so guard with `view !== 'needs_review'` when rendering only; the hook call itself is fine since admins pass the 403 gate).

- [ ] **Step 5: Run tests, typecheck, commit**

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/NeedsReviewTab.test.tsx src/features/tasks/TasksPage.test.tsx > /tmp/vitest-fe.log 2>&1; echo "exit: $?"; tail -10 /tmp/vitest-fe.log` (timeout 600000) → `exit: 0`
Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && node ../../node_modules/typescript/bin/tsc --noEmit --incremental > /tmp/tsc-fe.log 2>&1; echo "exit: $?"` (timeout 600000) → `exit: 0`

```bash
cd /Users/kaysworld/dev/KAY
git add packages/frontend/src/features/tasks/NeedsReviewTab.tsx packages/frontend/src/features/tasks/NeedsReviewTab.test.tsx packages/frontend/src/features/tasks/TasksPage.tsx packages/frontend/src/features/tasks/TasksPage.test.tsx packages/frontend/src/hooks/useStaffTasks.ts
git commit -m "feat(tasks): admin Needs review tab — patterns strip, reason chips, three always-live actions"
```

---

### Task 13: OverdueReasonDialog + arrival wiring + shortcut guard

**Files:**
- Create: `packages/frontend/src/features/tasks/OverdueReasonDialog.tsx`
- Modify: `packages/frontend/src/hooks/useStaffTasks.ts` (`useMyOverdueUnanswered`)
- Modify: `packages/frontend/src/features/tasks/TasksPage.tsx` (arrival wiring, shortcut-guard extension, shortcuts-off toggle)
- Test: `packages/frontend/src/features/tasks/OverdueReasonDialog.test.tsx`, `packages/frontend/src/features/tasks/TasksPage.test.tsx` (extend)

**Interfaces:**
- Consumes: `GET /tasks/overdue-mine` (Task 10), `PATCH` reason writes (Task 11), `useUpdateStaffTask`.
- Produces:

```ts
// useStaffTasks.ts
export interface OverdueTaskItem { id: string; title: string; description?: string | null; dueDate: string; }
export function useMyOverdueUnanswered(); // key ['staff-tasks','overdue-mine'] — invalidated by every task mutation
// OverdueReasonDialog.tsx
export const QUICK_REASONS: readonly ['Payer hasn\'t responded', 'Portal was down', 'Ran out of time', 'Waiting on documents'];
export default function OverdueReasonDialog(props: { tasks: OverdueTaskItem[]; onClose: (outcome: 'saved' | 'deferred') => void }): JSX.Element;
```

- [ ] **Step 1: Add the hook**

Append to `useStaffTasks.ts`:

```ts
export interface OverdueTaskItem {
  id: string;
  title: string;
  description?: string | null;
  dueDate: string;
}

export function useMyOverdueUnanswered() {
  return useQuery({
    queryKey: ['staff-tasks', 'overdue-mine'],
    queryFn: async () => (await api.get('/tasks/overdue-mine')).data.data as OverdueTaskItem[],
  });
}
```

- [ ] **Step 2: Write the failing dialog tests**

Create `packages/frontend/src/features/tasks/OverdueReasonDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('../../hooks/useStaffTasks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUpdateStaffTask: vi.fn(() => ({ mutateAsync: mocks.mutateAsync, isPending: false })),
}));

import OverdueReasonDialog from './OverdueReasonDialog';

const TASKS = [
  { id: 't1', title: 'Call Back — Aetna Better Health — Sunrise', description: 'Rep asked for Thursday', dueDate: new Date(Date.now() - 3 * 86_400_000).toISOString() },
  { id: 't2', title: 'Follow Up — Molina Healthcare of Texas', description: null, dueDate: new Date(Date.now() - 86_400_000).toISOString() },
];

describe('OverdueReasonDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the contract: heading, subhead, chips, per-task labeled inputs, both footer buttons', () => {
    render(<OverdueReasonDialog tasks={TASKS} onClose={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Before you dive in — 2 tasks missed their deadlines')).toBeInTheDocument();
    expect(screen.getByText("A quick reason for each helps Kay review them. You can defer, but it'll ask again next time.")).toBeInTheDocument();
    expect(screen.getAllByText("Payer hasn't responded")).toHaveLength(2); // chips per task
    expect(screen.getByRole('textbox', { name: 'What got in the way? — Call Back — Aetna Better Health — Sunrise' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save reasons' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I'll answer later" })).toBeInTheDocument();
  });

  it('singular heading for one task', () => {
    render(<OverdueReasonDialog tasks={[TASKS[0]]} onClose={vi.fn()} />);
    expect(screen.getByText('Before you dive in — 1 task missed its deadline')).toBeInTheDocument();
  });

  it('a chip fills the field, which stays editable', async () => {
    render(<OverdueReasonDialog tasks={[TASKS[0]]} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Waiting on documents' }));
    const input = screen.getByRole('textbox', { name: /Call Back/ });
    expect(input).toHaveValue('Waiting on documents');
    await userEvent.type(input, ' — chased Friday');
    expect(input).toHaveValue('Waiting on documents — chased Friday');
  });

  it('empty fields block submit with inline errors and an announced count — dialog stays open', async () => {
    const onClose = vi.fn();
    render(<OverdueReasonDialog tasks={TASKS} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save reasons' }));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getAllByText('Add a one-line reason')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: /Call Back/ })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('dialog-announcer')).toHaveTextContent('2 reasons still needed');
  });

  it('a failed save shows the inline retry error, keeps the text, and never blocks the buttons (D24)', async () => {
    mocks.mutateAsync
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({});
    const onClose = vi.fn();
    render(<OverdueReasonDialog tasks={TASKS} onClose={onClose} />);
    await userEvent.type(screen.getByRole('textbox', { name: /Call Back/ }), 'Payer went dark');
    await userEvent.type(screen.getByRole('textbox', { name: /Follow Up/ }), 'Ran out of time');
    await userEvent.click(screen.getByRole('button', { name: 'Save reasons' }));
    await waitFor(() =>
      expect(screen.getByText('Couldn\'t save this reason — check your connection and try again. Your text is kept.')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled(); // one failure → stays open for retry
    expect(screen.getByRole('textbox', { name: /Call Back/ })).toHaveValue('Payer went dark'); // text kept
    expect(screen.getByRole('button', { name: "I'll answer later" })).toBeEnabled(); // deferral always usable
  });

  it('Esc performs the same deferral as the button', async () => {
    const onClose = vi.fn();
    render(<OverdueReasonDialog tasks={TASKS} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith('deferred');
  });
});
```

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/OverdueReasonDialog.test.tsx > /tmp/vitest-fe.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1` (module not found).

- [ ] **Step 3: Implement OverdueReasonDialog.tsx**

```tsx
import { Fragment, useRef, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import clsx from 'clsx';
import { useUpdateStaffTask, type OverdueTaskItem } from '../../hooks/useStaffTasks';

export const QUICK_REASONS = [
  "Payer hasn't responded",
  'Portal was down',
  'Ran out of time',
  'Waiting on documents',
] as const;

interface OverdueReasonDialogProps {
  tasks: OverdueTaskItem[];
  onClose: (outcome: 'saved' | 'deferred') => void;
}

function daysOverdue(dueDate: string): number {
  return Math.max(1, Math.ceil((Date.now() - new Date(dueDate).getTime()) / 86_400_000));
}

// Prompt-on-arrival reason dialog (D18, D24). Deferrable, never a trap: Esc,
// backdrop, and the visible "I'll answer later" button are the SAME deferral;
// a failed save can never block passage; every button stays usable always.
export default function OverdueReasonDialog({ tasks, onClose }: OverdueReasonDialogProps) {
  const updateMutation = useUpdateStaffTask();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, boolean>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, boolean>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [saving, setSaving] = useState(false);

  const n = tasks.length;
  const heading = n === 1
    ? 'Before you dive in — 1 task missed its deadline'
    : `Before you dive in — ${n} tasks missed their deadlines`;

  const setDraft = (taskId: string, value: string) => {
    setDrafts((d) => ({ ...d, [taskId]: value }));
    setValidationErrors((e) => ({ ...e, [taskId]: false }));
  };

  const handleSave = async () => {
    const pending = tasks.filter((t) => !savedIds.has(t.id));
    const missing = pending.filter((t) => !(drafts[t.id] ?? '').trim());
    if (missing.length > 0) {
      setValidationErrors(Object.fromEntries(missing.map((t) => [t.id, true])));
      setAnnouncement(`${missing.length} reason${missing.length === 1 ? '' : 's'} still needed`);
      document.getElementById(`reason-${missing[0]!.id}`)?.focus();
      return;
    }
    setSaving(true);
    const results = await Promise.allSettled(
      pending.map((t) => updateMutation.mutateAsync({ taskId: t.id, data: { overdueReason: drafts[t.id]!.trim() } })),
    );
    setSaving(false);
    const failed = pending.filter((_t, i) => results[i]!.status === 'rejected');
    const succeeded = pending.filter((_t, i) => results[i]!.status === 'fulfilled');
    if (succeeded.length > 0) setSavedIds((s) => new Set([...s, ...succeeded.map((t) => t.id)]));
    if (failed.length === 0) {
      onClose('saved');
      return;
    }
    // Per-field inline errors; entered text retained; retry available (D24).
    setSaveErrors(Object.fromEntries(failed.map((t) => [t.id, true])));
    setAnnouncement(`${failed.length} reason${failed.length === 1 ? '' : 's'} couldn't be saved — your text is kept, try again`);
  };

  return (
    <Transition.Root show as={Fragment}>
      {/* role=alertdialog per the Accessibility Floor; Esc/backdrop hit
          Dialog onClose → the SAME deferral as the footer button. No ✕ glyph. */}
      <Dialog
        as="div"
        role="alertdialog"
        aria-labelledby="reason-dialog-heading"
        aria-describedby="reason-dialog-desc"
        className="relative z-50"
        initialFocus={headingRef}
        onClose={() => onClose('deferred')}
      >
        <Transition.Child as={Fragment}
          enter="ease-out duration-200 motion-reduce:duration-0" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150 motion-reduce:duration-0" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            {/* No transform animation — the auto-firing dialog appears without motion (reduced-motion rule). */}
            <Dialog.Panel className="w-full max-w-xl rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_32px_rgba(17,24,39,.08)]">
              <div className="border-b border-gray-100 px-5 py-4">
                <h2 id="reason-dialog-heading" ref={headingRef} tabIndex={-1} className="text-[15px] font-semibold text-gray-900 outline-none">
                  {heading}
                </h2>
                <p id="reason-dialog-desc" className="mt-1 text-sm text-gray-600">
                  A quick reason for each helps Kay review them. You can defer, but it&apos;ll ask again next time.
                </p>
              </div>

              <div role="status" aria-live="polite" data-testid="dialog-announcer" className="sr-only">{announcement}</div>

              <div className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto px-5">
                {tasks.map((task) => (
                  <div key={task.id} className="py-4">
                    <p className="text-[13.5px] font-semibold text-gray-900">{task.title}</p>
                    <p className="mt-0.5 text-[13px] text-gray-500">
                      Due {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {daysOverdue(task.dueDate)} day{daysOverdue(task.dueDate) === 1 ? '' : 's'} overdue
                      {task.description ? ` · ${task.description}` : ''}
                    </p>
                    {savedIds.has(task.id) ? (
                      <p className="mt-2 text-xs font-semibold text-primary-700">Saved</p>
                    ) : (
                      <>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {QUICK_REASONS.map((reason) => (
                            <button key={reason} type="button" onClick={() => setDraft(task.id, reason)}
                              className={clsx(
                                'rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                                (drafts[task.id] ?? '') === reason
                                  ? 'border-primary-200 bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-700/20'
                                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                              )}>
                              {reason}
                            </button>
                          ))}
                        </div>
                        <label htmlFor={`reason-${task.id}`} className="mt-2 block text-sm font-medium text-gray-600">
                          What got in the way? One line is plenty.
                        </label>
                        <input
                          id={`reason-${task.id}`}
                          aria-label={`What got in the way? — ${task.title}`}
                          aria-invalid={validationErrors[task.id] ? 'true' : undefined}
                          aria-describedby={validationErrors[task.id] || saveErrors[task.id] ? `reason-error-${task.id}` : undefined}
                          className="input mt-1"
                          value={drafts[task.id] ?? ''}
                          onChange={(e) => setDraft(task.id, e.target.value)}
                        />
                        {validationErrors[task.id] && (
                          <p id={`reason-error-${task.id}`} className="mt-1 text-[12.5px] text-red-600">Add a one-line reason</p>
                        )}
                        {saveErrors[task.id] && !validationErrors[task.id] && (
                          <p id={`reason-error-${task.id}`} className="mt-1 text-[12.5px] text-red-600">
                            Couldn&apos;t save this reason — check your connection and try again. Your text is kept.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-5 py-4">
                {/* Both buttons always enabled — errors never disable anything (D24). */}
                <button type="button" onClick={() => onClose('deferred')} className="btn-secondary">
                  I&apos;ll answer later
                </button>
                <button type="button" onClick={handleSave} className="btn-primary">
                  {saving ? 'Saving…' : 'Save reasons'}
                </button>
              </div>
            </Dialog.Panel>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
```

- [ ] **Step 4: Run the dialog tests**

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/OverdueReasonDialog.test.tsx > /tmp/vitest-fe.log 2>&1; echo "exit: $?"; tail -10 /tmp/vitest-fe.log` (timeout 600000)
Expected: `exit: 0`, 6 passed.

- [ ] **Step 5: Wire the arrival flow into TasksPage**

In `TasksPage.tsx`:

1. Imports: `import OverdueReasonDialog from './OverdueReasonDialog';` and add `useMyOverdueUnanswered` to the hook import.
2. State + wiring (next to the deep-link block):

```tsx
  // Prompt-on-arrival reason dialog (D18, D24). Mounts only AFTER the overdue
  // query resolves; if it errors the dialog simply doesn't fire — fail open,
  // never fail locked. reasonDialogClosed is mount-scoped state, so the dialog
  // re-arms on every Tasks-page arrival by construction. Deep link wins.
  const overdueQuery = useMyOverdueUnanswered();
  const [reasonDialogClosed, setReasonDialogClosed] = useState(false);
  const [srMessage, setSrMessage] = useState('');
  const overdueTasks = overdueQuery.data ?? [];
  const isReasonDialogOpen = overdueQuery.isSuccess && overdueTasks.length > 0 && !reasonDialogClosed && !deepLinkId;

  const handleReasonDialogClose = (outcome: 'saved' | 'deferred') => {
    setReasonDialogClosed(true);
    setSrMessage(outcome === 'saved' ? 'Reasons saved — thanks' : "Okay — we'll ask again next time you're here.");
    headingRef.current?.focus(); // no trigger to return focus to → the page's main heading
  };
```

3. Give the `<h1>` a ref + `tabIndex={-1}`: `const headingRef = useRef<HTMLHeadingElement>(null);` … `<h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-gray-900 outline-none">Tasks</h1>`
4. Render, next to the other overlays: `{isReasonDialogOpen && <OverdueReasonDialog tasks={overdueTasks} onClose={handleReasonDialogClose} />}` and the announcement region `<div role="status" aria-live="polite" className="sr-only">{srMessage}</div>`.
5. **Shortcut guard (WCAG 2.1.4)** — extend the ONE existing early-return in the keydown handler (do not add a second guard path) and add the user-level off switch:

```tsx
  const [shortcutsOff, setShortcutsOff] = useState(() => localStorage.getItem('tasks-shortcuts-off') === '1');
  const toggleShortcuts = () => setShortcutsOff((v) => {
    const next = !v;
    localStorage.setItem('tasks-shortcuts-off', next ? '1' : '0');
    return next;
  });
```

In the handler, the single guard condition becomes:

```tsx
      if (
        shortcutsOff ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable ||
        isNewTaskOpen ||
        selectedTask ||
        isReasonDialogOpen
      ) {
        return;
      }
```

(add `shortcutsOff` and `isReasonDialogOpen` to the effect deps). Replace the hint line with:

```tsx
      <p className="text-center text-xs text-gray-500">
        {shortcutsOff ? 'Keyboard shortcuts are off' : 'j/k move · e complete · c claim · n new task'}
        {' · '}
        <button type="button" onClick={toggleShortcuts} className="font-medium text-primary-700 hover:underline">
          {shortcutsOff ? 'Turn shortcuts on' : 'Turn shortcuts off'}
        </button>
      </p>
```

6. Add TasksPage tests (extend `TasksPage.test.tsx` — the hook mock's `useMyOverdueUnanswered` return value drives each case; the mock factory entry and the `import { useMyOverdueUnanswered } from '../../hooks/useStaffTasks';` line were added in Task 12 Step 2):

```tsx
  it('mounts the reason dialog only after overdue-mine resolves with tasks', () => {
    vi.mocked(useMyOverdueUnanswered).mockReturnValue({ data: [{ id: 'o1', title: 'Follow Up — Aetna', description: null, dueDate: new Date(Date.now() - 86_400_000).toISOString() }], isSuccess: true, isError: false } as any);
    render(<MemoryRouter><TasksPage /></MemoryRouter>);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('fails open — a failed overdue query never blocks the page', () => {
    vi.mocked(useMyOverdueUnanswered).mockReturnValue({ data: undefined, isSuccess: false, isError: true } as any);
    render(<MemoryRouter><TasksPage /></MemoryRouter>);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /my tasks/i })).toBeInTheDocument();
  });

  it('deep link wins over the dialog', () => {
    vi.mocked(useMyOverdueUnanswered).mockReturnValue({ data: [{ id: 'o1', title: 'x', description: null, dueDate: new Date().toISOString() }], isSuccess: true, isError: false } as any);
    render(<MemoryRouter initialEntries={['/tasks?taskId=t1']}><TasksPage /></MemoryRouter>);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
```

- [ ] **Step 6: Run all tasks-feature tests, typecheck, commit**

Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/ > /tmp/vitest-fe.log 2>&1; echo "exit: $?"; tail -15 /tmp/vitest-fe.log` (timeout 600000) → `exit: 0`
Run: `cd /Users/kaysworld/dev/KAY/packages/frontend && node ../../node_modules/typescript/bin/tsc --noEmit --incremental > /tmp/tsc-fe.log 2>&1; echo "exit: $?"` (timeout 600000) → `exit: 0`

```bash
cd /Users/kaysworld/dev/KAY
git add packages/frontend/src/features/tasks packages/frontend/src/hooks/useStaffTasks.ts
git commit -m "feat(tasks): prompt-on-arrival reason dialog — deferrable, fail-open, per-field retry, shortcut guard + off toggle"
```

---

### Task 14: Check-in engine + scheduler + e2e + PR-B wrap-up

**Files:**
- Create: `packages/backend/src/services/practice-checkin.service.ts`
- Modify: `packages/backend/src/services/scheduler.service.ts` (lock keys ~L17-20, class fields ~L43-59, `initialize()` ~L145-158, new run method after `runWeeklyDigestJob`)
- Modify: `e2e/tests/tasks.spec.ts` (needs-review + reason-dialog flows)
- Test: `packages/backend/src/services/practice-checkin.service.test.ts`

**Interfaces:**
- Consumes: Task 1 schema (`Task.taskGroup`, `Practice.status/isDemo/onboardedAt/deletedAt`); the scheduler's CAQH/weekly-digest job shape (in-process flag + `pg_try_advisory_lock` + try/finally unlock).
- Produces:

```ts
// practice-checkin.service.ts
export async function runPracticeCheckInSweep(now?: Date): Promise<{ practicesChecked: number; created: number }>;
// scheduler.service.ts
const CHECK_IN_LOCK_KEY = 73411003;
// job: env CHECK_IN_SCHEDULE, default '0 6 * * *'; public runCheckInJob(): Promise<void>
```

- [ ] **Step 1: Write the failing service tests**

Create `packages/backend/src/services/practice-checkin.service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});
vi.mock('../utils/logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { runPracticeCheckInSweep } from './practice-checkin.service.js';

const NOW = new Date('2026-07-17T06:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const PRACTICE = { id: 'prac-1', name: 'Lakeside Counseling', onboardedAt: daysAgo(60), createdAt: daysAgo(90) };

describe('runPracticeCheckInSweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.practice.findMany.mockResolvedValue([PRACTICE] as any);
    prismaMock.task.findFirst.mockResolvedValue(null); // default: no completed task, no open check-in
    prismaMock.task.create.mockResolvedValue({ id: 'new-task' } as any);
  });

  it('only sweeps ACTIVE, non-demo, non-deleted practices (isDemo/INACTIVE exclusion)', async () => {
    await runPracticeCheckInSweep(NOW);
    expect(prismaMock.practice.findMany.mock.calls[0][0].where)
      .toEqual({ status: 'ACTIVE', isDemo: false, deletedAt: null });
  });

  it('creates a check-in when the practice is exactly 7 days quiet (boundary fires)', async () => {
    // last completed task 7 days ago → quietDays = 7 → fires
    prismaMock.task.findFirst
      .mockResolvedValueOnce({ completedAt: daysAgo(7) } as any) // last-touch lookup
      .mockResolvedValueOnce(null); // open check-in dedup lookup
    const result = await runPracticeCheckInSweep(NOW);
    expect(result).toEqual({ practicesChecked: 1, created: 1 });
    const data = prismaMock.task.create.mock.calls[0][0].data;
    expect(data.title).toBe('Weekly check-in — Lakeside Counseling'); // D17 exact format
    expect(data.description).toBe('No contact in 7 days');
    expect(data.taskGroup).toBe('CHECK_IN');
    expect(data.type).toBe('CUSTOM');
    expect(data.assignedToId).toBeNull(); // Task Pool
    expect(data.createdById).toBeNull(); // system convention
    expect(data.dueDate).toEqual(new Date(NOW.getTime() + 3 * 86_400_000)); // D20: due in 3 days
  });

  it('does NOT fire at 6 days quiet (D19: a recent completed task resets the clock)', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({ completedAt: daysAgo(6) } as any);
    const result = await runPracticeCheckInSweep(NOW);
    expect(result.created).toBe(0);
    expect(prismaMock.task.create).not.toHaveBeenCalled();
  });

  it('falls back to onboardedAt, then createdAt, as the baseline (first-touch solved)', async () => {
    // no completed tasks at all; onboardedAt 60 days ago → fires
    const result = await runPracticeCheckInSweep(NOW);
    expect(result.created).toBe(1);

    vi.clearAllMocks();
    prismaMock.practice.findMany.mockResolvedValue([{ ...PRACTICE, onboardedAt: null, createdAt: daysAgo(3) }] as any);
    prismaMock.task.findFirst.mockResolvedValue(null);
    const second = await runPracticeCheckInSweep(NOW);
    expect(second.created).toBe(0); // created 3 days ago → not quiet yet
  });

  it('dedup: skips when an open CHECK_IN already exists (at most one per practice)', async () => {
    prismaMock.task.findFirst
      .mockResolvedValueOnce(null) // no completed task → quiet since onboardedAt (60d)
      .mockResolvedValueOnce({ id: 'existing-checkin' } as any); // open check-in exists
    const result = await runPracticeCheckInSweep(NOW);
    expect(result.created).toBe(0);
    expect(prismaMock.task.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/services/practice-checkin.service.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1` (module not found).

- [ ] **Step 3: Implement the service**

Create `packages/backend/src/services/practice-checkin.service.ts`:

```ts
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

const QUIET_DAYS = 7; // D13: a practice is "quiet" after 7 untouched days
const DUE_IN_DAYS = 3; // D20: check-in tasks are due 3 days after creation
const DAY_MS = 86_400_000;

/**
 * Daily practice check-in sweep (D13, D17, D19, D20). Injectable clock for
 * boundary tests. Last touch is derived FRESH per run (D19 automatic):
 *   max(completedAt of practice-linked COMPLETED tasks) ?? onboardedAt ?? createdAt
 * ANY completed practice-linked task resets the 7-day clock — the check-in
 * task itself included, so busy practices never accumulate redundant
 * reminders. At most one open CHECK_IN per practice. No notifications —
 * pool tasks don't notify (v1 convention).
 */
export async function runPracticeCheckInSweep(now: Date = new Date()): Promise<{ practicesChecked: number; created: number }> {
  const practices = await prisma.practice.findMany({
    where: { status: 'ACTIVE', isDemo: false, deletedAt: null },
    select: { id: true, name: true, onboardedAt: true, createdAt: true },
  });

  let created = 0;
  for (const practice of practices) {
    const lastCompleted = await prisma.task.findFirst({
      where: { practiceId: practice.id, status: 'COMPLETED', completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    });
    const lastTouch = lastCompleted?.completedAt ?? practice.onboardedAt ?? practice.createdAt;
    const quietDays = Math.floor((now.getTime() - lastTouch.getTime()) / DAY_MS);
    if (quietDays < QUIET_DAYS) continue;

    const openCheckIn = await prisma.task.findFirst({
      where: { practiceId: practice.id, taskGroup: 'CHECK_IN', status: { in: ['PENDING', 'IN_PROGRESS'] } },
      select: { id: true },
    });
    if (openCheckIn) continue; // dedup: at most one open check-in per practice

    await prisma.task.create({
      data: {
        title: `Weekly check-in — ${practice.name}`, // D17 exact format — NOT the group-title formula
        description: `No contact in ${quietDays} days`,
        taskGroup: 'CHECK_IN',
        type: 'CUSTOM',
        status: 'PENDING',
        priority: 'NORMAL',
        practiceId: practice.id,
        assignedToId: null, // lands unassigned in the Task Pool (D17)
        createdById: null, // v1 system-created convention
        dueDate: new Date(now.getTime() + DUE_IN_DAYS * DAY_MS),
      },
    });
    created++;
  }

  logger.info(`[CheckIn] Sweep complete: practicesChecked=${practices.length} created=${created}`);
  return { practicesChecked: practices.length, created };
}
```

- [ ] **Step 4: Run service tests to verify they pass**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/services/practice-checkin.service.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"; tail -10 /tmp/vitest.log` (timeout 600000)
Expected: `exit: 0`, 5 passed.

- [ ] **Step 5: Register the scheduler job (copy the CAQH job shape exactly)**

In `packages/backend/src/services/scheduler.service.ts`:

1. Import: `import { runPracticeCheckInSweep } from './practice-checkin.service.js';`
2. Next to the other lock keys (~L20): `/** Advisory lock key for the daily practice check-in sweep. */\nconst CHECK_IN_LOCK_KEY = 73411003;`
3. Class fields (next to the other job/flag pairs): `private checkInJob: cron.ScheduledTask | null = null;` and `private isCheckInJobRunning = false;`
4. At the end of `initialize()` (after the stalled-task block — always scheduled, no email/AI config gate):

```ts
    // Daily practice check-in sweep (6am) — creates pool tasks for practices
    // untouched for 7 days. Tasks v2, D13/D17.
    const checkInSchedule = process.env['CHECK_IN_SCHEDULE'] || '0 6 * * *';
    this.checkInJob = cron.schedule(checkInSchedule, () => {
      this.runCheckInJob();
    });
    logger.info(`[Scheduler] Practice check-in job scheduled: ${checkInSchedule}`);
```

5. New method after `runWeeklyDigestJob` (same shape: in-process flag + session advisory lock — never SETNX — + try/finally unlock):

```ts
  /**
   * Run one practice check-in sweep. Re-entrancy guarded in-process; session
   * advisory lock guards across Render instances (never SETNX — its TTL can
   * expire mid-run).
   */
  async runCheckInJob(): Promise<void> {
    if (this.isCheckInJobRunning) {
      logger.info('[Scheduler] Check-in job already running, skipping...');
      return;
    }
    this.isCheckInJobRunning = true;

    const lockRows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(${CHECK_IN_LOCK_KEY}) AS locked`;
    if (!lockRows[0]?.locked) {
      logger.info('[Scheduler] Check-in lock held by another instance, skipping.');
      this.isCheckInJobRunning = false;
      return;
    }

    try {
      const result = await runPracticeCheckInSweep();
      logger.info(`[Scheduler] Check-in sweep: practicesChecked=${result.practicesChecked} created=${result.created}`);
    } catch (err) {
      logger.error('[Scheduler] Check-in job error:', err);
      Sentry.captureException(err, { tags: { job: 'practice-checkin' } });
    } finally {
      await prisma.$queryRaw`SELECT pg_advisory_unlock(${CHECK_IN_LOCK_KEY})`
        .catch((err) => logger.error('[Scheduler] Check-in unlock failed:', err));
      this.isCheckInJobRunning = false;
    }
  }
```

- [ ] **Step 6: Backend typecheck + OpenAPI no-op check**

Run: `cd /Users/kaysworld/dev/KAY/packages/backend && node ../../node_modules/typescript/bin/tsc --noEmit --incremental > /tmp/tsc.log 2>&1; echo "exit: $?"` (timeout 600000) → `exit: 0`
Run: `npm run openapi:generate --workspace=packages/backend > /tmp/openapi.log 2>&1; echo "exit: $?"; git status --short packages/backend/openapi.json` → `exit: 0`, no diff.

- [ ] **Step 7: Extend the e2e spec**

Append to `e2e/tests/tasks.spec.ts` (admin storage state; the reason dialog fires for admins' own overdue tasks too, so one session covers both flows):

```ts
test.describe('Tasks v2 — needs review + reason dialog', () => {
  test('overdue task → arrival dialog defer/save → admin needs-review flow', async ({ page }) => {
    const note = `e2e overdue ${Date.now()}`;

    // 1. Create a task assigned to ME with a due date in the past.
    await page.goto('/tasks');
    // Defer any dialog left over from previous runs so the page is usable.
    const stale = page.getByRole('button', { name: "I'll answer later" });
    if (await stale.isVisible().catch(() => false)) await stale.click();

    await page.getByRole('button', { name: 'New Task' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Task group *').selectOption('VERIFY_INFORMATION');
    await dialog.getByLabel(/note/i).fill(note);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await dialog.getByLabel('Due Date').fill(yesterday);
    // Assign to myself: option 0 is "Leave in Task Pool", option 1 is the
    // first assignee — the seeded admin running this session. (Playwright's
    // selectOption label matcher takes exact strings only, and the admin's
    // display name varies per environment, so select by index.)
    await dialog.getByLabel('Assign To').selectOption({ index: 1 });
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByRole('heading', { name: 'New Task' })).toBeHidden();

    // 2. Re-arrive → the prompt-on-arrival dialog fires. Esc = deferral.
    await page.reload();
    const reasonDialog = page.getByRole('alertdialog');
    await expect(reasonDialog).toBeVisible();
    await expect(reasonDialog.getByText(/Before you dive in — \d+ task/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reasonDialog).toBeHidden();

    // 3. Re-arms on the next arrival; quick chip + edit + save.
    await page.reload();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Waiting on documents' }).first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Save reasons' }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();

    // 4. Admin Needs review tab: the reason sits on the row; Close resolves it.
    await page.getByRole('tab', { name: /needs review/i }).click();
    await expect(page.getByText('Reason: "Waiting on documents"').first()).toBeVisible();
    await page.getByRole('button', { name: /^Close — Verify Information/ }).first().click();
    await expect(page.getByText('Reason: "Waiting on documents"').first()).toBeHidden();
  });
});
```

Run (dev servers running): `cd /Users/kaysworld/dev/KAY/e2e && npx playwright test tests/tasks.spec.ts`
Expected: pass. Adjust selectors to the built DOM if needed — keep assertions, not selectors, as the contract.

- [ ] **Step 8: PR-B full verification sweep** (each its own foreground command, timeout 600000)

- `cd /Users/kaysworld/dev/KAY/packages/backend && node ../../node_modules/typescript/bin/tsc --noEmit > /tmp/tsc-be.log 2>&1; echo "exit: $?"` → `exit: 0`
- `cd /Users/kaysworld/dev/KAY/packages/frontend && node ../../node_modules/typescript/bin/tsc --noEmit > /tmp/tsc-fe.log 2>&1; echo "exit: $?"` → `exit: 0`
- `cd /Users/kaysworld/dev/KAY/packages/backend && ../../node_modules/.bin/vitest run src/services/staff-task.service.test.ts src/services/practice-checkin.service.test.ts src/routes/staff-task.routes.test.ts src/routes/task.routes.test.ts > /tmp/vt-be.log 2>&1; echo "exit: $?"` → `exit: 0`
- `cd /Users/kaysworld/dev/KAY/packages/frontend && ../../node_modules/.bin/vitest run src/features/tasks/ > /tmp/vt-fe.log 2>&1; echo "exit: $?"` → `exit: 0`
- Invoke `superpowers:verification-before-completion` before claiming done.

- [ ] **Step 9: Commit, push, PR (repo root)**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/backend/src/services/practice-checkin.service.ts packages/backend/src/services/practice-checkin.service.test.ts packages/backend/src/services/scheduler.service.ts e2e/tests/tasks.spec.ts
git commit -m "feat(tasks): daily practice check-in engine (advisory lock 73411003, 7d quiet, 3d due) + e2e"
git push -u origin feat/tasks-v2-review-checkins
gh pr create --title "Tasks v2 PR-B: needs review + overdue reasons + practice check-ins" --body "Approved plan: ~/.claude/plans/radiant-skipping-pine.md (tasks 10-14). Code-only — schema landed in PR-A. Admin-only Needs review tab (explicit route 403 gate + tests), prompt-on-arrival reason dialog (deferrable, fail-open, per-field retry), daily check-in sweep behind advisory lock 73411003 (cron 0 6 * * *, env CHECK_IN_SCHEDULE).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 10: Deploy path (after Kay merges)**

1. Merge PR-B branch to `develop` → staging. **Staging soak: 2–3 days of the check-in job** — verify no duplicate check-ins per practice, correct `+3d` due dates, and that completing any practice-linked task suppresses the next sweep (D19). Query to spot-check: count open CHECK_IN tasks per practice (must be ≤ 1).
2. Kay walks Flow 1 (Monday sweep) and Flow 3 (arrival dialog) on staging.
3. Prod promotion; verify both Render deploys' live commit SHAs (manual POST deploy for kay-frontend by default).

---

## Deliberately NOT in this plan (contract-consistent)

- **Retell in-app calling** — explicitly deferred to a separate project (D7); `tel:` links only.
- **Admin-side live region when "Awaiting reason…" flips to a real reason** — accepted trade-off (EXPERIENCE.md L3): refresh-on-focus is the fallback for a 3-person team.
- **Dedicated mockup state for group = Other** — spine-only per D25; covered by the auto-title rule + Note escape hatch (no code differences needed).
- **Task-group registration in the OpenAPI generator** — Phase 0.A scope excludes task routes; regeneration is run as a no-op drift check only.
- **Practice-facing task surfaces of any kind** — D8/D14: no tab, no badge, no endpoint; practice admins keep their existing view-only portal unchanged.
- **A bulk reason endpoint** — the dialog saves per-task via `Promise.allSettled` PATCHes (3-person team; per-field retry is the contract).
