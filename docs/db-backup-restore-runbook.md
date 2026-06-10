# DB Backup / Restore Runbook (Lanyard prod)

Verdict P1-6 — SOC2 requires a tested restore procedure, not just "backups exist".

## Current state (audited 2026-06-09)

| Item | Value |
|---|---|
| Prod DB | `dpg-d71c0v95pdvs73c5mm3g-a` (kay-backend-32426) — Render Postgres, basic_256mb, Oregon |
| Staging DB | `dpg-d8flbuhkh4rs73cnq5ig-a` (kay-db-staging) — Render Postgres, basic_256mb, Oregon |
| Backup method | Render Point-in-Time Recovery (PITR) — automatic, no config required |
| PITR window | 7 days (basic plan default) |
| Backup frequency | Continuous WAL streaming (PITR can restore to any second within window) |
| **RPO** | ≤ 5 seconds (WAL streaming latency) |
| **RTO** | ~5 minutes for a fresh restored instance to come online, observed |

## What we tested on 2026-06-09

PITR drill on staging DB:
- Triggered restore from Render dashboard → Recovery → "Restore database"
- Target timestamp: ~5 min before the drill (within PITR window)
- Restored instance: `kay-db-staging-copy` (separate DB, same plan)
- Outcome:
  - Status transitioned `recovery_in_progress` → `creating` → `available` in ~3 min wall-clock
  - External connection string was generated for the restored DB (different password than source, same user)
  - Restored DB was provably independent of staging (deletion of restored DB did not affect staging)
- Tear-down: deleted via Render dashboard immediately after; verified absence via `GET /v1/postgres`

Caveat: row-count comparison was not completed due to clipboard-handling friction during the drill. The restore mechanism itself was exercised end-to-end. Next drill should pre-stage psql with the connection string in a credential-safe way and run a row-count diff.

## Restore procedure (incident playbook)

**Trigger:** prod data corruption, accidental destructive query, or DB compromise where rollback is the fastest recovery path.

1. **Decide the target timestamp** before doing anything — write it down. PITR is one-shot per restore; choose carefully.
   - Last good state was usually `T - 1 hour` for app-level corruption, `T - 5 minutes` for "we just deleted the wrong row".
2. AWS / Render console → Dashboard → `kay-backend-32426` (prod) or `kay-db-staging` (staging) → **Recovery** tab.
3. Click **Restore database**.
4. Name the new DB `kay-db-prod-restored-YYYY-MM-DD-HHMM` (or `staging-`). Do NOT reuse the prod DB name.
5. Pick the target timestamp from step 1.
6. **Copy Existing Settings = Yes** (keeps the plan and IP allow list aligned).
7. **Start Recovery.** Render provisions a new DB and streams WAL up to the target timestamp.
8. Wait for status = `available` (3–8 min for the basic plan).
9. **Validate the restore** before touching prod traffic:
   - Get the External Database URL from the new DB's Info page.
   - Spot-check row counts on the canonical tables (`users`, `practices`, `providers`, `payer_enrollments`, `audit_logs`).
   - Spot-check a single PII-bearing row that you know existed at the target timestamp (e.g. your own user).
10. **Promote** (only if validation passes):
    - Decide cut-over: blue/green swap (point app at new DB) vs `pg_dump`+`pg_restore` into the original DB.
    - For app-side cut-over: update `DATABASE_URL` and `DATABASE_URL_ADMIN` in Render env vars on `kay-backend` (srv-d6212t7pm1nc73fjkdk0) → trigger redeploy.
    - Schedule a maintenance window if the cut-over takes more than 30 sec of write downtime.
11. **Tear down** any restored DBs after cut-over is verified — they bill hourly.

## Credential handling for restored DBs

- A PITR restore generates a **new password** for the same DB user. The original DB's connection string does NOT work against the restored DB.
- Get the restored DB's External Database URL from its Render Info page. Treat it like prod credentials until the DB is deleted.
- Do NOT paste the URL into chat, screenshots, Linear tickets, or any logged channel. Use the file-based pattern: `pbpaste > /tmp/restore_url; chmod 600 /tmp/restore_url`, then `psql "$(cat /tmp/restore_url)" -f script.sql`.
- Delete the temp file (`shred -u /tmp/restore_url`) when done.

## What's NOT covered yet

- **Cross-region restore.** Render PITR restores within the same region (Oregon). Region-wide outage = no restore option here. Mitigation if Render Oregon goes down for >RTO: bring up `pg_dump` from the most recent **Export** (Recovery → Export, retained 7 days) on a different provider. Not drilled.
- **Encryption key rotation drill.** `ENCRYPTION_KEY` rotation requires re-encrypting all PII columns. Documented in launch-blocker plan; not yet drilled.
- **Application-side data-integrity check after restore.** A SOC2-grade drill would include running the Prisma schema-drift check and a small smoke test against the restored DB. Add to next drill.

## References

- Render PITR docs: https://render.com/docs/postgresql-backups
- Memory: `feedback_clipboard_juggling_antipattern`, `feedback_psql_set_backticks_credential_pattern`
- Related runbook: `cognito-mfa-runbook.md`
