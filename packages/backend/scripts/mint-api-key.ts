/**
 * Mint or revoke a partner API key.
 *
 *   npx tsx scripts/mint-api-key.ts --practice <practiceId|name> --name "Acme Health" [--days 90]
 *   npx tsx scripts/mint-api-key.ts --revoke <keyPrefix>
 *   npx tsx scripts/mint-api-key.ts --list
 *
 * The raw key is written to .api-keys/<prefix>.txt (gitignored) and never
 * printed to stdout — a bearer credential echoed into a terminal ends up in
 * scrollback, then in a paste, then somewhere you cannot revoke.
 *
 * Hand that file to the partner through a shared secret store, then delete it.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { prisma } from '../src/utils/prisma.js';
import { hashApiKey, API_KEY_PREFIX } from '../src/middleware/apiKey.middleware.js';

const DEFAULT_TTL_DAYS = 90;
const OUT_DIR = join(process.cwd(), '.api-keys');

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Slug used for the service account's synthetic cognitoId. Never collides with a real Cognito sub. */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function list(): Promise<void> {
  const keys = await prisma.apiKey.findMany({
    select: {
      keyPrefix: true, name: true, expiresAt: true, revokedAt: true, lastUsedAt: true,
      practice: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (keys.length === 0) {
    console.log('No API keys.');
    return;
  }
  for (const k of keys) {
    const state = k.revokedAt ? 'REVOKED' : k.expiresAt < new Date() ? 'EXPIRED' : 'active';
    console.log(
      `${k.keyPrefix}…  ${state.padEnd(8)}  ${k.practice.name}  "${k.name}"  ` +
        `expires ${k.expiresAt.toISOString().slice(0, 10)}  ` +
        `last used ${k.lastUsedAt?.toISOString().slice(0, 10) ?? 'never'}`
    );
  }
}

async function revoke(prefix: string): Promise<void> {
  const result = await prisma.apiKey.updateMany({
    where: { keyPrefix: prefix, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) {
    console.error(`No active key with prefix "${prefix}".`);
    process.exit(1);
  }
  console.log(`Revoked ${result.count} key(s) with prefix ${prefix}. Effective immediately — there is no cache.`);
}

async function mint(practiceRef: string, name: string, days: number): Promise<void> {
  const practice = await prisma.practice.findFirst({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      OR: [{ id: practiceRef }, { name: practiceRef }],
    },
    select: { id: true, name: true },
  });
  if (!practice) {
    console.error(`No active practice matching "${practiceRef}".`);
    process.exit(1);
  }

  // Service account. role practice_admin — NOT admin (grants isSuperAdmin) and
  // NOT lanyard_staff (dashboard.routes.ts lets a platform role read any
  // practice via ?practiceId=). No UserPractice row, so if any future code path
  // ever re-derives scope from the role it resolves to the deny-all sentinel
  // rather than to every practice.
  const slug = slugify(name);
  const cognitoId = `apikey:${slug}`;
  const email = `apikey+${slug}@lanyardhealth.com`;

  const user = await prisma.user.upsert({
    where: { cognitoId },
    update: { isActive: true },
    create: {
      cognitoId,
      email,
      firstName: 'API',
      lastName: name.slice(0, 60),
      role: 'practice_admin',
      isActive: true,
    },
    select: { id: true },
  });

  const raw = `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
  const keyPrefix = raw.slice(0, 12);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await prisma.apiKey.create({
    data: {
      name,
      keyPrefix,
      tokenHash: hashApiKey(raw),
      practiceId: practice.id,
      userId: user.id,
      expiresAt,
    },
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const outFile = join(OUT_DIR, `${keyPrefix}.txt`);
  writeFileSync(outFile, `${raw}\n`, { mode: 0o600 });

  console.log(`Minted "${name}" for practice ${practice.name}`);
  console.log(`  prefix:  ${keyPrefix}`);
  console.log(`  expires: ${expiresAt.toISOString().slice(0, 10)} (${days} days)`);
  console.log(`  key written to: ${outFile}`);
  console.log('');
  console.log('This is the only copy. Move it into a shared secret store, then delete the file.');
  console.log(`Revoke with: npx tsx scripts/mint-api-key.ts --revoke ${keyPrefix}`);
}

async function main(): Promise<void> {
  const revokePrefix = arg('--revoke');
  if (revokePrefix) return revoke(revokePrefix);
  if (process.argv.includes('--list')) return list();

  const practiceRef = arg('--practice');
  const name = arg('--name');
  if (!practiceRef || !name) {
    console.error('Usage: --practice <practiceId|name> --name "Partner name" [--days 90]');
    console.error('       --revoke <keyPrefix>');
    console.error('       --list');
    process.exit(1);
  }
  const days = Number(arg('--days') ?? DEFAULT_TTL_DAYS);
  if (!Number.isFinite(days) || days < 1) {
    console.error('--days must be a positive number');
    process.exit(1);
  }
  return mint(practiceRef, name, days);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
