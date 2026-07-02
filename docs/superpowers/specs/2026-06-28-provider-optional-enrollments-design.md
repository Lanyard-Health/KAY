# Provider-Optional Enrollments — Design Spec

**Date:** 2026-06-28
**Status:** Approved design, spec-reviewed 2026-06-28 → implementation plan
**Owner:** Kentesha Ward

## Problem

Today the system hard-codes "an enrollment belongs to a provider" — you cannot
create an enrollment without selecting a provider. But real cases need a
provider-less enrollment:

- A practice exists with **no providers yet** (onboarded practice-first), but
  enrollment work should start.
- Some enrollments are correct with **no individual provider** — enrolling the
  **practice/group itself**, or a **state Medicaid** registration.

This must work for **all Lanyard users** — internal staff, external customers,
and self-service — so it has to be easy to understand.

## Decisions (locked)

- **Unified model.** One Enrollment list; each row has a **subject**.
- **Subject = Provider or Practice now.** Organization is *designed-for but not
  built* (drops in later without a rebuild).
- **"State-level" is not a separate type.** A state Medicaid program is just a
  **payer**, so a state-level enrollment = a practice enrollment with a state
  Medicaid payer.
- **Payer stays required** for every enrollment; only the **provider** becomes
  optional.
- A practice can exist with **zero providers** and still get enrollments.
- **No new permissions** — same access as provider enrollments today.
- **Manual v1.** Practice enrollments are created by hand; auto-draft generation
  for practices is deferred to a follow-up.

## Data model changes (for the engineer)

Verified current state:
- `Enrollment` model → `payer_enrollments` table.
- `providerId String` (**required**), `@@unique([providerId, payerId])`.
- **No** `practiceId` on `Enrollment`.
- Separate `PracticePayer` model already stores group identity
  (`groupNpi`, `groupTaxId`, `groupContractNumber`) per practice+payer.
- Provider → practice link via `ProviderProfile.practiceId` (nullable).

Changes:
1. `providerId` → **optional** (`String?`).
2. Add `practiceId String?` — practice enrollments attach to a practice.
3. Add `subjectType` enum: `PROVIDER` | `PRACTICE` (reserve `ORGANIZATION`).
   Explicit discriminator — do NOT infer the type from which FK is null.
4. **Uniqueness:** replace `@@unique([providerId, payerId])` with **two partial
   unique indexes** — one where `providerId IS NOT NULL` (`providerId, payerId`)
   and one where `practiceId IS NOT NULL` (`practiceId, payerId`). A plain
   composite unique won't enforce practice uniqueness because Postgres treats
   NULLs as distinct.
   **Gotcha (confirm before building):** Prisma 5.12 likely cannot express a
   filtered/partial unique index in `schema.prisma` — there is no `where:`
   precedent anywhere in the current schema. If so, these two indexes must be
   **hand-written raw SQL inside the migration file**, not declared as `@@unique`,
   and the CI schema-drift check may report them as drift. Verify Prisma's
   partial-index support first; budget for the raw-SQL path.

