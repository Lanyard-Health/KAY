/**
 * Phase 1 cutover — one-time data migration: legacy
 * `PayerSubmissionConfig.credentialsEncrypted` → per-practice
 * `PortalCredential` rows.
 *
 * Legacy model: one encrypted blob per Payer, shared across every practice.
 * New model: one PortalCredential row per (payer, practice) for GROUP creds
 * or per (payer, provider) for INDIVIDUAL creds, encrypted with that
 * practice's tenant-derived key.
 *
 * This script does NOT drop the source column. That happens in Phase 2 once
 * production has been verified to use PortalCredential exclusively for some
 * monitoring window.
 *
 * Idempotent: skips any (payer, practice) pair that already has an active
 * PortalCredential.
 *
 * Usage:
 *   # Dry-run, list what would be migrated for every practice in the DB:
 *   npx tsx scripts/migrate-portal-credentials.ts --all-practices
 *
 *   # Dry-run for one practice:
 *   npx tsx scripts/migrate-portal-credentials.ts --practice=<practiceId>
 *
 *   # Apply (append --apply to either form):
 *   npx tsx scripts/migrate-portal-credentials.ts --practice=<id> --apply
 *
 * The legacy `credentialsEncrypted` blob is expected to be a JSON string
 * (after master-key decryption) with shape:
 *   { username: string, password: string, mfaSeed?: string, extra?: object }
 *
 * Rows whose payload does not match this shape are logged and skipped. The
 * operator must inspect them manually — never guess at decryption shape.
 */
import { prisma } from '../src/utils/prisma.js';
import { decrypt } from '../src/utils/crypto.js';
import { createCredential, DuplicateCredentialError } from '../src/services/credential.service.js';

const APPLY = process.argv.includes('--apply');
const ALL_PRACTICES = process.argv.includes('--all-practices');
const PRACTICE_ARG = process.argv.find((a) => a.startsWith('--practice='));
const PRACTICE_ID = PRACTICE_ARG ? PRACTICE_ARG.slice('--practice='.length) : null;

interface LegacyPayload {
  username: string;
  password: string;
  mfaSeed?: string;
  extra?: unknown;
}

function parseLegacyPayload(plaintext: string): LegacyPayload | null {
  try {
    const obj = JSON.parse(plaintext);
    if (
      obj &&
      typeof obj === 'object' &&
      typeof obj.username === 'string' &&
      typeof obj.password === 'string'
    ) {
      return obj as LegacyPayload;
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  if (!ALL_PRACTICES && !PRACTICE_ID) {
    console.error(
      'ERROR: must specify either --practice=<id> or --all-practices.\n' +
        '  Re-run with --all-practices to migrate every practice in the DB,\n' +
        '  or with --practice=<id> to scope to one practice.'
    );
    process.exit(1);
  }

  const targetPractices = ALL_PRACTICES
    ? await prisma.practice.findMany({ select: { id: true, name: true } })
    : await prisma.practice.findMany({
        where: { id: PRACTICE_ID! },
        select: { id: true, name: true },
      });

  if (targetPractices.length === 0) {
    console.log('No practices match the target filter — nothing to do.');
    return;
  }

  const configs = await prisma.payerSubmissionConfig.findMany({
    where: { credentialsEncrypted: { not: null } },
    select: { id: true, payerId: true, credentialsEncrypted: true },
  });

  console.log(
    `Found ${configs.length} PayerSubmissionConfig row(s) with credentialsEncrypted.`
  );
  console.log(`Targeting ${targetPractices.length} practice(s).`);
  if (!APPLY) console.log('DRY-RUN — pass --apply to actually write rows.');
  console.log('');

  if (configs.length === 0) {
    console.log('Nothing to migrate. Done.');
    return;
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const config of configs) {
    if (!config.credentialsEncrypted) continue;

    let payload: LegacyPayload | null = null;
    try {
      const plaintext = decrypt(config.credentialsEncrypted);
      payload = parseLegacyPayload(plaintext);
    } catch (err) {
      console.error(
        `  ❌ payer=${config.payerId}: decrypt failed (${err instanceof Error ? err.message : 'unknown'}) — skipping`
      );
      failed++;
      continue;
    }

    if (!payload) {
      console.error(
        `  ❌ payer=${config.payerId}: decrypted but payload shape unrecognized — skipping (inspect manually)`
      );
      failed++;
      continue;
    }

    for (const practice of targetPractices) {
      // Idempotency check — also done inside createCredential, but doing it
      // here lets the dry-run report be accurate.
      const existing = await prisma.portalCredential.findFirst({
        where: {
          payerId: config.payerId,
          practiceId: practice.id,
          credentialType: 'GROUP',
          isActive: true,
        },
        select: { id: true },
      });
      if (existing) {
        console.log(
          `  ⏭  payer=${config.payerId} practice=${practice.id} (${practice.name}) — already has PortalCredential ${existing.id}`
        );
        skipped++;
        continue;
      }

      if (!APPLY) {
        console.log(
          `  + payer=${config.payerId} practice=${practice.id} (${practice.name}) — would create GROUP credential`
        );
        created++;
        continue;
      }

      try {
        const result = await createCredential({
          payerId: config.payerId,
          practiceId: practice.id,
          username: payload.username,
          password: payload.password,
          mfaSeed: payload.mfaSeed ?? null,
          extraConfig: payload.extra ? JSON.stringify(payload.extra) : null,
        });
        console.log(
          `  ✓ payer=${config.payerId} practice=${practice.id} → PortalCredential ${result.id}`
        );
        created++;
      } catch (err) {
        if (err instanceof DuplicateCredentialError) {
          console.log(
            `  ⏭  payer=${config.payerId} practice=${practice.id} — duplicate, skipping`
          );
          skipped++;
        } else {
          console.error(
            `  ❌ payer=${config.payerId} practice=${practice.id}: ${err instanceof Error ? err.message : 'unknown'}`
          );
          failed++;
        }
      }
    }
  }

  console.log('');
  console.log(`Summary: ${APPLY ? 'created' : 'would create'} ${created}, skipped ${skipped}, failed ${failed}`);
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
