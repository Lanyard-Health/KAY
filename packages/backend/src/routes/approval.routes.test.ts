import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../agents/approval.service.js', () => ({
  listPendingApprovals: vi.fn(),
  getApproval: vi.fn(),
  decideApproval: vi.fn(),
}));

import { approvalRoutes } from './approval.routes.js';
import {
  listPendingApprovals,
  getApproval,
  decideApproval,
} from '../agents/approval.service.js';

describe('Approval Routes', () => {
  const app = createTestApp(approvalRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns an array of approvals', async () => {
      const mockApprovals = [
        { id: 'appr-1', type: 'submission_review', status: 'pending' },
      ];
      (listPendingApprovals as any).mockResolvedValue(mockApprovals);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockApprovals);
      expect(listPendingApprovals).toHaveBeenCalledWith({});
    });

    it('passes query params to listPendingApprovals', async () => {
      (listPendingApprovals as any).mockResolvedValue([]);

      const res = await request(app)
        .get('/')
        .query({ status: 'pending', limit: '10', offset: '5' });

      expect(res.status).toBe(200);
      expect(listPendingApprovals).toHaveBeenCalledWith({
        status: 'pending',
        limit: 10,
        offset: 5,
      });
    });
  });

  describe('GET /:id', () => {
    it('returns 404 when approval not found', async () => {
      (getApproval as any).mockResolvedValue(null);

      const res = await request(app).get('/appr-nonexistent');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Approval not found' });
    });

    it('returns 200 with approval when found', async () => {
      const mockApproval = { id: 'appr-1', type: 'review', status: 'pending' };
      (getApproval as any).mockResolvedValue(mockApproval);

      const res = await request(app).get('/appr-1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockApproval);
    });
  });

  describe('POST /:id/decide', () => {
    it('approves and returns 200', async () => {
      const mockResult = {
        id: 'appr-1',
        status: 'approved',
        decidedBy: adminUser.id,
        decidedAt: new Date().toISOString(),
      };
      (decideApproval as any).mockResolvedValue(mockResult);

      const res = await request(app)
        .post('/appr-1/decide')
        .send({ decision: 'approved', notes: 'Looks good' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockResult);
      expect(decideApproval).toHaveBeenCalledWith('appr-1', {
        decision: 'approved',
        decidedBy: adminUser.id,
        notes: 'Looks good',
      });
    });

    it('denies and returns 200', async () => {
      const mockResult = { id: 'appr-1', status: 'denied' };
      (decideApproval as any).mockResolvedValue(mockResult);

      const res = await request(app)
        .post('/appr-1/decide')
        .send({ decision: 'denied', notes: 'Not ready' });

      expect(res.status).toBe(200);
      expect(decideApproval).toHaveBeenCalledWith('appr-1', {
        decision: 'denied',
        decidedBy: adminUser.id,
        notes: 'Not ready',
      });
    });

    it('returns 400 for invalid decision', async () => {
      const res = await request(app)
        .post('/appr-1/decide')
        .send({ decision: 'maybe' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 for missing decision', async () => {
      const res = await request(app)
        .post('/appr-1/decide')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });
});
