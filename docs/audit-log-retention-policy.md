# Audit Log Retention Policy (Lanyard prod)

Verdict P1-5 — written retention policy + documented export procedure. Closes the launch-blocker requirement; automated archive-to-R2 is a follow-up.

## Policy

### Scope

Applies to all rows in `audit_logs` (Postgres table, model `AuditLog` at `packages/backend/prisma/schema.prisma`). Captures every authenticated action that mutates or reads protected resources: user, provider, enrollment, document, credentials, payer configuration, admin actions.

### Retention duration

- **Hot retention (in primary DB):** 7 years from row creation.
- **Cold archive:** none yet — see Follow-ups below for the planned R2 archive at >90 days.
- **Hard delete:** never, until a row crosses the 7-year boundary AND has been confirmed archived to cold storage. Until cold archive ships, no automated deletion runs against `audit_logs`.

**Why 7 years.** HIPAA §164.530(j)(2) requires 6 years for documentation; we take the industry-standard 7 to align with most state medical-records retention statutes (CA 7y, NY 6y, TX 7y, FL 5y — taking the max). SOC2 has no explicit floor; auditors expect a written, enforced number.

### Immutability

`audit_logs` is **append-only by code convention**. Verified 2026-06-09:

- 27 call sites invoke `prisma.auditLog.create(...)` across `services/`, `middleware/`, `routes/`, `agents/`, `queues/`.
- **Zero** call sites invoke `auditLog.update`, `auditLog.delete`, `auditLog.deleteMany`, `auditLog.updateMany`, or `auditLog.upsert`.
- The application user `lanyard_app` does not have `DELETE` or `UPDATE` grants on `audit_logs` (per the `project_lanyard_db_role_split` runtime/admin role split — the runtime role can `INSERT`/`SELECT` only).
- Any future code path that mutates `audit_logs` MUST be reviewed by an admin owner and noted in a migration. The schema-drift CI check fails any migration that adds an `UPDATE`/`DELETE` trigger here without explicit annotation.

The combination = audit log tampering by application code is structurally prevented, not just discouraged.

### Coverage

Audit middleware (`packages/backend/src/middleware/audit.middleware.ts`) covers:

- All non-`GET` requests (writes) at `/api/v1/*` when authenticated.
- `GET` requests on a curated allow-list of sensitive read paths: `/api/v1/providers`, `/api/v1/enrollments`, `/api/v1/documents`. Added in PR #340 for SOC2 read-trail evidence.

Anything outside that coverage (background workers, scheduled jobs, agent-initiated mutations) is responsible for its own `auditLog.create` call. The 27 call sites enumerated above are the current set.

### What gets stored

Per row: `userId` (nullable for system actions), `action` enum, `resourceType`, `resourceId`, `changes` (JSON diff or input snapshot), `ipAddress`, `userAgent`, `timestamp`.

PII discipline: `changes` payloads pass through the Winston `phiSanitizer` redaction rules (SSN, NPI, tax ID, banking, DOB, etc.) before persistence. See `packages/backend/src/utils/log-sanitizer.ts` (PR #340 expanded this).

## Export procedure (compliance request, breach investigation, auditor pull)

**When to use:** a regulator, customer, or auditor asks for the audit trail for a specific user, time window, or resource.

### Option A — API export (preferred for narrow scope)

Authenticated `admin` user hits `/api/v1/audit` with the relevant filters:

```bash
# Example: all audit rows for user X in the last 90 days
curl -H "Authorization: Bearer $COGNITO_ID_TOKEN" \
  "https://kay-os62.onrender.com/api/v1/audit?userId=USR&startDate=2026-03-09&pageSize=100"
```

Available query params: `userId`, `resourceType`, `action`, `startDate`, `endDate`, `page`, `pageSize` (max 100 per page; paginate for larger windows).

For a single resource's history: `GET /api/v1/audit/resource/:type/:id`. For a user's history: `GET /api/v1/audit/user/:userId`. Aggregate stats: `GET /api/v1/audit/stats`.

Results include the joined `user` (email, name) so the export is human-readable without an extra join.

### Option B — Full DB export (broad scope, auditor wants everything)

Use Render's built-in PG Export:

1. AWS / Render dashboard → `kay-backend-32426` (prod DB) → **Recovery** tab → **Export** section → **Create export**.
2. Render produces a complete logical dump (`pg_dump`) and retains it for 7 days.
3. Download the export, extract the `audit_logs` rows only:
   ```bash
   pg_restore --table=audit_logs --data-only -f audit_logs.sql kay-backend-export.dump
   ```
4. Convert to CSV or JSON for the recipient. Suggested:
   ```bash
   psql -At -F'|' -f audit_logs.sql | gzip > audit_logs.csv.gz
   ```
5. Deliver via the recipient's preferred secure channel (signed-URL, SFTP, encrypted attachment). Do NOT paste raw audit rows into chat, email body, or any logged channel — `changes` payloads may carry resource IDs that are PHI-adjacent.

### Option C — Direct DB query (last resort, requires admin DB credential)

Run from `psql` using `DATABASE_URL_ADMIN` per the `project_lanyard_db_role_split` runbook. Output to CSV with `\copy`:

```sql
\copy (SELECT * FROM audit_logs WHERE timestamp > '2026-01-01' ORDER BY timestamp) TO 'audit_logs_2026.csv' CSV HEADER
```

Reserve for cases where the API export is too narrow and the full DB dump is too broad.

## Operational guarantees

- **Backup:** audit_logs participates in the Postgres PITR window (see `docs/db-backup-restore-runbook.md`) — RPO ≤ 5s.
- **Availability:** read endpoints under `/api/v1/audit` enforce role check (`admin`, `credentialing_staff`, `practice_admin`); `practice_admin` is scoped to users in their own practice only.
- **Replay protection:** rows are keyed by UUID generated server-side; the `timestamp` column is server-set (`@default(now())`), not client-controlled.

## Follow-ups (post-launch)

1. **Cold archive to R2 (>90d).** Build a nightly cron that selects audit rows older than 90 days, packages them as `audit_logs/<yyyy-mm>/part-<n>.jsonl.gz` in the R2 audit bucket, verifies the upload, then deletes the row from hot DB. Decompression path documented for compliance pulls. **Estimate:** 6-8h including tests + deploy. **Trigger:** when `audit_logs` row count exceeds ~500k or query latency on the `/api/v1/audit` endpoints breaches the p95 < 500ms target from CLAUDE.md.
2. **Hard-delete schedule.** Once the cold archive exists for ≥7 years, add a separate cron to hard-delete from R2 after the retention boundary. No code change until the archive is in place.
3. **Tamper-evidence (defense in depth).** Add a per-row HMAC over `(userId, action, resourceType, resourceId, changes, timestamp)` so out-of-band tampering of the DB is detectable. Useful for post-incident forensics.
4. **Quarterly review.** Operate the export procedure once a quarter on a small synthetic case to keep the muscle memory; record the run in the next quarter's compliance check-in.

## References

- Audit middleware: `packages/backend/src/middleware/audit.middleware.ts`
- Audit routes: `packages/backend/src/routes/audit.routes.ts`
- Schema: `packages/backend/prisma/schema.prisma` (model `AuditLog`)
- PII redaction: `packages/backend/src/utils/log-sanitizer.ts`
- Related: `docs/db-backup-restore-runbook.md`, `docs/cognito-mfa-runbook.md`
