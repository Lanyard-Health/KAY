import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

const { sendEmail, saveCredentials, verifyAndUpdateProvider, notifyAdminUsers } = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ success: true, messageId: 'm1' })),
  saveCredentials: vi.fn(async () => {}),
  verifyAndUpdateProvider: vi.fn(async () => ({ success: true, valid: true, message: 'ok' })),
  notifyAdminUsers: vi.fn(async () => []),
}));

vi.mock('./email.service.js', () => ({ emailService: { sendEmail } }));
vi.mock('./email-templates.js', () => ({ renderProviderActionEmail: () => '<html>request</html>' }));
vi.mock('./caqh-credentials.service.js', () => ({
  caqhCredentialsService: { saveCredentials, verifyAndUpdateProvider },
}));
vi.mock('./notification.service.js', () => ({ notificationService: { notifyAdminUsers } }));
vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import {
  createCredentialRequest,
  getRequestByToken,
  completeCredentialRequest,
  maskUsername,
} from './caqh-credential-request.service.js';

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

const providerRow = {
  id: 'prov-1',
  firstName: 'Ying',
  email: 'ying@example.com',
  caqhUsername: 'yingliu2024',
  caqhCredentialsLastChecked: null,
};

describe('caqh-credential-request.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.providerProfile.findUnique.mockResolvedValue(providerRow as any);
    prismaMock.caqhCredentialRequest.findFirst.mockResolvedValue(null);
    prismaMock.caqhCredentialRequest.create.mockImplementation(async (args: any) => ({
      id: 'req-1',
      ...args.data,
    }));
  });

  describe('maskUsername', () => {
    it('shows only leading chars and a tail hint', () => {
      expect(maskUsername('yingliu2024')).toMatch(/^yi•+4$/);
      expect(maskUsername('ab')).toBe('a•••');
      expect(maskUsername('yingliu2024')).not.toContain('ngliu');
    });
  });

  describe('createCredentialRequest', () => {
    it('stores only the token hash and emails the provider', async () => {
      await createCredentialRequest('prov-1', 'staff-1');

      const createArg = (prismaMock.caqhCredentialRequest.create as any).mock.calls[0][0];
      expect(createArg.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(createArg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect((sendEmail as any).mock.calls[0][0].to).toBe('ying@example.com');
    });

    it('rejects when the provider has no email on file', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({ ...providerRow, email: null } as any);
      await expect(createCredentialRequest('prov-1')).rejects.toThrow('NO_EMAIL');
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('rejects when no CAQH username is saved yet', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue({ ...providerRow, caqhUsername: null } as any);
      await expect(createCredentialRequest('prov-1')).rejects.toThrow('NO_CREDENTIALS');
    });

    it('rotates the pending request on re-send instead of creating a second one', async () => {
      prismaMock.caqhCredentialRequest.findFirst.mockResolvedValue({ id: 'req-1' } as any);
      prismaMock.caqhCredentialRequest.update.mockImplementation(async (args: any) => ({
        id: 'req-1',
        ...args.data,
      }));

      const result = await createCredentialRequest('prov-1');

      expect(result.resent).toBe(true);
      expect(prismaMock.caqhCredentialRequest.create).not.toHaveBeenCalled();
      expect(prismaMock.caqhCredentialRequest.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('getRequestByToken', () => {
    it('resolves a pending token to form data', async () => {
      prismaMock.caqhCredentialRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'pending',
        expiresAt: new Date(Date.now() + 1000 * 60),
        provider: { firstName: 'Ying', caqhUsername: 'yingliu2024' },
      } as any);

      const result = await getRequestByToken('raw-token');
      expect(prismaMock.caqhCredentialRequest.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: hash('raw-token') } })
      );
      expect(result).toEqual({ status: 'pending', firstName: 'Ying', usernameOnFile: 'yingliu2024' });
    });

    it('reports expired for a pending token past its deadline', async () => {
      prismaMock.caqhCredentialRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
        provider: { firstName: 'Ying', caqhUsername: 'yingliu2024' },
      } as any);

      const result = await getRequestByToken('raw-token');
      expect(result?.status).toBe('expired');
    });
  });

  describe('completeCredentialRequest', () => {
    const pendingRow = {
      id: 'req-1',
      status: 'pending',
      expiresAt: new Date(Date.now() + 1000 * 60),
      providerId: 'prov-1',
      provider: { firstName: 'Ying', lastName: 'Liu' },
    };

    it('saves credentials, consumes the token, and fires the async re-verify', async () => {
      prismaMock.caqhCredentialRequest.findUnique.mockResolvedValue(pendingRow as any);
      prismaMock.caqhCredentialRequest.update.mockResolvedValue({} as any);

      await completeCredentialRequest('raw-token', 'newuser', 'newpass');

      expect(saveCredentials).toHaveBeenCalledWith('prov-1', 'newuser', 'newpass');
      const updateArg = (prismaMock.caqhCredentialRequest.update as any).mock.calls[0][0];
      expect(updateArg.data.status).toBe('completed');
      // let the fire-and-forget verify settle
      await new Promise((r) => setTimeout(r, 0));
      expect(verifyAndUpdateProvider).toHaveBeenCalledWith('prov-1');
      expect(notifyAdminUsers).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'caqh_credentials_updated' })
      );
    });

    it('rejects an already-used token without saving anything', async () => {
      prismaMock.caqhCredentialRequest.findUnique.mockResolvedValue({
        ...pendingRow,
        status: 'completed',
      } as any);

      await expect(completeCredentialRequest('raw-token', 'u', 'p')).rejects.toThrow('ALREADY_USED');
      expect(saveCredentials).not.toHaveBeenCalled();
    });

    it('rejects and marks an expired token', async () => {
      prismaMock.caqhCredentialRequest.findUnique.mockResolvedValue({
        ...pendingRow,
        expiresAt: new Date(Date.now() - 1000),
      } as any);
      prismaMock.caqhCredentialRequest.update.mockResolvedValue({} as any);

      await expect(completeCredentialRequest('raw-token', 'u', 'p')).rejects.toThrow('EXPIRED');
      expect(saveCredentials).not.toHaveBeenCalled();
      const updateArg = (prismaMock.caqhCredentialRequest.update as any).mock.calls[0][0];
      expect(updateArg.data.status).toBe('expired');
    });
  });
});
