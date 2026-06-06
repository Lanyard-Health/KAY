import type { Practice } from '@prisma/client';
import { prismaBase } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

const MAX_REASON_LEN = 500;

function truncateReason(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= MAX_REASON_LEN) return trimmed;
  logger.info('soft_delete reason truncated', { originalLength: trimmed.length, cappedAt: MAX_REASON_LEN });
  return trimmed.slice(0, MAX_REASON_LEN);
}

export async function softDeletePractice(params: {
  practiceId: string;
  actorId: string | undefined;
  reason: string | null;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ practice: Practice; wasAlreadyDeleted: boolean }> {
  const existing = await prismaBase.practice.findUnique({
    where: { id: params.practiceId },
    select: { id: true, deletedAt: true, name: true, email: true },
  });
  if (!existing) {
    throw new Error('PRACTICE_NOT_FOUND');
  }
  if (existing.deletedAt) {
    const practice = await prismaBase.practice.findUniqueOrThrow({
      where: { id: params.practiceId },
    });
    return { practice, wasAlreadyDeleted: true };
  }

  const cleanedReason = truncateReason(params.reason);

  const result = await prismaBase.$transaction(async (tx) => {
    const updated = await tx.practice.update({
      where: { id: params.practiceId },
      data: {
        deletedAt: new Date(),
        deletedBy: params.actorId ?? null,
        deletionReason: cleanedReason,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: params.actorId ?? null,
        action: 'PRACTICE_SOFT_DELETE',
        resourceType: 'practice',
        resourceId: updated.id,
        changes: {
          practiceName: existing.name,
          email: existing.email,
          deletionReason: cleanedReason,
        },
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
    return updated;
  });

  return { practice: result, wasAlreadyDeleted: false };
}

export async function restorePractice(params: {
  practiceId: string;
  actorId: string | undefined;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ practice: Practice; wasAlreadyActive: boolean }> {
  const existing = await prismaBase.practice.findUnique({
    where: { id: params.practiceId },
    select: { id: true, deletedAt: true, name: true, email: true },
  });
  if (!existing) {
    throw new Error('PRACTICE_NOT_FOUND');
  }
  if (!existing.deletedAt) {
    const practice = await prismaBase.practice.findUniqueOrThrow({
      where: { id: params.practiceId },
    });
    return { practice, wasAlreadyActive: true };
  }

  const result = await prismaBase.$transaction(async (tx) => {
    const updated = await tx.practice.update({
      where: { id: params.practiceId },
      data: {
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: params.actorId ?? null,
        action: 'PRACTICE_RESTORE',
        resourceType: 'practice',
        resourceId: updated.id,
        changes: {
          practiceName: existing.name,
          email: existing.email,
        },
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
    return updated;
  });

  return { practice: result, wasAlreadyActive: false };
}
