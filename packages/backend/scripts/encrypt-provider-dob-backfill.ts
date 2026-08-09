/**
 * Phase 3 backfill — encrypt existing provider dates of birth (SOC 2 exception E-1).
 *
 * Populates `date_of_birth_encrypted` on `providers` and `provider_applications`
 * from the plaintext `date_of_birth` column.
 *
 * **This script never clears plaintext.** That is Phase 4, behind a separate
 * flag in a separate run, after a deploy has stopped writing plaintext. Until
 * then every row keeps both copies and the whole phase stays reversible: the
 * undo is `UPDATE ... SET date_of_birth_encrypted = NULL`.
 *
 * Two things it does differently from the CAQH mirror backfill it is modelled on:
 *
 *   1. The date is projected to YYYY-MM-DD **in SQL**, via to_char(). Doing it
 *      in JS would put the Node process's timezone between the stored timestamp
 *      and the encrypted value — run the backfill from a laptop in UTC-7 and
 *      every date of birth silently shifts a day.
 *   2. It reads and writes through raw SQL rather than the ORM, so the
 *      soft-delete query extension cannot hide rows. An archived provider still
 *      has a date of birth, and skipping it here would mean Phase 4 clears a
 *      plaintext value that was never encrypted.
 *
 * Idempotent: re-running converges to "0 rows needing encryption" and changes
 * nothing after that.
 *
 * ## The .env trap
 *
 * `tsx` auto-loads `packages/backend/.env`, exactly like the Prisma CLI does.
 * If that file is present it supplies BOTH `DATABASE_URL` and `ENCRYPTION_KEY`,
 * so a run intended for staging or prod would quietly hit the local database
 * with the local key and report success. Move `.env` aside for the run, and
 * pass `--db <name>` so a misdirected run aborts instead of writing.
 *
 * Usage:
 *   npx tsx scripts/encrypt-provider-dob-backfill.ts                        # dry-run
 *   npx tsx scripts/encrypt-provider-dob-backfill.ts --apply --db kay_staging
 *   npx tsx scripts/encrypt-provider-dob-backfill.ts --apply --db kay_backend_32426
 *
 * Phase 4 only, after the deploy that stops writing plaintext:
 *   ... --apply --clear-plaintext --db kay_staging
 *
 * `--clear-plaintext` is the one destructive step in this migration. It runs
 * only after every ciphertext has been decrypted and compared to the plaintext
 * it is about to delete, so it is recoverable via
 * `scripts/restore-provider-dob-plaintext.ts` — rehearse that on staging first.
 *
 * Requires ENCRYPTION_KEY — aborts rather than fall back to encryptSafe's dev
 * plaintext passthrough, which would write literal dates into the "encrypted"
 * column and make every production read of those rows throw.
 */
import { prisma } from '../src/utils/prisma.js';
import { encrypt, decrypt, isEncryptionAvailable } from '../src/utils/crypto.js';

const APPLY = process.argv.includes('--apply');
/**
 * Phase 4. Deletes the plaintext column's contents — the only step in this
 * migration that destroys data. Guarded three ways below: it will not run
 * unless every row's ciphertext has been decrypted and compared against the
 * plaintext about to be deleted, the gap report is zero, and the caller named
 * the database. The undo is `scripts/restore-provider-dob-plaintext.ts`, which
 * must have been rehearsed on staging first.
 */
const CLEAR_PLAINTEXT = process.argv.includes('--clear-plaintext');
const DB_FLAG_INDEX = process.argv.indexOf('--db');
const EXPECTED_DB = DB_FLAG_INDEX === -1 ? null : process.argv[DB_FLAG_INDEX + 1] ?? null;

/**
 * Refuse to write unless the caller named the database they meant.
 *
 * `tsx` auto-loads `.env`, so an operator who forgets to move it aside gets the
 * local DATABASE_URL and the local ENCRYPTION_KEY while believing they are
 * pointed at prod. Every check downstream would pass — against the wrong data.
 * Naming the target turns that silent misfire into a refusal.
 */
