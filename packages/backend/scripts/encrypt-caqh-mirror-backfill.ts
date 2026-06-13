/**
 * P1-8 backfill — encrypt existing CAQH mirror payloads and convert
 * attestation-tracker baselines to section fingerprints, then clear the
 * plaintext columns.
 *
 * What it does, per table:
 *   provider_caqh_mirrors:
 *     - raw_json present, raw_json_encrypted empty  → encrypt, verify the
 *       ciphertext decrypts back to the identical payload, store it, then
 *       NULL raw_json. A row is only cleared after its round-trip verifies.
 *     - raw_json present, raw_json_encrypted present → newer sync already
 *       wrote ciphertext; just NULL the stale plaintext.
 *   caqh_attestation_trackers:
 *     - baseline_snapshot present → store sectionHashes(snapshot) in
 *       baseline_section_hashes (unless already set), then NULL the snapshot.
 *
 * Also reports (read-only) how many rows still use the mirror's seven legacy
 * Json columns (licenses, dea_registrations, ...) — input for the follow-up
 * migration that drops dead columns.
 *
 * Idempotent: re-running converges to "0 plaintext rows" and changes nothing
 * after that.
 *
 * Usage:
 *   # Dry-run (default): row counts only, writes nothing
 *   npx tsx scripts/encrypt-caqh-mirror-backfill.ts
 *
 *   # Apply:
 *   npx tsx scripts/encrypt-caqh-mirror-backfill.ts --apply
 *
 * Requires ENCRYPTION_KEY — aborts rather than fall back to encryptSafe's
 * dev plaintext passthrough.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../src/utils/prisma.js';
import { isEncryptionAvailable } from '../src/utils/crypto.js';
import { encryptMirrorPayload, decryptMirrorPayload } from '../src/services/caqh-mirror.service.js';
import { sectionHashes } from '../src/services/caqh-attestation.service.js';

const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  if (!isEncryptionAvailable()) {
    console.error('ABORT: ENCRYPTION_KEY is not set. Refusing to run — encryptSafe would silently store plaintext.');
    process.exitCode = 1;
    return;
  }

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (pass --apply to write)'}\n`);

  // ---- provider_caqh_mirrors -----------------------------------------------
  const mirrors = await prisma.providerCaqhMirror.findMany({
    select: { id: true, providerProfileId: true, rawJson: true, rawJsonEncrypted: true },
  });
  const needsEncrypt = mirrors.filter((m) => m.rawJson !== null && !m.rawJsonEncrypted);
  const needsClearOnly = mirrors.filter((m) => m.rawJson !== null && m.rawJsonEncrypted);
  const alreadyClean = mirrors.length - needsEncrypt.length - needsClearOnly.length;

  console.log('provider_caqh_mirrors:');
  console.log(`  total rows:                       ${mirrors.length}`);
  console.log(`  plaintext → encrypt + clear:      ${needsEncrypt.length}`);
  console.log(`  stale plaintext → clear only:     ${needsClearOnly.length}`);
  console.log(`  already clean:                    ${alreadyClean}`);

  let encrypted = 0;
  let cleared = 0;
  const failures: string[] = [];

  if (APPLY) {
    for (const m of needsEncrypt) {
      const source = JSON.stringify(m.rawJson);
      const ciphertext = encryptMirrorPayload(m.rawJson);
      // Round-trip gate: never clear plaintext we can't provably get back.
      const roundTrip = JSON.stringify(decryptMirrorPayload(ciphertext));
      if (roundTrip !== source) {
        failures.push(`mirror ${m.id} (provider ${m.providerProfileId}): round-trip mismatch — left untouched`);
        continue;
      }
      await prisma.providerCaqhMirror.update({
        where: { id: m.id },
        data: { rawJsonEncrypted: ciphertext, rawJson: Prisma.DbNull },
      });
      encrypted++;
    }
    for (const m of needsClearOnly) {
      await prisma.providerCaqhMirror.update({
        where: { id: m.id },
        data: { rawJson: Prisma.DbNull },
      });
      cleared++;
    }
    console.log(`  encrypted: ${encrypted}, cleared: ${cleared}, failures: ${failures.length}`);
  }

  // ---- caqh_attestation_trackers -------------------------------------------
  const trackers = await prisma.caqhAttestationTracker.findMany({
    where: { NOT: { baselineSnapshot: { equals: Prisma.AnyNull } } },
    select: { id: true, providerProfileId: true, baselineSnapshot: true, baselineSectionHashes: true },
  });

  console.log('\ncaqh_attestation_trackers:');
  console.log(`  plaintext baselines to convert:   ${trackers.length}`);

  let converted = 0;
  if (APPLY) {
    for (const t of trackers) {
      const hashes = (t.baselineSectionHashes ?? sectionHashes(t.baselineSnapshot)) as Prisma.InputJsonValue;
      await prisma.caqhAttestationTracker.update({
        where: { id: t.id },
        data: { baselineSectionHashes: hashes, baselineSnapshot: Prisma.DbNull },
      });
      converted++;
    }
    console.log(`  converted: ${converted}`);
  }

  // ---- legacy column usage report (read-only) ------------------------------
  const [legacy] = await prisma.$queryRaw<Array<Record<string, bigint>>>`
    SELECT
      COUNT(*) FILTER (WHERE licenses IS NOT NULL)              AS licenses,
      COUNT(*) FILTER (WHERE dea_registrations IS NOT NULL)     AS dea_registrations,
      COUNT(*) FILTER (WHERE education IS NOT NULL)             AS education,
      COUNT(*) FILTER (WHERE work_history IS NOT NULL)          AS work_history,
      COUNT(*) FILTER (WHERE malpractice IS NOT NULL)           AS malpractice,
      COUNT(*) FILTER (WHERE hospital_affiliations IS NOT NULL) AS hospital_affiliations,
      COUNT(*) FILTER (WHERE board_certifications IS NOT NULL)  AS board_certifications
    FROM provider_caqh_mirrors
  `;
  console.log('\nlegacy mirror columns still holding data (candidates to drop in follow-up migration):');
  for (const [col, count] of Object.entries(legacy ?? {})) {
    console.log(`  ${col}: ${count}`);
  }

  // ---- post-apply verification ---------------------------------------------
  if (APPLY) {
    const [verify] = await prisma.$queryRaw<Array<{ mirrors: bigint; trackers: bigint }>>`
      SELECT
        (SELECT COUNT(*) FROM provider_caqh_mirrors WHERE raw_json IS NOT NULL)            AS mirrors,
        (SELECT COUNT(*) FROM caqh_attestation_trackers WHERE baseline_snapshot IS NOT NULL) AS trackers
    `;
    console.log('\nVERIFICATION — plaintext rows remaining:');
    console.log(`  provider_caqh_mirrors.raw_json:              ${verify?.mirrors}`);
    console.log(`  caqh_attestation_trackers.baseline_snapshot: ${verify?.trackers}`);
    if (failures.length > 0) {
      console.log('\nGAP REPORT — rows left untouched (need manual inspection):');
      for (const f of failures) console.log(`  ${f}`);
      process.exitCode = 1;
    }
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
