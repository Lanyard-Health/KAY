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

**Staging result, 2026-08-09 — clean.** Both columns are
`timestamp without time zone`, so the `::time` cast carries no timezone hazard.

| Table | Rows | With DOB | Non-midnight | `1900-01-01` sentinel |
|---|---|---|---|---|
| `providers` | 7 | 7 | **0** | 0 |
| `provider_applications` | 2 | 2 | **0** | 0 |

**Prod result, 2026-08-09 — clean.** This is the gate that matters; staging
holds 9 rows of mostly synthetic data.

| Table | Rows | With DOB | Non-midnight | `1900-01-01` sentinel |
|---|---|---|---|---|
| `providers` | 18 | 17 | **0** | 0 |
| `provider_applications` | 6 | 6 | **0** | 0 |

One provider row has no date of birth; the column is nullable and the shim
returns null for it. The `1900-01-01` sentinel that migration `20260209203325`
backfilled is absent from both environments — nothing to reconcile.

Re-run this before Phase 3 regardless. These counts are from 2026-08-09 and new
providers arrive between now and then.

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

## Applied — 2026-08-09

Both environments migrated by hand as the admin role, verified, triggers
restored. Nothing in the application writes the new columns yet.

| | Staging | Prod |
|---|---|---|
| `_prisma_migrations.finished_at` | 05:21:57 UTC | 18:54:28 UTC |
| `rolled_back_at` | NULL | NULL |
| Columns present, all nullable | 4/4 | 4/4 |
| Encrypted rows written | 0 | 0 |
| Plaintext rows untouched | 7 / 2 | 17 / 6 |
| Re-enabled autoDeploy + watchdog | yes | yes |
| `/health` after | 200 | 200 |

Point-in-time recovery was available on both back to 2026-08-01, which stood in
for the manual snapshot in step 2.

**Incidental finding — staging-only schema drift.** Staging's migration history
carries `20260724150000_add_payer_submission_details`, which exists on branch
`origin/aetna-enrollment-workflow` (committed 2026-07-24) and was **never merged
to master**. Staging therefore holds a 35-column `payer_submission_details` table
present in neither `schema.prisma` nor master's migrations. Its first apply
attempt failed with the same `42501 permission denied for schema public` this
runbook exists to prevent; it was rolled back and reapplied as admin, so both
rows are resolved and it does not block new migrations. **Prod does not have the
table** (`to_regclass` returned NULL), so this is staging-only. Recorded as a
change-management observation (CC8.1): schema reached a deployed environment
from an unmerged branch.

## Phase 3 — backfill

`scripts/encrypt-provider-dob-backfill.ts`. **Populates the encrypted column and
never touches plaintext**, so the whole phase is reversible: the undo is
`UPDATE <table> SET date_of_birth_encrypted = NULL`. No deploy pause, no DDL,
no migration — it is a script run against a live database.

### The `.env` trap

`tsx` auto-loads `packages/backend/.env`, exactly like the Prisma CLI. If that
file is present it supplies **both** `DATABASE_URL` and `ENCRYPTION_KEY`, so a
run intended for prod would quietly hit the local database with the local key
and report complete success.

Two defences, use both:

1. Move `.env` aside for the run.
2. Pass `--apply --db <name>`. The script reads `current_database()` and refuses
   to write unless it matches. Staging is `kay_staging`; prod is
   `kay_backend_32426`.

### Steps, per environment

```bash
cd packages/backend
mv .env .env.local.bak 2>/dev/null || true

# 1. Dry-run. Writes nothing. Confirms the pre-flight is still lossless and
#    reports how many rows need encrypting.
DATABASE_URL="$DATABASE_URL_ADMIN" ENCRYPTION_KEY="$KEY" \
  npx tsx scripts/encrypt-provider-dob-backfill.ts

# 2. Apply, naming the target database.
DATABASE_URL="$DATABASE_URL_ADMIN" ENCRYPTION_KEY="$KEY" \
  npx tsx scripts/encrypt-provider-dob-backfill.ts --apply --db kay_staging

mv .env.local.bak .env 2>/dev/null || true
```

`ENCRYPTION_KEY` must be the **same key that environment's backend runs with**,
or the app cannot read back anything the backfill writes. It is in Render's env
config for the service, and its fingerprint is recorded in
`docs/key-custody-runbook.md` (`7c00d4ffd0d403fe`) — check the fingerprint
matches before running against prod.

### What must be true when it finishes

The script asserts all of these itself and exits non-zero if any fails:

- Pre-flight lossless — zero non-midnight timestamps
- Every stored ciphertext decrypts back to the exact date plaintext still holds
- Gap report zero — no row has plaintext without ciphertext
- No row left in the failure list

