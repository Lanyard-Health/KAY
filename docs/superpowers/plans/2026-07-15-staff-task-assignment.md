# Staff Task Assignment System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tasks page for Lanyard's internal team (admin + lanyard_staff) with My Tasks / Task Pool / All Tasks views, assignment, claiming, a detail panel, and in-app notifications — per the approved spec at `docs/superpowers/specs/2026-07-15-staff-task-assignment-design.md` and approved mockup (artifact c9736d7a).

**Architecture:** Extend the existing `Task` model/routes (no second task system). New staff-scoped endpoints on `task.routes.ts` gated to `authorize(...ADMIN_ROLES, 'lanyard_staff')`. New service `staff-task.service.ts` for validation + atomic claim. Frontend: new `features/tasks/` page reusing existing patterns (Headless UI Tab, LicenseModal-style dialog, AiSidebar-style slide-over, ApprovalToasts-style assignment toast, OCR-badge-style sidebar count).

**Tech Stack:** Express 4 + Prisma 5 + Zod (backend), React 18 + React Query 5 + Headless UI + react-hook-form + react-hot-toast (frontend), Vitest + supertest + Playwright.

## Global Constraints

- **Roles:** staff-task endpoints use `authorize(...ADMIN_ROLES, 'lanyard_staff')` — NEVER `'credentialing_staff'` (that's a practice-side role, and `authorize()` auto-admits `lanyard_staff` wherever `credentialing_staff` is listed, but not vice versa). Assignees must have role `admin` or `lanyard_staff`, enforced server-side (spec: "Assignee restriction").
- **Auto-status:** claiming or assigning sets status `IN_PROGRESS` (only from `PENDING`); manual override allowed via PATCH.
- **Single link:** at most one of `providerId` / `practiceId` / `enrollmentId` per task; API rejects more than one.
- **Claim is atomic:** conditional `updateMany` where `assignedToId: null`; count 0 → HTTP 409.
- **Notifications:** reuse `InAppNotificationType` value `'system_announcement'` (do NOT add an enum value — enum changes need a DB ALTER TYPE + coordinated redeploy per repo history). `actionUrl: '/tasks?taskId=<id>'`.
- **Migration:** generated locally with `npx prisma migrate dev`; on staging/prod it must run with `DATABASE_URL_ADMIN` (runtime role gets 42501 on pre-2026-06 tables — `tasks` is one).
- **OpenAPI:** generator (`scripts/generate-openapi.ts`) is Phase 0.A-scoped; existing routes are intentionally absent. Do NOT add task routes to it in this plan.
- **Typecheck/test discipline (CLAUDE.md):** foreground only, `timeout: 600000`, one package per invocation, direct binaries (`node ./node_modules/typescript/bin/tsc --noEmit`, `./node_modules/.bin/vitest run <file>`), never background/poll.
- **Branch:** work on `feat/staff-task-assignment` (exists). Never push master. Repo root git only (`packages/backend` has a nested `.git` — run git from `/Users/kaysworld/dev/KAY`).
- **API envelope:** `{ success: true, data }`; frontend hooks return `response.data`, components read `data?.data`.
- CI note: vitest is not merge-gating (`|| true`) — a red test still means fix it; verify failures aren't pre-existing on the base branch before debugging.

---

### Task 1: Schema — extend Task model + migration

**Files:**
- Modify: `packages/backend/prisma/schema.prisma` (Task model ~line 2395, TaskStatus enums ~2374-2387, User model ~line 84, Practice model ~line 153)
- Create: `packages/backend/prisma/migrations/<timestamp>_staff_task_assignment/migration.sql` (generated)

**Interfaces:**
- Produces: `Task.priority: TaskPriority (LOW|NORMAL|HIGH|URGENT, default NORMAL)`, `Task.practiceId?: string`, `Task.createdById?: string`, `Task.providerId` now optional, relations `Task.practice`, `Task.createdBy`. Later tasks rely on these exact field names.

- [ ] **Step 1: Edit schema.prisma**

Add above the Task model (next to TaskStatus):

```prisma
enum TaskPriority {
  LOW
  NORMAL
  HIGH
  URGENT
}
```

Change the Task model — `providerId` and its relation become optional, three new fields, two new relations, three new indexes:

```prisma
model Task {
  id            String       @id @default(uuid())
  providerId    String?      @map("provider_id")
  practiceId    String?      @map("practice_id")
  enrollmentId  String?      @map("enrollment_id")
  title         String
  description   String?
  type          TaskType
  status        TaskStatus   @default(PENDING)
  priority      TaskPriority @default(NORMAL)
  assignedToId  String?      @map("assigned_to_id")
  createdById   String?      @map("created_by_id")
  dueDate       DateTime?    @map("due_date")
  completedAt   DateTime?    @map("completed_at")
  completedById String?      @map("completed_by_id")
  createdAt     DateTime     @default(now()) @map("created_at")
  updatedAt     DateTime     @updatedAt @map("updated_at")

  provider           ProviderProfile?    @relation(fields: [providerId], references: [id], onDelete: Cascade)
  practice           Practice?           @relation(fields: [practiceId], references: [id], onDelete: Cascade)
  enrollment         Enrollment?         @relation(fields: [enrollmentId], references: [id], onDelete: SetNull)
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
  @@map("tasks")
}
```

In the `User` model, next to the existing `tasksAssigned`/`tasksCompleted` lines (~L84-85), add:

```prisma
  tasksCreated                Task[]                   @relation("TaskCreatedBy")
```

In the `Practice` model, add to its relation list:

```prisma
  tasks               Task[]
```

- [ ] **Step 2: Generate the migration (local Docker DB must be up)**

Run: `docker compose up -d && cd packages/backend && npx prisma migrate dev --name staff_task_assignment`
Expected: new folder under `prisma/migrations/`, SQL containing `CREATE TYPE "TaskPriority"`, `ALTER TABLE "tasks" ALTER COLUMN "provider_id" DROP NOT NULL`, `ADD COLUMN "practice_id"`, `ADD COLUMN "priority" ... DEFAULT 'NORMAL'`, `ADD COLUMN "created_by_id"`, plus the three indexes. Prisma client regenerates automatically.

- [ ] **Step 3: Backend typecheck (existing code must still compile)**

Run: `cd packages/backend && node ./node_modules/typescript/bin/tsc --noEmit --incremental > /tmp/tsc.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 0`

- [ ] **Step 4: Commit (from repo root)**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/backend/prisma
git commit -m "feat(tasks): schema for staff task assignment (priority, practice link, createdBy, optional provider)"
```

---

### Task 2: Backend service — staff-task.service.ts

**Files:**
- Create: `packages/backend/src/services/staff-task.service.ts`
- Test: `packages/backend/src/services/staff-task.service.test.ts`

**Interfaces:**
- Consumes: Prisma singleton `import { prisma } from '../utils/prisma.js'`; logger `import { logger } from '../utils/logger.js'` (verify exact logger import path by copying it from `task.service.ts` line 1-10).
- Produces (exact signatures for Task 3/4):

```ts
export const ASSIGNABLE_ROLES = ['admin', 'lanyard_staff'] as const;
export async function assertAssignableUser(userId: string): Promise<void>            // throws Error('ASSIGNEE_NOT_ALLOWED') if user missing/inactive/wrong role
export async function createStaffTask(input: CreateStaffTaskInput, creatorId: string) // returns task with includes
export async function claimTask(taskId: string, userId: string): Promise<boolean>     // false = already claimed (409)
export async function listStaffTasks(opts: ListStaffTasksOptions)                     // { tasks, total }
export async function getMyTaskCounts(userId: string): Promise<{ open: number; overdue: number }>
export async function listAssignees()                                                 // active admin+lanyard_staff users
export interface CreateStaffTaskInput { title: string; description?: string; priority: 'LOW'|'NORMAL'|'HIGH'|'URGENT'; dueDate?: Date; assignedToId?: string; providerId?: string; practiceId?: string; enrollmentId?: string; }
export interface ListStaffTasksOptions { view: 'my'|'pool'|'all'; userId: string; status?: 'open'|'completed'|'all'; priority?: string; practiceId?: string; limit: number; offset: number; }
```

- [ ] **Step 1: Verify relation names before coding**

Read `packages/backend/prisma/schema.prisma` — the `Enrollment` model — and note the exact relation name for its payer (expected `payer Payer @relation(...)` with `Payer.name`). If it differs, adapt the `include` below. Also copy the exact logger import from `packages/backend/src/services/task.service.ts`.

- [ ] **Step 2: Write failing tests**

Follow the prisma-mock convention from `task.routes.test.ts` (mock `../utils/prisma.js` via `tests/helpers/mock-prisma.js`). Test cases (write all four):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});
vi.mock('../utils/logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { assertAssignableUser, createStaffTask, claimTask } from './staff-task.service.js';

const USER_ID = '00000000-0000-4000-a000-000000000001';
const TASK_ID = '00000000-0000-4000-a000-000000000002';

describe('assertAssignableUser', () => {
  beforeEach(() => vi.clearAllMocks());
  it('rejects a practice-side credentialing_staff user', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: USER_ID, role: 'credentialing_staff', isActive: true } as any);
    await expect(assertAssignableUser(USER_ID)).rejects.toThrow('ASSIGNEE_NOT_ALLOWED');
  });
  it('accepts an active lanyard_staff user', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: USER_ID, role: 'lanyard_staff', isActive: true } as any);
    await expect(assertAssignableUser(USER_ID)).resolves.toBeUndefined();
  });
});

describe('createStaffTask', () => {
  beforeEach(() => vi.clearAllMocks());
  it('rejects more than one linked record', async () => {
    await expect(createStaffTask({ title: 'x', priority: 'NORMAL', providerId: USER_ID, practiceId: USER_ID }, USER_ID))
      .rejects.toThrow('MULTIPLE_LINKS');
  });
  it('sets IN_PROGRESS when created with an assignee', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: USER_ID, role: 'admin', isActive: true } as any);
    prismaMock.task.create.mockResolvedValue({ id: TASK_ID, title: 'x' } as any);
    prismaMock.inAppNotification.create.mockResolvedValue({} as any);
    await createStaffTask({ title: 'x', priority: 'NORMAL', assignedToId: USER_ID }, USER_ID);
    expect(prismaMock.task.create.mock.calls[0][0].data.status).toBe('IN_PROGRESS');
  });
});

describe('claimTask', () => {
  it('returns false when someone else already claimed (atomic guard)', async () => {
    prismaMock.task.updateMany.mockResolvedValue({ count: 0 } as any);
    expect(await claimTask(TASK_ID, USER_ID)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/backend && ./node_modules/.bin/vitest run src/services/staff-task.service.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` (timeout 600000)
Expected: `exit: 1` (module not found)

- [ ] **Step 4: Implement the service**

```ts
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js'; // match task.service.ts import exactly

export const ASSIGNABLE_ROLES = ['admin', 'lanyard_staff'] as const;

export interface CreateStaffTaskInput {
  title: string; description?: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  dueDate?: Date; assignedToId?: string;
  providerId?: string; practiceId?: string; enrollmentId?: string;
}
export interface ListStaffTasksOptions {
  view: 'my' | 'pool' | 'all'; userId: string;
  status?: 'open' | 'completed' | 'all'; priority?: string; practiceId?: string;
  limit: number; offset: number;
}

const TASK_INCLUDE = {
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  completedBy: { select: { id: true, firstName: true, lastName: true } },
  provider: { select: { id: true, firstName: true, lastName: true } },
  practice: { select: { id: true, name: true } },
  enrollment: { select: { id: true, payer: { select: { name: true } } } }, // adapt to verified relation names
} as const;

export async function assertAssignableUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } });
  if (!user || !user.isActive || !(ASSIGNABLE_ROLES as readonly string[]).includes(user.role)) {
    throw new Error('ASSIGNEE_NOT_ALLOWED');
  }
}

function assertSingleLink(input: Pick<CreateStaffTaskInput, 'providerId' | 'practiceId' | 'enrollmentId'>) {
  const links = [input.providerId, input.practiceId, input.enrollmentId].filter(Boolean);
  if (links.length > 1) throw new Error('MULTIPLE_LINKS');
}

function notifyAssignee(userId: string, taskId: string, title: string) {
  prisma.inAppNotification.create({
    data: {
      userId, type: 'system_announcement',
      title: 'New task assigned',
      message: `You have been assigned: ${title}`,
      actionUrl: `/tasks?taskId=${taskId}`,
      metadata: { taskId, kind: 'task_assigned' },
    },
  }).catch((err) => logger.error(`Failed to notify assignee for task ${taskId}:`, err));
}

export async function createStaffTask(input: CreateStaffTaskInput, creatorId: string) {
  assertSingleLink(input);
  if (input.assignedToId) await assertAssignableUser(input.assignedToId);
  const task = await prisma.task.create({
    data: {
      title: input.title, description: input.description,
      type: 'CUSTOM', priority: input.priority,
      status: input.assignedToId ? 'IN_PROGRESS' : 'PENDING', // spec: auto-status on assignment
      dueDate: input.dueDate, assignedToId: input.assignedToId,
      providerId: input.providerId, practiceId: input.practiceId, enrollmentId: input.enrollmentId,
      createdById: creatorId,
    },
    include: TASK_INCLUDE,
  });
  if (input.assignedToId && input.assignedToId !== creatorId) notifyAssignee(input.assignedToId, task.id, input.title);
  return task;
}

export async function claimTask(taskId: string, userId: string): Promise<boolean> {
  const result = await prisma.task.updateMany({
    where: { id: taskId, assignedToId: null, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    data: { assignedToId: userId, status: 'IN_PROGRESS' },
  });
  return result.count === 1;
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export async function listStaffTasks(opts: ListStaffTasksOptions) {
  const where: Record<string, unknown> = {};
  if (opts.view === 'my') where['assignedToId'] = opts.userId;
  if (opts.view === 'pool') where['assignedToId'] = null;
  const status = opts.status ?? 'open';
  if (status === 'open') where['status'] = { in: ['PENDING', 'IN_PROGRESS'] };
  if (status === 'completed') where['status'] = { in: ['COMPLETED', 'SKIPPED'] };
  if (opts.priority) where['priority'] = opts.priority;
  if (opts.practiceId) where['practiceId'] = opts.practiceId;

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where, include: TASK_INCLUDE,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: opts.limit, skip: opts.offset,
    }),
    prisma.task.count({ where }),
  ]);

  // ponytail: in-page sort (overdue first, then priority rank) on the fetched window;
  // move to raw SQL ordering if pages ever feel wrong at large volumes.
  const now = Date.now();
  tasks.sort((a, b) => {
    const aOver = a.dueDate && a.dueDate.getTime() < now && a.status !== 'COMPLETED' ? 0 : 1;
    const bOver = b.dueDate && b.dueDate.getTime() < now && b.status !== 'COMPLETED' ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    const pr = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
    if (pr !== 0) return pr;
    return (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
  });
  return { tasks, total };
}

export async function getMyTaskCounts(userId: string) {
  const [open, overdue] = await Promise.all([
    prisma.task.count({ where: { assignedToId: userId, status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
    prisma.task.count({ where: { assignedToId: userId, status: { in: ['PENDING', 'IN_PROGRESS'] }, dueDate: { lt: new Date() } } }),
  ]);
  return { open, overdue };
}

export async function listAssignees() {
  return prisma.user.findMany({
    where: { role: { in: [...ASSIGNABLE_ROLES] }, isActive: true },
    select: { id: true, firstName: true, lastName: true, role: true },
    orderBy: { firstName: 'asc' },
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/backend && ./node_modules/.bin/vitest run src/services/staff-task.service.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"; tail -20 /tmp/vitest.log` (timeout 600000)
Expected: `exit: 0`, 5 passed

- [ ] **Step 6: Commit**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/backend/src/services/staff-task.service.ts packages/backend/src/services/staff-task.service.test.ts
git commit -m "feat(tasks): staff task service (create, atomic claim, list, counts, assignee guard)"
```

---

### Task 3: Backend routes — list, counts, assignees

**Files:**
- Modify: `packages/backend/src/routes/task.routes.ts`
- Test: `packages/backend/src/routes/staff-task.routes.test.ts` (new file; mirror mock setup from `task.routes.test.ts` lines 1-54)

**Interfaces:**
- Consumes: `listStaffTasks`, `getMyTaskCounts`, `listAssignees` from Task 2; `ADMIN_ROLES` from `../constants/roles.js`.
- Produces: `GET /tasks?view=my|pool|all&status=open|completed|all&priority=&practiceId=&limit=&offset=` → `{ success, data: Task[], meta: { total } }`; `GET /tasks/counts` → `{ success, data: { open, overdue } }`; `GET /tasks/assignees` → `{ success, data: {id,firstName,lastName,role}[] }`.

- [ ] **Step 1: Write failing tests** (new file; copy the exact vi.mock blocks from `task.routes.test.ts` lines 15-54, plus `vi.mock('../services/staff-task.service.js', ...)`)

```ts
// after mocks:
import taskRoutes from './task.routes.js';
import * as staffSvc from '../services/staff-task.service.js';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, staffUser } from '../../tests/helpers/fixtures.js';

