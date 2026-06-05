import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/caqh.service.js', () => ({
  CaqhService: vi.fn(),
}));

import { CaqhSubmissionAdapter } from './caqh-submission-adapter.js';
import { prismaMock } from '../../../tests/helpers/mock-prisma.js';
import type {
  SubmissionAdapterInput,
} from './submission-adapter.js';
import type { ResolvedCredential } from '../../services/credential.service.js';

const baseInput: SubmissionAdapterInput = {
  enrollmentRunId: 'run-1',
  payerId: 'payer-1',
  practiceId: 'practice-1',
  providerId: 'prov-1',
  providerData: undefined,
};

// The CAQH adapter ignores the credential (org-level CAQH API auth comes from
// env vars via CaqhService) but the interface requires we accept one.
const fakeCredential: ResolvedCredential = {
  credentialId: 'cred-1',
  username: 'ignored',
  password: 'ignored',
  mfaSeed: null,
  extraConfig: null,
  wipe: vi.fn(),
};

describe('CaqhSubmissionAdapter', () => {
  let adapter: CaqhSubmissionAdapter;
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
    adapter = new CaqhSubmissionAdapter(mockCaqhService as any);
  });

  it('has adapterType "CAQH"', () => {
    expect(adapter.adapterType).toBe('CAQH');
  });

  it('returns CAQH_NOT_CONFIGURED when CaqhService is not configured', async () => {
    mockCaqhService.isConfigured.mockReturnValueOnce(false);

    const result = await adapter.submit(baseInput, fakeCredential);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CAQH_NOT_CONFIGURED');
    expect(result.errorMessage).toMatch(/CAQH/i);
    expect(mockCaqhService.addToRoster).not.toHaveBeenCalled();
    expect(mockCaqhService.syncProvider).not.toHaveBeenCalled();
  });

  it('returns PROVIDER_NOT_FOUND when the provider does not exist', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValueOnce(null as never);

    const result = await adapter.submit(baseInput, fakeCredential);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PROVIDER_NOT_FOUND');
    expect(mockCaqhService.addToRoster).not.toHaveBeenCalled();
    expect(mockCaqhService.syncProvider).not.toHaveBeenCalled();
  });

  it('skips roster add and syncs when provider already has a CAQH ID', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValueOnce({
      id: 'prov-1',
      caqhProviderId: 'caqh-123',
    } as never);

    const result = await adapter.submit(baseInput, fakeCredential);

    expect(result.success).toBe(true);
    expect(result.confirmationNumber).toBe('caqh-123');
    expect(result.externalReference).toBe('sync-1');
    expect(mockCaqhService.addToRoster).not.toHaveBeenCalled();
    expect(mockCaqhService.syncProvider).toHaveBeenCalledWith('prov-1', 'caqh-123');
    expect(prismaMock.providerProfile.update).not.toHaveBeenCalled();
  });

  it('adds to roster, persists the CAQH ID, then syncs when provider has no CAQH ID yet', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValueOnce({
      id: 'prov-1',
      caqhProviderId: null,
    } as never);
    prismaMock.providerProfile.update.mockResolvedValueOnce({
      id: 'prov-1',
      caqhProviderId: 'caqh-new',
    } as never);

    const result = await adapter.submit(baseInput, fakeCredential);

    expect(result.success).toBe(true);
    expect(result.confirmationNumber).toBe('caqh-new');
    expect(result.externalReference).toBe('sync-1');
    expect(mockCaqhService.addToRoster).toHaveBeenCalledWith('prov-1');
    expect(prismaMock.providerProfile.update).toHaveBeenCalledWith({
      where: { id: 'prov-1' },
      data: { caqhProviderId: 'caqh-new' },
    });
    expect(mockCaqhService.syncProvider).toHaveBeenCalledWith('prov-1', 'caqh-new');
  });

  it('returns CAQH_ROSTER_FAILED with the error message when addToRoster throws', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValueOnce({
      id: 'prov-1',
      caqhProviderId: null,
    } as never);
    mockCaqhService.addToRoster.mockRejectedValueOnce(new Error('roster blew up'));

    const result = await adapter.submit(baseInput, fakeCredential);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CAQH_ROSTER_FAILED');
    expect(result.errorMessage).toMatch(/roster blew up/);
    expect(mockCaqhService.syncProvider).not.toHaveBeenCalled();
  });

  it('returns CAQH_SYNC_FAILED with the error message when syncProvider throws', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValueOnce({
      id: 'prov-1',
      caqhProviderId: 'caqh-123',
    } as never);
    mockCaqhService.syncProvider.mockRejectedValueOnce(new Error('sync exploded'));

    const result = await adapter.submit(baseInput, fakeCredential);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CAQH_SYNC_FAILED');
    expect(result.errorMessage).toMatch(/sync exploded/);
  });
});
