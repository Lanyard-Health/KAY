import { prisma } from '../utils/prisma.js';
import { decryptForTenant, encryptForTenant } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import type { PortalCredentialType } from '@prisma/client';

// ─── Errors ─────────────────────────────────────────────────────────────

export class CredentialMissingError extends Error {
  constructor(
    public readonly payerId: string,
    public readonly credentialType: PortalCredentialType,
    public readonly subjectId: string
  ) {
    super(
      `No active ${credentialType} PortalCredential for payer=${payerId}, ${
        credentialType === 'GROUP' ? 'practice' : 'provider'
      }=${subjectId}`
    );
    this.name = 'CredentialMissingError';
  }
}

export class DuplicateCredentialError extends Error {
  constructor(
    public readonly payerId: string,
    public readonly credentialType: PortalCredentialType,
    public readonly subjectId: string
  ) {
    super(
      `Active ${credentialType} PortalCredential already exists for payer=${payerId}, ${
        credentialType === 'GROUP' ? 'practice' : 'provider'
      }=${subjectId}`
    );
    this.name = 'DuplicateCredentialError';
  }
}

export class PayerNotFoundError extends Error {
  constructor(public readonly payerId: string) {
    super(`Payer ${payerId} not found`);
    this.name = 'PayerNotFoundError';
  }
}

// ─── Public types ───────────────────────────────────────────────────────

/**
 * Short-lived plaintext credential struct. Caller MUST invoke wipe() in a
 * finally block immediately after use:
 *
 *   let cred: ResolvedCredential | undefined;
 *   try {
 *     cred = await resolveCredential(payerId, practiceId, providerId);
 *     await adapter.submit(packet, cred);
 *   } finally {
 *     cred?.wipe();
 *   }
 *
 * wipe() does not erase the underlying string objects from memory (V8 strings
 * are immutable), but it removes any reachable reference held by this struct
 * so the GC can reclaim the plaintext.
 */
export interface ResolvedCredential {
  credentialId: string;
  username: string;
  password: string;
  mfaSeed: string | null;
  extraConfig: string | null;
  wipe(): void;
}

export interface CreateCredentialInput {
  payerId: string;
  practiceId: string;
  providerId?: string | null;
  username: string;
  password: string;
  mfaSeed?: string | null;
  extraConfig?: string | null;
}

// ─── resolveCredential ──────────────────────────────────────────────────

/**
 * Resolves the active PortalCredential for a submission run and decrypts its
 * payload with the practice's tenant-derived key.
 *
 * Dispatch:
 *   - payer.credentialType = GROUP      → lookup by (payerId, practiceId)
 *   - payer.credentialType = INDIVIDUAL → lookup by (payerId, providerId)
 *
 * Both paths derive the encryption key from `practiceId` — GROUP credentials
 * obviously belong to the practice; INDIVIDUAL credentials also live under
 * the practice's tenant key because providers do not have isolated key
 * domains and a provider cannot exist outside a practice.
 *
 * This is the ONLY function that calls decryptForTenant for portal
 * credentials. Adapters never decrypt directly.
 */
