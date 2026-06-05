import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { encryptForTenant } from '../utils/crypto.js';
import {
  resolveCredential,
  createCredential,
  CredentialMissingError,
  DuplicateCredentialError,
  PayerNotFoundError,
} from './credential.service.js';

const VALID_KEY = 'b'.repeat(64);

describe('credential.service', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env['ENCRYPTION_KEY'];
    process.env['ENCRYPTION_KEY'] = VALID_KEY;
    // Default: portalCredential.update succeeds (lastUsedAt fire-and-forget)
    prismaMock.portalCredential.update.mockResolvedValue({} as never);
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env['ENCRYPTION_KEY'] = originalKey;
    } else {
      delete process.env['ENCRYPTION_KEY'];
    }
  });

  // ─── resolveCredential ─────────────────────────────────────────────────

  describe('resolveCredential', () => {
    it('GROUP path: looks up by (payerId, practiceId) and decrypts', async () => {
      const practiceId = 'practice-a';
      const payerId = 'payer-availity';
      const providerId = 'provider-1';

      prismaMock.payer.findUnique.mockResolvedValue({
        id: payerId,
        credentialType: 'GROUP',
      } as never);

      prismaMock.portalCredential.findFirst.mockResolvedValue({
        id: 'cred-1',
        usernameEncrypted: encryptForTenant(practiceId, 'group-user'),
        passwordEncrypted: encryptForTenant(practiceId, 'group-pass'),
        mfaSeedEncrypted: null,
        extraConfigEncrypted: null,
      } as never);

      const cred = await resolveCredential(payerId, practiceId, providerId);

      expect(prismaMock.portalCredential.findFirst).toHaveBeenCalledWith({
        where: {
          payerId,
          practiceId,
          credentialType: 'GROUP',
          isActive: true,
        },
      });
      expect(cred.credentialId).toBe('cred-1');
      expect(cred.username).toBe('group-user');
      expect(cred.password).toBe('group-pass');
      expect(cred.mfaSeed).toBeNull();
      expect(cred.extraConfig).toBeNull();
    });

    it('INDIVIDUAL path: looks up by (payerId, providerId) and decrypts', async () => {
      const practiceId = 'practice-b';
      const payerId = 'payer-caqh';
      const providerId = 'provider-7';

      prismaMock.payer.findUnique.mockResolvedValue({
        id: payerId,
        credentialType: 'INDIVIDUAL',
      } as never);

      prismaMock.portalCredential.findFirst.mockResolvedValue({
        id: 'cred-2',
        usernameEncrypted: encryptForTenant(practiceId, 'ind-user'),
        passwordEncrypted: encryptForTenant(practiceId, 'ind-pass'),
        mfaSeedEncrypted: encryptForTenant(practiceId, 'JBSWY3DPEHPK3PXP'),
        extraConfigEncrypted: encryptForTenant(practiceId, '{"q":"a"}'),
      } as never);

      const cred = await resolveCredential(payerId, practiceId, providerId);

      expect(prismaMock.portalCredential.findFirst).toHaveBeenCalledWith({
        where: {
          payerId,
          providerId,
          credentialType: 'INDIVIDUAL',
          isActive: true,
        },
      });
      expect(cred.username).toBe('ind-user');
      expect(cred.password).toBe('ind-pass');
      expect(cred.mfaSeed).toBe('JBSWY3DPEHPK3PXP');
      expect(cred.extraConfig).toBe('{"q":"a"}');
    });

    it('throws PayerNotFoundError when payer does not exist', async () => {
      prismaMock.payer.findUnique.mockResolvedValue(null);
      await expect(
        resolveCredential('missing-payer', 'practice-a', 'provider-1')
      ).rejects.toBeInstanceOf(PayerNotFoundError);
    });

    it('throws CredentialMissingError when no credential found (GROUP)', async () => {
      prismaMock.payer.findUnique.mockResolvedValue({
        id: 'payer-x',
        credentialType: 'GROUP',
      } as never);
      prismaMock.portalCredential.findFirst.mockResolvedValue(null);

      await expect(
        resolveCredential('payer-x', 'practice-a', 'provider-1')
      ).rejects.toBeInstanceOf(CredentialMissingError);
    });

    it('throws CredentialMissingError when no credential found (INDIVIDUAL)', async () => {
      prismaMock.payer.findUnique.mockResolvedValue({
        id: 'payer-x',
        credentialType: 'INDIVIDUAL',
      } as never);
      prismaMock.portalCredential.findFirst.mockResolvedValue(null);

      await expect(
        resolveCredential('payer-x', 'practice-a', 'provider-1')
      ).rejects.toBeInstanceOf(CredentialMissingError);
    });

    it('cross-tenant isolation: ciphertext encrypted under practice-A cannot be decrypted under practice-B', async () => {
      const payerId = 'payer-shared';
      // Encrypt under practice-A
      const ciphertextUser = encryptForTenant('practice-a', 'a-user');
      const ciphertextPass = encryptForTenant('practice-a', 'a-pass');

      // Resolve under practice-B — must fail decryption
      prismaMock.payer.findUnique.mockResolvedValue({
        id: payerId,
        credentialType: 'GROUP',
      } as never);
      prismaMock.portalCredential.findFirst.mockResolvedValue({
        id: 'cred-bleed',
        usernameEncrypted: ciphertextUser,
        passwordEncrypted: ciphertextPass,
        mfaSeedEncrypted: null,
        extraConfigEncrypted: null,
      } as never);

      await expect(
        resolveCredential(payerId, 'practice-b', 'provider-1')
      ).rejects.toThrow(/Failed to decrypt PortalCredential/);
    });

    it('wipe() clears plaintext fields from the returned struct', async () => {
      const practiceId = 'practice-c';
      prismaMock.payer.findUnique.mockResolvedValue({
        id: 'payer-1',
        credentialType: 'GROUP',
      } as never);
      prismaMock.portalCredential.findFirst.mockResolvedValue({
        id: 'cred-3',
        usernameEncrypted: encryptForTenant(practiceId, 'secret-user'),
        passwordEncrypted: encryptForTenant(practiceId, 'secret-pass'),
        mfaSeedEncrypted: encryptForTenant(practiceId, 'totp-seed'),
        extraConfigEncrypted: encryptForTenant(practiceId, 'extra'),
      } as never);

      const cred = await resolveCredential('payer-1', practiceId, 'provider-1');
      expect(cred.username).toBe('secret-user');
      expect(cred.password).toBe('secret-pass');

      cred.wipe();
      expect(cred.username).toBe('');
      expect(cred.password).toBe('');
      expect(cred.mfaSeed).toBeNull();
      expect(cred.extraConfig).toBeNull();
    });

    it('touches lastUsedAt after a successful resolve', async () => {
      prismaMock.payer.findUnique.mockResolvedValue({
        id: 'payer-1',
        credentialType: 'GROUP',
      } as never);
      prismaMock.portalCredential.findFirst.mockResolvedValue({
        id: 'cred-4',
        usernameEncrypted: encryptForTenant('p', 'u'),
        passwordEncrypted: encryptForTenant('p', 'pw'),
        mfaSeedEncrypted: null,
        extraConfigEncrypted: null,
      } as never);

      await resolveCredential('payer-1', 'p', 'provider-1');

      // Await microtasks so the fire-and-forget update has a chance to register
      await new Promise((r) => setImmediate(r));

      expect(prismaMock.portalCredential.update).toHaveBeenCalledWith({
        where: { id: 'cred-4' },
        data: { lastUsedAt: expect.any(Date) },
      });
    });

    it('rejects empty payerId / practiceId / providerId', async () => {
      await expect(resolveCredential('', 'p', 'pr')).rejects.toThrow(/payerId/);
      await expect(resolveCredential('p', '', 'pr')).rejects.toThrow(/practiceId/);
      await expect(resolveCredential('p', 'pr', '')).rejects.toThrow(/providerId/);
    });
  });

  // ─── createCredential ──────────────────────────────────────────────────

  describe('createCredential', () => {
    it('GROUP path: defaults credentialType to GROUP when no providerId', async () => {
      prismaMock.portalCredential.findFirst.mockResolvedValue(null);
      prismaMock.portalCredential.create.mockResolvedValue({ id: 'new-1' } as never);

      const result = await createCredential({
        payerId: 'payer-1',
        practiceId: 'practice-a',
        username: 'u',
        password: 'pw',
      });

      expect(result.id).toBe('new-1');
      const createCall = prismaMock.portalCredential.create.mock.calls[0]![0];
      expect(createCall.data.credentialType).toBe('GROUP');
      expect(createCall.data.providerId).toBeNull();
      // Encrypted values should not equal plaintext
      expect(createCall.data.usernameEncrypted).not.toBe('u');
      expect(createCall.data.passwordEncrypted).not.toBe('pw');
    });

    it('INDIVIDUAL path: sets credentialType to INDIVIDUAL when providerId is given', async () => {
      prismaMock.portalCredential.findFirst.mockResolvedValue(null);
      prismaMock.portalCredential.create.mockResolvedValue({ id: 'new-2' } as never);

      await createCredential({
        payerId: 'payer-1',
        practiceId: 'practice-a',
        providerId: 'provider-7',
        username: 'u',
        password: 'pw',
      });

      const createCall = prismaMock.portalCredential.create.mock.calls[0]![0];
      expect(createCall.data.credentialType).toBe('INDIVIDUAL');
      expect(createCall.data.providerId).toBe('provider-7');
    });

    it('throws DuplicateCredentialError when an active INDIVIDUAL row already exists', async () => {
      prismaMock.portalCredential.findFirst.mockResolvedValue({ id: 'existing' } as never);

      await expect(
        createCredential({
          payerId: 'payer-1',
          practiceId: 'practice-a',
          providerId: 'provider-7',
          username: 'u',
          password: 'pw',
        })
      ).rejects.toBeInstanceOf(DuplicateCredentialError);
      expect(prismaMock.portalCredential.create).not.toHaveBeenCalled();
    });

    it('throws DuplicateCredentialError when an active GROUP row already exists', async () => {
      prismaMock.portalCredential.findFirst.mockResolvedValue({ id: 'existing' } as never);

      await expect(
        createCredential({
          payerId: 'payer-1',
          practiceId: 'practice-a',
          username: 'u',
          password: 'pw',
        })
      ).rejects.toBeInstanceOf(DuplicateCredentialError);
      expect(prismaMock.portalCredential.create).not.toHaveBeenCalled();
    });

    it('encrypts mfaSeed and extraConfig when provided', async () => {
      prismaMock.portalCredential.findFirst.mockResolvedValue(null);
      prismaMock.portalCredential.create.mockResolvedValue({ id: 'new-3' } as never);

      await createCredential({
        payerId: 'payer-1',
        practiceId: 'practice-a',
        username: 'u',
        password: 'pw',
        mfaSeed: 'JBSWY3DPEHPK3PXP',
        extraConfig: '{"q":"a"}',
      });

      const createCall = prismaMock.portalCredential.create.mock.calls[0]![0];
      expect(createCall.data.mfaSeedEncrypted).not.toBe('JBSWY3DPEHPK3PXP');
      expect(createCall.data.mfaSeedEncrypted).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);
      expect(createCall.data.extraConfigEncrypted).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);
    });

    it('rejects missing required fields', async () => {
      await expect(
        createCredential({ payerId: '', practiceId: 'p', username: 'u', password: 'pw' })
      ).rejects.toThrow(/payerId/);
      await expect(
        createCredential({ payerId: 'p', practiceId: '', username: 'u', password: 'pw' })
      ).rejects.toThrow(/practiceId/);
      await expect(
        createCredential({ payerId: 'p', practiceId: 'pr', username: '', password: 'pw' })
      ).rejects.toThrow(/username/);
      await expect(
        createCredential({ payerId: 'p', practiceId: 'pr', username: 'u', password: '' })
      ).rejects.toThrow(/password/);
    });
  });
});