describe('GET /tasks (staff list)', () => {
  it('returns tasks with meta for admin', async () => {
    vi.mocked(staffSvc.listStaffTasks).mockResolvedValue({ tasks: [{ id: 't1' }] as any, total: 1 });
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).get('/tasks?view=my');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
  });
  it('403s for practice-side credentialing_staff', async () => {
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'credentialing_staff' });
    const res = await request(app).get('/tasks?view=my');
    expect(res.status).toBe(403);
  });
});
describe('GET /tasks/counts', () => {
  it('returns my open/overdue counts', async () => {
    vi.mocked(staffSvc.getMyTaskCounts).mockResolvedValue({ open: 4, overdue: 1 });
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).get('/tasks/counts');
    expect(res.body.data).toEqual({ open: 4, overdue: 1 });
  });
});
```

IMPORTANT: the test-file `authorize` mock (copied from task.routes.test.ts) checks literal role inclusion and does NOT implement the lanyard_staff inheritance — that's fine here because these routes list roles explicitly. Also add one test asserting `lanyard_staff` gets 200 on `GET /tasks` (fixture: `{ ...staffUser, role: 'lanyard_staff' }`).

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/backend && ./node_modules/.bin/vitest run src/routes/staff-task.routes.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` — Expected: `exit: 1` (routes don't exist → 404s)

- [ ] **Step 3: Add routes** — in `task.routes.ts`, import `{ ADMIN_ROLES } from '../constants/roles.js'` and the Task 2 service functions. **Register these BEFORE the existing `GET /tasks/:taskId` route** (Express matches in order; `/tasks/counts` must not be captured by `:taskId`):

```ts
const staffOnly = authorize(...ADMIN_ROLES, 'lanyard_staff'); // internal team ONLY — not practice credentialing_staff

const listTasksQuerySchema = z.object({
  view: z.enum(['my', 'pool', 'all']).default('my'),
  status: z.enum(['open', 'completed', 'all']).default('open'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  practiceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get('/tasks', authenticate, staffOnly, async (req, res, next) => {
  try {
    const q = listTasksQuerySchema.parse(req.query);
    const { tasks, total } = await listStaffTasks({ ...q, userId: req.user!.id });
    res.json({ success: true, data: tasks, meta: { total } });
  } catch (error) { next(error); }
});

router.get('/tasks/counts', authenticate, staffOnly, async (req, res, next) => {
  try {
    res.json({ success: true, data: await getMyTaskCounts(req.user!.id) });
  } catch (error) { next(error); }
});

router.get('/tasks/assignees', authenticate, staffOnly, async (_req, res, next) => {
  try {
    res.json({ success: true, data: await listAssignees() });
  } catch (error) { next(error); }
});
```

- [ ] **Step 4: Run new tests + the existing task route tests (regression)**

Run: `cd packages/backend && ./node_modules/.bin/vitest run src/routes/staff-task.routes.test.ts src/routes/task.routes.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` — Expected: `exit: 0`

- [ ] **Step 5: Commit**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/backend/src/routes/task.routes.ts packages/backend/src/routes/staff-task.routes.test.ts
git commit -m "feat(tasks): staff list/counts/assignees endpoints (admin + lanyard_staff only)"
```

---

### Task 4: Backend routes — create, claim, update, delete

**Files:**
- Modify: `packages/backend/src/routes/task.routes.ts` (extend), `packages/backend/src/routes/staff-task.routes.test.ts` (extend)

**Interfaces:**
- Produces: `POST /tasks` (201, staff create — no provider required); `POST /tasks/:taskId/claim` (200, or 409 `{ error: { code: 'ALREADY_CLAIMED' } }`); `PATCH /tasks/:taskId` extended to accept `title/description/priority/dueDate/assignedToId(uuid|null)`; `DELETE /tasks/:taskId` (creator or admin only → 204, else 403).

- [ ] **Step 1: Read the existing PATCH `/tasks/:taskId` handler in full** (task.routes.ts ~line 166+) — note its current Zod schema and update logic; the extension below must preserve existing behavior (provider-task status updates by practice staff via `TaskStatusUpdateModal`).

- [ ] **Step 2: Write failing tests** (add to `staff-task.routes.test.ts`; also mock `assertAssignableUser`, `claimTask`, `createStaffTask` from the service mock):

```ts
describe('POST /tasks', () => {
  it('creates a staff task without a provider', async () => {
    vi.mocked(staffSvc.createStaffTask).mockResolvedValue({ id: 't1', title: 'Update payer sheet' } as any);
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post('/tasks').send({ title: 'Update payer sheet', priority: 'LOW' });
    expect(res.status).toBe(201);
  });
  it('400s when two record links are sent', async () => {
    vi.mocked(staffSvc.createStaffTask).mockRejectedValue(new Error('MULTIPLE_LINKS'));
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post('/tasks').send({ title: 'x', priority: 'NORMAL', providerId: PROVIDER_ID, practiceId: PROVIDER_ID });
    expect(res.status).toBe(400);
  });
  it('400s when assignee is not admin/lanyard_staff', async () => {
    vi.mocked(staffSvc.createStaffTask).mockRejectedValue(new Error('ASSIGNEE_NOT_ALLOWED'));
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post('/tasks').send({ title: 'x', priority: 'NORMAL', assignedToId: STAFF_USER_UUID });
    expect(res.status).toBe(400);
  });
});
describe('POST /tasks/:taskId/claim', () => {
  it('409s when already claimed', async () => {
    vi.mocked(staffSvc.claimTask).mockResolvedValue(false);
    const app = createTestApp(taskRoutes, adminUser);
    const res = await request(app).post(`/tasks/${TASK_ID}/claim`);
    expect(res.status).toBe(409);
  });
});
describe('DELETE /tasks/:taskId', () => {
  it('403s when a lanyard_staff user deletes a task they did not create', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: TASK_ID, createdById: 'someone-else' } as any);
    const app = createTestApp(taskRoutes, { ...staffUser, role: 'lanyard_staff' });
    const res = await request(app).delete(`/tasks/${TASK_ID}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run to verify failure** — same vitest command as Task 3 Step 2. Expected: failures on the new describes.

- [ ] **Step 4: Implement routes** (register `POST /tasks` and `/claim` before `GET /tasks/:taskId` for clarity; Express distinguishes by method anyway):

```ts
const staffCreateTaskSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title').max(500),
  description: z.string().max(2000).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  dueDate: z.string().datetime().optional(),
  assignedToId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  practiceId: z.string().uuid().optional(),
  enrollmentId: z.string().uuid().optional(),
});

router.post('/tasks', authenticate, staffOnly, async (req, res, next) => {
  try {
    const v = staffCreateTaskSchema.parse(req.body);
    const task = await createStaffTask(
      { ...v, dueDate: v.dueDate ? new Date(v.dueDate) : undefined },
      req.user!.id,
    );
    res.status(201).json({ success: true, data: task });
  } catch (error) {
    if (error instanceof Error && (error.message === 'MULTIPLE_LINKS' || error.message === 'ASSIGNEE_NOT_ALLOWED')) {
      res.status(400).json({ success: false, error: { message: error.message === 'MULTIPLE_LINKS' ? 'A task can link to at most one record' : 'Tasks can only be assigned to Lanyard admin or credentialing staff' } });
      return;
    }
    next(error);
  }
});

router.post('/tasks/:taskId/claim', authenticate, staffOnly, async (req, res, next) => {
  try {
    const claimed = await claimTask(req.params['taskId']!, req.user!.id);
    if (!claimed) {
      res.status(409).json({ success: false, error: { code: 'ALREADY_CLAIMED', message: 'Someone else claimed this task first' } });
      return;
    }
    res.json({ success: true, data: { taskId: req.params['taskId'], assignedToId: req.user!.id } });
  } catch (error) { next(error); }
});

router.delete('/tasks/:taskId', authenticate, staffOnly, async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: req.params['taskId']! }, select: { id: true, createdById: true } });
    if (!task) { res.status(404).json({ success: false, error: { message: 'Task not found' } }); return; }
    if (req.user!.role !== 'admin' && task.createdById !== req.user!.id) {
      throw new ForbiddenError('Only the creator or an admin can delete a task');
    }
    await prisma.task.delete({ where: { id: task.id } });
    res.status(204).send();
  } catch (error) { next(error); }
});
```

Extend the existing PATCH handler's Zod schema with the staff-editable fields and guards (merge into the existing schema — do not remove existing fields):

```ts
// added fields on the existing update schema:
//   title: z.string().trim().min(1).max(500).optional(),
//   description: z.string().max(2000).nullable().optional(),
//   priority: z.enum(['LOW','NORMAL','HIGH','URGENT']).optional(),
//   dueDate: z.string().datetime().nullable().optional(),
//   assignedToId: z.string().uuid().nullable().optional(),
// in the handler, before update:
const staffFields = ['title', 'description', 'priority', 'dueDate', 'assignedToId'] as const;
const touchesStaffFields = staffFields.some((f) => f in req.body);
if (touchesStaffFields && req.user!.role !== 'admin' && req.user!.role !== 'lanyard_staff') {
  throw new ForbiddenError('Insufficient permissions');
}
if (typeof validated.assignedToId === 'string') {
  await assertAssignableUser(validated.assignedToId); // wrap: on ASSIGNEE_NOT_ALLOWED respond 400 like POST /tasks
}
// auto-status: newly assigned + still PENDING -> IN_PROGRESS (spec)
// when setting assignedToId to null (back to pool), also set status: 'PENDING'
// notify on reassignment to someone other than the actor (reuse notifyAssignee via service export)
```

Export `notifyAssignee` from the service (add `export` keyword) so PATCH can reuse it.

- [ ] **Step 5: Run all task route tests**

Run: `cd packages/backend && ./node_modules/.bin/vitest run src/routes/staff-task.routes.test.ts src/routes/task.routes.test.ts > /tmp/vitest.log 2>&1; echo "exit: $?"` — Expected: `exit: 0`

- [ ] **Step 6: Backend typecheck** — `cd packages/backend && node ./node_modules/typescript/bin/tsc --noEmit --incremental > /tmp/tsc.log 2>&1; echo "exit: $?"` — Expected: `exit: 0`

- [ ] **Step 7: Commit**

```bash
cd /Users/kaysworld/dev/KAY
git add packages/backend/src/routes/task.routes.ts packages/backend/src/routes/staff-task.routes.test.ts packages/backend/src/services/staff-task.service.ts
git commit -m "feat(tasks): create/claim/update/delete staff task endpoints with role + link guards"
```

---

### Task 5: Frontend hooks — useStaffTasks.ts

**Files:**
- Create: `packages/frontend/src/hooks/useStaffTasks.ts`

**Interfaces:**
- Consumes: `api` singleton from `../services/api`; Task 3/4 endpoints.
- Produces (used by Tasks 6-10):

```ts
export interface StaffTask { id: string; title: string; description?: string | null; status: 'PENDING'|'IN_PROGRESS'|'COMPLETED'|'SKIPPED'; priority: 'LOW'|'NORMAL'|'HIGH'|'URGENT'; dueDate?: string | null; createdAt: string; completedAt?: string | null; assignedTo?: { id: string; firstName: string; lastName: string } | null; createdBy?: { id: string; firstName: string; lastName: string } | null; completedBy?: { id: string; firstName: string; lastName: string } | null; provider?: { id: string; firstName: string; lastName: string } | null; practice?: { id: string; name: string } | null; enrollment?: { id: string; payer?: { name: string } } | null; }
export function useStaffTasks(view: 'my'|'pool'|'all', filters?: { status?: string; priority?: string; practiceId?: string })
export function useTaskCounts()            // polls 60s -> { open, overdue }
export function useAssignees()
export function useCreateStaffTask()
export function useClaimTask()             // onError with response.status === 409 handled by caller
export function useUpdateStaffTask()       // PATCH /tasks/:id
export function useDeleteTask()
```

- [ ] **Step 1: Write the hook file** (conventions from `useTasks.ts` / `useCredentials.ts` — query keys prefix `['staff-tasks']` so invalidation is one call):

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

// ...StaffTask interface exactly as above...

export function useStaffTasks(view: 'my' | 'pool' | 'all', filters?: { status?: string; priority?: string; practiceId?: string }) {
  return useQuery({
    queryKey: ['staff-tasks', view, filters],
    queryFn: async () => {
      const params = new URLSearchParams({ view });
      if (filters?.status) params.set('status', filters.status);
      if (filters?.priority) params.set('priority', filters.priority);
      if (filters?.practiceId) params.set('practiceId', filters.practiceId);
      const response = await api.get(`/tasks?${params.toString()}`);
      return response.data; // { success, data: StaffTask[], meta: { total } }
    },
  });
}

export function useTaskCounts(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['staff-tasks', 'counts'],
    queryFn: async () => (await api.get('/tasks/counts')).data.data as { open: number; overdue: number },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    enabled: options?.enabled ?? true, // Layout passes false for practice roles (403 otherwise)
  });
}

export function useAssignees() {
  return useQuery({
    queryKey: ['staff-tasks', 'assignees'],
    queryFn: async () => (await api.get('/tasks/assignees')).data.data as { id: string; firstName: string; lastName: string; role: string }[],
    staleTime: 5 * 60_000,
  });
}

function useInvalidateTasks() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['staff-tasks'] });
}

export function useCreateStaffTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await api.post('/tasks', data)).data.data as StaffTask,
    onSuccess: invalidate,
  });
}

export function useClaimTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: async (taskId: string) => (await api.post(`/tasks/${taskId}/claim`)).data,
    onSettled: invalidate, // refetch even on 409 so the stolen task disappears
  });
}

export function useUpdateStaffTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: async ({ taskId, data }: { taskId: string; data: Record<string, unknown> }) =>
      (await api.patch(`/tasks/${taskId}`, data)).data.data as StaffTask,
    onSuccess: invalidate,
  });
}

export function useDeleteTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: async (taskId: string) => api.delete(`/tasks/${taskId}`),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 2: Frontend typecheck** — `cd packages/frontend && node ./node_modules/typescript/bin/tsc --noEmit --incremental > /tmp/tsc-fe.log 2>&1; echo "exit: $?"` (timeout 600000) — Expected: `exit: 0`

- [ ] **Step 3: Commit** — `git add packages/frontend/src/hooks/useStaffTasks.ts && git commit -m "feat(tasks): staff task React Query hooks"`

---

### Task 6: Route guard, App route, sidebar nav item + badge

**Files:**
- Modify: `packages/frontend/src/App.tsx` (lazy import ~L14-65; routes block L219-262; guards ~L93)
- Modify: `packages/frontend/src/components/Layout.tsx` (adminNavGroups Operations ~L65-77; badge injection L183-191; badge render L154-158)
- Create: `packages/frontend/src/features/tasks/TasksPage.tsx` (placeholder in this task; real page in Task 7)

**Interfaces:**
- Consumes: `useTaskCounts` from Task 5.
- Produces: route `/tasks` gated to admin + lanyard_staff; sidebar "Tasks" item with overdue-red / open-amber badge; `InternalOnlyRoute` guard component in App.tsx.

- [ ] **Step 1: Placeholder page** — create `packages/frontend/src/features/tasks/TasksPage.tsx`:

```tsx
export default function TasksPage() {
  return <h1 className="text-xl font-semibold text-gray-900">Tasks</h1>;
}
```

- [ ] **Step 2: Guard + route in App.tsx.** Add lazy import `const TasksPage = lazy(() => import('./features/tasks/TasksPage'));`. Add a guard next to `AdminOnlyRoute` (L93) — note `AdminOnlyRoute` is NOT sufficient: it still admits practice-side `credentialing_staff`:

```tsx
// Internal Lanyard team only (admin + lanyard_staff). Practice roles are redirected.
function InternalOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuthStore();
  if (isLoading) return <div className="flex h-screen items-center justify-center">Loading...</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== 'admin' && user?.role !== 'lanyard_staff') {
    return <RedirectWithToast to="/" message="You don't have access to Tasks" />;
  }
  return <>{children}</>;
}
```

Register inside the Layout route block (pattern of L237): `<Route path="tasks" element={<InternalOnlyRoute><TasksPage /></InternalOnlyRoute>} />`

- [ ] **Step 3: Sidebar item + badge in Layout.tsx.** Add to `adminNavGroups` → Operations group, after Documents: `{ name: 'Tasks', href: '/tasks', icon: CheckCircleIcon }` (import `CheckCircleIcon` from `@heroicons/react/24/outline`). Extend `NavItem` with `badgeColor?: 'amber' | 'red'`. In the component (~L175): `const { data: taskCounts } = useTaskCounts();`. Extend the `activeGroups` map (L183-191) and hide the item from practice-side credentialing_staff:

```ts
items: group.items
  .filter((item) => !(item.name === 'Tasks' && role === 'credentialing_staff'))
  .map((item) => {
    if (item.name === 'OCR Review' && ocrReviewCount) return { ...item, badge: ocrReviewCount };
    if (item.name === 'Tasks' && taskCounts && (taskCounts.overdue > 0 || taskCounts.open > 0)) {
      // spec: one number, one meaning — red overdue count wins, else amber open count
      return taskCounts.overdue > 0
        ? { ...item, badge: taskCounts.overdue, badgeColor: 'red' as const }
        : { ...item, badge: taskCounts.open, badgeColor: 'amber' as const };
    }
    return item;
  }),
