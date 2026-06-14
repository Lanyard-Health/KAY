# Phase B — manual apply steps (staging first, then prod)

**Do NOT let the normal Render deploy apply this migration.** The runtime role
`lanyard_app` cannot `ALTER` the `payer_*` tables (owned by `kay_staging_user`)
and cannot `CREATE` tables — it 42501s. This migration is applied **by hand as
`kay_staging_user` via `DATABASE_URL_ADMIN`**, with both deploy triggers paused.

Migration: `20260613120000_payer_brain_outcomes_provenance`
Companion role SQL: `lanyard_crawler_role.sql`
Rollback: `rollback_20260613120000_payer_brain.sql`

---

## 0. Pre-flight (read-only)
- Re-confirm **zero duplicates** for the four new unique keys on the target DB
  (already confirmed on staging 2026-06-13; re-run on prod before applying there):
  ```sql
  SELECT 'reqs' t, count(*) FROM (SELECT 1 FROM payer_requirements GROUP BY payer_track_id,name,override_type HAVING count(*)>1) x
  UNION ALL SELECT 'rules', count(*) FROM (SELECT 1 FROM payer_state_rules GROUP BY payer_track_id,state,rule_type HAVING count(*)>1) x
  UNION ALL SELECT 'timelines', count(*) FROM (SELECT 1 FROM payer_timelines GROUP BY payer_track_id,process_type HAVING count(*)>1) x
  UNION ALL SELECT 'forms', count(*) FROM (SELECT 1 FROM payer_forms GROUP BY payer_track_id,form_name HAVING count(*)>1) x;
  ```
  All counts must be 0.
- Confirm `_prisma_migrations` has no failed/un-rolled-back rows.

## 1. Pause BOTH deploy triggers
A merge or a watchdog cron mid-migration would try the failing `lanyard_app`
path and/or race us. Pause both:
- **Render autoDeploy → off** for `kay-backend-staging` (srv-d8fn3628qa3s73afc9q0):
  `PATCH /v1/services/{id}` `{"autoDeploy":"no"}` (or dashboard toggle).
- **Disable the watchdog GitHub Action** (fires on cron regardless of the dashboard):
  `gh workflow disable "Render Deploy Watchdog"`.

## 2. Snapshot / rollback ready
- Trigger a Render database snapshot of `kay-db-staging` (point-in-time recovery is
  also available). The `rollback_*.sql` is the fast structural undo; a snapshot
  restore is the safety net if the migration half-applies.

## 3. Apply the migration as admin (no .env override)
Prisma silently prefers `packages/backend/.env` over shell exports, so move it
aside for the one command, then restore:
```bash
cd packages/backend
mv .env .env.local.bak 2>/dev/null || true
DATABASE_URL="$DATABASE_URL_ADMIN" npx prisma migrate deploy   # runs DDL + backfill, records bookkeeping
mv .env.local.bak .env 2>/dev/null || true
```
Expect: `1 migration applied`, no P3009/P3018. (P3018 = a unique index hit a
dup → step 0 missed something → stop and rollback.)

## 4. Create the crawler role as admin
```bash
psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f prisma/manual/lanyard_crawler_role.sql
# set its password WITHOUT putting it on the command line:
psql "$DATABASE_URL_ADMIN" -c "\\password lanyard_crawler"
# grant CONNECT on the staging DB (name from the admin URL):
psql "$DATABASE_URL_ADMIN" -c "GRANT CONNECT ON DATABASE <staging_db_name> TO lanyard_crawler;"
```

## 5. Validate on staging (all must pass)
- **Migration clean:** `prisma migrate status` (admin URL) shows it applied, no P3009.
- **App boots + lanyard_app still reads curated tables:** `/health` 200; an admin
  request that reads payer requirements works (the runtime role only needs read).
- **Role isolation — crawler writes crawl tables, 42501s on curated:**
  ```sql
  -- as lanyard_crawler:
  INSERT INTO crawl_sources (id,url,page_type) VALUES ('t1','https://x','requirements');   -- OK
  INSERT INTO payer_requirements (id,payer_track_id,name,override_type,rule,is_blocking)
    VALUES ('t2','...','x','ADDITIONAL','r',false);                                          -- expect: permission denied (42501)
  UPDATE payer_state_rules SET description='x';                                              -- expect: 42501
  DELETE FROM crawl_sources WHERE id='t1';  -- cleanup (as crawler: note DELETE not granted → 42501; clean up as admin)
  ```
- **Recorder, one row:** flip a NON-demo (isDemo=false) staging enrollment to
  `approved`; confirm exactly ONE `enrollment_outcomes` row, correctly tagged
  (payer/state/provider_type/process_type, days_to_outcome).
- **Idempotent:** replay the same approval (re-send webhook / re-save) → still ONE row.
- **Demo excluded:** flip an enrollment under the seeded demo practice
  (`is_demo=true`) to `approved` → ZERO outcomes rows.
- **Backfill:** `SELECT count(*) FROM payer_requirements WHERE verified=true AND captured_at IS NOT NULL;` equals the curated row count; `origin` all `human_curated`.

## 6. Re-enable BOTH triggers, verify the no-op, THEN merge (in that order)
Order matters: re-enable is NOT the same motion as merging #391. Re-enabling
auto-deploy on `develop` means the moment #391 merges, staging rebuilds and runs
`prisma migrate deploy` under the plain `DATABASE_URL` against the DB we just
migrated by hand. It MUST no-op (Prisma finds the migration already applied) — but
that only holds if the migration is recorded as applied first. So:
1. Re-enable Render autoDeploy → on for `kay-backend-staging`.
2. `gh workflow enable "Render Deploy Watchdog"`.
3. **Verify the no-op precondition:** confirm `20260613120000_payer_brain_outcomes_provenance`
   is in `_prisma_migrations` with `finished_at` set and `rolled_back_at` NULL, so
   any develop auto-deploy genuinely no-ops rather than retries the failing
   `lanyard_app` path.
4. **Only then merge #391.** Never re-enable-and-merge in one motion.

## 7. Prod (later, same recipe)
Re-run step 0 dup-check against prod, then steps 1–6 with the **prod** admin URL
and `kay-backend` (srv-d6212t7pm1nc73fjkdk0) + its watchdog. The committed
migration will also be in the repo, so after the PR merges, the normal prod
`migrate deploy` would try it — apply it manually FIRST so the auto-run finds it
already applied (a no-op), never the failing `lanyard_app` path.

## Rollback
```bash
psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f prisma/manual/rollback_20260613120000_payer_brain.sql
```
Then restore the snapshot if anything looks inconsistent.