async function assertTargetDatabase(): Promise<boolean> {
  const [row] = await prisma.$queryRaw<Array<{ db: string; usr: string }>>`
    SELECT current_database() AS db, current_user AS usr
  `;
  const db = row?.db ?? '(unknown)';
  console.log(`Connected to database "${db}" as "${row?.usr ?? '(unknown)'}"\n`);

  if (!APPLY) return true;

  if (!EXPECTED_DB) {
    console.error(
      `ABORT: --apply requires --db <name> naming the intended target.\n` +
      `This connection is to "${db}". If that is what you meant, re-run with:\n` +
      `  --apply --db ${db}`
    );
    return false;
  }
  if (EXPECTED_DB !== db) {
    console.error(
      `ABORT: you asked for "${EXPECTED_DB}" but this connection is to "${db}".\n` +
      `Most likely packages/backend/.env is shadowing DATABASE_URL. Move it aside and retry.`
    );
    return false;
  }
  return true;
}

interface PendingRow {
  id: string;
  dob: string;
}

interface TableResult {
  label: string;
  pending: number;
  encrypted: number;
  failures: string[];
}

/** iv:authTag:ciphertext, all hex — what a correct encrypt() produces. */
const CIPHERTEXT_SHAPE = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/;

/**
 * Encrypt one date and prove it comes back before returning it. A ciphertext
 * that does not round-trip is never stored — the row is reported instead.
 */
function encryptVerified(dob: string, rowRef: string, failures: string[]): string | null {
  const ciphertext = encrypt(dob);

  if (!CIPHERTEXT_SHAPE.test(ciphertext)) {
    failures.push(`${rowRef}: ciphertext failed shape check — left untouched`);
    return null;
  }
  let roundTrip: string;
  try {
    roundTrip = decrypt(ciphertext);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    failures.push(`${rowRef}: ciphertext did not decrypt (${message}) — left untouched`);
    return null;
  }
  if (roundTrip !== dob) {
    failures.push(`${rowRef}: round-trip mismatch — left untouched`);
    return null;
  }
  return ciphertext;
}

/**
 * Both counts must be zero. Projecting a TIMESTAMP to YYYY-MM-DD is only
 * lossless at exact UTC midnight; a row with a time component would silently
 * lose it. Recorded clean for staging and prod on 2026-08-09, re-checked here
 * because rows arrive between then and now.
 */
async function preflight(): Promise<boolean> {
  const [row] = await prisma.$queryRaw<Array<{ providers: bigint; applications: bigint }>>`
    SELECT
      (SELECT COUNT(*) FROM providers
        WHERE date_of_birth IS NOT NULL AND date_of_birth::time <> '00:00:00')             AS providers,
      (SELECT COUNT(*) FROM provider_applications
        WHERE date_of_birth IS NOT NULL AND date_of_birth::time <> '00:00:00')             AS applications
  `;
  const providers = Number(row?.providers ?? 0);
  const applications = Number(row?.applications ?? 0);

  console.log('PRE-FLIGHT — timestamps that are not exact UTC midnight (both must be 0):');
  console.log(`  providers:            ${providers}`);
  console.log(`  provider_applications: ${applications}`);

  if (providers > 0 || applications > 0) {
    console.error(
      '\nABORT: at least one date of birth carries a time component. Projecting it to\n' +
      'YYYY-MM-DD would move the date for those rows. Dump them and decide individually —\n' +
      'the correct projection is the UTC date, which is what CAQH has been receiving.'
    );
    return false;
  }
  console.log('  → lossless\n');
  return true;
}

