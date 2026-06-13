/**
 * reset-staging-data.ts — wipe synthetic beta/tenant data from STAGING ONLY.
 *
 * Staging is synthetic-only. Between beta cohorts (or on a weekly Render cron)
 * we clear out the practices/providers/enrollments testers created, while
 * preserving the demo org and the dev seed users. This keeps staging tidy and
 * keeps it out of real-PII / SOC 2 scope.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  SAFETY: this script HARD-DELETES data. It is built to be IMPOSSIBLE to run
 *  against production by accident. Three independent guards must all pass:
 *
 *   1. --execute flag.   Without it, the script is a DRY RUN: it connects,
 *      counts what it *would* delete, prints the plan, and exits touching
 *      nothing. This is the default.
 *   2. STAGING_RESET_ALLOWED=true must be set in the environment.
 *   3. The live DATABASE_URL host must contain the staging DB fragment
 *      (STAGING_DB_HOST_FRAGMENT, default 'dpg-d8flbuhkh4rs73cnq5ig' =
 *      kay-db-staging). Production's DB host does not contain this fragment,
 *      so a prod DATABASE_URL is refused even with the flags set.
 *
 *  The host guard is checked even in dry-run: this script refuses to so much as
 *  connect to a database that doesn't look like staging.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Preserve (kept, never deleted):
 *   - Practices whose name matches RESET_PRESERVE_PRACTICE_NAMES
 *     (comma list, case-insensitive substring; default 'Lanyard Demo Behavioral Health').
 *   - Practices listed by id in RESET_PRESERVE_PRACTICE_IDS (comma list).
 *   - Users whose email matches RESET_PRESERVE_USER_EMAILS
 *     (comma list; default the *@dev.local seed accounts).
 *
 * Usage:
 *   npx tsx scripts/reset-staging-data.ts             # DRY RUN (default) — shows the plan
 *   STAGING_RESET_ALLOWED=true npx tsx scripts/reset-staging-data.ts --execute   # actually delete
 */

import { prisma } from '../src/utils/prisma.js';

const EXECUTE = process.argv.includes('--execute');

// ── Config (env-overridable) ────────────────────────────────────────────────
const STAGING_DB_HOST_FRAGMENT = (process.env['STAGING_DB_HOST_FRAGMENT'] ?? 'dpg-d8flbuhkh4rs73cnq5ig').trim();
const PRESERVE_PRACTICE_NAMES = splitEnv(process.env['RESET_PRESERVE_PRACTICE_NAMES'] ?? 'Lanyard Demo Behavioral Health');
const PRESERVE_PRACTICE_IDS = new Set(splitEnv(process.env['RESET_PRESERVE_PRACTICE_IDS'] ?? ''));
const PRESERVE_USER_EMAILS = new Set(
  splitEnv(
    process.env['RESET_PRESERVE_USER_EMAILS'] ??
      'admin@dev.local,provider@dev.local,practiceadmin@dev.local,staff@dev.local',
  ).map((e) => e.toLowerCase()),
);

function splitEnv(v: string): string[] {
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Guards ───────────────────────────────────────────────────────────────────

/** Refuses to proceed unless the live DATABASE_URL host looks like staging. */
function assertStagingDatabaseOrExit(): string {
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) {
    console.error('✗ DATABASE_URL is not set — refusing to run.');
    process.exit(1);
  }
  let host: string;
  try {
    // postgres URLs parse fine with the URL constructor; host excludes port.
    host = new URL(dbUrl).hostname;
  } catch {
    console.error('✗ Could not parse DATABASE_URL — refusing to run.');
    process.exit(1);
  }
  if (STAGING_DB_HOST_FRAGMENT.length < 8) {
    console.error(
      `✗ STAGING_DB_HOST_FRAGMENT ('${STAGING_DB_HOST_FRAGMENT}') is too short to be a safe guard — refusing.`,
    );
    process.exit(1);
  }
  if (!host.includes(STAGING_DB_HOST_FRAGMENT)) {
    console.error(
      `✗ SAFETY GUARD: DB host '${host}' does not contain the staging fragment ` +
        `'${STAGING_DB_HOST_FRAGMENT}'. This does not look like the staging database — refusing to run.\n` +
        `   (If staging's host changed, set STAGING_DB_HOST_FRAGMENT to the new value.)`,
    );
    process.exit(1);
  }
  return host;
}

/** Only reached for --execute; dry-run never needs the allow flag. */
function assertExecuteAllowedOrExit(): void {
  if (process.env['STAGING_RESET_ALLOWED'] !== 'true') {
    console.error(
      '✗ SAFETY GUARD: --execute requires STAGING_RESET_ALLOWED=true in the environment. Refusing to delete.',
    );
    process.exit(1);
  }
}

// ── Deletion ─────────────────────────────────────────────────────────────────

interface PracticePlan {
  id: string;
  name: string;
  providerIds: string[];
  counts: {
    providers: number;
    enrollments: number;
    applications: number;
    users: number; // UserPractice links
  };
}

/**
 * Hard-delete one practice and its full data graph in a transaction.
 *
 * Order matters — these tables have foreign keys that DON'T cascade from
 * Practice and would otherwise block the delete (audited against schema.prisma):
 *   - AgentWorkflow has required FKs to both Practice AND ProviderProfile (no cascade).
 *   - ProviderProfile / ProviderApplication / PortalCredential / PracticeLocation
 *     are SetNull on Practice, so a Practice delete would ORPHAN them, not remove
 *     them — we delete them explicitly.
 *   - EnterpriseQueue / FaxJob / PracticeSettings have required FKs to Practice (no cascade).
 * Everything else (UserPractice, invitations, owners, subscription, specialties,
 * and all ProviderProfile/Enrollment children) cascades automatically.
 */