```

In the badge render (L155), swap the hardcoded amber class: `item.badgeColor === 'red' ? 'bg-red-600' : 'bg-amber-500'`.

Gotcha: `useTaskCounts` runs for every Layout user — practice roles get 403s. Guard the hook call: `const isTaskUser = role === 'admin' || role === 'lanyard_staff';` and pass `enabled: isTaskUser` (add an `options?: { enabled?: boolean }` param to `useTaskCounts` in Task 5's file).

- [ ] **Step 4: Verify in the running app** — `docker compose up -d`, backend + frontend dev servers, log in as `admin@dev.local`, confirm: Tasks appears in the sidebar, `/tasks` renders the placeholder, and logging in as `practiceadmin@dev.local` shows no Tasks item and `/tasks` redirects home with the toast.

- [ ] **Step 5: Commit** — `git add packages/frontend/src/App.tsx packages/frontend/src/components/Layout.tsx packages/frontend/src/features/tasks/ packages/frontend/src/hooks/useStaffTasks.ts && git commit -m "feat(tasks): /tasks route (internal-only guard), sidebar item with overdue badge"`

---

### Task 7: TasksPage — tabs, filters, rows, claim/complete

**Files:**
- Modify: `packages/frontend/src/features/tasks/TasksPage.tsx` (replace placeholder)
- Create: `packages/frontend/src/features/tasks/TaskRow.tsx`
- Test: `packages/frontend/src/features/tasks/TasksPage.test.tsx`

**Interfaces:**
- Consumes: `useStaffTasks`, `useClaimTask`, `useUpdateStaffTask`, `StaffTask` (Task 5); `EmptyState`, `LoadingState`, `ErrorState`, `StatusBadge` from `components/ui`; `notify` from `utils/notify`; `useAuthStore`.
- Produces: `<TaskRow task onOpenDetail(task) view />` component; page state `selectedTask: StaffTask | null` + `isNewTaskOpen: boolean` that Tasks 8-9 wire into; deep-link support: on mount, if `?taskId=` is present, open that task's detail panel once loaded.

- [ ] **Step 1: Write a failing smoke test** (pattern: `ProviderTasks.test.tsx` — mock `../../hooks/useStaffTasks`):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../../hooks/useStaffTasks', () => ({
  useStaffTasks: vi.fn(() => ({ data: { data: [{ id: 't1', title: 'Chase W-9', status: 'IN_PROGRESS', priority: 'URGENT', dueDate: '2026-07-12T00:00:00Z', assignedTo: { id: 'u1', firstName: 'Kay', lastName: 'Ward' } }], meta: { total: 1 } }, isLoading: false, isError: false })),
  useTaskCounts: vi.fn(() => ({ data: { open: 1, overdue: 1 } })),
  useAssignees: vi.fn(() => ({ data: [] })),
  useClaimTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateStaffTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCreateStaffTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
import TasksPage from './TasksPage';

describe('TasksPage', () => {
  it('renders tabs and an urgent overdue task', () => {
    render(<MemoryRouter><TasksPage /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: /my tasks/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /task pool/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /all tasks/i })).toBeInTheDocument();
    expect(screen.getByText('Chase W-9')).toBeInTheDocument();
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  });
});
```

