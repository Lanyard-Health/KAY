import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock Prisma
vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

// Mock auth middleware to use the injected req.user from createTestApp
vi.mock('../../middleware/auth.middleware.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    if (!req.user) {
      return _res.status(401).json({ success: false, error: { message: 'Not authenticated' } });
    }
    next();
  },
  authorize: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: { message: 'Not authenticated' } });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: { message: 'Insufficient permissions' } });
    }
    next();
  },
}));

// Mock the service layer
vi.mock('../../services/clinicalProfile.service.js', () => ({
  getOrganizationTypes: vi.fn(),
  getSpecialties: vi.fn(),
  getSubSpecialties: vi.fn(),
  getServices: vi.fn(),
  getAgeGroups: vi.fn(),
  getGenderIdentities: vi.fn(),
  getSexualOrientations: vi.fn(),
  getSpecialPopulations: vi.fn(),
  getPracticeClinicalProfile: vi.fn(),
  savePracticeClinicalProfile: vi.fn(),
  createCustomService: vi.fn(),
}));

import { createTestApp } from '../../../tests/helpers/test-app.js';
import { adminUser, providerUser } from '../../../tests/helpers/fixtures.js';
import clinicalProfileRouter from '../clinicalProfile.routes.js';
import * as clinicalProfileService from '../../services/clinicalProfile.service.js';

const validUuid = '00000000-0000-0000-0000-000000000001';

describe('clinicalProfile.routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default service mocks
    vi.mocked(clinicalProfileService.getOrganizationTypes).mockResolvedValue([]);
    vi.mocked(clinicalProfileService.getSpecialties).mockResolvedValue([]);
    vi.mocked(clinicalProfileService.getSubSpecialties).mockResolvedValue([]);
    vi.mocked(clinicalProfileService.getServices).mockResolvedValue([]);
    vi.mocked(clinicalProfileService.getPracticeClinicalProfile).mockResolvedValue({} as any);
    vi.mocked(clinicalProfileService.savePracticeClinicalProfile).mockResolvedValue(undefined);
    vi.mocked(clinicalProfileService.createCustomService).mockResolvedValue({ id: 'cs-1', name: 'Test' } as any);
  });

  // ── GET /organization-types ──────────────────────────────────────
  describe('GET /organization-types', () => {
    it('should return 200 with data', async () => {
      const app = createTestApp(clinicalProfileRouter, adminUser);
      const mockData = [{ id: '1', name: 'Hospital' }];
      vi.mocked(clinicalProfileService.getOrganizationTypes).mockResolvedValue(mockData as any);

      const res = await request(app).get('/organization-types');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockData);
    });

    it('should return 401 without authentication', async () => {
      const app = createTestApp(clinicalProfileRouter); // no user

      const res = await request(app).get('/organization-types');

      expect(res.status).toBe(401);
    });
  });

  // ── GET /specialties ─────────────────────────────────────────────
  describe('GET /specialties', () => {
    it('should accept section query param', async () => {
      const app = createTestApp(clinicalProfileRouter, adminUser);

      const res = await request(app).get('/specialties?section=INDIVIDUAL');

      expect(res.status).toBe(200);
      expect(clinicalProfileService.getSpecialties).toHaveBeenCalledWith('INDIVIDUAL');
    });

    it('should return 200 without section param', async () => {
      const app = createTestApp(clinicalProfileRouter, adminUser);

      const res = await request(app).get('/specialties');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── GET /sub-specialties ─────────────────────────────────────────
  describe('GET /sub-specialties', () => {
    it('should accept specialtyIds query param', async () => {
      const app = createTestApp(clinicalProfileRouter, adminUser);

      const res = await request(app).get(`/sub-specialties?specialtyIds=${validUuid}`);

      expect(res.status).toBe(200);
      expect(clinicalProfileService.getSubSpecialties).toHaveBeenCalledWith([validUuid]);
    });

    it('should return 400 for invalid UUIDs', async () => {
      const app = createTestApp(clinicalProfileRouter, adminUser);

      const res = await request(app).get('/sub-specialties?specialtyIds=not-a-uuid');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 when specialtyIds is missing', async () => {
      const app = createTestApp(clinicalProfileRouter, adminUser);

      const res = await request(app).get('/sub-specialties');

      expect(res.status).toBe(400);
    });
  });

  // ── POST /practices/:practiceId ──────────────────────────────────
  describe('POST /practices/:practiceId', () => {
    const validPayload = {
      organizationTypeId: validUuid,
      specialtyIds: [validUuid],
      subSpecialtyIds: [],
      serviceOfferingIds: [],
      customServices: [],
      patientAgeGroupIds: [],
      patientGenderIdentityIds: [],
      patientSexualOrientationIds: [],
      specialPopulationIds: [],
    };

    it('should return 401 without auth', async () => {
      const app = createTestApp(clinicalProfileRouter); // no user

      const res = await request(app)
        .post(`/practices/${validUuid}`)
        .send(validPayload);

      expect(res.status).toBe(401);
    });

    it('should return 403 for provider role', async () => {
      const app = createTestApp(clinicalProfileRouter, providerUser);

      const res = await request(app)
        .post(`/practices/${validUuid}`)
        .send(validPayload);

      expect(res.status).toBe(403);
    });

    it('should return 400 for missing specialtyIds', async () => {
      const app = createTestApp(clinicalProfileRouter, adminUser);

      const res = await request(app)
        .post(`/practices/${validUuid}`)
        .send({
          organizationTypeId: validUuid,
          // specialtyIds missing entirely — Zod requires min(1)
        });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid UUIDs in arrays', async () => {
      const app = createTestApp(clinicalProfileRouter, adminUser);

      const res = await request(app)
        .post(`/practices/${validUuid}`)
        .send({
          ...validPayload,
          specialtyIds: ['not-a-uuid'],
        });

      expect(res.status).toBe(400);
    });

    it('should return 200 with valid payload', async () => {
      const app = createTestApp(clinicalProfileRouter, adminUser);

      const res = await request(app)
        .post(`/practices/${validUuid}`)
        .send(validPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(clinicalProfileService.savePracticeClinicalProfile).toHaveBeenCalledWith(
        validUuid,
        validPayload,
      );
    });
  });

  // ── POST /practices/:practiceId/custom-services ──────────────────
  describe('POST /practices/:practiceId/custom-services', () => {
    it('should return 400 for empty name', async () => {
      const app = createTestApp(clinicalProfileRouter, adminUser);

      const res = await request(app)
        .post(`/practices/${validUuid}/custom-services`)
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('should return 201 with valid name', async () => {
      const app = createTestApp(clinicalProfileRouter, adminUser);

      const res = await request(app)
        .post(`/practices/${validUuid}/custom-services`)
        .send({ name: 'Equine Therapy' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(clinicalProfileService.createCustomService).toHaveBeenCalledWith(validUuid, 'Equine Therapy');
    });
  });
});
