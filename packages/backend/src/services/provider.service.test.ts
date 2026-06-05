import { describe, it, expect, vi, beforeEach } from 'vitest';

// Both prisma and prismaBase mock to the same singleton — these tests don't care about the
// extension boundary; they care about service behavior.
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import {
  softDeleteProvider,
  restoreProvider,
  checkProviderCollision,
  collisionToHttpResponse,
} from './provider.service.js';

const PROVIDER_ID = '00000000-0000-0000-0000-000000000001';
const ACTOR_ID = '00000000-0000-0000-0000-000000000999';
const PRACTICE_A = '00000000-0000-0000-0000-0000000000aa';
const PRACTICE_B = '00000000-0000-0000-0000-0000000000bb';

describe('softDeleteProvider', () => {
  beforeEach(() => {
    (prismaMock.providerProfile.findUnique as any).mockReset();
    (prismaMock.providerProfile.findUniqueOrThrow as any).mockReset();
    (prismaMock.providerProfile.update as any).mockReset();
    (prismaMock.auditLog.create as any).mockReset();
  });

  it('sets deletedAt + deletedBy + deletionReason and writes a provider.soft_delete audit row', async () => {
    (prismaMock.providerProfile.findUnique as any).mockResolvedValue({
      id: PROVIDER_ID, deletedAt: null, firstName: 'Jane', lastName: 'Roe', npi: '1234567890',
    });
    (prismaMock.providerProfile.update as any).mockResolvedValue({ id: PROVIDER_ID });
    (prismaMock.auditLog.create as any).mockResolvedValue({ id: 'audit-1' });

    const result = await softDeleteProvider({
      providerId: PROVIDER_ID,
      actorId: ACTOR_ID,
      reason: 'Duplicate',
    });

    expect(result.wasAlreadyDeleted).toBe(false);

    const updateCall = (prismaMock.providerProfile.update as any).mock.calls[0][0];
    expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
    expect(updateCall.data.deletedBy).toBe(ACTOR_ID);
    expect(updateCall.data.deletionReason).toBe('Duplicate');

    const auditCall = (prismaMock.auditLog.create as any).mock.calls[0][0];
    expect(auditCall.data.action).toBe('PROVIDER_SOFT_DELETE');
    expect(auditCall.data.resourceType).toBe('provider');
    expect(auditCall.data.resourceId).toBe(PROVIDER_ID);
    expect(auditCall.data.userId).toBe(ACTOR_ID);
    expect((auditCall.data.changes as any).deletionReason).toBe('Duplicate');
  });

  it('is idempotent on an already-deleted provider — no second update, no second audit', async () => {
    (prismaMock.providerProfile.findUnique as any).mockResolvedValue({
      id: PROVIDER_ID, deletedAt: new Date('2026-06-01'), firstName: 'Jane', lastName: 'Roe', npi: '1234567890',
    });
    (prismaMock.providerProfile.findUniqueOrThrow as any).mockResolvedValue({ id: PROVIDER_ID, deletedAt: new Date('2026-06-01') });

    const result = await softDeleteProvider({
      providerId: PROVIDER_ID,
      actorId: ACTOR_ID,
      reason: 'Whatever',
    });

    expect(result.wasAlreadyDeleted).toBe(true);
    expect((prismaMock.providerProfile.update as any).mock.calls.length).toBe(0);
    expect((prismaMock.auditLog.create as any).mock.calls.length).toBe(0);
  });

  it('truncates a reason longer than 500 chars', async () => {
    const longReason = 'a'.repeat(600);
    (prismaMock.providerProfile.findUnique as any).mockResolvedValue({
      id: PROVIDER_ID, deletedAt: null, firstName: 'Jane', lastName: 'Roe', npi: '1234567890',
    });
    (prismaMock.providerProfile.update as any).mockResolvedValue({ id: PROVIDER_ID });

    await softDeleteProvider({ providerId: PROVIDER_ID, actorId: ACTOR_ID, reason: longReason });

    const updateCall = (prismaMock.providerProfile.update as any).mock.calls[0][0];
    expect((updateCall.data.deletionReason as string).length).toBe(500);
  });

  it('throws PROVIDER_NOT_FOUND if the row does not exist', async () => {
    (prismaMock.providerProfile.findUnique as any).mockResolvedValue(null);
    await expect(
      softDeleteProvider({ providerId: PROVIDER_ID, actorId: ACTOR_ID, reason: null })
    ).rejects.toThrow('PROVIDER_NOT_FOUND');
  });
});

