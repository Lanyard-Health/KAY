import type { UserRole } from '@credential-management/shared';

/** One row of the entitlement report: a user with their effective access. */
export interface EntitlementRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  practices: {
    practiceId: string;
    role: string;
    practice: { id: string; name: string; status: string };
  }[];
  /** Permissions this user's system role grants (code-defined mapping). */
  effectivePermissions: string[];
}

/** Catalog entry: a permission and every role that grants it. */
export interface PermissionCatalogEntry {
  permission: string;
  roles: UserRole[];
}

export interface EntitlementQuery {
  page: number;
  pageSize: number;
  search?: string | undefined;
  role?: UserRole | undefined;
  status?: 'active' | 'inactive' | undefined;
  /** Restrict to users whose role grants this permission (reverse lookup). */
  permission?: string | undefined;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
