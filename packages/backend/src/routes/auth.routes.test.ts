import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockResendInvite = vi.fn();
const mockGetStatus = vi.fn();
const mockSetPassword = vi.fn();
vi.mock('../services/cognitoUser.service.js', () => ({
  resendCognitoInvite: (email: string) => mockResendInvite(email),
  getCognitoUserStatus: (email: string) => mockGetStatus(email),
  setCognitoUserPassword: (email: string, password: string, permanent: boolean) =>
    mockSetPassword(email, password, permanent),
}));

const mockSendEmail = vi.fn();
vi.mock('../services/email.service.js', () => ({
  emailService: { sendEmail: (params: unknown) => mockSendEmail(params) },
}));

// In-memory stand-in for the handful of Redis commands the reset flow uses.
const redisStore = new Map<string, string>();
const mockRedis = {
  set: vi.fn(async (key: string, value: string) => {
    redisStore.set(key, value);
    return 'OK';
  }),
  get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
  del: vi.fn(async (...keys: string[]) => {
    keys.forEach((k) => redisStore.delete(k));
    return keys.length;
  }),
  incr: vi.fn(async (key: string) => {
    const next = Number(redisStore.get(key) ?? '0') + 1;
    redisStore.set(key, String(next));
    return next;
  }),
  expire: vi.fn(async () => 1),
};
vi.mock('../utils/redis.js', () => ({
  getRedisConnection: () => mockRedis,
  isRedisConfigured: () => true,
  isRedisAvailable: () => true,
}));

import { authRoutes } from './auth.routes.js';

