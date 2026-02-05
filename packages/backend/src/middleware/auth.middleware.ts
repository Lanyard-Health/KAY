import type { Request, Response, NextFunction } from 'express';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { prisma } from '../utils/prisma.js';
import { UnauthorizedError, ForbiddenError } from './error.middleware.js';
import type { UserRole } from '@prisma/client';
import { RolePermissions } from '@credential-management/shared';
import { logger } from '../utils/logger.js';

// Auth bypass controlled by DEV_AUTH_BYPASS env var (set to "false" when real auth is ready)
const DEV_BYPASS_ENABLED = process.env['DEV_AUTH_BYPASS'] === 'true' && process.env['NODE_ENV'] !== 'production';

// Development mock user
const DEV_USER = {
  id: 'dev-user-id',
  cognitoId: 'dev-cognito-id',
  email: 'admin@dev.local',
  role: 'admin' as const,
  providerId: undefined,
};

// Create JWT verifier (lazy initialization)
let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier() {
  if (!verifier) {
    const userPoolId = process.env['COGNITO_USER_POOL_ID'];
    const clientId = process.env['COGNITO_CLIENT_ID'];

    if (!userPoolId || !clientId) {
      throw new Error('Cognito configuration missing');
    }

    verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: 'access',
      clientId,
    });
  }
  return verifier;
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Auth bypass (controlled by DEV_AUTH_BYPASS env var)
    if (DEV_BYPASS_ENABLED) {
      logger.warn('⚠️  AUTH BYPASS ENABLED — set DEV_AUTH_BYPASS=false for real authentication');

      // Check if dev user exists in DB, create if not
      let user = await prisma.user.findUnique({
        where: { cognitoId: DEV_USER.cognitoId },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            cognitoId: DEV_USER.cognitoId,
            email: DEV_USER.email,
            firstName: 'Dev',
            lastName: 'Admin',
            role: 'admin',
            isActive: true,
          },
        });
        logger.info('Created development admin user');
      }

      req.user = {
        id: user.id,
        cognitoId: user.cognitoId,
        email: user.email,
        role: user.role,
        providerId: user.providerId ?? undefined,
      };

      next();
      return;
    }

    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('No token provided');
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      throw new UnauthorizedError('Invalid token format');
    }

    // Verify JWT with Cognito
    const payload = await getVerifier().verify(token);

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { cognitoId: payload.sub },
      select: {
        id: true,
        cognitoId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        providerId: true,
      },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('User account is disabled');
    }

    // Attach user to request
    req.user = {
      id: user.id,
      cognitoId: user.cognitoId,
      email: user.email,
      role: user.role,
      providerId: user.providerId ?? undefined,
    };

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error);
    } else {
      next(new UnauthorizedError('Invalid token'));
    }
  }
}

// Role-based authorization middleware
export function authorize(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Not authenticated'));
      return;
    }

    if (!allowedRoles.includes(req.user.role as UserRole)) {
      next(new ForbiddenError('Insufficient permissions'));
      return;
    }

    next();
  };
}

// Permission-based authorization middleware
export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Not authenticated'));
      return;
    }

    const userPermissions = RolePermissions[req.user.role as keyof typeof RolePermissions] || [];

    // Check for exact permission or wildcard
    const hasPermission = userPermissions.some(p => {
      if (p === permission) return true;

      // Check for :own permissions
      if (permission.endsWith(':own')) {
        const basePermission = permission.replace(':own', '');
        return p === basePermission || p === permission;
      }

      return false;
    });

    if (!hasPermission) {
      next(new ForbiddenError('Insufficient permissions'));
      return;
    }

    next();
  };
}

// Check if user can access a specific provider's data
export function requireProviderAccess(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    next(new UnauthorizedError('Not authenticated'));
    return;
  }

  const { role, providerId: userProviderId } = req.user;
  const requestedProviderId = req.params['providerId'] || req.body?.providerId;

  // Admins and credentialing staff can access any provider
  if (role === 'admin' || role === 'credentialing_staff') {
    next();
    return;
  }

  // Providers can only access their own data
  if (role === 'provider' && userProviderId === requestedProviderId) {
    next();
    return;
  }

  next(new ForbiddenError('Access denied to this provider'));
}
