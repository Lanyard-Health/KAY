/**
 * Seed PayerContactInfo from existing data (Tasks v2). Idempotent; skips
 * payers that already have a row. NOT part of the migration — run per env:
 *
 *   cd packages/backend && npx tsx scripts/seed-payer-contact-info.ts --dry-run
 *   cd packages/backend && npx tsx scripts/seed-payer-contact-info.ts
 *
 * ALWAYS review the --dry-run report before each live run (per env).
 */
import { prisma } from '../src/utils/prisma.js';
import { planContactSeeds, type ContactSeedSource } from '../src/utils/payer-contact-seed.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const [payers, payerContacts, existing] = await Promise.all([
    prisma.payer.findMany({ select: { id: true, name: true, phone: true } }),
    prisma.payerContact.findMany({
      select: {
        contactType: true, phone: true, email: true, hours: true, notes: true,
        payerTrack: { select: { payerName: true } },
      },
    }),
    prisma.payerContactInfo.findMany({ select: { payerId: true } }),
  ]);

  const contacts: ContactSeedSource[] = payerContacts.map((c) => ({
    trackName: c.payerTrack.payerName,
    contactType: c.contactType,
    phone: c.phone, email: c.email, hours: c.hours, notes: c.notes,
  }));

  const plan = planContactSeeds(payers, contacts, new Set(existing.map((e) => e.payerId)));
  const fromContacts = plan.filter((r) => r.source === 'payer_contact');
  const fromPhone = plan.filter((r) => r.source === 'payer_phone');

  console.log(`Payers in catalog:        ${payers.length}`);
  console.log(`Already seeded (skipped): ${existing.length}`);
  console.log(`Planned rows:             ${plan.length}  (${fromContacts.length} from PayerContact, ${fromPhone.length} from Payer.phone)`);
  for (const row of fromContacts) {
    console.log(`  [contact] ${row.payerName}  phone=${row.phone ?? '—'}  email=${row.email ?? '—'}`);
  }
  console.log(`  [phone-only] ${fromPhone.length} rows (Payer.phone fallback)`);

  if (dryRun) {
    console.log('\nDRY RUN — nothing written. Re-run without --dry-run after reviewing.');
    return;
  }

  let created = 0;
  for (const row of plan) {
    await prisma.payerContactInfo.create({
      data: {
        payerId: row.payerId,
        phone: row.phone, email: row.email, hours: row.hours, notes: row.notes,
        updatedById: null, // system-seeded
      },
    });
    created++;
  }
  console.log(`\nCreated ${created} PayerContactInfo rows.`);
}

main().finally(() => prisma.$disconnect());
