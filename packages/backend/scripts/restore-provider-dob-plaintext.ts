/**
 * Phase 4 undo — decrypt provider dates of birth back into the plaintext column.
 *
 * This is the reverse of `--clear-plaintext`. It exists so that clearing
 * plaintext is a recoverable operation rather than a one-way door: as long as
 * the ciphertext and the key survive, the plaintext column can be rebuilt.
 *
 * **Rehearse this on staging before clearing plaintext anywhere.** A recovery
 * script that has never been run is a hope, not a control.
 *
 * When you would reach for this:
 *   - a Phase 4 clear ran against the wrong environment
 *   - something downstream turns out to depend on the plaintext column after all
 *   - Phase 5 needs to be rolled back after plaintext was already cleared
 *
 * When this will NOT save you: if `ENCRYPTION_KEY` is lost. The ciphertext is
 * then unreadable and no script can help — that risk is E-9's territory, and
 * the four-copy custody arrangement in `docs/key-custody-runbook.md` is what
 * addresses it.
 *
 * Same `.env` trap as the backfill: `tsx` auto-loads `packages/backend/.env`,
 * which would supply the local DATABASE_URL and the local key. `--apply`
 * requires `--db <name>` and the script refuses unless `current_database()`
 * matches.
 *
 * Usage:
 *   npx tsx scripts/restore-provider-dob-plaintext.ts                          # dry-run
 *   npx tsx scripts/restore-provider-dob-plaintext.ts --apply --db kay_staging
 */
import { prisma } from '../src/utils/prisma.js';
import { decrypt, isEncryptionAvailable } from '../src/utils/crypto.js';

const APPLY = process.argv.includes('--apply');
const DB_FLAG_INDEX = process.argv.indexOf('--db');
const EXPECTED_DB = DB_FLAG_INDEX === -1 ? null : process.argv[DB_FLAG_INDEX + 1] ?? null;

const CIPHERTEXT_SHAPE = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

interface EncryptedRow {
  id: string;
  cipher: string;
}

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

/**
 * Decrypt every ciphertext and write it back as a UTC-midnight timestamp.
 *
 * Only touches rows where plaintext is currently NULL. A row that still has
 * plaintext is left alone — this restores what was cleared, it does not
 * overwrite anything that survived.
 */
async function restore(
  table: 'providers' | 'provider_applications'
): Promise<{ pending: number; restored: number; failures: string[] }> {
  const rows =
    table === 'providers'
      ? await prisma.$queryRaw<EncryptedRow[]>`
          SELECT id, date_of_birth_encrypted AS cipher FROM providers
          WHERE date_of_birth_encrypted IS NOT NULL AND date_of_birth IS NULL
          ORDER BY id`
      : await prisma.$queryRaw<EncryptedRow[]>`
          SELECT id, date_of_birth_encrypted AS cipher FROM provider_applications
          WHERE date_of_birth_encrypted IS NOT NULL AND date_of_birth IS NULL
          ORDER BY id`;

  const failures: string[] = [];
  let restored = 0;
  if (!APPLY) return { pending: rows.length, restored, failures };

  for (const row of rows) {
    if (!CIPHERTEXT_SHAPE.test(row.cipher)) {
      failures.push(`${table} ${row.id}: stored value is not ciphertext — skipped`);
      continue;
    }
    let dob: string;
    try {
      dob = decrypt(row.cipher);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      failures.push(`${table} ${row.id}: does not decrypt (${message}) — skipped`);
      continue;
    }
    if (!DATE_ONLY.test(dob)) {
      failures.push(`${table} ${row.id}: decrypted to "${dob}", not YYYY-MM-DD — skipped`);
      continue;
    }
    const ts = new Date(`${dob}T00:00:00.000Z`);
    if (table === 'providers') {
      await prisma.$executeRaw`UPDATE providers SET date_of_birth = ${ts} WHERE id = ${row.id}`;
    } else {
      await prisma.$executeRaw`UPDATE provider_applications SET date_of_birth = ${ts} WHERE id = ${row.id}`;
    }
    restored++;
  }
  return { pending: rows.length, restored, failures };
}

async function main(): Promise<void> {
  if (!isEncryptionAvailable()) {
    console.error('ABORT: ENCRYPTION_KEY is not set. Nothing can be decrypted without it.');
    process.exitCode = 1;
    return;
  }

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (pass --apply to write)'}\n`);
  if (!(await assertTargetDatabase())) {
    process.exitCode = 1;
    return;
  }

  const results = {
    providers: await restore('providers'),
    provider_applications: await restore('provider_applications'),
  };

  for (const [label, r] of Object.entries(results)) {
    console.log(`${label}:`);
    console.log(`  ciphertext with no plaintext: ${r.pending}`);
    if (APPLY) console.log(`  restored:                     ${r.restored}`);
  }

  const failures = Object.values(results).flatMap((r) => r.failures);
  if (failures.length > 0) {
    console.log('\nROWS SKIPPED:');
    for (const f of failures) console.log(`  ${f}`);
  }

  const [remaining] = await prisma.$queryRaw<Array<{ providers: bigint; applications: bigint }>>`
    SELECT
      (SELECT COUNT(*) FROM providers
        WHERE date_of_birth_encrypted IS NOT NULL AND date_of_birth IS NULL)                AS providers,
      (SELECT COUNT(*) FROM provider_applications
        WHERE date_of_birth_encrypted IS NOT NULL AND date_of_birth IS NULL)                AS applications
  `;
  console.log('\nSTILL ENCRYPTED-ONLY:');
  console.log(`  providers:             ${remaining?.providers}`);
  console.log(`  provider_applications: ${remaining?.applications}`);

  if (!APPLY) {
    console.log('\nNothing was written. Re-run with --apply --db <name> to restore.');
    return;
  }
  if (failures.length > 0) {
    console.error('\nCOMPLETED WITH SKIPS — inspect the rows above.');
    process.exitCode = 1;
    return;
  }
  console.log('\nRestore complete.');
}

main()
  .catch((err) => {
    console.error('Restore failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
