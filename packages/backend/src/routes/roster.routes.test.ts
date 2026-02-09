import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import { adminUser, staffUser } from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/practiceScope.middleware.js', () => ({
  getPracticeProviderFilter: vi.fn(() => ({})),
}));

vi.mock('../services/roster.service.js', () => ({
  validateColumns: vi.fn(),
  fetchRosterData: vi.fn(),
  fetchAllRosterData: vi.fn(),
  flattenToRows: vi.fn(),
  generateExcel: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { rosterRoutes } from './roster.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { validateColumns, fetchRosterData, fetchAllRosterData, flattenToRows, generateExcel } from '../services/roster.service.js';

const mockTemplate = {
  id: 'template-1',
  name: 'Test Template',
  description: 'A test template',
  columns: [{ fieldKey: 'firstName', label: 'First Name' }],
  filters: null,
  sortConfig: null,
  isShared: false,
  createdById: 'admin-user-id',
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: { firstName: 'Admin', lastName: 'User' },
};

const validTemplateInput = {
  name: 'Test Template',
  columns: [{ fieldKey: 'firstName', label: 'First Name' }],
};

describe('Roster Routes', () => {
  const app = createTestApp(rosterRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns roster templates (own + shared)', async () => {
      prismaMock.rosterTemplate.findMany.mockResolvedValue([mockTemplate] as any);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });

    it('returns empty array when no templates', async () => {
      prismaMock.rosterTemplate.findMany.mockResolvedValue([]);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('GET /:id', () => {
    it('returns a single template', async () => {
      prismaMock.rosterTemplate.findUnique.mockResolvedValue(mockTemplate as any);

      const res = await request(app).get('/template-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('template-1');
    });

    it('returns 404 when template not found', async () => {
      prismaMock.rosterTemplate.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/nonexistent');

      expect(res.status).toBe(404);
    });

    it('returns 403 when not owner and not shared', async () => {
      const otherUserTemplate = { ...mockTemplate, createdById: 'other-user', isShared: false };
      prismaMock.rosterTemplate.findUnique.mockResolvedValue(otherUserTemplate as any);

      const res = await request(app).get('/template-1');

      expect(res.status).toBe(403);
    });

    it('allows access to shared templates from other users', async () => {
      const sharedTemplate = { ...mockTemplate, createdById: 'other-user', isShared: true };
      prismaMock.rosterTemplate.findUnique.mockResolvedValue(sharedTemplate as any);

      const res = await request(app).get('/template-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /', () => {
    it('creates a new template', async () => {
      (validateColumns as any).mockImplementation(() => {});
      prismaMock.rosterTemplate.create.mockResolvedValue(mockTemplate as any);

      const res = await request(app).post('/').send(validTemplateInput);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(prismaMock.rosterTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Test Template',
            createdById: 'admin-user-id',
          }),
        })
      );
    });

    it('returns 400 for missing name', async () => {
      const res = await request(app).post('/').send({ columns: [{ fieldKey: 'a', label: 'A' }] });

      // Zod validation error propagates through error handler
      expect(res.status).toBe(400);
    });

    it('returns 400 for empty columns array', async () => {
      const res = await request(app).post('/').send({ name: 'T', columns: [] });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /:id', () => {
    it('updates template when owner', async () => {
      prismaMock.rosterTemplate.findUnique.mockResolvedValue(mockTemplate as any);
      prismaMock.rosterTemplate.update.mockResolvedValue({ ...mockTemplate, name: 'Updated' } as any);

      const res = await request(app).put('/template-1').send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when template not found', async () => {
      prismaMock.rosterTemplate.findUnique.mockResolvedValue(null);

      const res = await request(app).put('/nonexistent').send({ name: 'X' });

      expect(res.status).toBe(404);
    });

    it('returns 403 when not owner and not admin', async () => {
      const staffApp = createTestApp(rosterRoutes, staffUser);
      const otherTemplate = { ...mockTemplate, createdById: 'other-user' };
      prismaMock.rosterTemplate.findUnique.mockResolvedValue(otherTemplate as any);

      const res = await request(staffApp).put('/template-1').send({ name: 'X' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /:id', () => {
    it('deletes template when owner', async () => {
      prismaMock.rosterTemplate.findUnique.mockResolvedValue(mockTemplate as any);
      prismaMock.rosterTemplate.delete.mockResolvedValue(mockTemplate as any);

      const res = await request(app).delete('/template-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Template deleted');
    });

    it('returns 404 when template not found', async () => {
      prismaMock.rosterTemplate.findUnique.mockResolvedValue(null);

      const res = await request(app).delete('/nonexistent');

      expect(res.status).toBe(404);
    });

    it('returns 403 when not owner and not admin', async () => {
      const staffApp = createTestApp(rosterRoutes, staffUser);
      const otherTemplate = { ...mockTemplate, createdById: 'other-user' };
      prismaMock.rosterTemplate.findUnique.mockResolvedValue(otherTemplate as any);

      const res = await request(staffApp).delete('/template-1');

      expect(res.status).toBe(403);
    });
  });

  describe('POST /preview', () => {
    it('returns paginated preview data', async () => {
      const mockResult = { providers: [{ id: '1' }], total: 1, page: 1, pageSize: 25 };
      (fetchRosterData as any).mockResolvedValue(mockResult);
      (flattenToRows as any).mockReturnValue([['Jane']]);

      const res = await request(app)
        .post('/preview')
        .send({ columns: [{ fieldKey: 'firstName', label: 'First Name' }] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rows).toEqual([['Jane']]);
      expect(res.body.data.total).toBe(1);
    });

    it('returns 400 for missing columns', async () => {
      const res = await request(app).post('/preview').send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /export', () => {
    it('returns XLSX binary file', async () => {
      (fetchAllRosterData as any).mockResolvedValue([{ id: '1' }]);
      (flattenToRows as any).mockReturnValue([['Jane']]);
      (generateExcel as any).mockResolvedValue(Buffer.from('xlsx-data'));

      const res = await request(app)
        .post('/export')
        .send({ columns: [{ fieldKey: 'firstName', label: 'First Name' }] });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
      expect(res.headers['content-disposition']).toContain('attachment');
    });

    it('uses custom report name in filename', async () => {
      (fetchAllRosterData as any).mockResolvedValue([]);
      (flattenToRows as any).mockReturnValue([]);
      (generateExcel as any).mockResolvedValue(Buffer.from('xlsx'));

      const res = await request(app)
        .post('/export')
        .send({
          columns: [{ fieldKey: 'firstName', label: 'First Name' }],
          reportName: 'My Report',
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('My_Report');
    });
  });
});