Run: `cd packages/frontend && ./node_modules/.bin/vitest run src/features/tasks/TasksPage.test.tsx > /tmp/vitest-fe.log 2>&1; echo "exit: $?"` — Expected: `exit: 1`

- [ ] **Step 2: Implement TaskRow.tsx** — pure presentational; approved-mockup visuals via existing utility classes:

```tsx
import clsx from 'clsx';
import { CheckIcon } from '@heroicons/react/24/outline';
import StatusBadge from '../../components/ui/StatusBadge';
import type { StaffTask } from '../../hooks/useStaffTasks';

const PRIORITY_STYLES: Record<StaffTask['priority'], string> = {
  URGENT: 'bg-red-50 text-red-700 ring-red-600/30',
  HIGH: 'bg-amber-50 text-amber-700 ring-amber-600/30',
  NORMAL: 'bg-gray-50 text-gray-600 ring-gray-400/40',
  LOW: 'bg-white text-gray-500 ring-gray-300',
};
const PRIORITY_LABELS: Record<StaffTask['priority'], string> = { URGENT: 'Urgent', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };
const STATUS_VARIANT: Record<StaffTask['status'], 'info' | 'neutral' | 'success'> = { IN_PROGRESS: 'info', PENDING: 'neutral', COMPLETED: 'success', SKIPPED: 'neutral' };
const STATUS_LABEL: Record<StaffTask['status'], string> = { IN_PROGRESS: 'In progress', PENDING: 'Pending', COMPLETED: 'Completed', SKIPPED: 'Skipped' };

export function isOverdue(task: StaffTask): boolean {
  return !!task.dueDate && task.status !== 'COMPLETED' && task.status !== 'SKIPPED' && new Date(task.dueDate).getTime() < Date.now();
}
export function linkedRecordLabel(task: StaffTask): string | null {
  if (task.provider) return `${task.provider.firstName} ${task.provider.lastName}`;
  if (task.practice) return task.practice.name;
  if (task.enrollment) return task.enrollment.payer?.name ?? 'Enrollment';
  return null;
}
export function linkedRecordHref(task: StaffTask): string | null {
  if (task.provider) return `/providers/${task.provider.id}`;
  if (task.practice) return `/practices/${task.practice.id}`;
  if (task.enrollment) return `/enrollments?enrollmentId=${task.enrollment.id}`; // verify the enrollments page's deep-link param before shipping
  return null;
}

interface TaskRowProps {
  task: StaffTask;
  view: 'my' | 'pool' | 'all';
  onOpenDetail: (task: StaffTask) => void;
  onToggleComplete: (task: StaffTask) => void;
  onClaim: (task: StaffTask) => void;
  claimPending: boolean;
}

export default function TaskRow({ task, view, onOpenDetail, onToggleComplete, onClaim, claimPending }: TaskRowProps) {
  const overdue = isOverdue(task);
  const done = task.status === 'COMPLETED';
  const record = linkedRecordLabel(task);
  return (
    <div className="grid grid-cols-[26px_minmax(0,1fr)_92px_150px_150px] items-center gap-3 px-4 py-3 hover:bg-gray-50/60">
      <button
        type="button"
        aria-pressed={done}
        aria-label={`${done ? 'Completed' : 'Mark complete'}: ${task.title}`}
        onClick={() => onToggleComplete(task)}
        className={clsx(
          'flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors',
          done ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300 bg-white text-transparent hover:border-primary-500 hover:text-primary-200',
        )}
      >
        <CheckIcon className="h-3 w-3" strokeWidth={3} />
      </button>
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => onOpenDetail(task)}
          className={clsx('block max-w-full truncate text-left text-sm font-medium hover:text-primary-700 hover:underline underline-offset-2', done ? 'text-gray-500 line-through' : 'text-gray-900')}
          title={task.title}
        >
          {task.title}
        </button>
        {record ? (
          <span className="mt-0.5 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{record}</span>
        ) : (
          <span className="text-[11px] text-gray-500">No linked record</span>
        )}
      </div>
      <span className={clsx('inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', PRIORITY_STYLES[task.priority])}>{PRIORITY_LABELS[task.priority]}</span>
      <span className={clsx('text-xs tabular-nums', overdue ? 'font-semibold text-red-600' : 'text-gray-500')}>
        {task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
        {overdue && <span className="block text-[11px] font-medium">overdue</span>}
      </span>
      {view === 'pool' || (view === 'all' && !task.assignedTo) ? (
        <button type="button" disabled={claimPending} onClick={() => onClaim(task)} className="justify-self-end rounded-lg border border-primary-200 bg-white px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-50">
          Claim
        </button>
      ) : view === 'all' ? (
        <span className="text-xs text-gray-600">{task.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}` : 'Unassigned'}</span>
      ) : (
        <StatusBadge label={STATUS_LABEL[task.status]} variant={STATUS_VARIANT[task.status]} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Implement TasksPage.tsx** — Headless UI `Tab.Group` (Settings.tsx pattern), filters, show-completed toggle, claim with undo toast:

```tsx
import { useState, useEffect } from 'react';
import { Tab } from '@headlessui/react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { PlusIcon } from '@heroicons/react/24/outline';
import { useStaffTasks, useClaimTask, useUpdateStaffTask, type StaffTask } from '../../hooks/useStaffTasks';
import TaskRow from './TaskRow';
import EmptyState from '../../components/ui/EmptyState';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import { notify } from '../../utils/notify';

const VIEWS = [
  { key: 'my' as const, label: 'My Tasks' },
  { key: 'pool' as const, label: 'Task Pool' },
  { key: 'all' as const, label: 'All Tasks' },
];

export default function TasksPage() {
  const [tabIndex, setTabIndex] = useState(0);
  const [priority, setPriority] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedTask, setSelectedTask] = useState<StaffTask | null>(null);
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const view = VIEWS[tabIndex].key;
  const status = showCompleted ? 'all' : 'open';
  const { data, isLoading, isError, refetch } = useStaffTasks(view, { status, priority: priority || undefined });
  const claimMutation = useClaimTask();
  const updateMutation = useUpdateStaffTask();
  const tasks: StaffTask[] = data?.data ?? [];

  // deep link: /tasks?taskId=<id> opens the detail panel
  const deepLinkId = searchParams.get('taskId');
  useEffect(() => {
    if (deepLinkId && tasks.length > 0) {
      const t = tasks.find((x) => x.id === deepLinkId);
      if (t) { setSelectedTask(t); setSearchParams({}, { replace: true }); }
    }
  }, [deepLinkId, tasks, setSearchParams]);

  const handleToggleComplete = (task: StaffTask) => {
    const nowDone = task.status !== 'COMPLETED';
    updateMutation.mutate({ taskId: task.id, data: { status: nowDone ? 'COMPLETED' : 'IN_PROGRESS' } });
  };

  const handleClaim = (task: StaffTask) => {
    claimMutation.mutate(task.id, {
      onSuccess: () => notify.success('Claimed', {
        description: `${task.title} is yours now — it's marked In progress.`,
      }),
      onError: (error: any) => {
        if (error?.response?.status === 409) notify.error('Someone else claimed this one first', { description: 'The list has been refreshed.' });
        else notify.error('Could not claim the task', { description: 'Try again in a moment.' });
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tasks</h1>
          <p className="text-sm text-gray-500">Everything the team is working on, across every practice.</p>
        </div>
        <button type="button" onClick={() => setIsNewTaskOpen(true)} className="btn-primary">
          <PlusIcon className="mr-1.5 h-4 w-4" /> New Task
        </button>
      </div>

      <Tab.Group selectedIndex={tabIndex} onChange={setTabIndex}>
        <Tab.List className="flex space-x-1 border-b border-gray-200">
          {VIEWS.map((v) => (
            <Tab key={v.key} className={({ selected }) => clsx(
              'border-b-2 px-4 py-2.5 text-sm font-medium outline-none transition-colors',
              selected ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
            )}>
              {v.label}
            </Tab>
          ))}
        </Tab.List>
      </Tab.Group>

      <div className="flex items-center gap-2">
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="input w-40" aria-label="Filter by priority">
          <option value="">Priority: Any</option>
          <option value="URGENT">Urgent</option>
          <option value="HIGH">High</option>
          <option value="NORMAL">Normal</option>
          <option value="LOW">Low</option>
        </select>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
          Show completed
        </label>
      </div>

      <div className="card divide-y divide-gray-100">
        {isLoading ? (
          <LoadingState label="Loading tasks…" />
        ) : isError ? (
          <ErrorState title="Couldn't load tasks" message="Something went wrong on our end." onRetry={refetch} />
        ) : tasks.length === 0 ? (
          view === 'pool'
            ? <EmptyState illustration="inbox" title="Nothing waiting to be claimed" description="Every task has an owner. New unassigned work lands here." />
            : view === 'my'
              ? <EmptyState illustration="clipboard" title="You're all caught up" description="Nothing is assigned to you right now. If you've got room, grab something from the Task Pool." action={{ label: 'Browse Task Pool', onClick: () => setTabIndex(1) }} />
              : <EmptyState illustration="search" title="No tasks match" description="Try clearing the filters." />
        ) : (
          tasks.map((task) => (
            <TaskRow key={task.id} task={task} view={view}
              onOpenDetail={setSelectedTask}
              onToggleComplete={handleToggleComplete}
              onClaim={handleClaim}
              claimPending={claimMutation.isPending}
            />
          ))
        )}
      </div>
      {/* Task 8 mounts <NewTaskModal isOpen={isNewTaskOpen} onClose={...} /> here */}
      {/* Task 9 mounts <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} /> here */}
    </div>
  );
}
```

Note: `btn-primary`, `input`, `card` are existing global CSS component classes (index.css).

- [ ] **Step 4: Spec-completeness additions to the page (same files, before running tests):**

1. **Practice filter** — next to the priority select: a practice select fed by `useQuery({ queryKey: ['staff-tasks','practice-options'], queryFn: async () => (await api.get('/practices')).data.data, staleTime: 5 * 60_000 })`; option `"" → Practice: All`, options `{p.name}`; wire the chosen id into the `practiceId` filter passed to `useStaffTasks`.
2. **Load more** — add `const [limit, setLimit] = useState(50);`, pass `limit` through the filters/query string (extend `useStaffTasks` to accept it), and below the list render when `tasks.length < (data?.meta?.total ?? 0)`: `<button type="button" className="w-full py-2.5 text-sm font-semibold text-primary-700 hover:bg-gray-50" onClick={() => setLimit((l) => l + 50)}>Load more ({data.meta.total - tasks.length} more)</button>`.
3. **Claim undo (spec: "Claimed ✓ · Undo", ~5s)** — TasksPage state `const [justClaimed, setJustClaimed] = useState<StaffTask | null>(null);`. In `handleClaim`'s `onSuccess`: `setJustClaimed(task)` plus a 6s `setTimeout(() => setJustClaimed(null), 6000)` (clear any prior timer via a ref). Render above the list when set:

```tsx
{justClaimed && (
  <div className="flex items-center gap-3 rounded-xl border border-primary-100 bg-primary-50/60 px-4 py-2.5 text-sm">
    <span className="font-semibold text-primary-900">Claimed ✓</span>
    <span className="truncate text-gray-700">{justClaimed.title}</span>
    <button type="button" className="ml-auto font-semibold text-primary-700 underline underline-offset-2"
      onClick={() => { updateMutation.mutate({ taskId: justClaimed.id, data: { assignedToId: null, status: 'PENDING' } }); setJustClaimed(null); }}>
      Undo
    </button>
  </div>
)}
```

(Remove the claim success toast from Step 3's `handleClaim` — this banner replaces it; keep the 409 error toast.)
4. **Pool-row age** — in TaskRow, when `view === 'pool'`, under the record chip render `Added {n} day{s} ago` from `createdAt` (`const days = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / 86_400_000);` → `days === 0 ? 'Added today' : \`Added ${days} day${days > 1 ? 's' : ''} ago\``) in `text-[11px] text-gray-500`.
5. **Mobile stacking (spec: Claim never hidden)** — change TaskRow's grid classes to `grid grid-cols-[26px_minmax(0,1fr)_92px_150px_150px] max-md:flex max-md:flex-wrap max-md:gap-2` so on small screens the cells wrap instead of dropping; title cell gets `max-md:w-full max-md:order-first`.