Re-running is a no-op. Verified locally: 6 rows encrypted, second run reported
`needing encryption: 0`, and all three misdirection guards (`--apply` with no
`--db`, with a wrong `--db`, with no key) abort without writing.

### Backfill run — 2026-08-09

Both environments backfilled and independently verified. **Plaintext untouched
and still authoritative**; every row now carries both copies.

| | Staging | Prod |
|---|---|---|
| Key fingerprint used | `7c00d4ffd0d403fe` | `7c00d4ffd0d403fe` |
| Pre-flight non-midnight | 0 / 0 | 0 / 0 |
| `providers` encrypted | 7 / 7 | 17 / 17 |
| `provider_applications` encrypted | 2 / 2 | 6 / 6 |
| Round-trip against plaintext | 9/9 exact | 23/23 exact |
| Ciphertext well-formed | 9 | 23 |
| Values resembling a plain date | 0 | 0 |
| Gap (plaintext, no ciphertext) | 0 | 0 |

Verified independently of the script's own report — staging by direct SQL over
MCP, prod by `psql` — so the evidence does not rest on the tool that did the
writing.

### Observation — staging and prod share one master encryption key

Both environments returned key fingerprint `7c00d4ffd0d403fe`. `ENCRYPTION_KEY`
is therefore identical across staging and production.

Consequences: a staging compromise yields the key that decrypts **production**
PII, and ciphertext is portable between environments. It also diverges from the
per-environment split already adopted for R2 credentials (2026-06-05).

Not a blocker for this work, and deliberately **not** changed mid-migration —
re-keying staging now would strand the ciphertext this backfill just wrote.
Raised as a SOC 2 finding to schedule after Phase 5, when there is a single
documented re-encryption procedure (Information Security Policy §5.3) rather
than a half-migrated column.

### Do not proceed to Phase 4 until

The gap report has been zero on **both** environments for a sustained period,
and new providers created after the backfill are landing in both columns
(Phase 2 dual-write, live in prod since 2026-08-09). Phase 4 is the first
irreversible step: it clears the plaintext that is currently the safety net.

## Phase 4 — stop writing plaintext, then clear it

Two parts. The code change (PR #547, prod `5c8964e`, staging `8e0a519`) removes
the plaintext half of the dual-write. The clear is a manual script run.

```bash
# reversible while the ciphertext and the key both survive
npx tsx scripts/encrypt-provider-dob-backfill.ts --apply --db <name> --clear-plaintext

# the undo
npx tsx scripts/restore-provider-dob-plaintext.ts --apply --db <name>
```

The clear runs only after the same script's verification decrypts every
ciphertext and compares it to the plaintext it is about to delete, and only if
the gap report is zero. It therefore cannot delete a date it has not just proved
it can read back.

### Gates cleared before prod — 2026-08-09

| Gate | Evidence |
|---|---|
| Write path proven in a deployed environment | Provider created through the staging UI at 20:16 UTC landed in both columns; ciphertext 86 chars, correct `iv:authTag:ciphertext` shape |
| Read path proven with plaintext genuinely absent | Staging cleared, then the Edit Provider form still rendered `01/01/1988` — decrypted from the only remaining copy |
| Undo rehearsed against genuinely cleared rows | Staging restore returned 8 + 2 rows; md5 fingerprint of all 10 dates matched pre-clear exactly (`4c45950873e4b6a81560ba8264048df3`) |
| Recovery window | Render PITR `AVAILABLE`, `startsAt 2026-08-02T07:49:44Z` on prod |

Rehearsing the undo is the point of this section. A recovery script that has
never been executed is an assumption, not a control — and this one could not be
tested at all until real rows had been cleared.

### Clear run — 2026-08-09

| Environment | Verified before clear | Providers | Applications | Plaintext left | Unencrypted left |
|---|---|---|---|---|---|
| staging | 10/10 | 8 | 2 | 0 | 0 |
| prod | 23/23 | 17 | 6 | 0 | 0 |

Independent post-clear query on prod (not the script's own output):

```
                        plaintext  encrypted  well_formed  plaintext_leak  gap
providers                       0         17           17               0    0
provider_applications           0          6            6               0    0
```

`well_formed` counts ciphertext matching `^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$`;
`plaintext_leak` counts encrypted-column values that look like a bare date, which
is what a key-less environment would have written.

### Do not proceed to Phase 5 until

A sustained week of zero plaintext rows on both environments, per the plan.
Phase 5a removes the fields from `schema.prisma` and deletes the shim's plaintext
fallback; 5b is the hand-applied `DROP COLUMN`. That order is the inverse of
Phase 1 — deploy first, then drop, because a still-running old container would
`42703` on a column that no longer exists.

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