async function backfillProviders(): Promise<TableResult> {
  const rows = await prisma.$queryRaw<PendingRow[]>`
    SELECT id, to_char(date_of_birth, 'YYYY-MM-DD') AS dob
    FROM providers
    WHERE date_of_birth IS NOT NULL AND date_of_birth_encrypted IS NULL
    ORDER BY id
  `;
  const failures: string[] = [];
  let encrypted = 0;

  if (APPLY) {
    for (const row of rows) {
      const ciphertext = encryptVerified(row.dob, `providers ${row.id}`, failures);
      if (!ciphertext) continue;
      await prisma.$executeRaw`
        UPDATE providers SET date_of_birth_encrypted = ${ciphertext} WHERE id = ${row.id}
      `;
      encrypted++;
    }
  }
  return { label: 'providers', pending: rows.length, encrypted, failures };
}

async function backfillApplications(): Promise<TableResult> {
  const rows = await prisma.$queryRaw<PendingRow[]>`
    SELECT id, to_char(date_of_birth, 'YYYY-MM-DD') AS dob
    FROM provider_applications
    WHERE date_of_birth IS NOT NULL AND date_of_birth_encrypted IS NULL
    ORDER BY id
  `;
  const failures: string[] = [];
  let encrypted = 0;

  if (APPLY) {
    for (const row of rows) {
      const ciphertext = encryptVerified(row.dob, `provider_applications ${row.id}`, failures);
      if (!ciphertext) continue;
      await prisma.$executeRaw`
        UPDATE provider_applications SET date_of_birth_encrypted = ${ciphertext} WHERE id = ${row.id}
      `;
      encrypted++;
    }
  }
  return { label: 'provider_applications', pending: rows.length, encrypted, failures };
}

/**
 * Read every stored ciphertext back and confirm it decrypts to the same date the
 * plaintext column still holds. This is the check that matters — it is the
 * evidence that Phase 4 can clear plaintext without losing anything.
 */