- [ ] **Step 5: Run the test** — same vitest command as Step 1. Expected: `exit: 0`.

- [ ] **Step 6: Manual check in dev app** — as `admin@dev.local`: tabs switch, claiming a seeded unassigned task shows the Claimed ✓ · Undo banner (and Undo returns it to the pool as Pending), complete-circle strikes through, practice filter narrows the list, empty states render per tab.

- [ ] **Step 7: Commit** — `git add packages/frontend/src/features/tasks/ && git commit -m "feat(tasks): Tasks page with My/Pool/All tabs, claim with undo, complete, filters, empty states"`

---

### Task 8: NewTaskModal

**Files:**
- Create: `packages/frontend/src/features/tasks/NewTaskModal.tsx`
- Modify: `packages/frontend/src/features/tasks/TasksPage.tsx` (mount it)

**Interfaces:**
- Consumes: `useCreateStaffTask`, `useAssignees` (Task 5); `api` for record search; Headless UI Dialog pattern from `LicenseModal.tsx:133-168`; react-hook-form.
- Produces: `<NewTaskModal isOpen onClose />`.

- [ ] **Step 1: Implement** — LicenseModal skeleton (Transition.Root → Dialog → backdrop Transition.Child → Dialog.Panel `rounded-2xl bg-white sm:max-w-lg`) with this form body:

