import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers/test-app.js';

// Mock PrismaClient — portal.service creates its own `new PrismaClient()`
vi.mock('@prisma/client', () => {
  const mockProviderApplication = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  };
  const mockProvider = {
    findUnique: vi.fn(),
    create: vi.fn(),
  };
  const mockUser = {
    create: vi.fn(),
  };
  const mockUserPractice = {
    create: vi.fn(),
  };
  const mockAdminNotification = {
    create: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  };
  const mockPractice = {
    findUnique: vi.fn(),
  };

  return {
    PrismaClient: vi.fn().mockImplementation(() => ({
      providerApplication: mockProviderApplication,
      provider: mockProvider,
      user: mockUser,
      userPractice: mockUserPractice,
      adminNotification: mockAdminNotification,
      practice: mockPractice,
      $transaction: vi.fn((fn: any) =>
        fn({
          provider: mockProvider,
          user: mockUser,
          userPractice: mockUserPractice,
          providerApplication: mockProviderApplication,
        })
      ),
    })),
  };
});

vi.mock('../src/services/email.service.js', () => ({
  emailService: {
    isConfigured: vi.fn().mockReturnValue(false),
    sendEmail: vi.fn(() => Promise.resolve({ success: true })),
  },
}));

vi.mock('../src/services/cognitoUser.service.js', () => ({
  createCognitoUser: vi.fn(() => Promise.resolve({ cognitoId: 'test-cognito-id' })),
  deleteCognitoUser: vi.fn(() => Promise.resolve()),
}));

// Mock prisma for route-level tests (portal.routes.ts imports from utils/prisma)
vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../src/middleware/auth.middleware.js', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
  authorize: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PrismaClient } from '@prisma/client';
import {
  submitApplication,
  approveApplication,
} from '../src/services/portal.service.js';
import portalRouter from '../src/routes/portal.routes.js';
import { prismaMock } from './helpers/mock-prisma.js';

// Access the mock prisma instance created by the factory
const prismaInstance = (PrismaClient as any).mock.results[0]?.value;

const validInput = {
  npi: '1234567890',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@test.com',
  phone: '555-1234',
  dateOfBirth: '1985-06-15',
  gender: 'female',
  providerType: 'psychiatrist',
};

const mockApplication = {
  id: 'app-1-id',
  npi: '1234567890',
  firstName: 'Jane',
  lastName: 'Doe',
  middleName: null,
  suffix: null,
  email: 'jane@test.com',
  phone: '555-1234',
  dateOfBirth: new Date('1985-06-15'),
  gender: 'female',
  providerType: 'psychiatrist',
  taxonomy: null,
  specialties: [],
  status: 'pending',
  submittedAt: new Date(),
  reviewedAt: null,
  reviewedBy: null,
  reviewNotes: null,
  providerId: null,
  practiceId: null,
};