**`PracticePayer` reuse — confirmed (walkthrough 2026-06-28).** `PracticePayer`
is live and load-bearing, not dormant: it has a GET/PATCH admin route, is
auto-seeded per (practice, target payer) on signup and when a practice's target
payers change, and the form-fill + Aetna-RFP pipelines read its
`groupNpi`/`groupTaxIdEncrypted` (priority over `Practice.groupNpi`). The Aetna
resolver fails closed if the row is missing. So the direction holds: keep
`PracticePayer` as the *identity* record (group NPI / tax ID / contract #) and
make the practice `Enrollment` the *workflow/status* record that references the
practice. Reuse, do not duplicate. Evidence:
`practicePayer.routes.ts`, `practiceSignup.service.ts:124`,
`practice.routes.ts:380`, `aetna-rfp-resolver.ts:433`.

**Migration:** define `subjectType` as **`NOT NULL DEFAULT 'PROVIDER'`** —
adding a `NOT NULL` enum column without a default fails on the existing rows.
The default also serves as the backfill for all existing rows. The FK
`provider ProviderProfile @relation(... onDelete: Cascade)` (schema.prisma:1990)
must become nullable too, not just the scalar. Making `providerId` optional does
not touch existing required values → zero behavior change for current rows.

## Verified hidden dependencies (walkthrough 2026-06-28)

The concept is small; the change is not. The codebase assumes every enrollment
has a provider in load-bearing places that will **crash on a null provider**
unless fixed as part of this work.

**Pre-implementation step (do this first):** run
`grep -rn 'enrollment\.provider\.' packages/backend/src` — as of 2026-06-28 that
returns **27 references across 8 files**, not the 6 sites the walkthrough first
caught. Triage every one before writing code; some may already be guarded or
reachable only for provider enrollments, but each must be checked, not assumed.
The confirmed-crashing sites are below; the **additional files the walkthrough
did not cover** (must-audit, not yet confirmed safe) are:
`queues/submission.worker.ts`, `services/ai.service.ts`,
`services/denial-triage.service.ts`, `services/followup.service.ts`,
`services/workflow-approval.service.ts`.

Confirmed crash sites:

1. **CAQH monitor agent** — `monitor-agent.ts:75` reads
   `enrollment.provider.caqhProviderId` directly. Null → crash. Practice
   enrollments have no CAQH provider; the monitor must skip them.
2. **Enrollment workflow routes** — `enrollment-workflow.routes.ts:59,81,82`
   dereference `enrollment.provider.id / .firstName` with no null check.
3. **Follow-up routes** — `followup.routes.ts:534,599,632,647` dereference
   `existing.enrollment.provider.*` in pause/resume logic.
4. **Create endpoint is provider-locked** — the only create route is
   `POST /enrollments/provider/:providerId` (`enrollment.routes.ts:290`, create
   at :352 with `providerId: providerId!`). There is **no door** to create a
   provider-less enrollment. Add a unified `POST /enrollments`
   (`{ subjectType, providerId?, practiceId?, payerId, ... }`) or a sibling
   `POST /enrollments/practice/:practiceId`.
5. **Auto-draft generator** — `ensureDraftEnrollments` (`draft-enrollment.service.ts`)
   builds a provider×payer cartesian product, so a practice with **zero
   providers produces zero drafts**. Practice-level enrollments need their own
   creation branch (or stay manual-only in v1 — see scope note below).
6. **Uniqueness reliance** — `draft-enrollment.service.ts:28` documents reliance
   on `@@unique([providerId, payerId])` to skip duplicates; the partial-index
   change must preserve that for provider rows.

**Provider-readiness gate** (`blockPendingVerification`, `enrollment.routes.ts:43`)
only fires for `role === 'provider'` users, so practice enrollments fall through
it harmlessly — but the practice create path needs its own input validation.

**Scope — DECIDED: Manual v1.** v1 = schema change + new create path + the
null-safety fixes (audit **all** `enrollment.provider.*` sites — see hidden
dependencies above, not a fixed count of 6) + frontend type
picker/badges/empty-state. Practice
enrollments are created **manually** ("+ New Enrollment → A practice").
**Auto-draft generation for practices is explicitly OUT of v1** — deferred to a
follow-up. `ensureDraftEnrollments` stays provider-only in v1; do not change its
cartesian-product logic.

## User experience

**List:** one Enrollments page. New **"What's being enrolled"** column with a
badge — provider or practice. Filter by type. Existing provider rows unchanged.

**Create:** "+ New Enrollment" first asks **"What are you enrolling?"** →
*A provider* / *A practice or group*.
- Provider → today's exact flow (provider → payer → details).
- Practice/group → choose practice → payer (state Medicaid = a payer) →
  details. **No provider step.** Group NPI / tax ID pull from the practice's
  existing record so nothing is retyped.

**Empty practice:** a practice with zero providers opens normally; empty
enrollments list shows a prompt: *"No enrollments yet — add a provider
enrollment or enroll this practice as a group."* That single prompt is the
entire "flesh out an empty practice" story.

**Frontend work confirmed (walkthrough 2026-06-28)** — all in
`features/enrollments/EnrollmentsList.tsx` unless noted:
- The submit guard at :1477 (`disabled={!selectedProvider || ...}`) and the early
  return at :407 (`if (!selectedProvider) return;`) block practice enrollments —
  must change to "provider XOR practice required."
- The create modal has no "what are you enrolling?" step today; it assumes a
  provider. Needs the type-first picker, then branch.
- Rows render provider initials and link to `/providers/{providerId}` (:901) —
  a practice row would show empty initials and a **404 link**. Practice rows must
  show the practice as the primary subject and link to `/practices/{id}`.
  **OPEN ISSUE — resolve before build:** that route is admin-gated
  (`App.tsx:218` wraps `practices/:practiceId` in `<AdminOnlyRoute>`). A
  self-service / external practice admin clicking a practice row would hit a wall,
  which contradicts the "works for all Lanyard users" decision (lines 18–19).
  Pick one: (a) link non-admin users to a page they can actually open, or
  (b) accept that external users can create a practice enrollment but not open its
  subject, and say so explicitly.
- `Enrollment` TS interface (:38–65) needs `subjectType` + `practiceId`.
- New empty-state copy for "zero providers + zero enrollments" (today's copy at
  :651 is provider-first).

## Edge cases & what does NOT change

- **Statuses/workflow:** identical for both types. No new statuses.
- **Existing data:** all current enrollments become `PROVIDER` via backfill.
- **Type guard:** if `subjectType = PROVIDER`, provider is still required at the
  app level even though it's optional at the DB level.
- **Deleting a provider with enrollments:** unchanged (out of scope).
- **Deleting a practice with enrollments:** NEW case — the new `practiceId` FK
  needs an explicit `onDelete` choice. Pick one, don't let Prisma's default
  decide silently: `Cascade` (deleting the practice deletes its practice
  enrollments) or `Restrict` (block the delete while enrollments exist).
- **Migration is effectively one-way:** once any practice enrollment exists
  (`providerId = NULL`), you cannot revert `providerId` back to required without
  first deleting those rows. Note this in any rollback attempt.
- **Out of scope (designed-for, not built):** organization/parent-entity
  enrollments; any change to how state Medicaid payers are managed.

## Rollout — staging-first (hard gate)

**No change reaches production until tested in staging first.**

**Staging reality — CONFIRMED (walkthrough 2026-06-28):** there is **no staging
frontend**. `render.yaml` defines one frontend service (`kay-frontend`,
production, pointed at the prod backend) and the deploy watchdog monitors only
`kay-backend`, `kay-backend-staging`, and `kay-frontend` — no
`kay-frontend-staging`. So the "test in staging UI" step is:

1. Run the **frontend locally** against the staging backend:
   `VITE_API_URL=https://kay-backend-staging.onrender.com/api/v1 npm run dev`
   (in `packages/frontend`).
2. Walk the new flows in that local UI: create a practice enrollment, confirm
   the badge, confirm the empty-practice prompt, confirm a provider enrollment
   still can't be created without a provider.
3. Only after that passes → branch → PR → merge to `master` (which auto-deploys
   the real frontend to prod).

DB migrations on staging/prod must run via `DATABASE_URL_ADMIN` (least-privilege
runtime role can't ALTER pre-2026-06-03 tables). Run the migration against the
staging DB and verify the backfill there before prod.

## How we'll know it works

- Migration test: existing enrollments all come out `PROVIDER`, unchanged.
- Create a practice enrollment with **no provider** → succeeds, practice badge.
- Create a provider enrollment with no provider → still **rejected** (app guard).
- Duplicate guard: two practice enrollments for same practice+payer → blocked.
- External/self-service practice admin can create a practice enrollment
  (permissions unchanged).
- **Null-provider safety (the riskiest part — must be tested):** with a practice
  enrollment present, the CAQH monitor agent runs and **skips it without
  crashing**.
- **Null-provider safety:** the follow-up pause/resume path runs against a
  practice enrollment without dereferencing a null provider (no crash).
