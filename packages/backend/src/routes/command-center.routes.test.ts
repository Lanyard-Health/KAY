import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, providerUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn((..._roles: string[]) => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/practiceScope.middleware.js', () => ({
  getPracticeProviderFilter: vi.fn(() => ({})),
}));

vi.mock('../services/command-center.service.js', () => ({
  getEnrollmentMatrix: vi.fn(),
}));

import commandCenterRouter from './command-center.routes.js';
import { getEnrollmentMatrix } from '../services/command-center.service.js';

describe('Command Center Routes', () => {
  const app = createTestApp(commandCenterRouter, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /matrix', () => {
    it('returns enrollment matrix for admin', async () => {
      const mockMatrix = {
        providers: [{ id: 'p1', name: 'Dr. Smith' }],
        payers: [{ id: 'pay1', name: 'Aetna' }],
        cells: [{ providerId: 'p1', payerId: 'pay1', status: 'active' }],
      };
      vi.mocked(getEnrollmentMatrix).mockResolvedValue(mockMatrix);

      const res = await request(app).get('/matrix');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockMatrix);
    });

    it('returns 500 on service error', async () => {
      vi.mocked(getEnrollmentMatrix).mockRejectedValue(new Error('DB error'));

      const res = await request(app).get('/matrix');

      expect(res.status).toBe(500);
    });
  });
});
