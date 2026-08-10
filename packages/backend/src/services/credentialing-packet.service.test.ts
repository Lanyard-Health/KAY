import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockDecrypt = vi.fn((v: string) => `decrypted:${v}`);
// Only decryptSafe is stubbed. encrypt/decrypt stay real so the date-of-birth
// shim round-trips genuine AES-256-GCM ciphertext in the buildPacket test below
// — a fully-mocked crypto module would make that test prove nothing.
vi.mock('../utils/crypto.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/crypto.js')>()),
  decryptSafe: (v: string) => mockDecrypt(v),
}));

import { buildPacket } from './credentialing-packet.service.js';
import { dobWrite } from './provider-dob.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { NotFoundError } from '../middleware/error.middleware.js';

const PROVIDER_ID = 'provider-1';
const PRACTICE_ID = 'practice-1';
const PAYER_ID = 'payer-1';

function stubProvider(overrides: any = {}) {
  return {
    id: PROVIDER_ID,
    practiceId: PRACTICE_ID,
    ssnEncrypted: 'cipher-ssn',
    addresses: [],
    practiceLocations: [
      { id: 'loc-1', isPrimary: false, locationName: 'Secondary' },
      { id: 'loc-2', isPrimary: true, locationName: 'Main' },
    ],
    licenses: [],
    boardCertifications: [],
    malpracticeInsurances: [],
    educations: [],
    workHistories: [],
    hospitalAffiliations: [],
    professionalReferences: [],
    disciplinaryActions: [],
    continuingEducations: [],
    documents: [],
    demographics: null,
    deaRegistrations: [],
    providerIdentifiers: [],
    banking: [{ accountNumberEncrypted: 'cipher-acct', routingNumberEncrypted: 'cipher-rt' }],
    disclosures: [],
    supervisingPhysicians: [],
    caqhMirror: null,
    checklist: null,
    practice: {
      id: PRACTICE_ID,
      taxIdEncrypted: 'cipher-practice-tax',
      practiceLocations: [],
    },
    ...overrides,
  } as any;
}