Fields (react-hook-form; names in parentheses):
- Title (`title`) — `input` class; `{...register('title', { required: 'Give the task a title so the team knows what it is.' })}`; render `errors.title.message` in `text-red-600 text-xs mt-1`.
- Description (`description`) — textarea, optional.
- Priority (`priority`) — four-button segmented group (state via `watch`/`setValue`, default `'NORMAL'`); selected style `bg-primary-50 text-primary-800 font-semibold`.
- Due date (`dueDate`) — `<input type="date">`, optional. Convert on submit: `dueDate ? new Date(dueDate + 'T12:00:00Z').toISOString() : undefined`.
- Assign to (`assignedToId`) — select: first option `value="" → Leave in Task Pool`, then `useAssignees()` options (`{firstName} {lastName}`), mark the current user's own entry with `(you)` using `useAuthStore((s) => s.user)`.
- Link to record: a `linkType` select (`none` | `provider` | `practice`) + when `provider`, a search input debounced 300ms calling `api.get('/providers?search=' + q + '&pageSize=10')` rendering a small result list to pick from (store `providerId`); when `practice`, a select fed by `api.get('/practices')` via a `useQuery(['staff-tasks','practice-options'])`. Enrollment linking is EDIT-ONLY v1 (via detail panel later) — the API supports `enrollmentId`, the modal doesn't offer it; add code comment `// enrollment linking arrives with the enrollment-page "create task" affordance`.

