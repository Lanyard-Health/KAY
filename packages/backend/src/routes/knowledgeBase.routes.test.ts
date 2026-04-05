import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/knowledgeBase.embedding.service.js', () => ({
  upsertEmbedding: vi.fn().mockResolvedValue(undefined),
  deleteEmbeddings: vi.fn().mockResolvedValue(undefined),
  isConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock('../middleware/auth.middleware.js', async () => {
  const { UnauthorizedError, ForbiddenError } = await import(
    '../middleware/error.middleware.js'
  );
  return {
    authenticate: (req: any, _res: any, next: any) => {
      if (!req.user) {
        return next(new UnauthorizedError('Not authenticated'));
      }
      next();
    },
    authorize:
      (...allowedRoles: string[]) =>
      (req: any, _res: any, next: any) => {
        if (!req.user) {
          return next(new UnauthorizedError('Not authenticated'));
        }
        if (!allowedRoles.includes(req.user.role)) {
          return next(new ForbiddenError('Insufficient permissions'));
        }
        next();
      },
  };
});

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { knowledgeBaseRoutes } from './knowledgeBase.routes.js';

const lanyardAdmin = {
  id: 'test-lanyard-admin',
  email: 'admin@lanyard.com',
  role: 'admin',
  cognitoId: 'test-cognito-id',
};

const regularAdmin = {
  id: 'test-admin',
  email: 'admin@test.com',
  role: 'admin',
  cognitoId: 'test-admin-cognito',
};