describe('Auth Routes', () => {
  const app = createTestApp(authRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();
    mockSendEmail.mockResolvedValue({ success: true });
    mockSetPassword.mockResolvedValue(undefined);
  });

  describe('POST /login', () => {
    it('returns Cognito delegation message', async () => {
      const res = await request(app).post('/login');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Cognito');
    });
  });

  describe('POST /refresh', () => {
    it('returns Cognito SDK message', async () => {
      const res = await request(app).post('/refresh');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Cognito');
    });
  });

  describe('POST /logout', () => {
    it('returns logout success', async () => {
      const res = await request(app).post('/logout');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Logged out');
    });
  });

  /**
   * This endpoint is unauthenticated by necessity — the caller cannot sign in,
   * which is the problem it exists to solve. That makes the uniformity of the
   * response a security property, not a cosmetic one: any variation between a
   * known and an unknown address turns it into an account-enumeration oracle.
   */
  describe('POST /resend-invite', () => {
    it('sends the invite for an account pending setup', async () => {
      mockResendInvite.mockResolvedValue(true);

      const res = await request(app).post('/resend-invite').send({ email: 'invited@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockResendInvite).toHaveBeenCalledWith('invited@example.com');
    });

    it('returns an identical response for an address with no account', async () => {
      mockResendInvite.mockResolvedValue(true);
      const known = await request(app).post('/resend-invite').send({ email: 'known@example.com' });

      mockResendInvite.mockResolvedValue(false);
      const unknown = await request(app)
        .post('/resend-invite')
        .send({ email: 'nobody@example.com' });

      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toEqual(known.body);
    });

    it('returns an identical response when Cognito throws', async () => {
      mockResendInvite.mockResolvedValue(true);
      const ok = await request(app).post('/resend-invite').send({ email: 'known@example.com' });

      mockResendInvite.mockRejectedValue(new Error('Cognito is down'));
      const failed = await request(app).post('/resend-invite').send({ email: 'known@example.com' });

      expect(failed.status).toBe(ok.status);
      expect(failed.body).toEqual(ok.body);
    });

    it('never reveals whether an invite was actually sent', async () => {
      mockResendInvite.mockResolvedValue(false);

      const res = await request(app).post('/resend-invite').send({ email: 'nobody@example.com' });

      expect(JSON.stringify(res.body)).not.toMatch(/not found|no account|already|unknown/i);
    });

    it('rejects a malformed email without calling Cognito', async () => {
      const res = await request(app).post('/resend-invite').send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(mockResendInvite).not.toHaveBeenCalled();
    });

    it('rejects a missing body without calling Cognito', async () => {
      const res = await request(app).post('/resend-invite').send({});

      expect(res.status).toBe(400);
      expect(mockResendInvite).not.toHaveBeenCalled();
    });
  });

  /**
   * Backend-owned password reset. Unauthenticated like /resend-invite, so the
   * same enumeration property applies: the response never varies with account
   * existence. The password must only ever change after the emailed code is
   * proven — an anonymous request must not be able to invalidate a working
   * password.
   */
  describe('POST /forgot-password', () => {
    const requestReset = (email: string) => request(app).post('/forgot-password').send({ email });

    it('emails a code and stores its hash for a confirmed account', async () => {
      mockGetStatus.mockResolvedValue('CONFIRMED');

      const res = await requestReset('user@example.com');

      expect(res.status).toBe(200);
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('pwreset:code:'),
        expect.any(String),
        'EX',
        900
      );
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com' })
      );
      // The raw code must never be stored — only its hash.
      const [, storedValue] = mockRedis.set.mock.calls[0]!;
      const emailedCode = (mockSendEmail.mock.calls[0]![0] as { html: string }).html.match(/\d{6}/)![0];
      expect(storedValue).not.toContain(emailedCode);
    });

    it('normalizes the email to lowercase', async () => {
      mockGetStatus.mockResolvedValue('CONFIRMED');

      await requestReset('User@Example.COM');

      expect(mockGetStatus).toHaveBeenCalledWith('user@example.com');
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com' })
      );
    });

    it('re-sends the invite instead of a code for a never-activated account', async () => {
      mockGetStatus.mockResolvedValue('FORCE_CHANGE_PASSWORD');

      const res = await requestReset('invited@example.com');

      expect(res.status).toBe(200);
      expect(mockResendInvite).toHaveBeenCalledWith('invited@example.com');
      expect(mockSendEmail).not.toHaveBeenCalled();
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('returns an identical response for an unknown address and sends nothing', async () => {
      mockGetStatus.mockResolvedValue('CONFIRMED');
      const known = await requestReset('user@example.com');

      mockGetStatus.mockResolvedValue(null);
      const unknown = await requestReset('nobody@example.com');

      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toEqual(known.body);
      expect(mockSendEmail).toHaveBeenCalledTimes(1); // only the known account
    });

    it('returns an identical response when Cognito throws', async () => {
      mockGetStatus.mockResolvedValue('CONFIRMED');
      const ok = await requestReset('user@example.com');

      mockGetStatus.mockRejectedValue(new Error('Cognito is down'));
      const failed = await requestReset('user@example.com');

      expect(failed.status).toBe(ok.status);
      expect(failed.body).toEqual(ok.body);
    });

    it('rejects a malformed email without touching Cognito', async () => {
      const res = await requestReset('not-an-email');

      expect(res.status).toBe(400);
      expect(mockGetStatus).not.toHaveBeenCalled();
    });
  });

  describe('POST /reset-password', () => {
    // Runs the real forgot-password flow and captures the code from the email.
    async function issueCode(email: string): Promise<string> {
      mockGetStatus.mockResolvedValue('CONFIRMED');
      await request(app).post('/forgot-password').send({ email });
      const html = (mockSendEmail.mock.calls.at(-1)![0] as { html: string }).html;
      return html.match(/\d{6}/)![0];
    }

    const NEW_PASSWORD = 'CorrectHorse1!Battery';

    it('sets the password permanently when the code matches, then burns the code', async () => {
      const code = await issueCode('user@example.com');

      const res = await request(app)
        .post('/reset-password')
        .send({ email: 'user@example.com', code, newPassword: NEW_PASSWORD });

      expect(res.status).toBe(200);
      expect(mockSetPassword).toHaveBeenCalledWith('user@example.com', NEW_PASSWORD, true);

      // The code is single-use.
      const replay = await request(app)
        .post('/reset-password')
        .send({ email: 'user@example.com', code, newPassword: NEW_PASSWORD });
      expect(replay.status).toBe(400);
      expect(replay.body.error.code).toBe('ExpiredCodeException');
    });

    it('rejects a wrong code without changing the password', async () => {
      const code = await issueCode('user@example.com');
      const wrong = code === '111111' ? '222222' : '111111';

      const res = await request(app)
        .post('/reset-password')
        .send({ email: 'user@example.com', code: wrong, newPassword: NEW_PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CodeMismatchException');
      expect(mockSetPassword).not.toHaveBeenCalled();
    });

    it('burns the code after 5 wrong attempts', async () => {
      const code = await issueCode('user@example.com');
      const wrong = code === '111111' ? '222222' : '111111';

      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/reset-password')
          .send({ email: 'user@example.com', code: wrong, newPassword: NEW_PASSWORD });
      }

      // Even the CORRECT code is now rejected.
      const res = await request(app)
        .post('/reset-password')
        .send({ email: 'user@example.com', code, newPassword: NEW_PASSWORD });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ExpiredCodeException');
      expect(mockSetPassword).not.toHaveBeenCalled();
    });

    it('rejects when no code was ever issued', async () => {
      const res = await request(app)
        .post('/reset-password')
        .send({ email: 'nobody@example.com', code: '123456', newPassword: NEW_PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ExpiredCodeException');
      expect(mockSetPassword).not.toHaveBeenCalled();
    });

    it('keeps the code alive when Cognito rejects the password, so the user can retry', async () => {
      const code = await issueCode('user@example.com');
      const rejection = new Error('Password did not conform with policy');
      rejection.name = 'InvalidPasswordException';
      mockSetPassword.mockRejectedValueOnce(rejection);

      const first = await request(app)
        .post('/reset-password')
        .send({ email: 'user@example.com', code, newPassword: 'weakbutlong12' });
      expect(first.status).toBe(400);
      expect(first.body.error.code).toBe('InvalidPasswordException');

      const retry = await request(app)
        .post('/reset-password')
        .send({ email: 'user@example.com', code, newPassword: NEW_PASSWORD });
      expect(retry.status).toBe(200);
    });

    it('rejects a short password before touching anything', async () => {
      const res = await request(app)
        .post('/reset-password')
        .send({ email: 'user@example.com', code: '123456', newPassword: 'short' });

      expect(res.status).toBe(400);
      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(mockSetPassword).not.toHaveBeenCalled();
    });
  });
});