describe('restoreProvider', () => {
  beforeEach(() => {
    (prismaMock.providerProfile.findUnique as any).mockReset();
    (prismaMock.providerProfile.findUniqueOrThrow as any).mockReset();
    (prismaMock.providerProfile.update as any).mockReset();
    (prismaMock.auditLog.create as any).mockReset();
  });

  it('clears deletedAt + deletedBy + deletionReason and writes a provider.restore audit row', async () => {
    (prismaMock.providerProfile.findUnique as any).mockResolvedValue({
      id: PROVIDER_ID, deletedAt: new Date('2026-06-01'), firstName: 'Jane', lastName: 'Roe', npi: '1234567890',
    });
    (prismaMock.providerProfile.update as any).mockResolvedValue({ id: PROVIDER_ID });

    const result = await restoreProvider({ providerId: PROVIDER_ID, actorId: ACTOR_ID });

    expect(result.wasAlreadyActive).toBe(false);
    const updateCall = (prismaMock.providerProfile.update as any).mock.calls[0][0];
    expect(updateCall.data.deletedAt).toBeNull();
    expect(updateCall.data.deletedBy).toBeNull();
    expect(updateCall.data.deletionReason).toBeNull();

    const auditCall = (prismaMock.auditLog.create as any).mock.calls[0][0];
    expect(auditCall.data.action).toBe('PROVIDER_RESTORE');
    expect(auditCall.data.resourceId).toBe(PROVIDER_ID);
  });

  it('is idempotent on an already-active provider — no second update, no second audit', async () => {
    (prismaMock.providerProfile.findUnique as any).mockResolvedValue({
      id: PROVIDER_ID, deletedAt: null, firstName: 'Jane', lastName: 'Roe', npi: '1234567890',
    });
    (prismaMock.providerProfile.findUniqueOrThrow as any).mockResolvedValue({ id: PROVIDER_ID, deletedAt: null });

    const result = await restoreProvider({ providerId: PROVIDER_ID, actorId: ACTOR_ID });

    expect(result.wasAlreadyActive).toBe(true);
    expect((prismaMock.providerProfile.update as any).mock.calls.length).toBe(0);
    expect((prismaMock.auditLog.create as any).mock.calls.length).toBe(0);
  });
});