Submit handler:

```tsx
const onSubmit = (values: FormValues) => {
  createMutation.mutate(
    {
      title: values.title.trim(),
      description: values.description?.trim() || undefined,
      priority: values.priority,
      dueDate: values.dueDate ? new Date(values.dueDate + 'T12:00:00Z').toISOString() : undefined,
      assignedToId: values.assignedToId || undefined,
      providerId: values.linkType === 'provider' ? values.providerId || undefined : undefined,
      practiceId: values.linkType === 'practice' ? values.practiceId || undefined : undefined,
    },
    {
      onSuccess: () => { notify.success('Task created'); reset(); onClose(); },
      onError: (error: any) => notify.error('Could not create the task', { description: error?.response?.data?.error?.message ?? 'Try again in a moment.' }),
    },
  );
};
```

Dirty-close guard (spec): wrap `onClose` — `const guardedClose = () => { if (isDirty && !window.confirm('Discard this task?')) return; reset(); onClose(); };` and pass `guardedClose` to `Dialog onClose` and the Cancel/X buttons. (`isDirty` from `formState`.)

In TasksPage, mount: `<NewTaskModal isOpen={isNewTaskOpen} onClose={() => setIsNewTaskOpen(false)} />`.

- [ ] **Step 2: Manual verification in dev app** — empty title shows the inline error and the modal stays open; creating with "Leave in Task Pool" appears in Pool tab; assigning to yourself appears in My Tasks as In progress; typed-then-Esc asks before discarding.

- [ ] **Step 3: Frontend typecheck** — `cd packages/frontend && node ./node_modules/typescript/bin/tsc --noEmit --incremental > /tmp/tsc-fe.log 2>&1; echo "exit: $?"` — Expected: `exit: 0`

- [ ] **Step 4: Commit** — `git add packages/frontend/src/features/tasks/ && git commit -m "feat(tasks): New Task modal with validation, assignee and record linking"`

---

### Task 9: TaskDetailPanel (slide-over)

**Files:**
- Create: `packages/frontend/src/features/tasks/TaskDetailPanel.tsx`
- Modify: `packages/frontend/src/features/tasks/TasksPage.tsx` (mount)

**Interfaces:**
- Consumes: `useUpdateStaffTask`, `useDeleteTask`, `useAssignees`, `StaffTask`, `linkedRecordLabel`/`linkedRecordHref`/`isOverdue` from TaskRow; Headless UI Dialog right-panel (Layout.tsx mobile-sidebar Transition pattern, mirrored to the right).
- Produces: `<TaskDetailPanel task: StaffTask | null onClose />` — renders nothing when task is null.

- [ ] **Step 1: Implement.** Headless UI `Transition.Root show={!!task}` + `Dialog` with `Dialog.Panel className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-gray-200/60 bg-white shadow-xl"`, Transition.Child `enterFrom="translate-x-full" enterTo="translate-x-0"` (and reverse on leave). Content top-to-bottom:

1. Header: `Dialog.Title` = task title (wrap, no truncate) + X close button.
2. Pills row: priority pill (reuse `PRIORITY_STYLES` — export them from TaskRow) + due date (red + "N days overdue" when `isOverdue`; compute `Math.ceil((Date.now() - due) / 86_400_000)`).
3. Status select (`PENDING/IN_PROGRESS/COMPLETED/SKIPPED`) → `updateMutation.mutate({ taskId, data: { status } })`; helper text: "Set automatically when a task is claimed or assigned. Change it here any time."
4. Description block (render `task.description` or muted "No description").
5. Linked record chip → `<Link to={linkedRecordHref(task)}>` when present.
6. Assigned-to select: options from `useAssignees()` + final option `value="" → Back to Task Pool`; on change: `updateMutation.mutate({ taskId, data: { assignedToId: value || null } })`.
7. Activity list (from fields only — no audit-trail fetch v1): "Created by {createdBy names} · {createdAt date}", "Completed by … · {completedAt}" when present.
8. Footer: `Delete…` (danger-ghost; `window.confirm('Delete this task? This can\'t be undone.')` → `deleteMutation.mutate(task.id, { onSuccess: () => { notify.success('Task deleted'); onClose(); } })`) and `Mark complete` primary button (hidden when already COMPLETED).

Mutations `onError`: `notify.error('Could not update the task', { description: error?.response?.data?.error?.message })`. After any successful mutation the list invalidation (Task 5 hooks) refreshes the page behind the panel.

- [ ] **Step 2: Mount in TasksPage** — `<TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} />`.

- [ ] **Step 3: Manual verification** — click a title → panel slides in; change status/assignee reflects in the list; Back to Task Pool moves it to Pool tab as Pending; delete asks then removes; deep link `/tasks?taskId=<id>` opens the panel.

- [ ] **Step 4: Commit** — `git add packages/frontend/src/features/tasks/ && git commit -m "feat(tasks): task detail slide-over with status, reassign, activity, delete"`

---

### Task 10: Assignment toast

**Files:**
- Create: `packages/frontend/src/components/TaskAssignmentToasts.tsx`
- Modify: `packages/frontend/src/components/Layout.tsx` (mount next to `<ApprovalToasts />` at ~L401)

**Interfaces:**
- Consumes: `useNotifications` from `hooks/useNotifications` (already polls 30s); `notify`; `useNavigate`; `useAuthStore`.
- Produces: headless component (renders null) that fires a toast when a new unread task-assignment notification appears.

- [ ] **Step 1: Implement** — hand-rolled toast card (approved mockup has a "View task" button, which `notify` can't render; `ApprovalToasts.tsx` is the in-repo pattern for exactly this — seenIds priming at L76-82, fixed stack container, action buttons):

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useNotifications, useMarkNotificationsRead } from '../hooks/useNotifications';
import { useAuthStore } from '../stores/auth.store';

interface TaskToast { id: string; taskId: string; title: string; }
const AUTO_DISMISS_MS = 10_000;
const MAX_VISIBLE = 3;

