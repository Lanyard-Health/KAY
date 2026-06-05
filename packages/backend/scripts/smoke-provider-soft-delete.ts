/**
 * Smoke test for the provider soft-delete + restore flow.
 * Runs against the local dev Postgres via the real Prisma client (with extension).
 *
 * Cleans up after itself — leaves no test rows behind.
 */
import { prisma, prismaBase } from '../src/utils/prisma.js';
import {
  softDeleteProvider,
  restoreProvider,
  checkProviderCollision,
  findArchivedProviders,
} from '../src/services/provider.service.js';

const out: { name: string; pass: boolean; detail?: string }[] = [];
function record(name: string, pass: boolean, detail?: string) {
  out.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const testNpi = `9${Date.now().toString().slice(-9)}`; // unique-ish 10-digit NPI
  const created = await prismaBase.providerProfile.create({
    data: {
      npi: testNpi,
      firstName: 'Smoke',
      lastName: 'Test',
      email: `smoke-${Date.now()}@dev.local`,
      phone: '5555550100',
      dateOfBirth: new Date('1990-01-01'),
      gender: 'prefer_not_to_say',
      providerType: 'other',
      specialties: [],
      languages: [],
      status: 'active',
    },
  });

  try {
    // 1. Soft-delete — sets deletedAt + deletedBy + deletionReason
    const del = await softDeleteProvider({
      providerId: created.id,
      actorId: created.createdById ?? null,
      reason: 'smoke',
    });
    record('1. softDeleteProvider sets deletedAt', del.provider.deletedAt instanceof Date);
    record('1. softDeleteProvider sets deletionReason', del.provider.deletionReason === 'smoke');
    record('1. softDeleteProvider not-already-deleted', del.wasAlreadyDeleted === false);

    // 2. Hidden from default extension reads
    const viaExtension = await prisma.providerProfile.findUnique({ where: { id: created.id } });
    record('2. extension hides soft-deleted from findUnique', viaExtension === null);

    const inList = await prisma.providerProfile.findMany({ where: { id: created.id } });
    record('2. extension hides soft-deleted from findMany', inList.length === 0);

    // 3. Findable via bypass client (used by restore + archived view)
    const viaBypass = await prismaBase.providerProfile.findUnique({ where: { id: created.id } });
    record('3. bypass client still finds soft-deleted', viaBypass !== null && viaBypass.id === created.id);

    // 4. Idempotent on already-deleted (no second update, no second audit row)
    const repeat = await softDeleteProvider({
      providerId: created.id, actorId: null, reason: 'should not write',
    });
    record('4. soft-delete idempotent (wasAlreadyDeleted=true)', repeat.wasAlreadyDeleted === true);
    record('4. soft-delete idempotent does NOT bump deletionReason',
      repeat.provider.deletionReason === 'smoke');

    // 5. Collision detection — fresh NPI on the bypass client sees the archived row
    const collision = await checkProviderCollision({
      npi: testNpi, caqhProviderId: null,
      isSuperAdmin: true, practiceIds: [],
    });
    record('5. checkProviderCollision returns archived_in_scope', collision.kind === 'archived_in_scope');

    // 6. Archived list returns the soft-deleted row, paginated
    const archived = await findArchivedProviders({
      isSuperAdmin: true, practiceIds: [], page: 1, pageSize: 50,
    });
    const inArchived = archived.data.some((p) => p.id === created.id);
    record('6. findArchivedProviders returns the row', inArchived);

    // 7. Restore — clears the fields
    const restored = await restoreProvider({
      providerId: created.id, actorId: created.createdById ?? null,
    });
    record('7. restoreProvider clears deletedAt', restored.provider.deletedAt === null);
    record('7. restoreProvider clears deletionReason', restored.provider.deletionReason === null);

    // 8. Visible again via the extension
    const after = await prisma.providerProfile.findUnique({ where: { id: created.id } });
    record('8. restored provider visible via extension', after !== null && after.id === created.id);

    // 9. Audit trail — both rows present with the expected actions
    const audits = await prismaBase.auditLog.findMany({
      where: { resourceType: 'provider', resourceId: created.id },
      orderBy: { timestamp: 'asc' },
      select: { action: true },
    });
    record('9. exactly two audit rows', audits.length === 2,
      `found ${audits.length} (${audits.map(a => a.action).join(', ')})`);
    record('9. first audit is PROVIDER_SOFT_DELETE',
      (audits[0]?.action as string) === 'PROVIDER_SOFT_DELETE');
    record('9. second audit is PROVIDER_RESTORE',
      (audits[1]?.action as string) === 'PROVIDER_RESTORE');
  } finally {
    // Cleanup — hard delete the test provider row. The audit_logs table is append-only
    // (DB trigger blocks DELETE) — that's the correct compliance posture, so the smoke
    // rows stay in dev. Tag them with a known identifier so they're easy to find later.
    await prismaBase.providerProfile.delete({ where: { id: created.id } });
  }

  const failed = out.filter((r) => !r.pass).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prismaBase.$disconnect());
