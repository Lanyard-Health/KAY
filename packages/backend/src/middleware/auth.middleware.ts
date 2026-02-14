import type { Request, Response, NextFunction } from 'express';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { prisma } from '../utils/prisma.js';
import { UnauthorizedError, ForbiddenError } from './error.middleware.js';
import type { UserRole } from '@prisma/client';
import { RolePermissions } from '@credential-management/shared';
import { logger } from '../utils/logger.js';
import { initPracticeScope } from './practiceScope.middleware.js';

// Auth bypass controlled by DEV_AUTH_BYPASS env var (set to "false" when real auth is ready)
const DEV_BYPASS_ENABLED = process.env['DEV_AUTH_BYPASS'] === 'true';

if (DEV_BYPASS_ENABLED && process.env['NODE_ENV'] === 'production') {
  throw new Error('FATAL: DEV_AUTH_BYPASS cannot be enabled in production');
}

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

      const devRole = req.headers['x-dev-role'] as string | undefined;

      if (devRole === 'staff') {
        // Dev staff login — find the test staff user
        const staffUser = await prisma.user.findFirst({
          where: { role: 'credentialing_staff', isActive: true },
        });
        if (!staffUser) {
          next(new UnauthorizedError('No staff user found'));
          return;
        }
        req.user = {
          id: staffUser.id,
          cognitoId: staffUser.cognitoId,
          email: staffUser.email,
          role: staffUser.role,
          providerId: staffUser.providerId ?? undefined,
        };
        await initPracticeScope(req);
        next();
        return;
      }

      if (devRole === 'provider') {
        // Dev provider login
        const DEV_PROVIDER_COGNITO_ID = 'dev-provider-cognito-id';
        const DEV_PROVIDER_EMAIL = 'provider@dev.local';

        // Find or create the dev provider user
        let user = await prisma.user.findUnique({
          where: { cognitoId: DEV_PROVIDER_COGNITO_ID },
        });

        if (!user) {
          // Also check by email in case it exists from a previous run
          user = await prisma.user.findFirst({
            where: { email: DEV_PROVIDER_EMAIL },
          });

          if (user) {
            // Update the existing user to have the dev cognito ID
            user = await prisma.user.update({
              where: { id: user.id },
              data: { cognitoId: DEV_PROVIDER_COGNITO_ID, role: 'provider' },
            });
          }
        }

        if (!user) {
          // Find or create a provider record
          let provider = await prisma.provider.findUnique({
            where: { npi: '1234567890' },
          });

          if (!provider) {
            provider = await prisma.provider.create({
              data: {
                firstName: 'Dev',
                lastName: 'Provider',
                npi: '1234567890',
                email: DEV_PROVIDER_EMAIL,
                phone: '555-000-0000',
                status: 'active',
                providerType: 'psychiatrist',
                dateOfBirth: new Date('1980-01-01'),
                gender: 'male',
              },
            });
          }

          user = await prisma.user.create({
            data: {
              cognitoId: DEV_PROVIDER_COGNITO_ID,
              email: DEV_PROVIDER_EMAIL,
              firstName: 'Dev',
              lastName: 'Provider',
              role: 'provider',
              isActive: true,
              providerId: provider.id,
            },
          });
          logger.info('Created development provider user with linked provider record');
        } else if (!user.providerId) {
          // User exists but no linked provider — find or create one
          let provider = await prisma.provider.findUnique({
            where: { npi: '1234567890' },
          });

          if (!provider) {
            provider = await prisma.provider.create({
              data: {
                firstName: 'Dev',
                lastName: 'Provider',
                npi: '1234567890',
                email: DEV_PROVIDER_EMAIL,
                phone: '555-000-0000',
                status: 'active',
                providerType: 'psychiatrist',
                dateOfBirth: new Date('1980-01-01'),
                gender: 'male',
              },
            });
          }

          user = await prisma.user.update({
            where: { id: user.id },
            data: { providerId: provider.id },
          });
          logger.info('Linked existing dev provider user to new provider record');
        }

        req.user = {
          id: user.id,
          cognitoId: user.cognitoId,
          email: user.email,
          role: user.role,
          providerId: user.providerId ?? undefined,
        };

        await initPracticeScope(req);
        next();
        return;
      }

      if (devRole === 'practice_admin') {
        const DEV_PRACTICE_ADMIN_COGNITO_ID = 'dev-practice-admin-cognito-id';
        const DEV_PRACTICE_ADMIN_EMAIL = 'practiceadmin@dev.local';

        let user = await prisma.user.findUnique({
          where: { cognitoId: DEV_PRACTICE_ADMIN_COGNITO_ID },
        });

        if (!user) {
          user = await prisma.user.findFirst({
            where: { email: DEV_PRACTICE_ADMIN_EMAIL },
          });

          if (user) {
            user = await prisma.user.update({
              where: { id: user.id },
              data: { cognitoId: DEV_PRACTICE_ADMIN_COGNITO_ID, role: 'practice_admin' },
            });
          }
        }

        if (!user) {
          // Create a practice for the dev practice admin
          let practice = await prisma.practice.findFirst({
            where: { email: DEV_PRACTICE_ADMIN_EMAIL },
          });

          if (!practice) {
            practice = await prisma.practice.create({
              data: {
                name: 'Dev Practice',
                email: DEV_PRACTICE_ADMIN_EMAIL,
                phone: '555-000-0001',
                status: 'ACTIVE',
              },
            });
          }

          user = await prisma.user.create({
            data: {
              cognitoId: DEV_PRACTICE_ADMIN_COGNITO_ID,
              email: DEV_PRACTICE_ADMIN_EMAIL,
              firstName: 'Dev',
              lastName: 'PracticeAdmin',
              role: 'practice_admin',
              isActive: true,
            },
          });

          await prisma.userPractice.upsert({
            where: { userId_practiceId: { userId: user.id, practiceId: practice.id } },
            update: {},
            create: {
              userId: user.id,
              practiceId: practice.id,
              role: 'SUPER_ADMIN',
            },
          });

          logger.info('Created development practice admin user with linked practice');
        }

        req.user = {
          id: user.id,
          cognitoId: user.cognitoId,
          email: user.email,
          role: user.role,
          providerId: user.providerId ?? undefined,
        };

        await initPracticeScope(req);
        next();
        return;
      }

      // Default: dev admin login
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

      await initPracticeScope(req);
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

    await initPracticeScope(req);

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

  // Admins, credentialing staff, and practice admins can access providers (scoped by practice middleware)
  if (role === 'admin' || role === 'credentialing_staff' || role === 'practice_admin') {
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
