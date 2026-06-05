import type { Prisma, ProviderProfile } from '@prisma/client';
import { prisma, prismaBase } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

// Cap the user-supplied reason so a runaway URL or admin paste can't blow up the DB column.
const MAX_REASON_LEN = 500;

function truncateReason(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= MAX_REASON_LEN) return trimmed;
  logger.info('soft_delete reason truncated', { originalLength: trimmed.length, cappedAt: MAX_REASON_LEN });
  return trimmed.slice(0, MAX_REASON_LEN);
}

/**
 * Soft-delete a provider. Idempotent on already-deleted (returns the existing row, no second audit).
 * Caller is responsible for admin gate + tenant scope; this service writes the row + audit only.
 *
 * Audit is AWAITED (not fire-and-forget) per Amendment 4 — a missing audit row on deletion is
 * unacceptable. Any auditLog failure throws and the soft-delete should roll back.
 */
export async function softDeleteProvider(params: {
  providerId: string;
  actorId: string | undefined;
  reason: string | null;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ provider: ProviderProfile; wasAlreadyDeleted: boolean }> {
  const existing = await prismaBase.providerProfile.findUnique({
    where: { id: params.providerId },
    select: { id: true, deletedAt: true, firstName: true, lastName: true, npi: true },
  });
  if (!existing) {
    throw new Error('PROVIDER_NOT_FOUND');
  }
  if (existing.deletedAt) {
    // Idempotent — return the current row, no second audit entry.
    const provider = await prismaBase.providerProfile.findUniqueOrThrow({
      where: { id: params.providerId },
    });
    return { provider, wasAlreadyDeleted: true };
  }

  const cleanedReason = truncateReason(params.reason);

  const result = await prismaBase.$transaction(async (tx) => {
    const updated = await tx.providerProfile.update({
      where: { id: params.providerId },
      data: {
        deletedAt: new Date(),
        deletedBy: params.actorId ?? null,
        deletionReason: cleanedReason,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: params.actorId ?? null,
        action: 'PROVIDER_SOFT_DELETE',
        resourceType: 'provider',
        resourceId: updated.id,
        changes: {
          providerName: `${existing.firstName} ${existing.lastName}`,
          npi: existing.npi,
          deletionReason: cleanedReason,
        },
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
    return updated;
  });

  return { provider: result, wasAlreadyDeleted: false };
}

/**
 * Restore a soft-deleted provider. Idempotent on already-active (no second audit).
 * Single canonical entry point — both `POST /:id/restore` and the collision-detection
 * "restore instead?" path call this function. Audit is AWAITED per Amendment 4.
 */
export async function restoreProvider(params: {
  providerId: string;
  actorId: string | undefined;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ provider: ProviderProfile; wasAlreadyActive: boolean }> {
  const existing = await prismaBase.providerProfile.findUnique({
    where: { id: params.providerId },
    select: { id: true, deletedAt: true, firstName: true, lastName: true, npi: true },
  });
  if (!existing) {
    throw new Error('PROVIDER_NOT_FOUND');
  }
  if (!existing.deletedAt) {
    const provider = await prismaBase.providerProfile.findUniqueOrThrow({
      where: { id: params.providerId },
    });
    return { provider, wasAlreadyActive: true };
  }

  const result = await prismaBase.$transaction(async (tx) => {
    const updated = await tx.providerProfile.update({
      where: { id: params.providerId },
      data: {
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: params.actorId ?? null,
        action: 'PROVIDER_RESTORE',
        resourceType: 'provider',
        resourceId: updated.id,
        changes: {
          providerName: `${existing.firstName} ${existing.lastName}`,
          npi: existing.npi,
        },
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
    return updated;
  });

  return { provider: result, wasAlreadyActive: false };
}

/**
 * List soft-deleted providers, scoped to the caller's practice(s).
 * Bypasses the soft-delete query extension — that's the whole point.
 */
export async function findArchivedProviders(params: {
  isSuperAdmin: boolean;
  practiceIds: string[];
  page: number;
  pageSize: number;
}): Promise<{ data: ProviderProfile[]; total: number }> {
  const where: Prisma.ProviderProfileWhereInput = {
    deletedAt: { not: null },
    ...(params.isSuperAdmin
      ? {}
      : params.practiceIds.length === 0
        ? { id: '__no_access__' }
        : { practiceId: { in: params.practiceIds } }),
  };

  const [data, total] = await Promise.all([
    prismaBase.providerProfile.findMany({
      where,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      orderBy: { deletedAt: 'desc' },
      select: {
        id: true,
        npi: true,
        firstName: true,
        lastName: true,
        email: true,
        practiceId: true,
        deletedAt: true,
        deletedBy: true,
        deletionReason: true,
      },
    }) as unknown as Promise<ProviderProfile[]>,
    prismaBase.providerProfile.count({ where }),
  ]);

  return { data, total };
}

export type ProviderCollisionResult =
  | { kind: 'none' }
  | {
      kind: 'archived_in_scope';
      providerId: string;
      providerName: string;
      restoreUrl: string;
      field: 'npi' | 'caqhProviderId';
    }
  | {
      kind: 'active_in_scope';
      providerId: string;
      providerName: string;
      field: 'npi' | 'caqhProviderId';
    }
  | { kind: 'out_of_scope'; field: 'npi' | 'caqhProviderId' };

/**
 * Pre-flight check before creating a new provider. Returns the type of collision (if any)
 * so the caller can decide whether to surface "restore?" UI, "duplicate" error, or
 * the leak-free "contact super admin" message.
 *
 * Critically: this query uses the BYPASS client so it sees soft-deleted rows. The whole
 * point is to detect that a colliding row exists even if it's archived.
 */
export async function checkProviderCollision(params: {
  npi?: string | null;
  caqhProviderId?: string | null;
  isSuperAdmin: boolean;
  practiceIds: string[];
}): Promise<ProviderCollisionResult> {
  const fieldsToCheck: { field: 'npi' | 'caqhProviderId'; value: string }[] = [];
  if (params.npi) fieldsToCheck.push({ field: 'npi', value: params.npi });
  if (params.caqhProviderId) fieldsToCheck.push({ field: 'caqhProviderId', value: params.caqhProviderId });

  for (const { field, value } of fieldsToCheck) {
    const existing = await prismaBase.providerProfile.findFirst({
      where: { [field]: value },
      select: { id: true, firstName: true, lastName: true, practiceId: true, deletedAt: true },
    });
    if (!existing) continue;

    const inScope =
      params.isSuperAdmin ||
      (existing.practiceId !== null && params.practiceIds.includes(existing.practiceId));

    if (!inScope) {
      // Existence-only leak: do not include name, providerId, or practiceId.
      return { kind: 'out_of_scope', field };
    }

    const providerName = `${existing.firstName} ${existing.lastName}`;
    if (existing.deletedAt) {
      return {
        kind: 'archived_in_scope',
        providerId: existing.id,
        providerName,
        restoreUrl: `/api/v1/providers/${existing.id}/restore`,
        field,
      };
    }
    return {
      kind: 'active_in_scope',
      providerId: existing.id,
      providerName,
      field,
    };
  }

  return { kind: 'none' };
}

/**
 * Human-safe error payload for a collision. The `out_of_scope` variant deliberately
 * carries no provider details — only that the identifier is already registered.
 */
export function collisionToHttpResponse(
  collision: Exclude<ProviderCollisionResult, { kind: 'none' }>
): { statusCode: number; body: Record<string, unknown> } {
  switch (collision.kind) {
    case 'archived_in_scope':
      return {
        statusCode: 409,
        body: {
          success: false,
          error: {
            code: 'PROVIDER_ARCHIVED',
            message: `${collision.providerName} is archived in this practice. Restore the existing record instead of creating a new one.`,
            providerId: collision.providerId,
            providerName: collision.providerName,
            restoreUrl: collision.restoreUrl,
            field: collision.field,
          },
        },
      };
    case 'active_in_scope':
      return {
        statusCode: 409,
        body: {
          success: false,
          error: {
            code: 'PROVIDER_ACTIVE_DUPLICATE',
            message: `${collision.providerName} already exists in this practice with the same ${collision.field}.`,
            providerId: collision.providerId,
            field: collision.field,
          },
        },
      };
    case 'out_of_scope': {
      const fieldLabel = collision.field === 'npi' ? 'NPI' : 'CAQH ID';
      const code = collision.field === 'npi' ? 'NPI_EXISTS_OUT_OF_SCOPE' : 'CAQH_ID_EXISTS_OUT_OF_SCOPE';
      return {
        statusCode: 409,
        body: {
          success: false,
          error: {
            code,
            message: `This ${fieldLabel} is already registered in our system. Contact a super-admin to restore or transfer the existing record.`,
          },
        },
      };
    }
  }
}
