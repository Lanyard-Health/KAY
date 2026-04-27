import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before imports
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn(() => ({ stop: vi.fn() })) },
}));

vi.mock('./followup.service.js', () => ({
  followUpService: { processAllDueFollowUps: vi.fn() },
}));

vi.mock('./email.service.js', () => ({
  emailService: { isConfigured: vi.fn().mockReturnValue(false) },
}));

vi.mock('./ai.service.js', () => ({
  isConfigured: vi.fn().mockReturnValue(false),
  generateExpirationAlerts: vi.fn(),
}));

vi.mock('./notification.service.js', () => ({
  notificationService: {
    notifyAdminUsers: vi.fn().mockResolvedValue(undefined),
    cleanupOldNotifications: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./expiration.service.js', () => ({
  ExpirationService: vi.fn().mockImplementation(function () {
    return { sendExpirationReminders: vi.fn() };
  }),
}));

// Mock CaqhService — constructor must use function() not arrow
vi.mock('./caqh.service.js', () => ({
  CaqhService: vi.fn().mockImplementation(function () {
    return {
      isConfigured: vi.fn().mockReturnValue(false),
      syncProvider: vi.fn(),
    };
  }),
}));

import { schedulerService } from './scheduler.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { CaqhService } from './caqh.service.js';
import { notificationService } from './notification.service.js';

// Get the mock CaqhService instance created by the constructor
const caqhServiceInstance = (CaqhService as any).mock.results[0]?.value;

describe('SchedulerService — CAQH Sync Job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runCaqhSyncJob', () => {
    it('returns empty result when no eligible providers found', async () => {
      prismaMock.provider.findMany.mockResolvedValue([]);

      const result = await schedulerService.runCaqhSyncJob();

      expect(result).toEqual({ synced: 0, failed: 0, skipped: 0, results: [] });
      expect(prismaMock.provider.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            caqhProviderId: { not: null },
            caqhCredentialsValid: true,
          },
        })
      );
    });

    it('syncs eligible providers and returns summary', async () => {
      prismaMock.provider.findMany.mockResolvedValue([
        { id: 'p1', firstName: 'Jane', lastName: 'Doe', caqhProviderId: 'caqh-1' },
        { id: 'p2', firstName: 'John', lastName: 'Smith', caqhProviderId: 'caqh-2' },
      ] as any);

      const syncResult = {
        syncId: 'sync-1',
        changes: {
          licenses: { created: 1, updated: 0, skipped: 0, failed: 0 },
          certifications: { created: 0, updated: 0, skipped: 0, failed: 0 },
          education: { created: 0, updated: 0, skipped: 0, failed: 0 },
          malpractice: { created: 0, updated: 0, skipped: 0, failed: 0 },
          failedRecords: [],
        },
      };

      caqhServiceInstance.syncProvider.mockResolvedValue(syncResult);

      const result = await schedulerService.runCaqhSyncJob();

      expect(result.synced).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toEqual(
        expect.objectContaining({
          providerId: 'p1',
          providerName: 'Jane Doe',
          success: true,
        })
      );
      expect(caqhServiceInstance.syncProvider).toHaveBeenCalledWith('p1', 'caqh-1');
      expect(caqhServiceInstance.syncProvider).toHaveBeenCalledWith('p2', 'caqh-2');
    });

    it('sends notification when sync produces changes', async () => {
      prismaMock.provider.findMany.mockResolvedValue([
        { id: 'p1', firstName: 'Jane', lastName: 'Doe', caqhProviderId: 'caqh-1' },
      ] as any);

      caqhServiceInstance.syncProvider.mockResolvedValue({
        syncId: 'sync-1',
        changes: {
          licenses: { created: 2, updated: 1, skipped: 0, failed: 0 },
          certifications: { created: 0, updated: 0, skipped: 0, failed: 0 },
          education: { created: 0, updated: 0, skipped: 0, failed: 0 },
          malpractice: { created: 0, updated: 0, skipped: 0, failed: 0 },
          failedRecords: [],
        },
      });

      await schedulerService.runCaqhSyncJob();

      expect(notificationService.notifyAdminUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system_announcement',
          title: 'CAQH Sync Update',
          message: expect.stringContaining('3 credential(s)'),
          actionUrl: '/providers/p1',
        })
      );
    });

    it('does NOT send notification when sync has zero changes', async () => {
      prismaMock.provider.findMany.mockResolvedValue([
        { id: 'p1', firstName: 'Jane', lastName: 'Doe', caqhProviderId: 'caqh-1' },
      ] as any);

      caqhServiceInstance.syncProvider.mockResolvedValue({
        syncId: 'sync-1',
        changes: {
          licenses: { created: 0, updated: 0, skipped: 0, failed: 0 },
          certifications: { created: 0, updated: 0, skipped: 0, failed: 0 },
          education: { created: 0, updated: 0, skipped: 0, failed: 0 },
          malpractice: { created: 0, updated: 0, skipped: 0, failed: 0 },
          failedRecords: [],
        },
      });

      await schedulerService.runCaqhSyncJob();

      expect(notificationService.notifyAdminUsers).not.toHaveBeenCalled();
    });

    it('handles individual provider sync failures gracefully', async () => {
      prismaMock.provider.findMany.mockResolvedValue([
        { id: 'p1', firstName: 'Jane', lastName: 'Doe', caqhProviderId: 'caqh-1' },
        { id: 'p2', firstName: 'John', lastName: 'Smith', caqhProviderId: 'caqh-2' },
      ] as any);

      caqhServiceInstance.syncProvider
        .mockRejectedValueOnce(new Error('CAQH API timeout'))
        .mockResolvedValueOnce({
          syncId: 'sync-2',
          changes: {
            licenses: { created: 0, updated: 0, skipped: 0, failed: 0 },
            certifications: { created: 0, updated: 0, skipped: 0, failed: 0 },
            education: { created: 0, updated: 0, skipped: 0, failed: 0 },
            malpractice: { created: 0, updated: 0, skipped: 0, failed: 0 },
            failedRecords: [],
          },
        });

      const result = await schedulerService.runCaqhSyncJob();

      expect(result.synced).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results[0]).toEqual(
        expect.objectContaining({
          providerId: 'p1',
          success: false,
          error: 'CAQH API timeout',
        })
      );
      expect(result.results[1]).toEqual(
        expect.objectContaining({
          providerId: 'p2',
          success: true,
        })
      );
    });

    it('prevents concurrent runs with guard flag', async () => {
      prismaMock.provider.findMany.mockResolvedValue([
        { id: 'p1', firstName: 'Jane', lastName: 'Doe', caqhProviderId: 'caqh-1' },
      ] as any);

      // Make syncProvider take time to complete
      caqhServiceInstance.syncProvider.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({
          syncId: 'sync-1',
          changes: {
            licenses: { created: 0, updated: 0, skipped: 0, failed: 0 },
            certifications: { created: 0, updated: 0, skipped: 0, failed: 0 },
            education: { created: 0, updated: 0, skipped: 0, failed: 0 },
            malpractice: { created: 0, updated: 0, skipped: 0, failed: 0 },
            failedRecords: [],
          },
        }), 50))
      );

      // Start first run (don't await)
      const firstRun = schedulerService.runCaqhSyncJob();

      // Second concurrent run should be skipped
      const secondRun = await schedulerService.runCaqhSyncJob();
      expect(secondRun).toEqual({ synced: 0, failed: 0, skipped: 0, results: [] });

      // Wait for first to complete
      const firstResult = await firstRun;
      expect(firstResult.synced).toBe(1);
    });

    it('resets guard flag even when job throws', async () => {
      prismaMock.provider.findMany.mockRejectedValue(new Error('DB connection lost'));

      await expect(schedulerService.runCaqhSyncJob()).rejects.toThrow('DB connection lost');

      // Guard should be reset — next run should proceed (not return the skip result)
      prismaMock.provider.findMany.mockResolvedValue([]);
      const result = await schedulerService.runCaqhSyncJob();
      expect(result).toEqual({ synced: 0, failed: 0, skipped: 0, results: [] });
    });
  });

  describe('getStatus', () => {
    it('includes CAQH sync status fields', () => {
      const status = schedulerService.getStatus();

      expect(status).toHaveProperty('caqhSyncConfigured');
      expect(status).toHaveProperty('caqhSyncJobRunning');
      expect(status).toHaveProperty('caqhSyncSchedule');
      expect(status.caqhSyncSchedule).toBe('0 2 * * *');
    });
  });
});
