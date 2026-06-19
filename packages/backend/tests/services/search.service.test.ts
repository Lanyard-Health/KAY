import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../helpers/mock-prisma.js';
import { createMockRequest } from '../helpers/mock-express.js';

vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/middleware/practiceScope.middleware.js', () => ({
  getPracticeProviderFilter: vi.fn().mockReturnValue({}),
}));

import { globalSearch } from '../../src/services/search.service.js';

describe('globalSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array for queries shorter than 2 characters', async () => {
    const req = createMockRequest({
      user: { id: 'u1', cognitoId: 'c1', email: 'a@b.com', role: 'admin' } as any,
      practiceScope: { isSuperAdmin: true, practiceIds: [] },
    });

    const results = await globalSearch(req, 'a');
    expect(results).toEqual([]);
  });

  it('returns empty array for empty query', async () => {
    const req = createMockRequest({
      user: { id: 'u1', cognitoId: 'c1', email: 'a@b.com', role: 'admin' } as any,
      practiceScope: { isSuperAdmin: true, practiceIds: [] },
    });

    const results = await globalSearch(req, '');
    expect(results).toEqual([]);
  });

  it('returns provider results', async () => {
    const req = createMockRequest({
      user: { id: 'u1', cognitoId: 'c1', email: 'a@b.com', role: 'admin' } as any,
      practiceScope: { isSuperAdmin: true, practiceIds: [] },
    });

    prismaMock.providerProfile.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'Jane', lastName: 'Doe', npi: '1234567890', email: 'jane@test.com' } as any,
    ]);
    prismaMock.practice.findMany.mockResolvedValue([]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    prismaMock.payer.findMany.mockResolvedValue([]);
    prismaMock.document.findMany.mockResolvedValue([]);

    const results = await globalSearch(req, 'Jane');

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: 'p1',
      type: 'provider',
      title: 'Jane Doe',
      subtitle: 'NPI: 1234567890',
      url: '/providers/p1',
    });
  });

  it('returns practice results for super admins', async () => {
    const req = createMockRequest({
      user: { id: 'u1', cognitoId: 'c1', email: 'a@b.com', role: 'admin' } as any,
      practiceScope: { isSuperAdmin: true, practiceIds: [] },
    });

    prismaMock.providerProfile.findMany.mockResolvedValue([]);
    prismaMock.practice.findMany.mockResolvedValue([
      { id: 'pr1', name: 'Test Practice', email: 'office@practice.com' } as any,
    ]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    prismaMock.payer.findMany.mockResolvedValue([]);
    prismaMock.document.findMany.mockResolvedValue([]);

    const results = await globalSearch(req, 'Test');

    const practiceResult = results.find((r) => r.type === 'practice');
    expect(practiceResult).toEqual({
      id: 'pr1',
      type: 'practice',
      title: 'Test Practice',
      subtitle: 'office@practice.com',
      url: '/practices/pr1',
    });
  });

  it('does not return practice results for non-super-admins', async () => {
    const req = createMockRequest({
      user: { id: 'u1', cognitoId: 'c1', email: 'a@b.com', role: 'credentialing_staff' } as any,
      practiceScope: { isSuperAdmin: false, practiceIds: ['practice-1'] },
    });

    prismaMock.providerProfile.findMany.mockResolvedValue([]);
    // practice.findMany should NOT be called for non-superadmin
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    prismaMock.payer.findMany.mockResolvedValue([]);
    prismaMock.document.findMany.mockResolvedValue([]);

    const results = await globalSearch(req, 'Test');

    const practiceResults = results.filter((r) => r.type === 'practice');
    expect(practiceResults).toHaveLength(0);
  });

  it('returns enrollment results', async () => {
    const req = createMockRequest({
      user: { id: 'u1', cognitoId: 'c1', email: 'a@b.com', role: 'admin' } as any,
      practiceScope: { isSuperAdmin: true, practiceIds: [] },
    });

    prismaMock.providerProfile.findMany.mockResolvedValue([]);
    prismaMock.practice.findMany.mockResolvedValue([]);
    prismaMock.enrollment.findMany.mockResolvedValue([
      {
        id: 'e1',
        status: 'in_progress',
        provider: { firstName: 'Jane', lastName: 'Doe' },
        payer: { name: 'Blue Cross' },
      } as any,
    ]);
    prismaMock.payer.findMany.mockResolvedValue([]);
    prismaMock.document.findMany.mockResolvedValue([]);

    const results = await globalSearch(req, 'Blue');

    const enrollmentResult = results.find((r) => r.type === 'enrollment');
    expect(enrollmentResult).toEqual({
      id: 'e1',
      type: 'enrollment',
      title: 'Jane Doe — Blue Cross',
      subtitle: 'Status: in_progress',
      url: '/enrollments/e1',
    });
  });

  it('returns payer results', async () => {
    const req = createMockRequest({
      user: { id: 'u1', cognitoId: 'c1', email: 'a@b.com', role: 'admin' } as any,
      practiceScope: { isSuperAdmin: true, practiceIds: [] },
    });

    prismaMock.providerProfile.findMany.mockResolvedValue([]);
    prismaMock.practice.findMany.mockResolvedValue([]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    prismaMock.payer.findMany.mockResolvedValue([
      { id: 'pay1', name: 'Aetna', state: 'CA' } as any,
    ]);
    prismaMock.document.findMany.mockResolvedValue([]);

    const results = await globalSearch(req, 'Aetna');

    const payerResult = results.find((r) => r.type === 'payer');
    expect(payerResult).toEqual({
      id: 'pay1',
      type: 'payer',
      title: 'Aetna',
      subtitle: 'CA',
      url: '/enrollment-strategy',
    });
  });

  it('returns document results', async () => {
    const req = createMockRequest({
      user: { id: 'u1', cognitoId: 'c1', email: 'a@b.com', role: 'admin' } as any,
      practiceScope: { isSuperAdmin: true, practiceIds: [] },
    });

    prismaMock.providerProfile.findMany.mockResolvedValue([]);
    prismaMock.practice.findMany.mockResolvedValue([]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    prismaMock.payer.findMany.mockResolvedValue([]);
    prismaMock.document.findMany.mockResolvedValue([
      { id: 'd1', fileName: 'license.pdf', documentType: 'license', providerId: 'p1' } as any,
    ]);

    const results = await globalSearch(req, 'license');

    const docResult = results.find((r) => r.type === 'document');
    expect(docResult).toEqual({
      id: 'd1',
      type: 'document',
      title: 'license.pdf',
      subtitle: 'license',
      url: '/providers/p1',
    });
  });

  it('returns combined results from multiple types', async () => {
    const req = createMockRequest({
      user: { id: 'u1', cognitoId: 'c1', email: 'a@b.com', role: 'admin' } as any,
      practiceScope: { isSuperAdmin: true, practiceIds: [] },
    });

    prismaMock.providerProfile.findMany.mockResolvedValue([
      { id: 'p1', firstName: 'Test', lastName: 'Provider', npi: '111', email: 'tp@t.com' } as any,
    ]);
    prismaMock.practice.findMany.mockResolvedValue([
      { id: 'pr1', name: 'Test Clinic', email: null } as any,
    ]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    prismaMock.payer.findMany.mockResolvedValue([]);
    prismaMock.document.findMany.mockResolvedValue([]);

    const results = await globalSearch(req, 'Test');

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.type)).toContain('provider');
    expect(results.map((r) => r.type)).toContain('practice');
  });

  it('returns empty array on database error', async () => {
    const req = createMockRequest({
      user: { id: 'u1', cognitoId: 'c1', email: 'a@b.com', role: 'admin' } as any,
      practiceScope: { isSuperAdmin: true, practiceIds: [] },
    });

    prismaMock.providerProfile.findMany.mockRejectedValue(new Error('DB error'));

    const results = await globalSearch(req, 'test');
    expect(results).toEqual([]);
  });
});
