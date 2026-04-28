import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../tests/helpers/test-app.js';
import {
  adminUser,
  validLicenseInput,
  mockLicense,
  validBoardCertInput,
  mockBoardCert,
  validMalpracticeInput,
  mockMalpractice,
  validEducationInput,
  mockEducation,
  validWorkHistoryInput,
  mockWorkHistory,
} from '../../tests/helpers/fixtures.js';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  requireProviderAccess: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middleware/audit.middleware.js', () => ({
  setAuditContext: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { credentialRoutes } from './credential.routes.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

describe('Credential Routes', () => {
  const app = createTestApp(credentialRoutes, adminUser);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // LICENSES
  // ==========================================
  describe('Licenses', () => {
    describe('GET /licenses/:providerId', () => {
      it('returns list of licenses for a provider', async () => {
        prismaMock.license.findMany.mockResolvedValue([mockLicense] as any);

        const res = await request(app).get('/licenses/provider-1-id');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);
        expect(prismaMock.license.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { providerId: 'provider-1-id' },
            orderBy: { expirationDate: 'asc' },
          })
        );
      });

      it('returns empty array when no licenses exist', async () => {
        prismaMock.license.findMany.mockResolvedValue([]);

        const res = await request(app).get('/licenses/provider-1-id');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(0);
      });
    });

    describe('POST /licenses/:providerId', () => {
      it('creates license with date conversion and sets createdById', async () => {
        prismaMock.license.create.mockResolvedValue(mockLicense as any);

        const res = await request(app)
          .post('/licenses/provider-1-id')
          .send(validLicenseInput);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(prismaMock.license.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              providerId: 'provider-1-id',
              licenseType: 'state_medical',
              licenseNumber: 'MD-12345',
              issueDate: expect.any(Date),
              expirationDate: expect.any(Date),
              createdById: 'admin-user-id',
            }),
          })
        );
      });

      it('returns error on validation failure', async () => {
        const res = await request(app)
          .post('/licenses/provider-1-id')
          .send({ licenseType: 'invalid_type' });

        expect(res.body.success).toBe(false);
        expect(res.body.error).toBeDefined();
      });
    });

    describe('PUT /licenses/:id', () => {
      it('updates license partially and sets updatedById', async () => {
        prismaMock.license.findUnique.mockResolvedValue({ providerId: 'provider-1-id' } as any);
        prismaMock.license.update.mockResolvedValue({
          ...mockLicense,
          licenseNumber: 'MD-99999',
          updatedById: 'admin-user-id',
        } as any);

        const res = await request(app)
          .put('/licenses/license-1-id')
          .send({ licenseNumber: 'MD-99999' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(prismaMock.license.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'license-1-id' },
            data: expect.objectContaining({
              updatedById: 'admin-user-id',
            }),
          })
        );
      });

      it('converts date fields when provided in update', async () => {
        prismaMock.license.findUnique.mockResolvedValue({ providerId: 'provider-1-id' } as any);
        prismaMock.license.update.mockResolvedValue(mockLicense as any);

        await request(app)
          .put('/licenses/license-1-id')
          .send({ expirationDate: '2026-06-15' });

        expect(prismaMock.license.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              expirationDate: expect.any(Date),
            }),
          })
        );
      });
    });

    describe('DELETE /licenses/:id', () => {
      it('deletes a license', async () => {
        prismaMock.license.findUnique.mockResolvedValue({ providerId: 'provider-1-id' } as any);
        prismaMock.license.delete.mockResolvedValue(mockLicense as any);

        const res = await request(app).delete('/licenses/license-1-id');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('License deleted');
        expect(prismaMock.license.delete).toHaveBeenCalledWith({
          where: { id: 'license-1-id' },
        });
      });
    });
  });

  // ==========================================
  // BOARD CERTIFICATIONS
  // ==========================================
  describe('Board Certifications', () => {
    describe('GET /certifications/:providerId', () => {
      it('returns list of certifications', async () => {
        prismaMock.boardCertification.findMany.mockResolvedValue([mockBoardCert] as any);

        const res = await request(app).get('/certifications/provider-1-id');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);
      });
    });

    describe('POST /certifications/:providerId', () => {
      it('creates certification with date conversion', async () => {
        prismaMock.boardCertification.create.mockResolvedValue(mockBoardCert as any);

        const res = await request(app)
          .post('/certifications/provider-1-id')
          .send(validBoardCertInput);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(prismaMock.boardCertification.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              providerId: 'provider-1-id',
              boardType: 'abpn_psychiatry',
              initialCertificationDate: expect.any(Date),
              createdById: 'admin-user-id',
            }),
          })
        );
      });

      it('handles optional expirationDate', async () => {
        prismaMock.boardCertification.create.mockResolvedValue(mockBoardCert as any);

        const inputWithExpiration = {
          ...validBoardCertInput,
          expirationDate: '2028-06-01',
        };

        await request(app)
          .post('/certifications/provider-1-id')
          .send(inputWithExpiration);

        expect(prismaMock.boardCertification.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              expirationDate: expect.any(Date),
            }),
          })
        );
      });

      it('returns error on validation failure', async () => {
        const res = await request(app)
          .post('/certifications/provider-1-id')
          .send({ boardType: 'invalid' });

        expect(res.body.success).toBe(false);
        expect(res.body.error).toBeDefined();
      });
    });
  });

  // ==========================================
  // MALPRACTICE INSURANCE
  // ==========================================
  describe('Malpractice Insurance', () => {
    describe('GET /malpractice/:providerId', () => {
      it('returns list of malpractice insurance', async () => {
        prismaMock.malpracticeInsurance.findMany.mockResolvedValue([mockMalpractice] as any);

        const res = await request(app).get('/malpractice/provider-1-id');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);
      });
    });

    describe('POST /malpractice/:providerId', () => {
      it('creates malpractice insurance with date conversion', async () => {
        prismaMock.malpracticeInsurance.create.mockResolvedValue(mockMalpractice as any);
        // Route wraps create in prisma.$transaction; default mock doesn't invoke the callback
        (prismaMock.$transaction as any).mockImplementation(async (cb: any) => cb(prismaMock));

        const res = await request(app)
          .post('/malpractice/provider-1-id')
          .send(validMalpracticeInput);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(prismaMock.malpracticeInsurance.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              providerId: 'provider-1-id',
              carrierName: 'PIAA Insurance',
              effectiveDate: expect.any(Date),
              expirationDate: expect.any(Date),
              createdById: 'admin-user-id',
            }),
          })
        );
      });

      it('returns error on validation failure', async () => {
        const res = await request(app)
          .post('/malpractice/provider-1-id')
          .send({ carrierName: 'Test' }); // missing required fields

        expect(res.body.success).toBe(false);
        expect(res.body.error).toBeDefined();
      });
    });
  });

  // ==========================================
  // EDUCATION
  // ==========================================
  describe('Education', () => {
    describe('GET /education/:providerId', () => {
      it('returns list of education records', async () => {
        prismaMock.education.findMany.mockResolvedValue([mockEducation] as any);

        const res = await request(app).get('/education/provider-1-id');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);
        expect(prismaMock.education.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: { graduationDate: 'desc' },
          })
        );
      });
    });

    describe('POST /education/:providerId', () => {
      it('creates education with date conversion', async () => {
        prismaMock.education.create.mockResolvedValue(mockEducation as any);

        const res = await request(app)
          .post('/education/provider-1-id')
          .send(validEducationInput);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(prismaMock.education.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              providerId: 'provider-1-id',
              institutionName: 'Johns Hopkins University',
              startDate: expect.any(Date),
              graduationDate: expect.any(Date),
              createdById: 'admin-user-id',
            }),
          })
        );
      });

      it('handles optional endDate and graduationDate', async () => {
        prismaMock.education.create.mockResolvedValue(mockEducation as any);

        const inputWithEndDate = {
          ...validEducationInput,
          endDate: '2014-05-15',
        };

        await request(app)
          .post('/education/provider-1-id')
          .send(inputWithEndDate);

        expect(prismaMock.education.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              endDate: expect.any(Date),
            }),
          })
        );
      });

      it('returns error on validation failure', async () => {
        const res = await request(app)
          .post('/education/provider-1-id')
          .send({ institutionName: 'Test' }); // missing required fields

        expect(res.body.success).toBe(false);
        expect(res.body.error).toBeDefined();
      });
    });
  });

  // ==========================================
  // WORK HISTORY
  // ==========================================
  describe('Work History', () => {
    describe('GET /work-history/:providerId', () => {
      it('returns list of work history records', async () => {
        prismaMock.workHistory.findMany.mockResolvedValue([mockWorkHistory] as any);

        const res = await request(app).get('/work-history/provider-1-id');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);
        expect(prismaMock.workHistory.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: { startDate: 'desc' },
          })
        );
      });
    });

    describe('POST /work-history/:providerId', () => {
      it('creates work history with date conversion', async () => {
        prismaMock.workHistory.create.mockResolvedValue(mockWorkHistory as any);

        const res = await request(app)
          .post('/work-history/provider-1-id')
          .send(validWorkHistoryInput);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(prismaMock.workHistory.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              providerId: 'provider-1-id',
              organizationName: 'City Hospital',
              startDate: expect.any(Date),
              createdById: 'admin-user-id',
            }),
          })
        );
      });

      it('handles optional endDate', async () => {
        prismaMock.workHistory.create.mockResolvedValue(mockWorkHistory as any);

        const inputWithEndDate = {
          ...validWorkHistoryInput,
          isCurrent: false,
          endDate: '2020-12-31',
        };

        await request(app)
          .post('/work-history/provider-1-id')
          .send(inputWithEndDate);

        expect(prismaMock.workHistory.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              endDate: expect.any(Date),
            }),
          })
        );
      });

      it('returns error on validation failure', async () => {
        const res = await request(app)
          .post('/work-history/provider-1-id')
          .send({ organizationName: 'Test' }); // missing required fields

        expect(res.body.success).toBe(false);
        expect(res.body.error).toBeDefined();
      });
    });
  });
});
