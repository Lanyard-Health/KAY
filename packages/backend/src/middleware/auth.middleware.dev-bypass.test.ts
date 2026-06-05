import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set DEV_AUTH_BYPASS=true BEFORE auth.middleware.ts is imported,
// so the module-level const DEV_BYPASS_ENABLED evaluates to true.
vi.hoisted(() => {
  process.env['DEV_AUTH_BYPASS'] = 'true';
});

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: () => ({ verify: vi.fn() }),
  },
}));

import { authenticate } from './auth.middleware.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
} from '../../tests/helpers/mock-express.js';

// Prisma mock return values need the full DB shape
const fullDevAdmin = {
  id: 'dev-admin-id',
  cognitoId: 'dev-cognito-id',
  email: 'admin@dev.local',
  firstName: 'Dev',
  lastName: 'Admin',
  role: 'admin' as const,
  isActive: true,
  providerId: null,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const fullDevProvider = {
  id: 'dev-provider-id',
  cognitoId: 'dev-provider-cognito-id',
  email: 'provider@dev.local',
  firstName: 'Dev',
  lastName: 'Provider',
  role: 'provider' as const,
  isActive: true,
  providerId: 'linked-provider-id',
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockProviderRecord = {
  id: 'linked-provider-id',
  npi: '1234567890',
  firstName: 'Dev',
  lastName: 'Provider',
  email: 'provider@dev.local',
  phone: '555-000-0000',
  status: 'active',
  providerType: 'psychiatrist',
  dateOfBirth: new Date('1980-01-01'),
  gender: 'male',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const fullStaffUser = {
  id: 'staff-id',
  cognitoId: 'staff-cognito-id',
  email: 'staff@test.com',
  firstName: 'Staff',
  lastName: 'User',
  role: 'credentialing_staff' as const,
  isActive: true,
  providerId: null,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('authenticate() — DEV_AUTH_BYPASS path', () => {
  let req: ReturnType<typeof createMockRequest>;
  let res: ReturnType<typeof createMockResponse>;
  let next: ReturnType<typeof createMockNext>;

  beforeEach(() => {
    req = createMockRequest();
    res = createMockResponse();
    next = createMockNext();
  });

  describe('dev admin (default — no X-Dev-Role header)', () => {
    it('attaches existing admin user to req and calls next', async () => {
      prismaMock.user.findUnique.mockResolvedValue(fullDevAdmin as any);

      req.headers = { authorization: 'Bearer dev-token' };
      await authenticate(req, res, next);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { cognitoId: 'dev-cognito-id' } }),
      );
      expect(req.user).toEqual(
        expect.objectContaining({
          id: 'dev-admin-id',
          email: 'admin@dev.local',
          role: 'admin',
        }),
      );
      expect(next).toHaveBeenCalledWith();
    });

    it('creates admin user when not found in DB', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(fullDevAdmin as any);

      req.headers = { authorization: 'Bearer dev-token' };
      await authenticate(req, res, next);

      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cognitoId: 'dev-cognito-id',
            email: 'admin@dev.local',
            firstName: 'Dev',
            lastName: 'Admin',
            role: 'admin',
            isActive: true,
          }),
        }),
      );
      expect(req.user).toEqual(
        expect.objectContaining({ id: 'dev-admin-id', role: 'admin' }),
      );
      expect(next).toHaveBeenCalledWith();
    });

    it('sets isSuperAdmin practice scope for admin', async () => {
      prismaMock.user.findUnique.mockResolvedValue(fullDevAdmin as any);

      req.headers = { authorization: 'Bearer dev-token' };
      await authenticate(req, res, next);

      expect(req.practiceScope).toEqual({ isSuperAdmin: true, practiceIds: [] });
    });
  });

  describe('dev provider (X-Dev-Role: provider)', () => {
    it('attaches existing provider user found by cognitoId', async () => {
      prismaMock.user.findUnique.mockResolvedValue(fullDevProvider as any);

      req.headers = { authorization: 'Bearer dev-token', 'x-dev-role': 'provider' };
      await authenticate(req, res, next);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { cognitoId: 'dev-provider-cognito-id' } }),
      );
      expect(req.user).toEqual(
        expect.objectContaining({
          id: 'dev-provider-id',
          role: 'provider',
          providerId: 'linked-provider-id',
        }),
      );
      expect(next).toHaveBeenCalledWith();
    });

    it('falls back to email lookup and updates cognitoId', async () => {
      const userWithOldCognito = { ...fullDevProvider, cognitoId: 'old-cognito-id' };
      // Not found by cognitoId
      prismaMock.user.findUnique.mockResolvedValue(null);
      // Found by email
      prismaMock.user.findFirst.mockResolvedValue(userWithOldCognito as any);
      // Updated with dev cognito ID
      prismaMock.user.update.mockResolvedValue(fullDevProvider as any);

      req.headers = { authorization: 'Bearer dev-token', 'x-dev-role': 'provider' };
      await authenticate(req, res, next);

      expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'provider@dev.local' } }),
      );
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: userWithOldCognito.id },
          data: { cognitoId: 'dev-provider-cognito-id', role: 'provider' },
        }),
      );
      expect(next).toHaveBeenCalledWith();
    });

    it('creates both provider record and user when neither exists', async () => {
      // User not found by cognitoId
      prismaMock.user.findUnique.mockResolvedValue(null);
      // User not found by email
      prismaMock.user.findFirst.mockResolvedValue(null);
      // Provider record not found
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);
      // Provider created
      prismaMock.providerProfile.create.mockResolvedValue(mockProviderRecord as any);
      // User created
      prismaMock.user.create.mockResolvedValue(fullDevProvider as any);

      req.headers = { authorization: 'Bearer dev-token', 'x-dev-role': 'provider' };
      await authenticate(req, res, next);

      expect(prismaMock.providerProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            npi: '1234567890',
            firstName: 'Dev',
            lastName: 'Provider',
            email: 'provider@dev.local',
          }),
        }),
      );
      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cognitoId: 'dev-provider-cognito-id',
            email: 'provider@dev.local',
            role: 'provider',
            providerId: 'linked-provider-id',
          }),
        }),
      );
      expect(req.user).toEqual(
        expect.objectContaining({ role: 'provider', providerId: 'linked-provider-id' }),
      );
      expect(next).toHaveBeenCalledWith();
    });

    it('links existing user to new provider when user has no providerId', async () => {
      const userWithoutProvider = { ...fullDevProvider, providerId: null };
      // Found by cognitoId but without providerId
      prismaMock.user.findUnique.mockResolvedValue(userWithoutProvider as any);
      // Provider record not found
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);
      // Provider created
      prismaMock.providerProfile.create.mockResolvedValue(mockProviderRecord as any);
      // User updated with link
      prismaMock.user.update.mockResolvedValue(fullDevProvider as any);

      req.headers = { authorization: 'Bearer dev-token', 'x-dev-role': 'provider' };
      await authenticate(req, res, next);

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: userWithoutProvider.id },
          data: { providerId: 'linked-provider-id' },
        }),
      );
      expect(next).toHaveBeenCalledWith();
    });

    it('reuses existing provider record when NPI already exists', async () => {
      // User not found
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.findFirst.mockResolvedValue(null);
      // Provider found by NPI
      prismaMock.providerProfile.findUnique.mockResolvedValue(mockProviderRecord as any);
      // User created with existing provider
      prismaMock.user.create.mockResolvedValue(fullDevProvider as any);

      req.headers = { authorization: 'Bearer dev-token', 'x-dev-role': 'provider' };
      await authenticate(req, res, next);

      expect(prismaMock.providerProfile.create).not.toHaveBeenCalled();
      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ providerId: 'linked-provider-id' }),
        }),
      );
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('dev staff (X-Dev-Role: staff)', () => {
    it('attaches first active credentialing_staff user', async () => {
      prismaMock.user.findFirst.mockResolvedValue(fullStaffUser as any);

      req.headers = { authorization: 'Bearer dev-token', 'x-dev-role': 'staff' };
      await authenticate(req, res, next);

      expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: 'credentialing_staff', isActive: true },
        }),
      );
      expect(req.user).toEqual(
        expect.objectContaining({
          id: 'staff-id',
          email: 'staff@test.com',
          role: 'credentialing_staff',
        }),
      );
      expect(next).toHaveBeenCalledWith();
    });

    it('returns UnauthorizedError when no staff user exists', async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);

      req.headers = { authorization: 'Bearer dev-token', 'x-dev-role': 'staff' };
      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'No staff user found' }),
      );
    });
  });

  describe('error handling', () => {
    it('falls through to error handler when DB query throws', async () => {
      prismaMock.user.findUnique.mockRejectedValue(new Error('DB connection lost'));

      req.headers = { authorization: 'Bearer dev-token' };
      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid token' }),
      );
    });
  });
});
