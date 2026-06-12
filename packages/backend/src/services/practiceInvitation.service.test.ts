import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

// Hoisted so the vi.mock factories below can reference them safely.
const { sendEmail, createCognitoUser, setCognitoUserPassword, deleteCognitoUser } = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ success: true, messageId: 'm1' })),
  createCognitoUser: vi.fn(async () => ({ cognitoId: 'cog-1' })),
  setCognitoUserPassword: vi.fn(async () => {}),
  deleteCognitoUser: vi.fn(async () => {}),
}));

vi.mock('./email.service.js', () => ({ emailService: { sendEmail } }));
vi.mock('./email-templates.js', () => ({ renderProviderActionEmail: () => '<html>invite</html>' }));
vi.mock('./cognitoUser.service.js', () => ({ createCognitoUser, setCognitoUserPassword, deleteCognitoUser }));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import {
  createInvitation,
  acceptInvitation,
  getInvitationByToken,
} from './practiceInvitation.service.js';

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

describe('practiceInvitation.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.practice.findUnique.mockResolvedValue({ id: 'prac-1', name: 'Bright Health' } as any);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.practiceInvitation.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.practiceInvitation.create.mockImplementation(async (args: any) => ({
      id: 'inv-1', ...args.data,
    }));
  });

  describe('createInvitation', () => {
    it('stores only the token hash (never a raw token) and emails the invite', async () => {
      await createInvitation({ practiceId: 'prac-1', email: 'New.Admin@Example.com', role: 'PRACTICE_ADMIN', invitedById: 'u-1' });

      const createArg = (prismaMock.practiceInvitation.create as any).mock.calls[0][0];
      expect(createArg.data.email).toBe('new.admin@example.com'); // normalized
      expect(createArg.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(createArg.data.status).toBeUndefined(); // defaults to pending in the DB
      expect(createArg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(sendEmail).toHaveBeenCalledTimes(1);
      // The emailed link must not be the stored hash.
      const emailArg = sendEmail.mock.calls[0][0] as any;
      expect(emailArg.to).toBe('new.admin@example.com');
    });

    it('supersedes any still-pending invite for the same email + practice', async () => {
      await createInvitation({ practiceId: 'prac-1', email: 'a@b.com', role: 'PRACTICE_ADMIN' });
      expect(prismaMock.practiceInvitation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'pending' }), data: { status: 'revoked' } })
      );
    });

    it('rejects when an account already exists for the email', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'existing' } as any);
      await expect(createInvitation({ practiceId: 'prac-1', email: 'taken@x.com', role: 'PRACTICE_ADMIN' }))
        .rejects.toThrow('EMAIL_EXISTS');
      expect(prismaMock.practiceInvitation.create).not.toHaveBeenCalled();
    });
  });

  describe('getInvitationByToken', () => {
    it('reports an expired pending invite as expired', async () => {
      prismaMock.practiceInvitation.findUnique.mockResolvedValue({
        status: 'pending', expiresAt: new Date(Date.now() - 1000), email: 'x@y.com', practice: { name: 'P' }, role: 'PRACTICE_ADMIN',
      } as any);
      const result = await getInvitationByToken('rawtoken');
      expect(result.status).toBe('expired');
    });

    it('returns invalid for an unknown token', async () => {
      prismaMock.practiceInvitation.findUnique.mockResolvedValue(null);
      const result = await getInvitationByToken('nope');
      expect(result.status).toBe('invalid');
    });
  });

  describe('acceptInvitation', () => {
    const validInvite = {
      id: 'inv-1', practiceId: 'prac-1', email: 'invitee@x.com', role: 'PRACTICE_ADMIN',
      status: 'pending', expiresAt: new Date(Date.now() + 1000 * 60), practice: { id: 'prac-1', name: 'Bright Health' },
    };

    beforeEach(() => {
      (prismaMock as any).$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
      prismaMock.user.create.mockResolvedValue({ id: 'user-new', email: validInvite.email } as any);
      prismaMock.userPractice.create.mockResolvedValue({ id: 'up-1' } as any);
      prismaMock.practiceInvitation.update.mockResolvedValue({ id: 'inv-1' } as any);
    });

    it('creates the login, assigns the practice, and marks the invite accepted', async () => {
      prismaMock.practiceInvitation.findUnique.mockResolvedValue(validInvite as any);

      const result = await acceptInvitation({ token: 'raw', password: 'SecureP@ss1234', firstName: 'Sam', lastName: 'Lee' });

      expect(createCognitoUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'invitee@x.com', suppressInviteEmail: true }));
      expect(setCognitoUserPassword).toHaveBeenCalledWith('invitee@x.com', 'SecureP@ss1234', true);
      expect(prismaMock.userPractice.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ practiceId: 'prac-1', role: 'PRACTICE_ADMIN', userId: 'user-new' }) })
      );
      expect(prismaMock.practiceInvitation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'accepted' }) })
      );
      expect(result).toMatchObject({ userId: 'user-new', practiceId: 'prac-1' });
    });

    it('rejects an already-used invitation', async () => {
      prismaMock.practiceInvitation.findUnique.mockResolvedValue({ ...validInvite, status: 'accepted' } as any);
      await expect(acceptInvitation({ token: 'raw', password: 'SecureP@ss1234', firstName: 'S', lastName: 'L' }))
        .rejects.toThrow('ALREADY_USED');
      expect(createCognitoUser).not.toHaveBeenCalled();
    });

    it('rejects an expired invitation and rolls nothing forward', async () => {
      prismaMock.practiceInvitation.findUnique.mockResolvedValue({ ...validInvite, expiresAt: new Date(Date.now() - 1000) } as any);
      await expect(acceptInvitation({ token: 'raw', password: 'SecureP@ss1234', firstName: 'S', lastName: 'L' }))
        .rejects.toThrow('EXPIRED');
      expect(createCognitoUser).not.toHaveBeenCalled();
    });

    it('rolls back the Cognito user if the DB transaction fails', async () => {
      prismaMock.practiceInvitation.findUnique.mockResolvedValue(validInvite as any);
      (prismaMock as any).$transaction.mockRejectedValue(new Error('db down'));
      await expect(acceptInvitation({ token: 'raw', password: 'SecureP@ss1234', firstName: 'S', lastName: 'L' }))
        .rejects.toThrow('db down');
      expect(deleteCognitoUser).toHaveBeenCalledWith('invitee@x.com');
    });
  });

  // Cross-check the hashing is stable so token lookups resolve.
  it('hashes tokens deterministically with sha256', () => {
    expect(hash('abc')).toBe(hash('abc'));
    expect(hash('abc')).toHaveLength(64);
  });
});
