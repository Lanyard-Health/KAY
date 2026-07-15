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
- `PATCH /tasks/:id` — status changes, reassignment, claim (set assignee to self), priority/due-date edits.
- `DELETE /tasks/:id` — creator or admin only.
- On assignment (create-with-assignee or reassign), write a notification record for the assignee via the existing notification system. No notification when someone claims their own task.

## Tasks page (UI)

New **Tasks** sidebar item, visible to admin + lanyard_staff only, with an open-count badge (red when anything assigned to you is overdue).

Three tabs:
- **My Tasks** (default): tasks assigned to the viewer, sorted urgent + overdue first, then due date.
- **Task Pool**: unassigned tasks, one-click **Claim**. Visible to admin + lanyard_staff only (like the whole page — no practice role ever sees it).
- **All Tasks**: every open task with assignee column — the oversight view. Visible to both roles.

Row contents: title, priority badge, linked-record chip (click → that provider / practice / enrollment page), due date (red when overdue), assignee, status. Filters: status, priority, practice. Completed tasks hidden by default behind a filter toggle.

**New Task** modal: title, description, priority (default Normal), due date, assign-to dropdown of admin + lanyard_staff users (or "Leave in Task Pool"), and an optional attach-record search (provider / practice / enrollment).

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

## Testing

- Backend: route tests for the new filters, role gates (both allowed roles + a practice-role 403), single-link validation, claim flow, delete permission.
- Staging E2E before prod: create → appears in Task Pool → claim → toast/bell on a second assigned task → complete → badge updates. Staging first per standard rollout.

## Rollout gates (in order)

1. Kay reviews this spec.
2. **UI mockups via /impeccable — Kay approves visuals before any code is written.**
3. Implementation plan (writing-plans), then build on a branch → PR → develop/staging E2E → prod.