const mockPayerTrack = {
  id: 'pt-1',
  payerName: 'Blue Cross',
  parentOrg: 'Anthem',
  payerType: 'commercial',
  stateRegion: 'CA',
  track: 'Standard',
  submissionMethod: 'portal',
  enrollmentLink: 'https://example.com',
  portalUrl: 'https://portal.example.com',
  productLines: ['HMO', 'PPO'],
  notes: 'Test notes',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const validPayerTrackInput = {
  payerName: 'Blue Cross',
  payerType: 'commercial',
  stateRegion: 'CA',
  track: 'Standard',
  submissionMethod: 'portal',
};

describe('Knowledge Base Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Auth ──────────────────────────────────────────────────

  describe('authorization', () => {
    it('returns 401 when no user is authenticated', async () => {
      const app = createTestApp(knowledgeBaseRoutes);
      const res = await request(app).get('/payer-tracks');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin roles', async () => {
      const staffUser = { id: 'test-staff', email: 'staff@test.com', role: 'credentialing_staff', cognitoId: 'test-staff-cognito' };
      const app = createTestApp(knowledgeBaseRoutes, staffUser);
      const res = await request(app).get('/payer-tracks');
      expect(res.status).toBe(403);
    });
  });

  // ─── GET /payer-tracks ─────────────────────────────────────

  describe('GET /payer-tracks', () => {
    const app = createTestApp(knowledgeBaseRoutes, lanyardAdmin);

    it('returns list of payer tracks', async () => {
      const tracks = [
        { ...mockPayerTrack, _count: { contacts: 2, timelines: 1, stateRules: 0, forms: 3, requirements: 1, workflowTemplates: 0, followUpTemplates: 0 } },
      ];
      (prismaMock.payerTrack.findMany as any).mockResolvedValue(tracks);

      const res = await request(app).get('/payer-tracks');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].payerName).toBe('Blue Cross');
    });

    it('passes search filter to prisma', async () => {
      (prismaMock.payerTrack.findMany as any).mockResolvedValue([]);

      await request(app).get('/payer-tracks?search=Aetna');

      expect(prismaMock.payerTrack.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ payerName: { contains: 'Aetna', mode: 'insensitive' } }),
            ]),
          }),
        }),
      );
    });

    it('passes payerType and stateRegion filters', async () => {
      (prismaMock.payerTrack.findMany as any).mockResolvedValue([]);

      await request(app).get('/payer-tracks?payerType=commercial&stateRegion=CA');

      expect(prismaMock.payerTrack.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            payerType: 'commercial',
            stateRegion: 'CA',
          }),
        }),
      );
    });

    it('passes isActive boolean filter', async () => {
      (prismaMock.payerTrack.findMany as any).mockResolvedValue([]);

      await request(app).get('/payer-tracks?isActive=true');

      expect(prismaMock.payerTrack.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });
  });

  // ─── GET /payer-tracks/:id ─────────────────────────────────

  describe('GET /payer-tracks/:id', () => {
    const app = createTestApp(knowledgeBaseRoutes, lanyardAdmin);

    it('returns payer track with children', async () => {
      const detail = {
        ...mockPayerTrack,
        contacts: [{ id: 'c1', contactType: 'provider_enrollment', phone: '555-1234' }],
        timelines: [],
        stateRules: [],
        forms: [],
        requirements: [],
      };
      (prismaMock.payerTrack.findUnique as any).mockResolvedValue(detail);

      const res = await request(app).get('/payer-tracks/pt-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.contacts).toHaveLength(1);
    });

    it('returns 404 when not found', async () => {
      (prismaMock.payerTrack.findUnique as any).mockResolvedValue(null);

      const res = await request(app).get('/payer-tracks/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── POST /payer-tracks ────────────────────────────────────

  describe('POST /payer-tracks', () => {
    const app = createTestApp(knowledgeBaseRoutes, lanyardAdmin);

    it('creates a payer track with valid body', async () => {
      const app = createTestApp(knowledgeBaseRoutes, lanyardAdmin);
      const created = { ...mockPayerTrack, ...validPayerTrackInput };
      (prismaMock.payerTrack.create as any).mockResolvedValueOnce(created);

      const res = await request(app).post('/payer-tracks').send(validPayerTrackInput);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.payerName).toBe('Blue Cross');
      expect(prismaMock.payerTrack.create).toHaveBeenCalledWith({
        data: expect.objectContaining(validPayerTrackInput),
      });
    });

    it('rejects missing required fields (Zod validation)', async () => {
      const res = await request(app).post('/payer-tracks').send({ payerName: 'Incomplete' });

      // Zod errors pass through error handler as 400 or 500 depending on handler
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(prismaMock.payerTrack.create).not.toHaveBeenCalled();
    });

    it('rejects empty payerName', async () => {
      const res = await request(app).post('/payer-tracks').send({
        ...validPayerTrackInput,
        payerName: '',
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(prismaMock.payerTrack.create).not.toHaveBeenCalled();
    });
  });

  // ─── PATCH /payer-tracks/:id ───────────────────────────────

  describe('PATCH /payer-tracks/:id', () => {
    const app = createTestApp(knowledgeBaseRoutes, lanyardAdmin);

    it('updates a payer track', async () => {
      const updated = { ...mockPayerTrack, payerName: 'Updated Name' };
      (prismaMock.payerTrack.update as any).mockResolvedValue(updated);

      const res = await request(app)
        .patch('/payer-tracks/pt-1')
        .send({ payerName: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.payerName).toBe('Updated Name');
      expect(prismaMock.payerTrack.update).toHaveBeenCalledWith({
        where: { id: 'pt-1' },
        data: expect.objectContaining({ payerName: 'Updated Name' }),
      });
    });

    it('accepts partial updates', async () => {
      (prismaMock.payerTrack.update as any).mockResolvedValue({ ...mockPayerTrack, notes: 'new note' });

      const res = await request(app)
        .patch('/payer-tracks/pt-1')
        .send({ notes: 'new note' });

      expect(res.status).toBe(200);
      expect(prismaMock.payerTrack.update).toHaveBeenCalledWith({
        where: { id: 'pt-1' },
        data: { notes: 'new note' },
      });
    });
  });

  // ─── DELETE /payer-tracks/:id ──────────────────────────────

  describe('DELETE /payer-tracks/:id', () => {
    const app = createTestApp(knowledgeBaseRoutes, lanyardAdmin);

    it('deletes a payer track', async () => {
      (prismaMock.payerTrack.delete as any).mockResolvedValue(mockPayerTrack);

      const res = await request(app).delete('/payer-tracks/pt-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('PayerTrack deleted');
      expect(prismaMock.payerTrack.delete).toHaveBeenCalledWith({
        where: { id: 'pt-1' },
      });
    });
  });

  // ─── GET /gaps ─────────────────────────────────────────────

  describe('GET /gaps', () => {
    const app = createTestApp(knowledgeBaseRoutes, lanyardAdmin);

    it('returns gap analysis data', async () => {
      const trackWithGaps = {
        ...mockPayerTrack,
        parentOrg: null,
        enrollmentLink: null,
        portalUrl: null,
        notes: null,
        productLines: [],
        contacts: [],
        timelines: [],
        stateRules: [],
        forms: [],
        requirements: [],
      };
      (prismaMock.payerTrack.findMany as any).mockResolvedValue([trackWithGaps]);
      (prismaMock.requirementUniversal.findMany as any).mockResolvedValue([]);

      const res = await request(app).get('/gaps');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.meta.totalGaps).toBe(res.body.data.length);

      // Should include gaps for missing parentOrg, enrollmentLink, portalUrl, notes, productLines, contacts, timelines
      const fields = res.body.data.map((g: any) => g.field);
      expect(fields).toContain('parentOrg');
      expect(fields).toContain('enrollmentLink');
      expect(fields).toContain('portalUrl');
      expect(fields).toContain('notes');
      expect(fields).toContain('productLines');
      expect(fields).toContain('contacts (none)');
      expect(fields).toContain('timelines (none)');
    });

    it('includes universal requirement gaps', async () => {
      (prismaMock.payerTrack.findMany as any).mockResolvedValue([]);
      (prismaMock.requirementUniversal.findMany as any).mockResolvedValue([
        {
          id: 'ru-1',
          name: 'DEA License',
          description: 'Required for prescribing',
          appliesTo: 'all',
          isBlocking: true,
          standardMinimum: null,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const res = await request(app).get('/gaps');

      expect(res.status).toBe(200);
      const universalGaps = res.body.data.filter((g: any) => g.payerName === 'Universal');
      expect(universalGaps.length).toBe(2); // standardMinimum + notes
    });

    it('returns empty gaps for complete data', async () => {
      const completeTrack = {
        ...mockPayerTrack,
        contacts: [{ id: 'c1', contactType: 'enrollment', phone: '555-1234', email: null, fax: null }],
        timelines: [{ id: 't1', processType: 'initial', minDays: 30, maxDays: 60 }],
        stateRules: [],
        forms: [],
        requirements: [],
      };
      (prismaMock.payerTrack.findMany as any).mockResolvedValue([completeTrack]);
      (prismaMock.requirementUniversal.findMany as any).mockResolvedValue([]);

      const res = await request(app).get('/gaps');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.totalGaps).toBe(0);
    });
  });

  // ─── GET /filter-options ───────────────────────────────────

  describe('GET /filter-options', () => {
    const app = createTestApp(knowledgeBaseRoutes, lanyardAdmin);

    it('returns distinct payerTypes and stateRegions', async () => {
      (prismaMock.payerTrack.findMany as any)
        .mockResolvedValueOnce([{ payerType: 'commercial' }, { payerType: 'medicare' }])
        .mockResolvedValueOnce([{ stateRegion: 'CA' }, { stateRegion: 'NY' }]);

      const res = await request(app).get('/filter-options');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.payerTypes).toEqual(['commercial', 'medicare']);
      expect(res.body.data.stateRegions).toEqual(['CA', 'NY']);
    });
  });

  // ─── Nested child routes ───────────────────────────────────

  describe('POST /payer-tracks/:trackId/contacts', () => {
    const app = createTestApp(knowledgeBaseRoutes, lanyardAdmin);

    it('creates a contact under a payer track', async () => {
      const contactInput = { contactType: 'provider_enrollment', phone: '555-1234' };
      const created = { id: 'c1', payerTrackId: 'pt-1', ...contactInput };
      (prismaMock.payerContact.create as any).mockResolvedValue(created);

      const res = await request(app)
        .post('/payer-tracks/pt-1/contacts')
        .send(contactInput);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(prismaMock.payerContact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contactType: 'provider_enrollment',
          payerTrackId: 'pt-1',
        }),
      });
    });

    it('rejects missing contactType', async () => {
      const res = await request(app)
        .post('/payer-tracks/pt-1/contacts')
        .send({ phone: '555-1234' });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(prismaMock.payerContact.create).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /contacts/:id', () => {
    const app = createTestApp(knowledgeBaseRoutes, lanyardAdmin);

    it('deletes a contact', async () => {
      (prismaMock.payerContact.delete as any).mockResolvedValue({ id: 'c1' });

      const res = await request(app).delete('/contacts/c1');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Contact deleted');
    });
  });
});