async function deletePractice(plan: PracticePlan): Promise<void> {
  const { id: practiceId, providerIds } = plan;
  await prisma.$transaction(async (tx) => {
    // 1. Agent workflows — blocker for both the providers and the practice.
    await tx.agentWorkflow.deleteMany({ where: { practiceId } });
    if (providerIds.length) {
      await tx.agentWorkflow.deleteMany({ where: { providerId: { in: providerIds } } });
    }
    // 2. Providers → cascades enrollments, licenses, DEA/CDS, banking, demographics, etc.
    await tx.providerProfile.deleteMany({ where: { practiceId } });
    // 3. SetNull-on-Practice rows: delete explicitly so they don't survive orphaned.
    await tx.providerApplication.deleteMany({ where: { practiceId } });
    await tx.portalCredential.deleteMany({ where: { practiceId } });
    await tx.practiceLocation.deleteMany({ where: { practiceId } });
    // 4. Remaining required-FK blockers on Practice.
    await tx.enterpriseQueue.deleteMany({ where: { practiceId } });
    await tx.faxJob.deleteMany({ where: { practiceId } });
    await tx.practiceSettings.deleteMany({ where: { practiceId } });
    // 5. The practice itself → cascades the rest.
    await tx.practice.delete({ where: { id: practiceId } });
  });
}

/**
 * Best-effort cleanup of users orphaned by the practice deletes. Never aborts
 * the run: a user who still authored a record in a PRESERVED practice has a
 * Restrict FK and is simply skipped (left in place) rather than failing.
 */
async function cleanupOrphanedUsers(): Promise<{ deleted: number; skipped: number }> {
  const orphans = await prisma.user.findMany({
    where: { practices: { none: {} } },
    select: { id: true, email: true },
  });
  let deleted = 0;
  let skipped = 0;
  for (const u of orphans) {
    if (PRESERVE_USER_EMAILS.has(u.email.toLowerCase())) {
      skipped++;
      continue;
    }
    try {
      await prisma.user.delete({ where: { id: u.id } });
      deleted++;
    } catch {
      // Still referenced as createdBy/updatedBy somewhere we kept — leave it.
      skipped++;
    }
  }
  return { deleted, skipped };
}

function isPreserved(p: { id: string; name: string }): boolean {
  if (PRESERVE_PRACTICE_IDS.has(p.id)) return true;
  const name = p.name.toLowerCase();
  return PRESERVE_PRACTICE_NAMES.some((frag) => name.includes(frag.toLowerCase()));
}

async function main() {
  const host = assertStagingDatabaseOrExit();
  if (EXECUTE) assertExecuteAllowedOrExit();

  console.log('Staging data reset');
  console.log('────────────────────────────────────────');
  console.log(`Mode:        ${EXECUTE ? 'EXECUTE (will delete)' : 'DRY RUN (no changes)'}`);
  console.log(`DB host:     ${host}`);
  console.log(`Preserve by name:  ${PRESERVE_PRACTICE_NAMES.join(', ') || '(none)'}`);
  console.log(`Preserve by id:    ${[...PRESERVE_PRACTICE_IDS].join(', ') || '(none)'}`);
  console.log(`Preserve users:    ${[...PRESERVE_USER_EMAILS].join(', ') || '(none)'}`);
  console.log('────────────────────────────────────────');

  const allPractices = await prisma.practice.findMany({ select: { id: true, name: true } });
  const targets = allPractices.filter((p) => !isPreserved(p));
  const preserved = allPractices.filter((p) => isPreserved(p));

  console.log(`Practices total: ${allPractices.length}  |  preserve: ${preserved.length}  |  delete: ${targets.length}`);
  for (const p of preserved) console.log(`  KEEP   ${p.id}  ${p.name}`);
  console.log('');

  if (targets.length === 0) {
    console.log('Nothing to delete. Done.');
    return;
  }

  // Build per-practice plans with counts (read-only).
  const plans: PracticePlan[] = [];
  for (const p of targets) {
    const providers = await prisma.providerProfile.findMany({
      where: { practiceId: p.id },
      select: { id: true },
    });
    const providerIds = providers.map((x) => x.id);
    const [enrollments, applications, users] = await Promise.all([
      providerIds.length
        ? prisma.enrollment.count({ where: { providerId: { in: providerIds } } })
        : Promise.resolve(0),
      prisma.providerApplication.count({ where: { practiceId: p.id } }),
      prisma.userPractice.count({ where: { practiceId: p.id } }),
    ]);
    plans.push({
      id: p.id,
      name: p.name,
      providerIds,
      counts: { providers: providerIds.length, enrollments, applications, users },
    });
  }

  for (const plan of plans) {
    const c = plan.counts;
    console.log(
      `  DELETE ${plan.id}  ${plan.name}  ` +
        `(providers:${c.providers} enrollments:${c.enrollments} applications:${c.applications} userLinks:${c.users})`,
    );
  }
  console.log('');

  if (!EXECUTE) {
    console.log('DRY RUN — no rows were deleted.');
    console.log('To actually delete, re-run with: STAGING_RESET_ALLOWED=true ... --execute');
    return;
  }

  let ok = 0;
  for (const plan of plans) {
    try {
      await deletePractice(plan);
      ok++;
      console.log(`  ✓ deleted ${plan.name} (${plan.id})`);
    } catch (err) {
      console.error(`  ✗ FAILED ${plan.name} (${plan.id}):`, err instanceof Error ? err.message : err);
    }
  }

  const users = await cleanupOrphanedUsers();
  console.log('');
  console.log('────────────────────────────────────────');
  console.log(`Practices deleted: ${ok}/${plans.length}`);
  console.log(`Orphaned users removed: ${users.deleted}  |  kept/skipped: ${users.skipped}`);
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error('Reset failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
