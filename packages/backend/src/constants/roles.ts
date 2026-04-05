import type { UserRole } from '@prisma/client';

export const STAFF_ROLES = ['admin', 'credentialing_staff', 'practice_admin'] as const satisfies readonly UserRole[];
export const ADMIN_ROLES = ['admin'] as const satisfies readonly UserRole[];
export const ALL_AUTHENTICATED_ROLES = ['admin', 'credentialing_staff', 'practice_admin', 'provider'] as const satisfies readonly UserRole[];
export const STAFF_AND_PROVIDER_ROLES = ALL_AUTHENTICATED_ROLES;
