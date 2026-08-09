/**
 * Build the Libretto Aetna-RFP params for a provider, straight from Lanyard's
 * own data — the SAME resolver + mapper the submission worker uses. Reads the DB
 * only; contacts no external system. Doubles as a data-completeness check: the
 * resolver throws (with specifics) if the provider's profile can't fill the form.
 *
 * The full params contain PII (NPI, Tax ID, DOB, CAQH ID), so they are written
 * to a file — NEVER printed. Only a non-PII summary goes to stdout.
 *
 * Run (from packages/backend):
 *   npx tsx scripts/build-aetna-params.ts "Janice Weixelman" [payerId] [outFile]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { prisma } from '../src/utils/prisma.js';
import { buildAetnaRfpProviderData } from '../src/agents/portal/aetna-rfp-resolver.js';
import { aetnaPacketToLibrettoParams } from '../src/agents/portal/libretto-aetna-mapper.js';

const fullName = process.argv[2] ?? 'Janice Weixelman';
const payerIdArg = process.argv[3];
const outFile = process.argv[4] ?? `/tmp/${fullName.toLowerCase().replace(/\s+/g, '-')}-aetna-params.json`;

const parts = fullName.trim().split(/\s+/);
const firstName = parts[0]!;
const lastName = parts.slice(1).join(' ') || parts[0]!;

// 1. Provider
const provider = await prisma.providerProfile.findFirst({
  where: {
    firstName: { equals: firstName, mode: 'insensitive' },
    lastName: { equals: lastName, mode: 'insensitive' },
  },
  select: { id: true, practiceId: true, firstName: true, lastName: true, deletedAt: true },
});
if (!provider) {
  console.error(`No provider matching "${firstName} ${lastName}". Check the name/spelling.`);
  process.exit(1);
}
if (provider.deletedAt) {
  console.error(`Provider "${firstName} ${lastName}" is archived (deletedAt set) — not actionable.`);
  process.exit(1);
}
if (!provider.practiceId) {
  console.error(`Provider "${firstName} ${lastName}" has no practice — cannot resolve.`);
  process.exit(1);
}

// 2. Aetna payer
let payerId = payerIdArg;
if (!payerId) {
  const payers = await prisma.payer.findMany({
    where: { name: { contains: 'Aetna', mode: 'insensitive' } },
    select: { id: true, name: true, payerType: true },
  });
  if (payers.length === 0) {
    console.error('No payer with "Aetna" in the name found.');
    process.exit(1);
  }
  if (payers.length > 1) {
    console.error('Multiple Aetna payers — pass the payerId as the 2nd arg:');
    for (const p of payers) console.error(`  ${p.id}  ${p.name} (${p.payerType})`);
    process.exit(1);
  }
  payerId = payers[0]!.id;
}

// 3. Resolve packet (throws with specifics if data incomplete) -> map -> write
const packet = await buildAetnaRfpProviderData(
  { providerId: provider.id, practiceId: provider.practiceId, payerId },
  prisma
);
// First run is ALWAYS a dry run: fill the form, never click the final Submit.
const params = aetnaPacketToLibrettoParams(packet, { confirmSubmit: false });

writeFileSync(outFile, JSON.stringify(params, null, 2));

// Non-PII summary ONLY.
console.log('provider     :', `${provider.firstName} ${provider.lastName}`, `(${provider.id})`);
console.log('payerId      :', payerId);
console.log('lineOfBusiness:', packet.lineOfBusiness);
console.log('state        :', packet.location.state);
console.log('telehealth   :', packet.telehealth);
console.log('confirmSubmit:', params.confirmSubmit, '(dry run — will NOT file)');
console.log('field count  :', Object.keys(params).length);
console.log('params file  :', outFile, '(contains PII — do not paste its contents)');

await prisma.$disconnect();