describe('checkProviderCollision', () => {
  beforeEach(() => {
    (prismaMock.providerProfile.findFirst as any).mockReset();
  });

  it('returns kind=none when neither NPI nor CAQH ID exists', async () => {
    (prismaMock.providerProfile.findFirst as any).mockResolvedValue(null);
    const result = await checkProviderCollision({
      npi: '1234567890', caqhProviderId: null, isSuperAdmin: false, practiceIds: [PRACTICE_A],
    });
    expect(result.kind).toBe('none');
  });

  it('returns archived_in_scope when colliding NPI is soft-deleted in caller’s practice', async () => {
    (prismaMock.providerProfile.findFirst as any).mockResolvedValue({
      id: PROVIDER_ID, firstName: 'Jane', lastName: 'Roe', practiceId: PRACTICE_A, deletedAt: new Date('2026-05-01'),
    });
    const result = await checkProviderCollision({
      npi: '1234567890', caqhProviderId: null, isSuperAdmin: false, practiceIds: [PRACTICE_A],
    });
    expect(result.kind).toBe('archived_in_scope');
    if (result.kind === 'archived_in_scope') {
      expect(result.providerId).toBe(PROVIDER_ID);
      expect(result.providerName).toBe('Jane Roe');
      expect(result.field).toBe('npi');
      expect(result.restoreUrl).toContain(`/${PROVIDER_ID}/restore`);
    }
  });

  it('returns active_in_scope when colliding NPI is active in caller’s practice', async () => {
    (prismaMock.providerProfile.findFirst as any).mockResolvedValue({
      id: PROVIDER_ID, firstName: 'Jane', lastName: 'Roe', practiceId: PRACTICE_A, deletedAt: null,
    });
    const result = await checkProviderCollision({
      npi: '1234567890', caqhProviderId: null, isSuperAdmin: false, practiceIds: [PRACTICE_A],
    });
    expect(result.kind).toBe('active_in_scope');
  });

  it('returns out_of_scope with NO name or providerId when collision is in a different practice', async () => {
    (prismaMock.providerProfile.findFirst as any).mockResolvedValue({
      id: PROVIDER_ID, firstName: 'Secret', lastName: 'Other-Practice', practiceId: PRACTICE_B, deletedAt: null,
    });
    const result = await checkProviderCollision({
      npi: '1234567890', caqhProviderId: null, isSuperAdmin: false, practiceIds: [PRACTICE_A],
    });
    expect(result.kind).toBe('out_of_scope');
    // The result type intentionally has no providerId/providerName for out_of_scope.
    expect(Object.keys(result)).toEqual(['kind', 'field']);
  });

  it('super admin sees all collisions as in_scope (never out_of_scope)', async () => {
    (prismaMock.providerProfile.findFirst as any).mockResolvedValue({
      id: PROVIDER_ID, firstName: 'Jane', lastName: 'Roe', practiceId: PRACTICE_B, deletedAt: null,
    });
    const result = await checkProviderCollision({
      npi: '1234567890', caqhProviderId: null, isSuperAdmin: true, practiceIds: [],
    });
    expect(result.kind).toBe('active_in_scope');
  });

  it('checks CAQH provider ID too (returns its own field label)', async () => {
    (prismaMock.providerProfile.findFirst as any)
      .mockResolvedValueOnce(null) // NPI check
      .mockResolvedValueOnce({ id: PROVIDER_ID, firstName: 'Jane', lastName: 'Roe', practiceId: PRACTICE_A, deletedAt: null });
    const result = await checkProviderCollision({
      npi: '1234567890', caqhProviderId: 'caqh-xyz', isSuperAdmin: false, practiceIds: [PRACTICE_A],
    });
    expect(result.kind).toBe('active_in_scope');
    if (result.kind === 'active_in_scope') {
      expect(result.field).toBe('caqhProviderId');
    }
  });
});

describe('collisionToHttpResponse', () => {
  it('out_of_scope variant leaks NOTHING — no provider id, name, or practice', () => {
    const response = collisionToHttpResponse({ kind: 'out_of_scope', field: 'npi' });
    expect(response.statusCode).toBe(409);
    const body = JSON.stringify(response.body);
    // None of these tokens should appear anywhere in the response body.
    expect(body).not.toContain('providerId');
    expect(body).not.toContain('providerName');
    expect(body).not.toContain('practice');
    expect(body).not.toContain('restoreUrl');
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'NPI_EXISTS_OUT_OF_SCOPE' },
    });
  });

  it('archived_in_scope variant includes restoreUrl + name so the UI can offer restore', () => {
    const response = collisionToHttpResponse({
      kind: 'archived_in_scope',
      providerId: PROVIDER_ID,
      providerName: 'Jane Roe',
      restoreUrl: `/api/v1/providers/${PROVIDER_ID}/restore`,
      field: 'npi',
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'PROVIDER_ARCHIVED',
        providerId: PROVIDER_ID,
        providerName: 'Jane Roe',
      },
    });
  });

  it('CAQH out_of_scope uses the CAQH_ID code', () => {
    const response = collisionToHttpResponse({ kind: 'out_of_scope', field: 'caqhProviderId' });
    expect((response.body.error as any).code).toBe('CAQH_ID_EXISTS_OUT_OF_SCOPE');
  });
});