export async function resolveCredential(
  payerId: string,
  practiceId: string,
  providerId: string
): Promise<ResolvedCredential> {
  if (!payerId) throw new Error('payerId is required');
  if (!practiceId) throw new Error('practiceId is required');
  if (!providerId) throw new Error('providerId is required');

  const payer = await prisma.payer.findUnique({
    where: { id: payerId },
    select: { id: true, credentialType: true },
  });
  if (!payer) {
    throw new PayerNotFoundError(payerId);
  }

  const credentialType = payer.credentialType;

  const credential =
    credentialType === 'GROUP'
      ? await prisma.portalCredential.findFirst({
          where: {
            payerId,
            practiceId,
            credentialType: 'GROUP',
            isActive: true,
          },
        })
      : await prisma.portalCredential.findFirst({
          where: {
            payerId,
            providerId,
            credentialType: 'INDIVIDUAL',
            isActive: true,
          },
        });

  if (!credential) {
    throw new CredentialMissingError(
      payerId,
      credentialType,
      credentialType === 'GROUP' ? practiceId : providerId
    );
  }

  let username: string;
  let password: string;
  try {
    username = decryptForTenant(practiceId, credential.usernameEncrypted);
    password = decryptForTenant(practiceId, credential.passwordEncrypted);
  } catch (err) {
    // Do not leak the ciphertext or the practiceId-derived key material into
    // the error. Surface a generic decryption-failure error.
    const reason = err instanceof Error ? err.message : 'unknown';
    throw new Error(
      `Failed to decrypt PortalCredential ${credential.id} (tenant key mismatch or corrupt ciphertext): ${reason}`
    );
  }

  const mfaSeed = credential.mfaSeedEncrypted
    ? decryptForTenant(practiceId, credential.mfaSeedEncrypted)
    : null;
  const extraConfig = credential.extraConfigEncrypted
    ? decryptForTenant(practiceId, credential.extraConfigEncrypted)
    : null;

  // Touch lastUsedAt without blocking the caller — submission proceeds
  // regardless of whether this write succeeds.
  prisma.portalCredential
    .update({
      where: { id: credential.id },
      data: { lastUsedAt: new Date() },
    })
    .catch((err) => {
      logger.warn('credential.service: lastUsedAt touch failed', {
        credentialId: credential.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
    });

  const struct: ResolvedCredential = {
    credentialId: credential.id,
    username,
    password,
    mfaSeed,
    extraConfig,
    wipe(this: ResolvedCredential) {
      this.username = '';
      this.password = '';
      this.mfaSeed = null;
      this.extraConfig = null;
    },
  };
  return struct;
}

// ─── createCredential ───────────────────────────────────────────────────

/**
 * Creates a new PortalCredential, encrypting all secret fields with the
 * practice's tenant-derived key. Determines credentialType from input shape:
 * presence of providerId → INDIVIDUAL, otherwise GROUP.
 *
 * Includes an application-layer uniqueness guard. Postgres does NOT treat two
 * NULLs as equal in a unique constraint, so @@unique([payerId, providerId])
 * does not prevent two INDIVIDUAL rows for the same (payer, provider) when
 * practiceId is null on both. Likewise for GROUP credentials with a null
 * providerId. We pre-check before insert to catch the race-free case; a true
 * race between two concurrent creates can still fall back to the DB
 * constraint failure, which propagates as a Prisma error.
 */
export async function createCredential(
  input: CreateCredentialInput
): Promise<{ id: string }> {
  const { payerId, practiceId, providerId, username, password, mfaSeed, extraConfig } = input;
  if (!payerId) throw new Error('payerId is required');
  if (!practiceId) throw new Error('practiceId is required');
  if (!username) throw new Error('username is required');
  if (!password) throw new Error('password is required');

  const credentialType: PortalCredentialType = providerId ? 'INDIVIDUAL' : 'GROUP';

  // Uniqueness guard — covers the NULL-in-unique-constraint Postgres gotcha
  const existing = await prisma.portalCredential.findFirst({
    where:
      credentialType === 'GROUP'
        ? { payerId, practiceId, credentialType: 'GROUP', isActive: true }
        : { payerId, providerId: providerId!, credentialType: 'INDIVIDUAL', isActive: true },
    select: { id: true },
  });
  if (existing) {
    throw new DuplicateCredentialError(
      payerId,
      credentialType,
      credentialType === 'GROUP' ? practiceId : providerId!
    );
  }

  const created = await prisma.portalCredential.create({
    data: {
      payerId,
      practiceId,
      providerId: providerId ?? null,
      credentialType,
      usernameEncrypted: encryptForTenant(practiceId, username),
      passwordEncrypted: encryptForTenant(practiceId, password),
      mfaSeedEncrypted: mfaSeed ? encryptForTenant(practiceId, mfaSeed) : null,
      extraConfigEncrypted: extraConfig ? encryptForTenant(practiceId, extraConfig) : null,
    },
    select: { id: true },
  });

  logger.info('credential.service: created PortalCredential', {
    credentialId: created.id,
    payerId,
    practiceId,
    credentialType,
    hasMfaSeed: !!mfaSeed,
  });

  return created;
}
