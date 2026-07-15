# Staff Task Assignment System — Design

**Date:** 2026-07-15
**Status:** Approved by Kay (functional design). UI mockups pending approval — see Rollout Gates.
**Audience:** lanyard_admin (admin) + lanyard_staff (credentialing staff) only. Practice users never see any of this.

## Goal

Give the internal Lanyard credentialing team a real task system: create work, assign it (or leave it in a shared Task Pool to claim), see what's on each person's plate, and never lose track of overdue items. Manual task creation first; the data model must be ready for auto-generated tasks (from credentialing events) as a later phase without rework.

## What exists today (reuse, don't rebuild)

- `tasks` table (`packages/backend/prisma/schema.prisma:2395`): title, description, type, status (PENDING / IN_PROGRESS / COMPLETED / SKIPPED), `assignedToId`, `dueDate`, `completedAt/ById`. **Requires a provider** today; task types are termination-workflow-specific plus CUSTOM.
- `task.routes.ts` with list/create/patch endpoints gated to `admin` + `credentialing_staff`.
- `ProviderTasks.tsx` panel on the provider detail page.
- The in-app notification system shipped with the transparency dashboards (bell + notification records).

Existing termination tasks keep working untouched; they simply appear in the new views as one kind of task.

## Data model changes

Extend the existing `Task` model — no second task system.

1. `providerId` becomes **optional**.
2. Add optional `practiceId` (FK to Practice). A task links to **at most one** of: provider, practice, enrollment — or none (general work). Enforce single-link in the API layer (reject requests setting more than one), not with a DB constraint.
3. Add `priority` enum: `LOW | NORMAL | HIGH | URGENT`, default `NORMAL`.
4. Add `createdById` (FK to User). Nullable for pre-existing rows; required on new tasks. (When auto-generation arrives later, system-created tasks use a null/system creator — no schema change needed.)
5. Reuse the existing `CUSTOM` task type for general/manual tasks — no `TaskType` enum change. Do not remove existing values.
6. Indexes: `assignedToId`, `priority` (status/type already indexed).

**Migration gotchas (known from past work):**
- Must run with the admin DB role (`DATABASE_URL_ADMIN`) — the runtime `lanyard_app` role gets `42501` altering pre-2026-06-03 tables, and `tasks` predates that.
- New enum values/types need the DB migration **and** a backend redeploy together (Prisma client validates enums).

## API

Extend `task.routes.ts` (keep existing endpoints backward-compatible for ProviderTasks):

- `GET /tasks` — cross-practice list with filters: `assignedToId` (incl. `me` and `unassigned`), `status`, `priority`, `practiceId`. Auth: `admin` + `lanyard_staff` role-gates only, mirroring how other staff routes do it (check the sibling-route allow-list pattern — the "insufficient permissions" 403 class of bug).
- `POST /tasks` — create without requiring a provider; accepts optional provider/practice/enrollment link, priority, assignee.
- **Assignee restriction (Kay decision 2026-07-15):** a task may only be assigned to a user whose role is `admin` or `lanyard_staff`. Enforced server-side on create, reassign, and claim — not just filtered in the dropdown. Any other assignee returns a validation error.
- `PATCH /tasks/:id` — status changes, reassignment, claim (set assignee to self), priority/due-date edits.
  - **Auto-status:** claiming a task or being assigned one sets status to `IN_PROGRESS` automatically (Kay decision 2026-07-15). Nobody maintains status by hand; manual override remains possible from the detail panel.
  - **Claim conflict:** claim uses an atomic conditional update (only succeeds if still unassigned). Loser gets a 409 and the UI shows "Someone else just claimed this" and removes the row.
- `DELETE /tasks/:id` — creator or admin only.
- On assignment (create-with-assignee or reassign), write a notification record for the assignee via the existing notification system. No notification when someone claims their own task.

## Tasks page (UI)

New **Tasks** sidebar item, visible to admin + lanyard_staff only, with an open-count badge (red when anything assigned to you is overdue).

