import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
});

const caqhMocks = vi.hoisted(() => ({
  checkStatus: vi.fn(),
  addToRoster: vi.fn(),
  syncProvider: vi.fn(),
}));

vi.mock('./caqh.service.js', () => ({
  // Vitest v4: constructor mocks must use function(), not arrow
  CaqhService: vi.fn().mockImplementation(function () {
    return caqhMocks;
  }),
}));

vi.mock('./email.service.js', () => ({
  emailService: {
    isConfigured: vi.fn().mockReturnValue(true),
    sendEmail: vi.fn(() => Promise.resolve({ success: true })),
  },
}));

vi.mock('./notification.service.js', () => ({
  notificationService: {
    notifyAdminUsers: vi.fn(() => Promise.resolve({ count: 1 })),
  },
}));

const enqueueMock = vi.hoisted(() => vi.fn(() => Promise.resolve({ jobId: 'j1', deduplicated: false })));
vi.mock('../queues/caqh-import.queue.js', () => ({
  enqueueCaqhImport: enqueueMock,
  MAX_CAQH_IMPORT_RECHECKS: 14,
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { emailService } from './email.service.js';
import { notificationService } from './notification.service.js';
import { processCaqhImportJob } from './caqh-import.service.js';

const provider = {
  id: 'prov-1',
  email: 'jane@test.com',
  firstName: 'Jane',
  caqhProviderId: '12345678',
  caqhImportStatus: null,
};

const attestedStatus = {
  roster_status: 'ACTIVE',
  authorization_flag: 'Y',
  provider_status_date: '20260101',
};

describe('processCaqhImportJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    caqhMocks.checkStatus.mockReset();
    caqhMocks.addToRoster.mockReset();
    caqhMocks.syncProvider.mockReset();
    prismaMock.providerProfile.update.mockResolvedValue({} as any);
  });

  it('runs the full sync when roster is active, authorized, and attested', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue(provider as any);
    caqhMocks.checkStatus.mockResolvedValue(attestedStatus);
    caqhMocks.syncProvider.mockResolvedValue({ syncId: 'sync-1', changes: {} });

    const result = await processCaqhImportJob({ providerId: 'prov-1', trigger: 'approval', recheckCount: 0 });

    expect(result.outcome).toBe('completed');
    expect(caqhMocks.addToRoster).not.toHaveBeenCalled();
    expect(caqhMocks.syncProvider).toHaveBeenCalledWith('prov-1', '12345678');
    expect(prismaMock.providerProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ caqhImportStatus: 'completed' }),
      })
    );
  });

  it('adds the provider to the roster first when not on roster', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue(provider as any);
    caqhMocks.checkStatus
      .mockResolvedValueOnce({ ...attestedStatus, roster_status: 'NOT ON ROSTER' })
      .mockResolvedValueOnce(attestedStatus);
    caqhMocks.addToRoster.mockResolvedValue({ caqhProviderId: '12345678', status: 'ok' });
    caqhMocks.syncProvider.mockResolvedValue({ syncId: 'sync-1', changes: {} });

    const result = await processCaqhImportJob({ providerId: 'prov-1', trigger: 'manual', recheckCount: 0 });

    expect(caqhMocks.addToRoster).toHaveBeenCalledWith('prov-1');
    expect(result.outcome).toBe('completed');
  });

  it('parks in waiting_authorization with a nudge email and daily recheck', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue(provider as any);
    caqhMocks.checkStatus.mockResolvedValue({ ...attestedStatus, authorization_flag: 'N' });

    const result = await processCaqhImportJob({ providerId: 'prov-1', trigger: 'approval', recheckCount: 0 });

    expect(result.outcome).toBe('waiting_authorization');
    expect(caqhMocks.syncProvider).not.toHaveBeenCalled();
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('authorize') })
    );
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'recheck', recheckCount: 1, delayMs: 24 * 60 * 60 * 1000 })
    );
  });

  it('parks in waiting_attestation when no attestation date, with distinct email copy', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue(provider as any);
    caqhMocks.checkStatus.mockResolvedValue({
      roster_status: 'ACTIVE',
      authorization_flag: 'Y',
      provider_status_date: '',
      anniversary_date: '',
    });

    const result = await processCaqhImportJob({ providerId: 'prov-1', trigger: 'approval', recheckCount: 0 });

    expect(result.outcome).toBe('waiting_attestation');
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('attestation') })
    );
  });

  it('does not re-send the nudge email on a recheck that finds the same blocker', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue({
      ...provider,
      caqhImportStatus: 'waiting_attestation',
    } as any);
    caqhMocks.checkStatus.mockResolvedValue({
      roster_status: 'ACTIVE',
      authorization_flag: 'Y',
      provider_status_date: '',
    });

    await processCaqhImportJob({ providerId: 'prov-1', trigger: 'recheck', recheckCount: 3 });

    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ recheckCount: 4 }));
  });

  it('gives up after the recheck cap and alerts admins', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue({
      ...provider,
      caqhImportStatus: 'waiting_attestation',
    } as any);
    caqhMocks.checkStatus.mockResolvedValue({
      roster_status: 'ACTIVE',
      authorization_flag: 'Y',
      provider_status_date: '',
    });

    await processCaqhImportJob({ providerId: 'prov-1', trigger: 'recheck', recheckCount: 14 });

    expect(prismaMock.providerProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ caqhImportStatus: 'failed' }),
      })
    );
    expect(notificationService.notifyAdminUsers).toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('marks failed when the provider has no CAQH ID', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue({ ...provider, caqhProviderId: null } as any);

    const result = await processCaqhImportJob({ providerId: 'prov-1', trigger: 'manual', recheckCount: 0 });

    expect(result.outcome).toBe('failed');
    expect(caqhMocks.checkStatus).not.toHaveBeenCalled();
  });

  it('records failure and rethrows on unexpected sync errors so BullMQ retries', async () => {
    prismaMock.providerProfile.findUnique.mockResolvedValue(provider as any);
    caqhMocks.checkStatus.mockResolvedValue(attestedStatus);
    caqhMocks.syncProvider.mockRejectedValue(new Error('CAQH 503'));

    await expect(
      processCaqhImportJob({ providerId: 'prov-1', trigger: 'approval', recheckCount: 0 })
    ).rejects.toThrow('CAQH 503');

    expect(prismaMock.providerProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ caqhImportStatus: 'failed', caqhImportError: 'CAQH 503' }),
      })
    );
  });
});
