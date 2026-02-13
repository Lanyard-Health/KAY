import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser } from '../../tests/helpers/fixtures.js';

const { mockIsConfigured, mockSendTestEmail, mockGetConfig } = vi.hoisted(() => ({
  mockIsConfigured: vi.fn(),
  mockSendTestEmail: vi.fn(),
  mockGetConfig: vi.fn(),
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../services/email.service.js', () => ({
  emailService: {
    isConfigured: mockIsConfigured,
    sendTestEmail: mockSendTestEmail,
    getConfig: mockGetConfig,
  },
}));

import emailRouter from './email.routes.js';

describe('Email Routes', () => {
  const app = createTestApp(emailRouter, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /test', () => {
    it('sends test email successfully', async () => {
      mockIsConfigured.mockReturnValue(true);
      mockSendTestEmail.mockResolvedValue({ success: true, messageId: 'msg-123' });

      const res = await request(app).get('/test?to=admin@test.com');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageId).toBe('msg-123');
      expect(mockSendTestEmail).toHaveBeenCalledWith('admin@test.com');
    });

    it('returns 400 when to param is missing', async () => {
      const res = await request(app).get('/test');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('email address');
    });

    it('returns 400 for invalid email format', async () => {
      const res = await request(app).get('/test?to=not-an-email');

      expect(res.status).toBe(400);
    });

    it('returns 503 when email service is not configured', async () => {
      mockIsConfigured.mockReturnValue(false);

      const res = await request(app).get('/test?to=admin@test.com');

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('not configured');
    });

    it('returns 500 when send fails', async () => {
      mockIsConfigured.mockReturnValue(true);
      mockSendTestEmail.mockResolvedValue({ success: false, error: 'SES rejected' });

      const res = await request(app).get('/test?to=admin@test.com');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('SES rejected');
    });
  });

  describe('GET /config', () => {
    it('returns email configuration status', async () => {
      mockIsConfigured.mockReturnValue(true);
      mockGetConfig.mockReturnValue({ fromEmail: 'no-reply@lanyard.health', region: 'us-east-1' });

      const res = await request(app).get('/config');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.configured).toBe(true);
      expect(res.body.data.config.fromEmail).toBe('no-reply@lanyard.health');
    });

    it('returns unconfigured status', async () => {
      mockIsConfigured.mockReturnValue(false);
      mockGetConfig.mockReturnValue({});

      const res = await request(app).get('/config');

      expect(res.status).toBe(200);
      expect(res.body.data.configured).toBe(false);
    });
  });
});
