import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { decryptSafe } from '../utils/crypto.js';
import { NotFoundError } from '../middleware/error.middleware.js';
import { logger } from '../utils/logger.js';
import { providerDobDate } from './provider-dob.service.js';

/**
 * Credentialing Packet — unified provider + practice dataset used to
 * populate payer enrollment forms.
 *
 * Assemble once via buildPacket(providerId, payerId?); the form-fill
 * engines (browser, PDF) read from this object rather than issuing
 * their own ad-hoc queries. Keeping the shape stable means new payers
 * can be onboarded by writing field mappings (sourcePath strings)
 * without touching service code.
 *
 * Sensitive fields (SSN, tax IDs, banking) are returned encrypted by
 * default. Pass { decryptSensitive: true } only when the caller is a
 * form-fill engine or other trusted consumer that needs plaintext; the
 * HIPAA hardening rule in CLAUDE.md requires explicit opt-in.
 */

interface BuildPacketOptions {
  /**
   * When true, sensitive fields (SSN, tax IDs, banking) are decrypted.
   * Default false — return the encrypted ciphertext. Only form-fill
   * engines should pass true.
   */
  decryptSensitive?: boolean;
}

const PROVIDER_INCLUDE = {
  addresses: true,
  practiceLocations: true,
  licenses: { orderBy: { expirationDate: 'desc' } },
  boardCertifications: true,
  malpracticeInsurances: { orderBy: { expirationDate: 'desc' } },
  educations: true,
  workHistories: { orderBy: { startDate: 'desc' } },
  hospitalAffiliations: true,
  professionalReferences: true,
  disciplinaryActions: true,
  continuingEducations: true,
  documents: { orderBy: { createdAt: 'desc' } },
  demographics: true,
  deaRegistrations: true,
  providerIdentifiers: true,
  banking: true,
  disclosures: true,
  supervisingPhysicians: true,
  caqhMirror: true,
  checklist: true,
  practice: {
    include: {
      practiceLocations: true,
    },
  },
} satisfies Prisma.ProviderProfileInclude;

type ProviderWithRelations = Prisma.ProviderProfileGetPayload<{
  include: typeof PROVIDER_INCLUDE;
}>;

type PracticePayerRow = Prisma.PracticePayerGetPayload<{ include: { payer: true } }>;

export interface CredentialingPacket {
  provider: ProviderWithRelations;
  practice: ProviderWithRelations['practice'];
  practicePayer: PracticePayerRow | null;
  primaryLocation: ProviderWithRelations['practiceLocations'][number] | null;
  /** Sensitive fields decrypted when decryptSensitive=true, else ciphertext. */
  sensitive: {
    ssn: string | null;
    taxIdPersonal: string | null;
    taxIdGroup: string | null;
    bankingAccountNumber: string | null;
    bankingRoutingNumber: string | null;
  };
  meta: {
    builtAt: string;
    decrypted: boolean;
    payerId: string | null;
    practicePayerId: string | null;
  };
}

function pickPrimaryLocation(
  locations: ProviderWithRelations['practiceLocations']
): ProviderWithRelations['practiceLocations'][number] | null {
  if (!locations || locations.length === 0) return null;
  const primary = locations.find((l) => l.isPrimary);
  return primary ?? locations[0] ?? null;
}

function decryptOrPass(value: string | null | undefined, decrypt: boolean): string | null {
  if (!value) return null;
  if (!decrypt) return value;
  try {
    return decryptSafe(value);
  } catch (err) {
    logger.warn('credentialing-packet: decrypt failed for sensitive field', err);
    return null;
  }
}

/**
 * Assemble a CredentialingPacket for a provider. If payerId is provided,
 * the PracticePayer row (if any) is attached — this is what supplies
 * practice-level fields that only make sense for a specific payer
 * (group NPI, group contract, W-9 status).
 */
export async function buildPacket(
  providerId: string,
  payerId?: string,
  options: BuildPacketOptions = {}
): Promise<CredentialingPacket> {
  const { decryptSensitive = false } = options;

  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    include: PROVIDER_INCLUDE,
  });
  if (!provider) {
    throw new NotFoundError('Provider');
  }

  let practicePayer: PracticePayerRow | null = null;
  if (payerId && provider.practiceId) {
    practicePayer = await prisma.practicePayer.findUnique({
      where: {
        practiceId_payerId: { practiceId: provider.practiceId, payerId },
      },
      include: { payer: true },
    });
  }

  const primaryLocation = pickPrimaryLocation(provider.practiceLocations);

  const primaryBanking = provider.banking?.[0] ?? null;

  const sensitive = {
    ssn: decryptOrPass(provider.ssnEncrypted, decryptSensitive),
    taxIdPersonal: decryptOrPass(
      (provider as any).taxIdEncrypted ?? null,
      decryptSensitive
    ),
    taxIdGroup: decryptOrPass(
      practicePayer?.groupTaxIdEncrypted ?? provider.practice?.taxIdEncrypted ?? null,
      decryptSensitive
    ),
    bankingAccountNumber: decryptOrPass(
      primaryBanking?.accountNumberEncrypted ?? null,
      decryptSensitive
    ),
    bankingRoutingNumber: decryptOrPass(
      primaryBanking?.routingNumberEncrypted ?? null,
      decryptSensitive
    ),
  };

  return {
    // The recipe resolver dot-walks admin-authored `sourcePath` strings straight
    // off this object, and an unresolved path is classified `missingOptional` —
    // informational, not an error. So if `dateOfBirth` ever stopped being
    // populated here, DOB-mapped PDF fields would come out blank, the packet
    // would ship to the payer, and nothing would fail. Re-hydrating through the
    // shim keeps that from happening when Phase 4 clears the plaintext column.
    //
    // The ciphertext is blanked so a recipe cannot map it into a form field.
    provider: {
      ...provider,
      dateOfBirth: providerDobDate(provider),
      dateOfBirthEncrypted: null,
    },
    practice: provider.practice,
    practicePayer,
    primaryLocation,
    sensitive,
    meta: {
      builtAt: new Date().toISOString(),
      decrypted: decryptSensitive,
      payerId: payerId ?? null,
      practicePayerId: practicePayer?.id ?? null,
    },
  };
}