Three tabs:
- **My Tasks** (default): tasks assigned to the viewer, sorted urgent + overdue first, then due date.
- **Task Pool**: unassigned tasks, one-click **Claim**. Visible to admin + lanyard_staff only (like the whole page — no practice role ever sees it).
- **All Tasks**: every open task with assignee column — the oversight view. Visible to both roles.

Row contents: title, priority badge, linked-record chip (click → that provider / practice / enrollment page), due date (red when overdue), assignee, status. Filters: status, priority, practice. Completed tasks hidden by default behind a real toggle switch whose on/off state is visible. Task Pool rows also show "Added N days ago" so stale unclaimed work is visible. Claim is available on unassigned rows in **every** tab, not just Task Pool. Claiming shows an in-place "Claimed ✓ · Undo" affordance (undo window ~5s). Lists over 50 rows get a "Load more" control.

**Task detail panel (required — findings from 2026-07-15 UX critique):** clicking a task title/row opens a slide-over panel from the right (the app's existing pattern) showing description, linked record, status control (manual override of the auto-status), assignee with reassign dropdown, priority + due date editing, activity trail (created by/when, claimed, completed), Complete, and Delete-with-confirm. This is the only place Delete appears. Without this panel the description field is write-only; it is not optional.

**New Task** modal: title, description, priority (default Normal), due date, assign-to dropdown of admin + lanyard_staff users (or "Leave in Task Pool"), and an optional attach-record search (provider / practice / enrollment). Title is required with an inline validation message; Create does not close the modal on validation failure. Closing with typed content asks before discarding.

**Efficiency layer (v1):** bulk select via hover checkboxes with a floating action bar (assign, priority, complete); keyboard shortcuts (j/k rows, e complete, c claim, n new task) extending the existing command-palette vocabulary.

**States (v1, all using the existing LoadingState/ErrorState/EmptyState components):** skeleton rows while loading; claim-conflict toast; empty states for My Tasks, Task Pool, and empty filter results; network-error state.

**Accessibility (WCAG AA):** no text under 13px lighter than #6b7280 on white; sidebar group labels at ≥55% white; complete-circle uses `aria-pressed` and updates its label; modal traps focus and returns it to the trigger on close; tabs support arrow keys; toast actions are keyboard-focusable. Mobile: rows stack (title + meta) rather than dropping columns — the Claim button must never be hidden on small screens.

**Sidebar badge semantics:** one number, one meaning — red overdue count when anything is overdue, otherwise amber open count.

## Notifications

- Bell notification on assignment (existing system).
- If the assignee is online in the app, a toast: "New task assigned: *{title}* — View" with click-through to the task.
- Badge counts as described above.
- **Not in v1:** email of any kind. A daily digest is a later add.

## Permissions summary

| Action | admin | lanyard_staff | practice roles |
|---|---|---|---|
| See Tasks page / Task Pool / any endpoint | yes | yes | no |
| Create / assign / reassign / claim / complete | yes | yes | no |
| Delete | yes | creator only | no |

## Explicitly out of scope for v1

Auto-generated tasks from credentialing events (phase 2 — schema is ready), email notifications/digests, task comments, recurring tasks, practice-user-facing tasks.

**Direction note (Kay decision 2026-07-15):** Tasks is intended to become the single work queue — system-generated work (including what lands in Workflow Queue today) flows INTO Tasks in phase 2 rather than living in a parallel queue. V1 design choices should not preclude this (the `type` field and null-creator convention are the hooks).

## Testing

- Backend: route tests for the new filters, role gates (both allowed roles + a practice-role 403), single-link validation, claim flow, delete permission.
- Staging E2E before prod: create → appears in Task Pool → claim → toast/bell on a second assigned task → complete → badge updates. Staging first per standard rollout.

## Rollout gates (in order)

1. Kay reviews this spec.
2. **UI mockups via /impeccable — Kay approves visuals before any code is written.**
3. Implementation plan (writing-plans), then build on a branch → PR → develop/staging E2E → prod.
