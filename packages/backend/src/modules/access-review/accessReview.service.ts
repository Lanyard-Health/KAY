import { prisma } from '../../utils/prisma.js';
import { RolePermissions } from '@credential-management/shared';
import type { UserRole } from '@credential-management/shared';
import type {
  EntitlementQuery,
  EntitlementRow,
  PaginatedResult,
  PermissionCatalogEntry,
} from './accessReview.types.js';

/**
 * Access Review service — read-only entitlement reporting.
 *
 * Role → permission mappings stay code-defined in the shared package
 * (RolePermissions). This module only REPORTS on them joined with live
 * user/practice data; it never mutates access.
 */

export function getEffectivePermissions(role: UserRole): string[] {
  return RolePermissions[role] ?? [];
}

/** Every known permission with the roles that grant it, sorted for stable output. */
export function getPermissionCatalog(): PermissionCatalogEntry[] {
  const map = new Map<string, UserRole[]>();
  for (const [role, perms] of Object.entries(RolePermissions) as [UserRole, string[]][]) {
    for (const perm of perms) {
      const roles = map.get(perm) ?? [];
      roles.push(role);
      map.set(perm, roles);
    }
  }
  return [...map.entries()]
    .map(([permission, roles]) => ({ permission, roles }))
    .sort((a, b) => a.permission.localeCompare(b.permission));
}

/** Roles whose permission list includes the given permission. */
export function rolesGranting(permission: string): UserRole[] {
  return (Object.entries(RolePermissions) as [UserRole, string[]][])
    .filter(([, perms]) => perms.includes(permission))
    .map(([role]) => role);
}

/**
 * Prisma WHERE for the entitlement report.
 * `scopePracticeIds === null` means unrestricted (admin / lanyard_staff);
 * an array means "only users who share one of these practices" (practice_admin).
 */
function buildUserWhere(
  q: Pick<EntitlementQuery, 'search' | 'role' | 'status' | 'permission'>,
  scopePracticeIds: string[] | null
): Record<string, unknown> {
  const roleFilter: UserRole[] | undefined = q.permission
    ? rolesGranting(q.permission).filter((r) => !q.role || r === q.role)
    : q.role
      ? [q.role]
      : undefined;

  return {
    ...(scopePracticeIds !== null && {
      practices: scopePracticeIds.length
        ? { some: { practiceId: { in: scopePracticeIds } } }
        : { some: { practiceId: '__no_access__' } }, // matches nothing — fail closed
    }),
    ...(q.search && {
      OR: [
        { firstName: { contains: q.search, mode: 'insensitive' as const } },
        { lastName: { contains: q.search, mode: 'insensitive' as const } },
        { email: { contains: q.search, mode: 'insensitive' as const } },
      ],
    }),
    ...(roleFilter && { role: roleFilter.length ? { in: roleFilter } : { in: ['__none__'] } }),
    ...(q.status === 'active' ? { isActive: true } : q.status === 'inactive' ? { isActive: false } : {}),
  };
}

/**
 * Selection for one entitlement row, scoped the same way the user list is.
 *
 * The WHERE built above only decides *which users* appear — "people who share
 * a practice with you". It says nothing about which of their practices you may
 * see, so an unfiltered nested select handed a practice_admin the full tenancy
 * list of everyone it matched: a viewer scoped to one practice could read the
 * names of every other company a shared user belonged to, on screen and in the
 * CSV export. Scope the nested rows too, or the row leaks what the filter just
 * finished restricting.
 */
function entitlementSelect(scopePracticeIds: string[] | null) {
  return {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    role: true,
    isActive: true,
    lastLoginAt: true,
    createdAt: true,
    practices: {
      // null means unrestricted (admin / lanyard_staff). An array — including
      // an empty one — restricts, and empty correctly yields nothing.
      ...(scopePracticeIds !== null && {
        where: { practiceId: { in: scopePracticeIds } },
      }),
      select: {
        practiceId: true,
        role: true,
        practice: { select: { id: true, name: true, status: true } },
      },
    },
  } as const;
}

export async function getEntitlements(
  q: EntitlementQuery,
  scopePracticeIds: string[] | null
): Promise<PaginatedResult<EntitlementRow>> {
  const where = buildUserWhere(q, scopePracticeIds);
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: entitlementSelect(scopePracticeIds),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    data: users.map((u) => ({
      ...u,
      role: u.role as UserRole,
      effectivePermissions: getEffectivePermissions(u.role as UserRole),
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
    totalPages: Math.ceil(total / q.pageSize),
  };
}

/** Hard cap on CSV export rows — compliance snapshots, not bulk data dumps. */
const EXPORT_ROW_CAP = 5000;

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Full (capped) entitlement report as CSV, honoring the same filters and
 * practice scoping as the paginated report.
 */
export async function exportEntitlementsCsv(
  q: Pick<EntitlementQuery, 'search' | 'role' | 'status' | 'permission'>,
  scopePracticeIds: string[] | null
): Promise<string> {
  const where = buildUserWhere(q, scopePracticeIds);
  const users = await prisma.user.findMany({
    where,
    select: entitlementSelect(scopePracticeIds),
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    take: EXPORT_ROW_CAP,
  });

  const header = [
    'Last Name',
    'First Name',
    'Email',
    'System Role',
    'Status',
    'Practices',
    'Effective Permissions',
    'Last Login',
    'Created',
  ];
  const lines = [header.join(',')];
  for (const u of users) {
    lines.push(
      [
        u.lastName,
        u.firstName,
        u.email,
        u.role,
        u.isActive ? 'active' : 'inactive',
        u.practices.map((p) => `${p.practice.name} (${p.role})`).join('; '),
        getEffectivePermissions(u.role as UserRole).join('; '),
        u.lastLoginAt ? u.lastLoginAt.toISOString() : '',
        u.createdAt.toISOString(),
      ]
        .map((v) => csvEscape(String(v)))
        .join(',')
    );
  }
  return lines.join('\r\n') + '\r\n';
}