async function verify(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ tbl: string; id: string; dob: string; cipher: string }>>`
    SELECT 'providers' AS tbl, id, to_char(date_of_birth, 'YYYY-MM-DD') AS dob,
           date_of_birth_encrypted AS cipher
      FROM providers
     WHERE date_of_birth IS NOT NULL AND date_of_birth_encrypted IS NOT NULL
    UNION ALL
    SELECT 'provider_applications', id, to_char(date_of_birth, 'YYYY-MM-DD'),
           date_of_birth_encrypted
      FROM provider_applications
     WHERE date_of_birth IS NOT NULL AND date_of_birth_encrypted IS NOT NULL
  `;

  const mismatches: string[] = [];
  for (const r of rows) {
    if (!CIPHERTEXT_SHAPE.test(r.cipher)) {
      mismatches.push(`${r.tbl} ${r.id}: stored value is not ciphertext (a key-less run wrote plaintext?)`);
      continue;
    }
    try {
      const got = decrypt(r.cipher);
      if (got !== r.dob) mismatches.push(`${r.tbl} ${r.id}: decrypts to ${got}, plaintext says ${r.dob}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      mismatches.push(`${r.tbl} ${r.id}: does not decrypt (${message})`);
    }
  }

  console.log(`\nVERIFICATION — ${rows.length} encrypted row(s) checked against plaintext:`);
  if (mismatches.length === 0) {
    console.log('  all decrypt back to the exact stored date ✓');
    return true;
  }
  console.log(`  ${mismatches.length} MISMATCH(ES):`);
  for (const m of mismatches) console.log(`    ${m}`);
  return false;
}

/** Rows that would lose their date of birth if Phase 4 ran right now. */
async function gapReport(): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ providers: bigint; applications: bigint }>>`
    SELECT
      (SELECT COUNT(*) FROM providers
        WHERE date_of_birth IS NOT NULL AND date_of_birth_encrypted IS NULL)               AS providers,
      (SELECT COUNT(*) FROM provider_applications
        WHERE date_of_birth IS NOT NULL AND date_of_birth_encrypted IS NULL)               AS applications
  `;
  const providers = Number(row?.providers ?? 0);
  const applications = Number(row?.applications ?? 0);
  const total = providers + applications;

  console.log('\nGAP REPORT — plaintext with no ciphertext (must be 0 before Phase 4):');
  console.log(`  providers:             ${providers}`);
  console.log(`  provider_applications: ${applications}`);
  return total;
}

async function main(): Promise<void> {
  if (!isEncryptionAvailable()) {
    console.error(
      'ABORT: ENCRYPTION_KEY is not set. Refusing to run — a key-less run would write\n' +
      'literal dates into the encrypted column, and every production read of those rows\n' +
      'would then throw.'
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (pass --apply to write)'}\n`);

  if (!(await assertTargetDatabase())) {
    process.exitCode = 1;
    return;
  }

  if (!(await preflight())) {
    process.exitCode = 1;
    return;
  }

  const results = [await backfillProviders(), await backfillApplications()];

  for (const r of results) {
    console.log(`${r.label}:`);
    console.log(`  needing encryption: ${r.pending}`);
    if (APPLY) console.log(`  encrypted:          ${r.encrypted}`);
  }

  const failures = results.flatMap((r) => r.failures);
  if (failures.length > 0) {
    console.log('\nROWS LEFT UNTOUCHED (need manual inspection):');
    for (const f of failures) console.log(`  ${f}`);
  }

  const verified = await verify();
  const gap = await gapReport();

  if (!APPLY) {
    console.log('\nNothing was written. Re-run with --apply to perform the backfill.');
    return;
  }

  if (!verified || failures.length > 0) {
    console.error('\nFAILED — do not proceed to Phase 4 until every row above is resolved.');
    process.exitCode = 1;
    return;
  }
  if (gap > 0) {
    console.error(`\nINCOMPLETE — ${gap} row(s) still have plaintext with no ciphertext.`);
    process.exitCode = 1;
    return;
  }

  if (!CLEAR_PLAINTEXT) {
    console.log('\nBackfill complete. Plaintext is untouched and still authoritative.');
    return;
  }

  // ---- Phase 4: clear plaintext -------------------------------------------
  // Everything above already passed: verify() decrypted every ciphertext and
  // compared it to the plaintext about to be deleted, and the gap report is
  // zero. Reaching here means every row is provably recoverable from its
  // ciphertext, so the delete is recoverable rather than final.
  console.log('\n--clear-plaintext: deleting the plaintext column contents.');
  console.log('Undo: scripts/restore-provider-dob-plaintext.ts (rehearse on staging first).');

  const clearedProviders = await prisma.$executeRaw`
    UPDATE providers SET date_of_birth = NULL
    WHERE date_of_birth IS NOT NULL AND date_of_birth_encrypted IS NOT NULL
  `;
  const clearedApplications = await prisma.$executeRaw`
    UPDATE provider_applications SET date_of_birth = NULL
    WHERE date_of_birth IS NOT NULL AND date_of_birth_encrypted IS NOT NULL
  `;
  console.log(`  providers cleared:             ${clearedProviders}`);
  console.log(`  provider_applications cleared: ${clearedApplications}`);

  const [after] = await prisma.$queryRaw<Array<{ plaintext: bigint; orphans: bigint }>>`
    SELECT
      (SELECT COUNT(*) FROM providers WHERE date_of_birth IS NOT NULL)
        + (SELECT COUNT(*) FROM provider_applications WHERE date_of_birth IS NOT NULL)      AS plaintext,
      (SELECT COUNT(*) FROM providers
        WHERE date_of_birth IS NOT NULL AND date_of_birth_encrypted IS NULL)
        + (SELECT COUNT(*) FROM provider_applications
            WHERE date_of_birth IS NOT NULL AND date_of_birth_encrypted IS NULL)            AS orphans
  `;
  console.log('\nAFTER CLEAR:');
  console.log(`  plaintext rows remaining: ${after?.plaintext}   (expect 0)`);
  console.log(`  of which unencrypted:     ${after?.orphans}   (must be 0 — these would be data loss)`);

  if (Number(after?.orphans ?? 0) > 0) {
    console.error('\nFAILED: rows hold plaintext with no ciphertext. Do NOT proceed to Phase 5.');
    process.exitCode = 1;
    return;
  }
  console.log('\nPlaintext cleared. The encrypted column is now the only copy.');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
