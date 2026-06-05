import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createMockRequest, createMockResponse, createMockNext } from '../../tests/helpers/mock-express.js';
import { adminUser, staffUser, providerUser } from '../../tests/helpers/fixtures.js';

// Mock dependencies - use path-based mock that imports the shared mock
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock aws-jwt-verify
const mockVerify = vi.fn();
vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: () => ({
      verify: mockVerify,
    }),
  },
}));

// Import after mocks are defined
import { authenticate, authorize, requirePermission, requireProviderAccess } from './auth.middleware.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

describe('auth.middleware', () => {
  let req: ReturnType<typeof createMockRequest>;
  let res: ReturnType<typeof createMockResponse>;
  let next: ReturnType<typeof createMockNext>;

  beforeEach(() => {
    req = createMockRequest();
    res = createMockResponse();
    next = createMockNext();
    vi.clearAllMocks();
    process.env['COGNITO_USER_POOL_ID'] = 'us-east-1_test';
    process.env['COGNITO_CLIENT_ID'] = 'test-client-id';
  });

  describe('authenticate() — JWT path', () => {
    it('rejects missing authorization header', async () => {
      req.headers = {};
      await authenticate(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'No token provided' })
      );
    });

    it('rejects header without Bearer prefix', async () => {
      req.headers = { authorization: 'Token abc123' };
      await authenticate(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'No token provided' })
      );
    });

    it('rejects invalid token', async () => {
      req.headers = { authorization: 'Bearer invalid-token' };
      mockVerify.mockRejectedValue(new Error('Invalid token'));
      await authenticate(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid token' })
      );
    });

    it('rejects when user not found in DB', async () => {
      req.headers = { authorization: 'Bearer valid-token' };
      mockVerify.mockResolvedValue({ sub: 'cognito-123' });
      prismaMock.user.findUnique.mockResolvedValue(null);

      await authenticate(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User not found' })
      );
    });

    it('rejects inactive user', async () => {
      req.headers = { authorization: 'Bearer valid-token' };
      mockVerify.mockResolvedValue({ sub: 'cognito-123' });
      prismaMock.user.findUnique.mockResolvedValue({
        ...adminUser,
        isActive: false,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      await authenticate(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User account is disabled' })
      );
    });

    it('attaches user to req and calls next on success', async () => {
      req.headers = { authorization: 'Bearer valid-token' };
      mockVerify.mockResolvedValue({ sub: 'admin-cognito-id' });
      prismaMock.user.findUnique.mockResolvedValue({
        ...adminUser,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        providerId: null,
      } as any);
      prismaMock.user.update.mockResolvedValue({} as any);

      await authenticate(req, res, next);

      expect(req.user).toEqual(
        expect.objectContaining({
          id: 'admin-user-id',
          email: 'admin@test.com',
          role: 'admin',
        })
      );
      expect(next).toHaveBeenCalledWith();
    });

    it('updates lastLoginAt on successful auth', async () => {
      req.headers = { authorization: 'Bearer valid-token' };
      mockVerify.mockResolvedValue({ sub: 'admin-cognito-id' });
      prismaMock.user.findUnique.mockResolvedValue({
        ...adminUser,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        providerId: null,
      } as any);
      prismaMock.user.update.mockResolvedValue({} as any);

      await authenticate(req, res, next);

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'admin-user-id' },
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        })
      );
    });
  });

  describe('authorize()', () => {
    it('allows matching role', () => {
      req.user = { id: adminUser.id, cognitoId: adminUser.cognitoId, email: adminUser.email, role: 'admin' };
      const middleware = authorize('admin', 'credentialing_staff');
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('rejects non-matching role', () => {
      req.user = { id: providerUser.id, cognitoId: providerUser.cognitoId, email: providerUser.email, role: 'provider' };
      const middleware = authorize('admin');
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Insufficient permissions' })
      );
    });

    it('rejects when no user attached', () => {
      req.user = undefined;
      const middleware = authorize('admin');
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Not authenticated' })
      );
    });

    it('allows credentialing_staff role', () => {
      req.user = { id: staffUser.id, cognitoId: staffUser.cognitoId, email: staffUser.email, role: 'credentialing_staff' };
      const middleware = authorize('admin', 'credentialing_staff');
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('requireProviderAccess()', () => {
    it('allows admin to access any provider', () => {
      req.user = { id: adminUser.id, cognitoId: adminUser.cognitoId, email: adminUser.email, role: 'admin' };
      req.params = { providerId: 'any-provider-id' };
      requireProviderAccess(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('allows credentialing_staff to access any provider', () => {
      req.user = { id: staffUser.id, cognitoId: staffUser.cognitoId, email: staffUser.email, role: 'credentialing_staff' };
      req.params = { providerId: 'any-provider-id' };
      requireProviderAccess(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('allows provider to access own data', () => {
      req.user = {
        id: providerUser.id,
        cognitoId: providerUser.cognitoId,
        email: providerUser.email,
        role: 'provider',
        providerId: 'provider-record-id',
      };
      req.params = { providerId: 'provider-record-id' };
      requireProviderAccess(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('denies provider access to other provider data', () => {
      req.user = {
        id: providerUser.id,
        cognitoId: providerUser.cognitoId,
        email: providerUser.email,
        role: 'provider',
        providerId: 'provider-record-id',
      };
      req.params = { providerId: 'different-provider-id' };
      requireProviderAccess(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Access denied to this provider' })
      );
    });

    it('rejects when no user attached', () => {
      req.user = undefined;
      requireProviderAccess(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Not authenticated' })
      );
    });
  });

  describe('requirePermission()', () => {
    it('allows admin with matching permission', () => {
      req.user = { id: adminUser.id, cognitoId: adminUser.cognitoId, email: adminUser.email, role: 'admin' };
      const middleware = requirePermission('providers:read');
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('allows admin with any permission (broad access)', () => {
      req.user = { id: adminUser.id, cognitoId: adminUser.cognitoId, email: adminUser.email, role: 'admin' };
      const middleware = requirePermission('audit:read');
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('denies provider permissions they lack', () => {
      req.user = { id: providerUser.id, cognitoId: providerUser.cognitoId, email: providerUser.email, role: 'provider' };
      const middleware = requirePermission('users:read');
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Insufficient permissions' })
      );
    });

    it('rejects when no user attached', () => {
      req.user = undefined;
      const middleware = requirePermission('providers:read');
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Not authenticated' })
      );
    });

    it('allows credentialing_staff with their permissions', () => {
      req.user = { id: staffUser.id, cognitoId: staffUser.cognitoId, email: staffUser.email, role: 'credentialing_staff' };
      const middleware = requirePermission('providers:write');
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('denies credentialing_staff admin-only permissions', () => {
      req.user = { id: staffUser.id, cognitoId: staffUser.cognitoId, email: staffUser.email, role: 'credentialing_staff' };
      const middleware = requirePermission('users:write');
      middleware(req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Insufficient permissions' })
      );
    });
  });
});
