import type { UUID, AuditInfo } from './common.js';

export type UserRole = 'admin' | 'credentialing_staff' | 'provider' | 'practice_admin' | 'lanyard_admin';

export interface User extends AuditInfo {
  id: UUID;
  cognitoId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt?: Date;

  // If role is 'provider', link to provider record
  providerId?: UUID;
}

export interface CreateUserDto {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  providerId?: UUID;
}

export interface UpdateUserDto {
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface AuthenticatedUser {
  id: UUID;
  cognitoId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  providerId?: UUID;
}

// Permissions by role
export const RolePermissions: Record<UserRole, string[]> = {
  admin: [
    'users:read',
    'users:write',
    'users:delete',
    'providers:read',
    'providers:write',
    'providers:delete',
    'documents:read',
    'documents:write',
    'documents:delete',
    'audit:read',
    'settings:read',
    'settings:write',
    'reports:read',
  ],
  credentialing_staff: [
    'providers:read',
    'providers:write',
    'documents:read',
    'documents:write',
    'reports:read',
  ],
  provider: [
    'providers:read:own',
    'providers:write:own',
    'documents:read:own',
    'documents:write:own',
  ],
  practice_admin: [
    'providers:read',
    'providers:write',
    'documents:read',
    'documents:write',
    'reports:read',
  ],
  lanyard_admin: [
    'users:read',
    'users:write',
    'users:delete',
    'providers:read',
    'providers:write',
    'providers:delete',
    'documents:read',
    'documents:write',
    'documents:delete',
    'audit:read',
    'settings:read',
    'settings:write',
    'reports:read',
  ],
};
