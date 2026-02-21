import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/caqh.service.js', () => ({
  CaqhService: vi.fn(),
}));

import { CaqhDirectAssureAdapter } from './caqh-adapter.js';
import { prismaMock } from '../../../tests/helpers/mock-prisma.js';
import type { SubmissionInput } from './payer-adapter.js';

const baseInput: SubmissionInput = {
  workflowId: 'wf-1',
  taskId: 'task-1',
  providerId: 'prov-1',
  payerId: 'payer-1',
  config: {},
};

const fakeProvider = {
  id: 'prov-1',
  caqhProviderId: 'caqh-123',
  npi: '1234567890',
  firstName: 'John',
  lastName: 'Doe',
  dateOfBirth: new Date('1980-01-01'),
};

describe('CaqhDirectAssureAdapter', () => {
  let adapter: CaqhDirectAssureAdapter;
  let mockCaqhService: {
    isConfigured: ReturnType<typeof vi.fn>;
    addToRoster: ReturnType<typeof vi.fn>;
    syncProvider: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCaqhService = {
      isConfigured: vi.fn().mockReturnValue(true),
      addToRoster: vi.fn().mockResolvedValue({ caqhProviderId: 'caqh-new', status: 'added' }),
      syncProvider: vi.fn().mockResolvedValue({ syncId: 'sync-1', changes: { licenses: 2 } }),
    };
    adapter = new CaqhDirectAssureAdapter(mockCaqhService as any);
  });

  describe('checkReadiness', () => {
    it('returns not ready when CAQH is not configured', async () => {
      mockCaqhService.isConfigured.mockReturnValue(false);

      const result = await adapter.checkReadiness(baseInput);

      expect(result.ready).toBe(false);
      expect(result.missingFields).toContain('CAQH_API_URL');
    });

    it('returns not ready when provider not found', async () => {
      prismaMock.provider.findUnique.mockResolvedValueOnce(null as never);

      const result = await adapter.checkReadiness(baseInput);

      expect(result.ready).toBe(false);
      expect(result.missingFields).toContain('provider');
    });

    it('returns not ready when provider missing required fields', async () => {
      prismaMock.provider.findUnique.mockResolvedValueOnce({
        ...fakeProvider,
        npi: null,
        dateOfBirth: null,
      } as never);

      const result = await adapter.checkReadiness(baseInput);

      expect(result.ready).toBe(false);
      expect(result.missingFields).toContain('npi');
      expect(result.missingFields).toContain('dateOfBirth');
    });

    it('returns ready with warning when provider missing caqhProviderId', async () => {
      prismaMock.provider.findUnique.mockResolvedValueOnce({
        ...fakeProvider,
        caqhProviderId: null,
      } as never);

      const result = await adapter.checkReadiness(baseInput);

      expect(result.ready).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toMatch(/CAQH Provider ID/);
    });

    it('returns ready when all fields present', async () => {
      prismaMock.provider.findUnique.mockResolvedValueOnce(fakeProvider as never);

      const result = await adapter.checkReadiness(baseInput);

      expect(result.ready).toBe(true);
      expect(result.missingFields).toHaveLength(0);
    });
  });

  describe('submit', () => {
    it('returns error when provider not found', async () => {
      prismaMock.provider.findUnique.mockResolvedValueOnce(null as never);

      const result = await adapter.submit(baseInput);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/);
    });

    it('syncs provider with existing caqhProviderId', async () => {
      prismaMock.provider.findUnique.mockResolvedValueOnce(fakeProvider as never);

      const result = await adapter.submit(baseInput);

      expect(result.success).toBe(true);
      expect(result.submissionId).toBe('sync-1');
      expect(result.confirmationNumber).toBe('caqh-123');
      expect(mockCaqhService.addToRoster).not.toHaveBeenCalled();
      expect(mockCaqhService.syncProvider).toHaveBeenCalledWith('prov-1', 'caqh-123');
    });

    it('adds to roster first when caqhProviderId missing', async () => {
      prismaMock.provider.findUnique.mockResolvedValueOnce({
        ...fakeProvider,
        caqhProviderId: null,
      } as never);
      prismaMock.provider.update.mockResolvedValueOnce(fakeProvider as never);

      const result = await adapter.submit(baseInput);

      expect(result.success).toBe(true);
      expect(mockCaqhService.addToRoster).toHaveBeenCalledWith(
        expect.objectContaining({ npi: '1234567890' })
      );
      expect(prismaMock.provider.update).toHaveBeenCalledWith({
        where: { id: 'prov-1' },
        data: { caqhProviderId: 'caqh-new' },
      });
      expect(mockCaqhService.syncProvider).toHaveBeenCalledWith('prov-1', 'caqh-new');
    });

    it('returns error when provider missing required fields', async () => {
      prismaMock.provider.findUnique.mockResolvedValueOnce({
        ...fakeProvider,
        npi: null,
      } as never);

      const result = await adapter.submit(baseInput);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/missing required fields/);
    });
  });
});