export default function TaskAssignmentToasts() {
  const user = useAuthStore((s) => s.user);
  const enabled = user?.role === 'admin' || user?.role === 'lanyard_staff';
  const { data } = useNotifications({ unreadOnly: true, limit: 10 });
  const markRead = useMarkNotificationsRead();
  const navigate = useNavigate();
  const seenIds = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<TaskToast[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const items: any[] = data?.data ?? [];
    const taskItems = items.filter((n) => n.metadata?.kind === 'task_assigned' && n.metadata?.taskId);
    if (seenIds.current === null) {
      seenIds.current = new Set(taskItems.map((n) => n.id)); // prime — no toast storm on login
      return;
    }
    for (const n of taskItems) {
      if (seenIds.current.has(n.id)) continue;
      seenIds.current.add(n.id);
      const toast: TaskToast = { id: n.id, taskId: n.metadata.taskId, title: n.message.replace('You have been assigned: ', '') };
      setToasts((t) => [toast, ...t].slice(0, MAX_VISIBLE));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toast.id)), AUTO_DISMISS_MS);
    }
  }, [data, enabled]);

  if (!enabled || toasts.length === 0) return null;
  return (
    <div className="fixed right-4 top-16 z-50 flex w-80 flex-col gap-2" role="status">
      {toasts.map((t) => (
        <div key={t.id} className="flex items-start gap-2.5 rounded-2xl border border-gray-200/80 bg-white p-3.5 shadow-lg">
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary-100 text-primary-800">
            <CheckCircleIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-900">New task assigned to you</p>
            <p className="truncate text-xs text-gray-600">{t.title}</p>
            <button type="button" className="mt-1 text-xs font-semibold text-primary-700 hover:underline"
              onClick={() => { markRead.mutate([t.id]); setToasts((x) => x.filter((y) => y.id !== t.id)); navigate(`/tasks?taskId=${t.taskId}`); }}>
              View task
            </button>
          </div>
          <button type="button" aria-label="Dismiss" className="ml-auto text-gray-400 hover:text-gray-600"
            onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
```

(Match `useNotifications`/`useMarkNotificationsRead` exact signatures from `hooks/useNotifications.ts` — the mark-read hook takes `notificationIds: string[]`. The bell keeps its own actionUrl click-through independently.)

- [ ] **Step 2: Mount in Layout.tsx** — `<TaskAssignmentToasts />` beside `<ApprovalToasts />`.

- [ ] **Step 3: Manual verification** — two browser sessions (admin + a second dev staff user): assign a task to the other user; within 30s their session shows the toast and the bell badge increments; clicking the bell entry navigates to `/tasks` and opens the panel.

- [ ] **Step 4: Commit** — `git add packages/frontend/src/components/TaskAssignmentToasts.tsx packages/frontend/src/components/Layout.tsx && git commit -m "feat(tasks): in-app toast when a task is assigned to you"`

---

### Task 11: Keyboard shortcuts + bulk actions (efficiency layer)

**Files:**
- Modify: `packages/frontend/src/features/tasks/TasksPage.tsx`, `packages/frontend/src/features/tasks/TaskRow.tsx`

**Interfaces:**
- Consumes: everything already on the page.
- Produces: `n` opens New Task; `j`/`k` move a focused-row highlight; `e` completes the highlighted task; `c` claims it (pool/unassigned only). Bulk: hover checkbox per row + floating bar with "Assign to…" and "Complete" acting on the selection.

- [ ] **Step 1: Shortcuts.** In TasksPage add `const [focusIndex, setFocusIndex] = useState(-1);` and a `useEffect` keydown listener on `window` that early-returns when the event target is an input/textarea/select or when the modal/panel is open (`isNewTaskOpen || selectedTask`):

```tsx
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isNewTaskOpen || selectedTask) return;
    if (e.key === 'n') { e.preventDefault(); setIsNewTaskOpen(true); }
    if (e.key === 'j') setFocusIndex((i) => Math.min(i + 1, tasks.length - 1));
    if (e.key === 'k') setFocusIndex((i) => Math.max(i - 1, 0));
    if (e.key === 'e' && tasks[focusIndex]) handleToggleComplete(tasks[focusIndex]);
    if (e.key === 'c' && tasks[focusIndex] && !tasks[focusIndex].assignedTo) handleClaim(tasks[focusIndex]);
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [tasks, focusIndex, isNewTaskOpen, selectedTask]);
```

Pass `focused={index === focusIndex}` to TaskRow; render `focused && 'bg-primary-50/50 ring-1 ring-inset ring-primary-200'` on the row container. Add a muted hint line under the list: `j/k move · e complete · c claim · n new task`.

- [ ] **Step 2: Bulk select.** TasksPage state `const [selected, setSelected] = useState<Set<string>>(new Set());` cleared on tab change. TaskRow gains `selectable` + `selected` + `onToggleSelect` props: render a checkbox in the first grid column on `group-hover` (make the row a `group`; checkbox `opacity-0 group-hover:opacity-100` unless selected). Floating bar when `selected.size > 0`:

```tsx
{selected.size > 0 && (
  <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 shadow-lg">
    <span className="text-sm font-medium text-gray-700">{selected.size} selected</span>
    <select className="input w-44" defaultValue="" aria-label="Assign selected to" onChange={(e) => { if (e.target.value !== '') bulkAssign(e.target.value === 'POOL' ? null : e.target.value); }}>
      <option value="" disabled>Assign to…</option>
      <option value="POOL">Back to Task Pool</option>
      {(assignees ?? []).map((a) => <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>)}
    </select>
    <button type="button" className="btn-secondary" onClick={bulkComplete}>Complete</button>
    <button type="button" className="text-sm text-gray-500 hover:text-gray-700" onClick={() => setSelected(new Set())}>Clear</button>
  </div>
)}
```

```tsx
// ponytail: N sequential PATCHes via Promise.all; add a bulk endpoint if teams exceed ~20-row selections
const bulkAssign = async (assignedToId: string | null) => {
  await Promise.all([...selected].map((taskId) => updateMutation.mutateAsync({ taskId, data: { assignedToId } })));
  notify.success(`${selected.size} task${selected.size > 1 ? 's' : ''} reassigned`);
  setSelected(new Set());
};
const bulkComplete = async () => {
  await Promise.all([...selected].map((taskId) => updateMutation.mutateAsync({ taskId, data: { status: 'COMPLETED' } })));
  notify.success(`${selected.size} task${selected.size > 1 ? 's' : ''} completed`);
  setSelected(new Set());
};
```

- [ ] **Step 3: Update TasksPage.test.tsx** — add one test: pressing `n` opens the modal (assert by mocked modal presence or `isNewTaskOpen` side effect — render real modal stubbed via `vi.mock('./NewTaskModal', () => ({ default: ({ isOpen }: any) => isOpen ? <div data-testid="new-task-modal" /> : null }))`).

- [ ] **Step 4: Run tests** — `cd packages/frontend && ./node_modules/.bin/vitest run src/features/tasks/ > /tmp/vitest-fe.log 2>&1; echo "exit: $?"` — Expected: `exit: 0`

- [ ] **Step 5: Commit** — `git add packages/frontend/src/features/tasks/ && git commit -m "feat(tasks): keyboard shortcuts and bulk assign/complete"`

---

### Task 12: E2E test, full verification, PR

**Files:**
- Create: `e2e/tests/tasks.spec.ts`
- Modify: `e2e/tests/navigation.spec.ts` (add `{ name: 'Tasks', path: '/tasks' }` to its `navItems` array)

- [ ] **Step 1: E2E spec** (admin-tests project; storageState `e2e/.auth/admin.json` per playwright.config.ts):

```ts
import { test, expect } from '@playwright/test';

test.describe('Tasks page', () => {
  test('create → pool → claim → complete lifecycle', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('tab', { name: 'My Tasks' })).toBeVisible();

    const title = `E2E task ${Date.now()}`;
    await page.getByRole('button', { name: 'New Task' }).click();
    await page.getByRole('button', { name: 'Create task' }).click();          // empty title
    await expect(page.getByText('Give the task a title')).toBeVisible();      // validation holds the modal
    await page.getByLabel('Title').fill(title);
    await page.getByRole('button', { name: 'Create task' }).click();

    await page.getByRole('tab', { name: 'Task Pool' }).click();               // unassigned → pool
    const row = page.locator('div', { hasText: title }).last();
    await row.getByRole('button', { name: 'Claim' }).click();
    await expect(page.getByText('Claimed')).toBeVisible();

    await page.getByRole('tab', { name: 'My Tasks' }).click();
    await page.getByRole('button', { name: `Mark complete: ${title}` }).click();
  });
});
```

Run: `cd e2e && npx playwright test tests/tasks.spec.ts` (dev servers running). Expected: pass. Adjust selectors to the built DOM if needed — keep assertions, not selectors, as the contract.

- [ ] **Step 2: Full verification sweep** (each its own foreground command, timeout 600000):
  - `cd packages/backend && node ./node_modules/typescript/bin/tsc --noEmit > /tmp/tsc-be.log 2>&1; echo "exit: $?"` → 0
  - `cd packages/frontend && node ./node_modules/typescript/bin/tsc --noEmit > /tmp/tsc-fe.log 2>&1; echo "exit: $?"` → 0
  - `cd packages/backend && ./node_modules/.bin/vitest run src/services/staff-task.service.test.ts src/routes/staff-task.routes.test.ts src/routes/task.routes.test.ts > /tmp/vt-be.log 2>&1; echo "exit: $?"` → 0
  - `cd packages/frontend && ./node_modules/.bin/vitest run src/features/tasks/ > /tmp/vt-fe.log 2>&1; echo "exit: $?"` → 0
  - Invoke `superpowers:verification-before-completion` before claiming done.

- [ ] **Step 3: Push + PR** (repo root):

```bash
cd /Users/kaysworld/dev/KAY
git push -u origin feat/staff-task-assignment
gh pr create --title "Staff task assignment system (Tasks page for internal team)" --body "Spec: docs/superpowers/specs/2026-07-15-staff-task-assignment-design.md. Approved mockup: artifact c9736d7a. My/Pool/All views, atomic claim, detail panel, assignment notifications, keyboard + bulk. Endpoints gated to admin + lanyard_staff only.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Deploy path (after Kay merges to develop for staging):** staging migration runs via `DATABASE_URL_ADMIN` (see memory: least-privilege runtime role). Staging E2E per spec's testing section, then prod promotion. Verify live commit SHA after each deploy (Render webhooks flake).

---

## Deliberately NOT in this plan (spec-consistent)

- Auto-generated tasks from credentialing events (phase 2; `createdById: null` + `type` field are the hooks).
- Email notifications/digests, task comments, recurring tasks, practice-facing tasks.
- OpenAPI registration (Phase 0.A scope), enrollment-linking from the New Task modal (edit-only v1), a dedicated bulk endpoint, toast "View" button (bell carries the click-through).
