import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
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
});
