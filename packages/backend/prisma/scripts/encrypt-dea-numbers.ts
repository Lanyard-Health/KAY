/**
 * Post-migration script: Encrypts plaintext DEA numbers
 * in dea_registrations.dea_number_encrypted using AES-256-GCM.
 *
 * The migration copies raw plaintext into dea_number_encrypted.
 * This script reads each row, encrypts the value with encryptSafe(),
 * and writes it back.
 *
 * Usage:
 *   ENCRYPTION_KEY=<hex-key> npx tsx prisma/scripts/encrypt-dea-numbers.ts
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
  const rows = await prisma.deaRegistration.findMany({
    select: { id: true, deaNumberEncrypted: true },
  });

  if (rows.length === 0) {
    console.log('No DEA records found. Nothing to do.');
    return;
  }

  let encrypted = 0;
  let skipped = 0;

  for (const row of rows) {
    const value = row.deaNumberEncrypted;

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

    // Value is plaintext — encrypt it
    const encryptedValue = encryptSafe(value);

    await prisma.deaRegistration.update({
      where: { id: row.id },
      data: { deaNumberEncrypted: encryptedValue },
    });

    encrypted++;
    console.log(`Encrypted DEA number for registration ${row.id}`);
  }

  console.log(`\nDone. Encrypted: ${encrypted}, Already encrypted: ${skipped}, Total: ${rows.length}`);
}

main()
  .catch((err) => {
    console.error('Failed to encrypt DEA numbers:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