describe('Provider Onboarding — v2 (Feature 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // SUBMIT APPLICATION
  // ==========================================
  describe('submitApplication', () => {
    it('creates application with valid data', async () => {
      prismaInstance.providerApplication.findFirst.mockResolvedValue(null);
      prismaInstance.provider.findUnique.mockResolvedValue(null);
      prismaInstance.providerApplication.create.mockResolvedValue(mockApplication);
      prismaInstance.adminNotification.create.mockResolvedValue({});

      const result = await submitApplication(validInput);

      expect(result.id).toBe('app-1-id');
      expect(prismaInstance.providerApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            npi: '1234567890',
            firstName: 'Jane',
          }),
        })
      );
    });

    it('stores practiceId on application when provided', async () => {
      prismaInstance.providerApplication.findFirst.mockResolvedValue(null);
      prismaInstance.provider.findUnique.mockResolvedValue(null);
      prismaInstance.providerApplication.create.mockResolvedValue({
        ...mockApplication,
        practiceId: 'practice-123',
      });
      prismaInstance.adminNotification.create.mockResolvedValue({});

      await submitApplication({ ...validInput, practiceId: 'practice-123' });

      expect(prismaInstance.providerApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            practiceId: 'practice-123',
          }),
        })
      );
    });
  });

  // ==========================================
  // APPROVE APPLICATION
  // ==========================================
  describe('approveApplication', () => {
    it('creates Provider + User records in transaction', async () => {
      prismaInstance.providerApplication.findUnique.mockResolvedValue(mockApplication);
      prismaInstance.provider.create.mockResolvedValue({ id: 'new-provider-id' });
      prismaInstance.user.create.mockResolvedValue({ id: 'new-user-id' });
      prismaInstance.providerApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'approved',
        providerId: 'new-provider-id',
      });
      prismaInstance.adminNotification.updateMany.mockResolvedValue({ count: 1 });

      const result = await approveApplication('app-1-id', 'admin@test.com');

      expect(result.status).toBe('approved');
      expect(prismaInstance.provider.create).toHaveBeenCalled();
      expect(prismaInstance.user.create).toHaveBeenCalled();
    });

    it('auto-assigns provider to practice and creates UserPractice when practiceId set', async () => {
      const appWithPractice = {
        ...mockApplication,
        practiceId: 'practice-ABC',
      };

      prismaInstance.providerApplication.findUnique.mockResolvedValue(appWithPractice);
      prismaInstance.provider.create.mockResolvedValue({ id: 'new-provider-id' });
      prismaInstance.user.create.mockResolvedValue({ id: 'new-user-id' });
      prismaInstance.userPractice.create.mockResolvedValue({});
      prismaInstance.providerApplication.update.mockResolvedValue({
        ...appWithPractice,
        status: 'approved',
        providerId: 'new-provider-id',
      });
      prismaInstance.adminNotification.updateMany.mockResolvedValue({ count: 1 });

      await approveApplication('app-1-id', 'admin@test.com');

      // Provider should be created with practiceId
      expect(prismaInstance.provider.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            practiceId: 'practice-ABC',
          }),
        })
      );

      // UserPractice should be created
      expect(prismaInstance.userPractice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'new-user-id',
            practiceId: 'practice-ABC',
            role: 'PROVIDER',
          }),
        })
      );
    });

    it('throws when application already approved', async () => {
      prismaInstance.providerApplication.findUnique.mockResolvedValue({
        ...mockApplication,
        status: 'approved',
      });

      await expect(
        approveApplication('app-1-id', 'admin@test.com')
      ).rejects.toThrow('already been reviewed');
    });
  });

  // ==========================================
  // ROUTE-LEVEL: Registration with practiceId validation
  // ==========================================
  describe('POST /register — practiceId validation (route level)', () => {
    const publicApp = createTestApp(portalRouter);

    it('returns 400 for missing required fields', async () => {
      const res = await request(publicApp)
        .post('/register')
        .send({ npi: '1234567890' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for invalid practiceId format', async () => {
      const res = await request(publicApp)
        .post('/register')
        .send({ ...validInput, practiceId: 'not-a-uuid' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when practiceId points to non-existent or inactive practice', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(null);

      const res = await request(publicApp)
        .post('/register')
        .send({
          ...validInput,
          practiceId: '00000000-0000-4000-a000-000000000099',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not found or inactive');
    });
  });

  // ==========================================
  // ROUTE-LEVEL: Public practice info endpoint
  // ==========================================
  describe('GET /practice/:practiceId/info', () => {
    const publicApp = createTestApp(portalRouter);

    it('returns practice name and status for active practice', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({
        name: 'Downtown Clinic',
        status: 'ACTIVE',
      } as any);

      const res = await request(publicApp)
        .get('/practice/00000000-0000-4000-a000-000000000001/info');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Downtown Clinic');
      expect(res.body.data.status).toBe('ACTIVE');
    });

    it('returns 404 for inactive practice', async () => {
      prismaMock.practice.findUnique.mockResolvedValue({
        name: 'Closed Clinic',
        status: 'INACTIVE',
      } as any);

      const res = await request(publicApp)
        .get('/practice/00000000-0000-4000-a000-000000000002/info');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 for non-existent practice', async () => {
      prismaMock.practice.findUnique.mockResolvedValue(null);

      const res = await request(publicApp)
        .get('/practice/00000000-0000-4000-a000-000000000099/info');

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid UUID format', async () => {
      const res = await request(publicApp)
        .get('/practice/not-a-uuid/info');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid practice ID');
    });
  });
});
