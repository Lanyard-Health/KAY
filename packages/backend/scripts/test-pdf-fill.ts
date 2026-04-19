/**
 * Test harness for runPdfFill.
 *
 * Uses a local-filesystem storage adapter so we can exercise the full
 * pipeline without LocalStack / S3. The "S3 key" becomes a relative
 * path inside fixtures/storage/.
 *
 * Usage:
 *   tsx scripts/test-pdf-fill.ts <enrollmentId> <payerFormId>
 *
 * Prerequisites:
 *   1. Run: tsx scripts/seed-healthchoice-recipe.ts     (creates form + fields + mappings)
 *   2. The real HealthChoice PDF is in fixtures/healthchoice-application.pdf
 *   3. <enrollmentId> is a real Enrollment UUID in your dev DB whose
 *      provider has some credentialing data filled in.
 *
 * Output:
 *   - Filled PDF written to fixtures/output/filled-<runId>-<formId>.pdf
 *   - Field log + missingRequired summary printed to stdout
 *   - EnrollmentRun row advanced to awaiting_review (or failed)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/utils/prisma.js';
import {
  runPdfFill,
  type StorageAdapter,
} from '../src/services/form-fill/pdf-fill-runner.js';

const FIXTURES_DIR = path.resolve('fixtures');
const STORAGE_DIR = path.join(FIXTURES_DIR, 'storage');
const OUTPUT_DIR = path.join(FIXTURES_DIR, 'output');
const LOCAL_TEMPLATE_PATH = path.join(FIXTURES_DIR, 'healthchoice-application.pdf');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Local-filesystem storage adapter. Maps S3-style keys to files under
 * fixtures/storage/. On first run, seeds the asset key from the real
 * template PDF in fixtures/ so there's always something to download.
 */
function buildLocalStorage(): StorageAdapter {
  return {
    async download(key: string) {
      const fullPath = path.join(STORAGE_DIR, key);
      try {
        return new Uint8Array(await fs.readFile(fullPath));
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(
            `Template missing at ${fullPath}. ` +
              `Copy the PDF there (or run this script once — it auto-seeds from fixtures/healthchoice-application.pdf on first run).`
          );
        }
        throw err;
      }
    },
    async upload(key: string, bytes: Uint8Array) {
      const fullPath = path.join(STORAGE_DIR, key);
      await ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, bytes);
    },
  };
}

async function seedTemplateOnce(assetUrl: string) {
  const target = path.join(STORAGE_DIR, assetUrl);
  try {
    await fs.access(target);
    return; // already seeded
  } catch {
    // fall through
  }
  await ensureDir(path.dirname(target));
  await fs.copyFile(LOCAL_TEMPLATE_PATH, target);
  console.log(`Seeded template: ${target}`);
}

async function main() {
  const enrollmentId = process.argv[2];
  const payerFormId = process.argv[3];
  if (!enrollmentId || !payerFormId) {
    console.error('usage: tsx scripts/test-pdf-fill.ts <enrollmentId> <payerFormId>');
    process.exit(1);
  }

  await ensureDir(STORAGE_DIR);
  await ensureDir(OUTPUT_DIR);

  // Look up the form's assetUrl so we can seed the template at that key
  const form = await prisma.payerForm.findUnique({
    where: { id: payerFormId },
    select: { id: true, formName: true, assetUrl: true, deliveryEngine: true },
  });
  if (!form) throw new Error(`PayerForm ${payerFormId} not found`);
  if (!form.assetUrl) throw new Error(`PayerForm ${payerFormId} has no assetUrl`);
  console.log(`Form: ${form.formName}`);
  console.log(`Asset: ${form.assetUrl}`);

  await seedTemplateOnce(form.assetUrl);

  const storage = buildLocalStorage();
  const start = Date.now();

  const result = await runPdfFill({
    enrollmentId,
    payerFormId,
    storage,
    triggeredBy: 'test-harness',
  });

  const ms = Date.now() - start;

  // Copy the filled PDF to fixtures/output/ for easy inspection
  const source = path.join(STORAGE_DIR, result.artifact.filledS3Key);
  const dest = path.join(
    OUTPUT_DIR,
    `filled-${result.enrollmentRunId}-${payerFormId}.pdf`
  );
  await fs.copyFile(source, dest);

  console.log(`\n✓ Fill complete in ${ms}ms`);
  console.log(`  enrollmentRunId: ${result.enrollmentRunId}`);
  console.log(`  filled:  ${result.artifact.filledCount}`);
  console.log(`  skipped: ${result.artifact.skippedCount}`);
  console.log(`  missingRequired: ${result.missingRequired.join(', ') || '(none)'}`);
  console.log(`\nFilled PDF: ${dest}\n`);

  console.log('Per-field outcomes:');
  const grouped = new Map<string, number>();
  for (const entry of result.artifact.fieldLog) {
    grouped.set(entry.outcome, (grouped.get(entry.outcome) ?? 0) + 1);
  }
  for (const [outcome, count] of grouped) {
    console.log(`  ${outcome.padEnd(20)} ${count}`);
  }

  console.log('\nFirst 15 field results:');
  for (const entry of result.artifact.fieldLog.slice(0, 15)) {
    const val = entry.writtenValue ?? '';
    const mark =
      entry.outcome === 'filled'
        ? '✓'
        : entry.outcome === 'skipped_no_value'
          ? '·'
          : '✗';
    console.log(`  ${mark}  ${entry.fieldKey.padEnd(40)} ${entry.outcome.padEnd(20)} ${val}`);
  }
}

main()
  .catch((err) => {
    console.error('\n✗ Test harness failed:');
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
