/**
 * Post-migration script: Encrypts plaintext JSON credential values
 * in payer_adapter_configs.credentials_encrypted using AES-256-GCM.
 *
 * The migration copies raw JSON text into credentials_encrypted.
 * This script reads each row, encrypts the value with encryptSafe(),
 * and writes it back.
 *
 * Usage:
 *   ENCRYPTION_KEY=<hex-key> npx tsx prisma/scripts/encrypt-payer-credentials.ts
 *
 * Safe to run multiple times — skips values that are already encrypted
 * (detected by the iv:authTag:ciphertext format).
 */

import { PrismaClient } from '@prisma/client';
import { encryptSafe, decryptSafe } from '../../src/utils/crypto.js';

const prisma = new PrismaClient();

function looksEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  // iv = 32 hex chars, authTag = 32 hex chars
  return parts[0]!.length === 32 && parts[1]!.length === 32;
}

async function main() {
  const rows = await prisma.payerSubmissionConfig.findMany({
    where: { credentialsEncrypted: { not: null } },
    select: { id: true, credentialsEncrypted: true },
  });

  if (rows.length === 0) {
    console.log('No rows with credentials to encrypt. Nothing to do.');
    return;
  }

  let encrypted = 0;
  let skipped = 0;

  for (const row of rows) {
    const value = row.credentialsEncrypted!;

    if (looksEncrypted(value)) {
      // Already encrypted — verify it decrypts successfully
      try {
        decryptSafe(value);
        skipped++;
        continue;
      } catch {
        // Falls through to re-encrypt
      }
    }

    // Value is plaintext JSON — encrypt it
    const encryptedValue = encryptSafe(value);

    await prisma.payerSubmissionConfig.update({
      where: { id: row.id },
      data: { credentialsEncrypted: encryptedValue },
    });

    encrypted++;
    console.log(`Encrypted credentials for config ${row.id}`);
  }

  console.log(`Done. Encrypted: ${encrypted}, Already encrypted: ${skipped}`);
}

main()
  .catch((err) => {
    console.error('Failed to encrypt payer credentials:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