describe('buildPacket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws NotFoundError when provider is missing', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue(null);
    await expect(buildPacket(PROVIDER_ID)).rejects.toThrow(NotFoundError);
  });

  // These three pin the highest-risk failure mode in the DOB encryption work.
  // The recipe resolver dot-walks `provider.dateOfBirth` off the packet, and an
  // unresolved path is classified missingOptional — informational, not an error.
  // A regression here ships forms to payers with a blank date of birth and
  // nothing anywhere fails. Do not delete these without replacing them.
  describe('date of birth', () => {
    it('populates dateOfBirth from ciphertext alone (the post-Phase-4 state)', async () => {
      const { dateOfBirthEncrypted } = dobWrite('1972-09-04');
      prismaMock.providerProfile.findUnique.mockResolvedValue(
        stubProvider({ dateOfBirth: null, dateOfBirthEncrypted })
      );

      const packet = await buildPacket(PROVIDER_ID);

      expect(packet.provider.dateOfBirth).toBeInstanceOf(Date);
      expect(packet.provider.dateOfBirth?.toISOString()).toBe('1972-09-04T00:00:00.000Z');
    });

    // The plaintext column is gone (Phase 5), so ciphertext is the only source.
    // What matters now is the failure shape: a provider with no readable date of
    // birth must yield null rather than something a recipe would render. An
    // unresolved sourcePath is classified `missingOptional` — informational, not
    // an error — so a wrong value here ships a filled-in-but-wrong form to a
    // payer, which is worse than a blank one.
    it('yields a null dateOfBirth when there is no ciphertext', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(
        stubProvider({ dateOfBirthEncrypted: null })
      );

      const packet = await buildPacket(PROVIDER_ID);

      expect(packet.provider.dateOfBirth).toBeNull();
    });

    it('yields a null dateOfBirth when the ciphertext will not decrypt', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(
        stubProvider({ dateOfBirthEncrypted: 'not-ciphertext' })
      );

      const packet = await buildPacket(PROVIDER_ID);

      expect(packet.provider.dateOfBirth).toBeNull();
    });

    it('never exposes the ciphertext to a recipe sourcePath', async () => {
      const { dateOfBirthEncrypted } = dobWrite('1972-09-04');
      prismaMock.providerProfile.findUnique.mockResolvedValue(
        stubProvider({ dateOfBirthEncrypted })
      );

      const packet = await buildPacket(PROVIDER_ID);

      // Absent rather than null: the key is dropped from the packet entirely,
      // so a recipe sourcePath of 'dateOfBirthEncrypted' resolves to nothing.
      expect(packet.provider).not.toHaveProperty('dateOfBirthEncrypted');
      // ...while the decrypted value is still reachable under the name recipes use.
      expect(packet.provider.dateOfBirth?.toISOString()).toBe('1972-09-04T00:00:00.000Z');
    });
  });

  it('returns packet without decrypting sensitive fields by default', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue(stubProvider());

    const packet = await buildPacket(PROVIDER_ID);

    expect(packet.meta.decrypted).toBe(false);
    expect(packet.sensitive.ssn).toBe('cipher-ssn');
    expect(packet.sensitive.bankingAccountNumber).toBe('cipher-acct');
    expect(packet.sensitive.taxIdGroup).toBe('cipher-practice-tax');
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it('decrypts sensitive fields when decryptSensitive=true', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue(stubProvider());

    const packet = await buildPacket(PROVIDER_ID, undefined, { decryptSensitive: true });

    expect(packet.meta.decrypted).toBe(true);
    expect(packet.sensitive.ssn).toBe('decrypted:cipher-ssn');
    expect(packet.sensitive.bankingAccountNumber).toBe('decrypted:cipher-acct');
    expect(mockDecrypt).toHaveBeenCalled();
  });

  it('picks the primary practice location', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue(stubProvider());

    const packet = await buildPacket(PROVIDER_ID);

    expect(packet.primaryLocation?.id).toBe('loc-2');
    expect(packet.primaryLocation?.locationName).toBe('Main');
  });

  it('falls back to first location when none is marked primary', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue(
      stubProvider({
        practiceLocations: [
          { id: 'loc-x', isPrimary: false, locationName: 'Only' },
        ],
      })
    );

    const packet = await buildPacket(PROVIDER_ID);

    expect(packet.primaryLocation?.id).toBe('loc-x');
  });

  it('fetches and attaches PracticePayer when payerId provided', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue(stubProvider());
    prismaMock.practicePayer.findUnique.mockResolvedValue({
      id: 'pp-1',
      practiceId: PRACTICE_ID,
      payerId: PAYER_ID,
      groupTaxIdEncrypted: 'cipher-group-tax',
      payer: { id: PAYER_ID, name: 'Aetna' },
    } as any);

    const packet = await buildPacket(PROVIDER_ID, PAYER_ID);

    expect(packet.practicePayer?.id).toBe('pp-1');
    expect(packet.meta.practicePayerId).toBe('pp-1');
    expect(packet.meta.payerId).toBe(PAYER_ID);
    // PracticePayer's group tax id overrides the practice-level one
    expect(packet.sensitive.taxIdGroup).toBe('cipher-group-tax');
  });

  it('returns null practicePayer when none exists for the (practice, payer) pair', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue(stubProvider());
    prismaMock.practicePayer.findUnique.mockResolvedValue(null);

    const packet = await buildPacket(PROVIDER_ID, PAYER_ID);

    expect(packet.practicePayer).toBeNull();
    // Falls back to practice-level tax id
    expect(packet.sensitive.taxIdGroup).toBe('cipher-practice-tax');
  });

  it('skips PracticePayer lookup when provider has no practice', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue(
      stubProvider({ practiceId: null, practice: null })
    );

    const packet = await buildPacket(PROVIDER_ID, PAYER_ID);

    expect(packet.practicePayer).toBeNull();
    expect(prismaMock.practicePayer.findUnique).not.toHaveBeenCalled();
  });
});
