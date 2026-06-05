import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const hookMock = vi.fn();
vi.mock('./enrollment-creation-hook.js', () => ({
  onEnrollmentCreated: (...args: unknown[]) => hookMock(...args),
}));

import { ensureDraftEnrollments } from './draft-enrollment.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

const PRACTICE_ID = 'practice-1';
const PROVIDER_ID = 'provider-1';
const PAYER_A = 'payer-a';
const PAYER_B = 'payer-b';

function stubPayersExist(ids: string[]) {
  prismaMock.payer.findMany.mockResolvedValue(
    ids.map((id) => ({ id })) as any
  );
}

describe('ensureDraftEnrollments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookMock.mockResolvedValue({ stepsCreated: 0, templateFound: false, workflowType: null });
  });

  it('requires providerId or payerId', async () => {
    await expect(
      ensureDraftEnrollments({ practiceId: PRACTICE_ID })
    ).rejects.toThrow(/providerId or payerId/);
  });

  it('returns 0 when practice does not exist', async () => {
    prismaMock.practice.findUnique.mockResolvedValue(null);
    const result = await ensureDraftEnrollments({
      practiceId: PRACTICE_ID,
      providerId: PROVIDER_ID,
    });
    expect(result.created).toBe(0);
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });

  it('creates one draft per target payer when provider is added', async () => {
    prismaMock.practice.findUnique.mockResolvedValue({
      targetPayerIds: [PAYER_A, PAYER_B],
    } as any);
    stubPayersExist([PAYER_A, PAYER_B]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    prismaMock.enrollment.create.mockImplementation(async ({ data }: any) => ({
      id: `e-${data.payerId}`,
      ...data,
      payer: { name: 'x' },
      provider: { providerType: 'md' },
    }) as any);

    const result = await ensureDraftEnrollments({
      practiceId: PRACTICE_ID,
      providerId: PROVIDER_ID,
    });

    expect(result.created).toBe(2);
    expect(prismaMock.enrollment.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.enrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerId: PROVIDER_ID,
          payerId: PAYER_A,
          status: 'not_started',
          isDraft: true,
        }),
      })
    );
    // Workflow hydration fired for each draft
    expect(hookMock).toHaveBeenCalledTimes(2);
  });

  it('is idempotent: skips existing (provider, payer) pairs', async () => {
    prismaMock.practice.findUnique.mockResolvedValue({
      targetPayerIds: [PAYER_A, PAYER_B],
    } as any);
    stubPayersExist([PAYER_A, PAYER_B]);
    // Existing enrollment for PAYER_A — should be skipped
    prismaMock.enrollment.findMany.mockResolvedValue([
      { providerId: PROVIDER_ID, payerId: PAYER_A },
    ] as any);
    prismaMock.enrollment.create.mockImplementation(async ({ data }: any) => ({
      id: `e-${data.payerId}`,
      ...data,
      payer: { name: 'x' },
      provider: { providerType: 'md' },
    }) as any);

    const result = await ensureDraftEnrollments({
      practiceId: PRACTICE_ID,
      providerId: PROVIDER_ID,
    });

    expect(result.created).toBe(1);
    expect(prismaMock.enrollment.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.enrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payerId: PAYER_B }),
      })
    );
  });

  it('when a payer is added, creates one draft per existing provider', async () => {
    prismaMock.practice.findUnique.mockResolvedValue({
      targetPayerIds: [PAYER_A],
    } as any);
    prismaMock.providerProfile.findMany.mockResolvedValue([
      { id: 'p1' },
      { id: 'p2' },
      { id: 'p3' },
    ] as any);
    stubPayersExist([PAYER_A]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    prismaMock.enrollment.create.mockImplementation(async ({ data }: any) => ({
      id: `e-${data.providerId}`,
      ...data,
      payer: { name: 'x' },
      provider: { providerType: 'md' },
    }) as any);

    const result = await ensureDraftEnrollments({
      practiceId: PRACTICE_ID,
      payerId: PAYER_A,
    });

    expect(result.created).toBe(3);
    expect(prismaMock.providerProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          practiceId: PRACTICE_ID,
          status: { not: 'inactive' },
        }),
      })
    );
  });

  it('when added payer is not in targetPayerIds, creates nothing', async () => {
    prismaMock.practice.findUnique.mockResolvedValue({
      targetPayerIds: [PAYER_A],
    } as any);

    const result = await ensureDraftEnrollments({
      practiceId: PRACTICE_ID,
      payerId: PAYER_B, // not a target
    });

    expect(result.created).toBe(0);
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });

  it('skips payers that do not exist in the Payer table', async () => {
    prismaMock.practice.findUnique.mockResolvedValue({
      targetPayerIds: [PAYER_A, PAYER_B],
    } as any);
    // Only PAYER_A is a real row; PAYER_B was deleted/renamed
    stubPayersExist([PAYER_A]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    prismaMock.enrollment.create.mockImplementation(async ({ data }: any) => ({
      id: `e-${data.payerId}`,
      ...data,
      payer: { name: 'x' },
      provider: { providerType: 'md' },
    }) as any);

    const result = await ensureDraftEnrollments({
      practiceId: PRACTICE_ID,
      providerId: PROVIDER_ID,
    });

    expect(result.created).toBe(1);
    expect(prismaMock.enrollment.create).toHaveBeenCalledTimes(1);
  });

  it('logs but does not throw when workflow hydration fails', async () => {
    prismaMock.practice.findUnique.mockResolvedValue({
      targetPayerIds: [PAYER_A],
    } as any);
    stubPayersExist([PAYER_A]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    prismaMock.enrollment.create.mockResolvedValue({
      id: 'e1',
      providerId: PROVIDER_ID,
      payerId: PAYER_A,
      payer: { name: 'x' },
      provider: { providerType: 'md' },
    } as any);
    hookMock.mockRejectedValueOnce(new Error('boom'));

    const result = await ensureDraftEnrollments({
      practiceId: PRACTICE_ID,
      providerId: PROVIDER_ID,
    });

    expect(result.created).toBe(1);
  });

  it('recovers from unique-constraint races and skips the duplicate', async () => {
    prismaMock.practice.findUnique.mockResolvedValue({
      targetPayerIds: [PAYER_A, PAYER_B],
    } as any);
    stubPayersExist([PAYER_A, PAYER_B]);
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    prismaMock.enrollment.create
      .mockRejectedValueOnce(new Error('Unique constraint failed on the fields: (providerId, payerId)'))
      .mockResolvedValueOnce({
        id: 'e2',
        providerId: PROVIDER_ID,
        payerId: PAYER_B,
        payer: { name: 'x' },
        provider: { providerType: 'md' },
      } as any);

    const result = await ensureDraftEnrollments({
      practiceId: PRACTICE_ID,
      providerId: PROVIDER_ID,
    });

    expect(result.created).toBe(1);
  });
});
