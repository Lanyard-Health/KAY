import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockResendInvite = vi.fn();
vi.mock('../services/cognitoUser.service.js', () => ({
  resendCognitoInvite: (email: string) => mockResendInvite(email),
}));

import { authRoutes } from './auth.routes.js';

describe('Auth Routes', () => {
  const app = createTestApp(authRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
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
});
