import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('./helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

import { prismaMock } from './helpers/mock-prisma.js';
import { getEntitlements, exportEntitlementsCsv } from '../src/modules/access-review/accessReview.service.js';

/**
 * The access review report filtered *which users* a practice_admin could see —
 * "people who share one of your practices" — and then returned every practice
 * row belonging to each of them. A viewer scoped to one practice could read the
 * names of every other company a shared user belonged to, on screen and in the
 * CSV export.
 *
 * The filter answered "may I see this person?". Nothing answered "may I see
 * this person's other tenancies?". These assert on the nested rows, which is
 * exactly what nobody was checking.
 */
const QUERY = { page: 1, pageSize: 25 } as never;

function practicesSelect(call: { select: { practices: Record<string, unknown> } }) {
  return call.select.practices;
}

describe('access review practice scoping', () => {
  beforeEach(() => {
    prismaMock.user.findMany.mockResolvedValue([] as never);
    prismaMock.user.count.mockResolvedValue(0 as never);
  });

  it('only returns the practices the viewer is scoped to', async () => {
    await getEntitlements(QUERY, ['practice-a']);

    const call = prismaMock.user.findMany.mock.calls[0]![0] as never as {
      select: { practices: { where?: unknown } };
    };
    expect(practicesSelect(call)).toHaveProperty('where');
    expect((practicesSelect(call) as { where: unknown }).where).toEqual({
      practiceId: { in: ['practice-a'] },
    });
  });

  it('leaves the practice list unfiltered for admin and lanyard_staff', async () => {
    await getEntitlements(QUERY, null);

    const call = prismaMock.user.findMany.mock.calls[0]![0] as never as {
      select: { practices: { where?: unknown } };
    };
    expect(practicesSelect(call)).not.toHaveProperty('where');
  });

  it('scopes an empty scope to nothing rather than everything', async () => {
    // A practice-scoped account with no practice rows must see no practices at
    // all. An empty array must not be read as "unrestricted".
    await getEntitlements(QUERY, []);

    const call = prismaMock.user.findMany.mock.calls[0]![0] as never as {
      select: { practices: { where: { practiceId: { in: string[] } } } };
    };
    expect(call.select.practices.where).toEqual({ practiceId: { in: [] } });
  });

  it('scopes the CSV export the same way as the screen', async () => {
    // The export is the worse leak: a downloadable file of cross-tenant
    // relationships rather than one screen.
    await exportEntitlementsCsv({} as never, ['practice-a']);

    const call = prismaMock.user.findMany.mock.calls[0]![0] as never as {
      select: { practices: { where: unknown } };
    };
    expect(call.select.practices.where).toEqual({ practiceId: { in: ['practice-a'] } });
  });
});
