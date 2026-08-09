# Provider DOB encryption, Phase 1 — manual apply steps (staging first, then prod)

**Do NOT let the normal Render deploy apply this migration.** `render.yaml:17`
runs `npx prisma migrate deploy` as the **start command**, under the runtime
role `lanyard_app`. That role cannot `ALTER` `providers` or
`provider_applications` — both were created by the 2026-01-29 init migration and
are owned by the admin role, so the `ALTER` fails with Postgres `42501`. A failed
migration at boot means the app does not start.

Applied **by hand as the admin role via `DATABASE_URL_ADMIN`**, with both deploy
triggers paused, **before** the PR merges.

| | |
|---|---|
| Migration | `20260809045015_provider_dob_encrypted` |
| Rollback | `prisma/manual/rollback_20260809045015_provider_dob.sql` |
| Plan | `~/.claude/plans/write-it-as-a-buzzing-liskov.md` — item 5 |

**What it does:** adds `date_of_birth_encrypted TEXT` to both tables, and drops
`NOT NULL` from `provider_applications.date_of_birth`. Additive only — no data is
read, written, or dropped. Nothing in the application writes the new columns yet
(that is Phase 2), so a half-applied state is inert rather than dangerous.

---

## 0. Pre-flight (read-only, run on the target DB)

The backfill in Phase 3 projects a `TIMESTAMP` to `YYYY-MM-DD`, which is only
lossless at exact UTC midnight. Establish now whether that holds, while there is
still time to decide what to do about it.

```sql
SELECT 'providers' t, count(*) FROM providers
  WHERE date_of_birth IS NOT NULL AND date_of_birth::time <> '00:00:00'
UNION ALL
SELECT 'applications', count(*) FROM provider_applications
  WHERE date_of_birth IS NOT NULL AND date_of_birth::time <> '00:00:00';
```

**Both must be zero.** If either is non-zero, dump those rows and decide
individually — the correct projection is the **UTC** date, because that is what
`caqh.service.ts:2008` has been sending CAQH all along. Record the answer here
before Phase 3.

Also record the sentinel count, so Phase 3's row counts reconcile rather than
surprise (migration `20260209203325` backfilled `'1900-01-01'` into
`provider_applications`):

```sql
SELECT count(*) FROM provider_applications WHERE date_of_birth = '1900-01-01';
```

Confirm `_prisma_migrations` has no failed or un-rolled-back rows.

## 1. Pause BOTH deploy triggers

A merge or a watchdog cron mid-migration would take the failing `lanyard_app`
path or race this one. Pause both:

- **Render autoDeploy → off.** Staging: `kay-backend-staging`
  (`srv-d8fn3628qa3s73afc9q0`). Prod: `kay-backend`
  (`srv-d6212t7pm1nc73fjkdk0`). `PATCH /v1/services/{id}` `{"autoDeploy":"no"}`,
  or the dashboard toggle.
- **Disable the watchdog GitHub Action** — it fires on cron regardless of the
  dashboard toggle: `gh workflow disable "Render Deploy Watchdog"`.

## 2. Snapshot

Trigger a Render database snapshot. The rollback SQL is the fast structural
undo; the snapshot is the safety net if the migration half-applies.

## 3. Apply as admin (move `.env` aside first)

Prisma silently prefers `packages/backend/.env` over shell exports, so a
`migrate deploy` with `.env` present can quietly run against the **local** DB and
report success. Move it aside for the one command, then restore:

```bash
cd packages/backend
mv .env .env.local.bak 2>/dev/null || true
DATABASE_URL="$DATABASE_URL_ADMIN" npx prisma migrate deploy
mv .env.local.bak .env 2>/dev/null || true
```

Expect `1 migration applied`, no P3009/P3018.

## 4. Verify (all must pass)

```sql
-- columns exist, both nullable
SELECT table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE column_name IN ('date_of_birth', 'date_of_birth_encrypted')
  AND table_name IN ('providers', 'provider_applications')
ORDER BY table_name, column_name;
```

Expect four rows. `provider_applications.date_of_birth` must now read
`is_nullable = YES`; both `date_of_birth_encrypted` are `text`, `YES`.

```sql
-- nothing has been written yet
SELECT count(*) FROM providers WHERE date_of_birth_encrypted IS NOT NULL;
SELECT count(*) FROM provider_applications WHERE date_of_birth_encrypted IS NOT NULL;
```

Both zero after Phase 1.

Then confirm the app still boots and behaves: `/health` returns 200, and a
provider detail page still shows a date of birth (it is still being read from
plaintext — Phase 1 changes no behaviour).

## 5. Re-enable BOTH triggers, verify the no-op, THEN merge (in that order)

Re-enabling is not the same motion as merging. The moment the PR merges, Render
rebuilds and runs `prisma migrate deploy` under the plain `DATABASE_URL`. It MUST
no-op — but that only holds if the migration is recorded as applied first.

1. Render autoDeploy → on.
2. `gh workflow enable "Render Deploy Watchdog"`.
3. Confirm `20260809045015_provider_dob_encrypted` is in `_prisma_migrations`
   with `finished_at` set and `rolled_back_at` NULL:
   ```sql
   SELECT migration_name, finished_at, rolled_back_at
   FROM _prisma_migrations
   WHERE migration_name = '20260809045015_provider_dob_encrypted';
   ```
4. **Only then merge the PR.** Never re-enable-and-merge in one motion.

## 6. Prod

Same recipe, `kay-backend` and the prod admin URL. Re-run step 0 against prod
first — the sentinel and non-midnight counts will differ from staging.

Because the migration is committed in the repo, prod's normal `migrate deploy`
will try it after merge. Apply it manually **first** so the automatic run finds
it already applied (a no-op) rather than taking the failing `lanyard_app` path.

## Rollback

```bash
psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 \
  -f prisma/manual/rollback_20260809045015_provider_dob.sql
```

Safe at Phase 1 with no caveats: nothing has been written to the new columns, so
dropping them loses nothing. **It stops being safe after Phase 3 backfills them
and Phase 4 clears plaintext** — from that point the encrypted column is the only
copy, and the rollback would destroy every date of birth. The script refuses to
run if either column holds data.
