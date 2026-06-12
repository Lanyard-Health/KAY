import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before imports
vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock, prismaBase: prismaMock };
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
  emailService: {
    isConfigured: vi.fn().mockReturnValue(true),
    sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
  },
}));

// Sentry — captureException + withScope must work in tests for #207 alerting.
vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  withScope: vi.fn((cb: (scope: any) => void) => {
    cb({ setTags: vi.fn(), setFingerprint: vi.fn() });
  }),
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
import { emailService } from './email.service.js';
import * as Sentry from '@sentry/node';

// Get the mock CaqhService instance created by the constructor
const caqhServiceInstance = (CaqhService as any).mock.results[0]?.value;

// Helper for #207 tests — produces an empty changes summary for syncProvider mocks.
function emptyChanges() {
  return {
    licenses: { created: 0, updated: 0, skipped: 0, failed: 0 },
    certifications: { created: 0, updated: 0, skipped: 0, failed: 0 },
    education: { created: 0, updated: 0, skipped: 0, failed: 0 },
    malpractice: { created: 0, updated: 0, skipped: 0, failed: 0 },
    failedRecords: [],
  };
}

describe('SchedulerService — CAQH Sync Job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Advisory lock for the nightly sync: acquired by default in tests.
    prismaMock.$queryRaw.mockResolvedValue([{ locked: true }] as never);
  });

  describe('runCaqhSyncJob', () => {
    it('skips the run when another instance holds the advisory lock', async () => {
      prismaMock.$queryRaw.mockResolvedValue([{ locked: false }] as never);

      const result = await schedulerService.runCaqhSyncJob();

      expect(result).toEqual({ synced: 0, failed: 0, skipped: 0, results: [] });
      expect(prismaMock.providerProfile.findMany).not.toHaveBeenCalled();
    });

    it('returns empty result when no eligible providers found', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([]);

      const result = await schedulerService.runCaqhSyncJob();

      expect(result).toEqual({ synced: 0, failed: 0, skipped: 0, results: [] });
      expect(prismaMock.providerProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            caqhProviderId: { not: null },
            caqhCredentialsValid: true,
          },
        })
      );
    });

    it('syncs eligible providers and returns summary', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([
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

    it('sends per-provider notification when sync produces changes (in addition to job-summary)', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([
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

    it('does NOT send per-provider notification when sync has zero changes (still sends job-summary)', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([
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

      // Per-provider 'CAQH Sync Update' notification should NOT fire when changes=0,
      // but the always-on job-summary 'CAQH nightly sync complete' should.
      const calls = (notificationService.notifyAdminUsers as any).mock.calls.map((c: any[]) => c[0]);
      expect(calls.find((c: any) => c.title === 'CAQH Sync Update')).toBeUndefined();
      expect(calls.find((c: any) => c.title === 'CAQH nightly sync complete')).toBeDefined();
    });

    it('handles individual provider sync failures gracefully', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([
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
      prismaMock.providerProfile.findMany.mockResolvedValue([
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
      prismaMock.providerProfile.findMany.mockRejectedValue(new Error('DB connection lost'));

      await expect(schedulerService.runCaqhSyncJob()).rejects.toThrow('DB connection lost');

      // Guard should be reset — next run should proceed (not return the skip result)
      prismaMock.providerProfile.findMany.mockResolvedValue([]);
      const result = await schedulerService.runCaqhSyncJob();
      expect(result).toEqual({ synced: 0, failed: 0, skipped: 0, results: [] });
    });
  });

  // ============================================================
  // Issue #207: nightly sync observability (Sentry, in-app summary,
  // threshold email, structured per-failure logs).
  // ============================================================

  describe('runCaqhSyncJob — #207 observability', () => {
    const SAVED_ENV: Record<string, string | undefined> = {};
    beforeEach(() => {
      SAVED_ENV['ADMIN_EMAIL'] = process.env['ADMIN_EMAIL'];
      SAVED_ENV['CAQH_SYNC_ALERT_THRESHOLD'] = process.env['CAQH_SYNC_ALERT_THRESHOLD'];
    });

    function restoreEnv() {
      for (const k of ['ADMIN_EMAIL', 'CAQH_SYNC_ALERT_THRESHOLD']) {
        if (SAVED_ENV[k] === undefined) delete process.env[k];
        else process.env[k] = SAVED_ENV[k];
      }
    }

    it('always sends a job-summary in-app notification (no actionUrl)', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([
        { id: 'p1', firstName: 'Jane', lastName: 'Doe', caqhProviderId: 'caqh-1' },
      ] as any);
      caqhServiceInstance.syncProvider.mockRejectedValue(new Error('CAQH API error: 503'));

      await schedulerService.runCaqhSyncJob();

      const calls = (notificationService.notifyAdminUsers as any).mock.calls.map((c: any[]) => c[0]);
      const summary = calls.find((c: any) => c.title === 'CAQH nightly sync complete');
      expect(summary).toBeDefined();
      expect(summary.message).toBe('0/1 synced, 1 failed.');
      expect(summary.type).toBe('system_announcement');
      expect(summary.actionUrl).toBeUndefined();
      restoreEnv();
    });

    it('captures Sentry exception per failure with stable fingerprint by errorClass', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([
        { id: 'p1', firstName: 'A', lastName: 'X', caqhProviderId: 'c1' },
        { id: 'p2', firstName: 'B', lastName: 'Y', caqhProviderId: 'c2' },
      ] as any);
      const err1 = new Error('CAQH API request timed out');
      const err2 = new Error('CAQH API error: 502');
      caqhServiceInstance.syncProvider
        .mockRejectedValueOnce(err1)
        .mockRejectedValueOnce(err2);

      const setFingerprint = vi.fn();
      const setTags = vi.fn();
      (Sentry.withScope as any).mockImplementation((cb: (scope: any) => void) => {
        cb({ setFingerprint, setTags });
      });

      await schedulerService.runCaqhSyncJob();

      // Two providers failed → two captures (plus possibly the alert-email one
      // if it didn't fire because ADMIN_EMAIL is unset; we verify by exception
      // identity instead of count).
      expect(Sentry.captureException).toHaveBeenCalledWith(err1);
      expect(Sentry.captureException).toHaveBeenCalledWith(err2);

      // Tags include job + providerId + errorClass; fingerprint is stable
      // [job, errorClass] so repeated 5xx/timeout dedup in Sentry.
      expect(setTags).toHaveBeenCalledWith(expect.objectContaining({
        job: 'caqh-sync',
        providerId: 'p1',
        errorClass: 'caqh_timeout',
      }));
      expect(setTags).toHaveBeenCalledWith(expect.objectContaining({
        job: 'caqh-sync',
        providerId: 'p2',
        errorClass: 'caqh_5xx',
      }));
      expect(setFingerprint).toHaveBeenCalledWith(['caqh-sync', 'caqh_timeout']);
      expect(setFingerprint).toHaveBeenCalledWith(['caqh-sync', 'caqh_5xx']);
      restoreEnv();
    });

    it('logs per-failure as structured event with errorClass + durationMs', async () => {
      prismaMock.providerProfile.findMany.mockResolvedValue([
        { id: 'p1', firstName: 'Jane', lastName: 'Doe', caqhProviderId: 'caqh-1' },
      ] as any);
      caqhServiceInstance.syncProvider.mockRejectedValue(new Error('CAQH API error: 500'));

      const { logger } = await import('../utils/logger.js');

      await schedulerService.runCaqhSyncJob();

      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
        event: 'caqh_sync_provider_failed',
        providerId: 'p1',
        providerName: 'Jane Doe',
        errorClass: 'caqh_5xx',
        errorMessage: 'CAQH API error: 500',
        durationMs: expect.any(Number),
      }));
      restoreEnv();
    });

    it('sends threshold email when failure rate >= CAQH_SYNC_ALERT_THRESHOLD', async () => {
      process.env['ADMIN_EMAIL'] = 'admin@lanyard.test';
      process.env['CAQH_SYNC_ALERT_THRESHOLD'] = '0.25';
      prismaMock.providerProfile.findMany.mockResolvedValue([
        { id: 'p1', firstName: 'A', lastName: 'X', caqhProviderId: 'c1' },
        { id: 'p2', firstName: 'B', lastName: 'Y', caqhProviderId: 'c2' },
        { id: 'p3', firstName: 'C', lastName: 'Z', caqhProviderId: 'c3' },
      ] as any);
      // 1 of 3 fails = 33%, exceeds 25% threshold.
      caqhServiceInstance.syncProvider
        .mockRejectedValueOnce(new Error('CAQH API request timed out'))
        .mockResolvedValueOnce({ syncId: 's2', changes: emptyChanges() })
        .mockResolvedValueOnce({ syncId: 's3', changes: emptyChanges() });

      await schedulerService.runCaqhSyncJob();

      expect(emailService.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
        to: 'admin@lanyard.test',
        subject: expect.stringContaining('33.3% failure rate'),
        html: expect.stringContaining('caqh_timeout'),
      }));
      restoreEnv();
    });

    it('does NOT send threshold email when failure rate < threshold', async () => {
      process.env['ADMIN_EMAIL'] = 'admin@lanyard.test';
      process.env['CAQH_SYNC_ALERT_THRESHOLD'] = '0.5';
      prismaMock.providerProfile.findMany.mockResolvedValue([
        { id: 'p1', firstName: 'A', lastName: 'X', caqhProviderId: 'c1' },
        { id: 'p2', firstName: 'B', lastName: 'Y', caqhProviderId: 'c2' },
        { id: 'p3', firstName: 'C', lastName: 'Z', caqhProviderId: 'c3' },
      ] as any);
      // 1 of 3 fails = 33%, BELOW 50% threshold — no email.
      caqhServiceInstance.syncProvider
        .mockRejectedValueOnce(new Error('CAQH API error: 502'))
        .mockResolvedValueOnce({ syncId: 's2', changes: emptyChanges() })
        .mockResolvedValueOnce({ syncId: 's3', changes: emptyChanges() });

      await schedulerService.runCaqhSyncJob();

      expect(emailService.sendEmail).not.toHaveBeenCalled();
      restoreEnv();
    });

    it('skips email alert when ADMIN_EMAIL is not set (no crash)', async () => {
      delete process.env['ADMIN_EMAIL'];
      process.env['CAQH_SYNC_ALERT_THRESHOLD'] = '0.25';
      prismaMock.providerProfile.findMany.mockResolvedValue([
        { id: 'p1', firstName: 'A', lastName: 'X', caqhProviderId: 'c1' },
      ] as any);
      caqhServiceInstance.syncProvider.mockRejectedValue(new Error('CAQH API error: 500'));

      const result = await schedulerService.runCaqhSyncJob();

      expect(result.failed).toBe(1);
      expect(emailService.sendEmail).not.toHaveBeenCalled();
      restoreEnv();
    });

    it('email send failure does NOT cascade — sync job completes; email error captured to Sentry', async () => {
      process.env['ADMIN_EMAIL'] = 'admin@lanyard.test';
      process.env['CAQH_SYNC_ALERT_THRESHOLD'] = '0.25';
      prismaMock.providerProfile.findMany.mockResolvedValue([
        { id: 'p1', firstName: 'A', lastName: 'X', caqhProviderId: 'c1' },
      ] as any);
      caqhServiceInstance.syncProvider.mockRejectedValue(new Error('CAQH API error: 500'));
      // Resend outage — the email send throws.
      const emailErr = new Error('Resend network error');
      (emailService.sendEmail as any).mockRejectedValueOnce(emailErr);

      const result = await schedulerService.runCaqhSyncJob();

      // Sync job still completes with the failure recorded — does NOT cascade.
      expect(result.failed).toBe(1);
      expect(result.synced).toBe(0);
      // Email error was captured to Sentry alongside the original sync failure.
      expect(Sentry.captureException).toHaveBeenCalledWith(emailErr);
      restoreEnv();
    });

    it('treats emailService.sendEmail({success:false}) as a send failure (Sentry-captured)', async () => {
      process.env['ADMIN_EMAIL'] = 'admin@lanyard.test';
      process.env['CAQH_SYNC_ALERT_THRESHOLD'] = '0.25';
      prismaMock.providerProfile.findMany.mockResolvedValue([
        { id: 'p1', firstName: 'A', lastName: 'X', caqhProviderId: 'c1' },
      ] as any);
      caqhServiceInstance.syncProvider.mockRejectedValue(new Error('CAQH API error: 500'));
      // Resend returned {success:false} (e.g. rate-limited) — treat same as throw.
      (emailService.sendEmail as any).mockResolvedValueOnce({ success: false, error: 'rate limited' });

      const result = await schedulerService.runCaqhSyncJob();

      expect(result.failed).toBe(1);
      // Sentry should have captured an Error wrapping the rate-limit message.
      const calls = (Sentry.captureException as any).mock.calls.map((c: any[]) => c[0]);
      const wrapped = calls.find((e: unknown) => e instanceof Error && e.message.includes('rate limited'));
      expect(wrapped).toBeDefined();
      restoreEnv();
    });

    it('groups failures by error class in the email breakdown', async () => {
      process.env['ADMIN_EMAIL'] = 'admin@lanyard.test';
      process.env['CAQH_SYNC_ALERT_THRESHOLD'] = '0.25';
      prismaMock.providerProfile.findMany.mockResolvedValue([
        { id: 'p1', firstName: 'A', lastName: 'X', caqhProviderId: 'c1' },
        { id: 'p2', firstName: 'B', lastName: 'Y', caqhProviderId: 'c2' },
        { id: 'p3', firstName: 'C', lastName: 'Z', caqhProviderId: 'c3' },
      ] as any);
      caqhServiceInstance.syncProvider
        .mockRejectedValueOnce(new Error('CAQH API request timed out'))
        .mockRejectedValueOnce(new Error('CAQH API request timed out'))
        .mockRejectedValueOnce(new Error('CAQH API error: 500'));

      await schedulerService.runCaqhSyncJob();

      const call = (emailService.sendEmail as any).mock.calls[0][0];
      expect(call.html).toContain('caqh_timeout');
      expect(call.html).toContain('caqh_5xx');
      // Counts in breakdown: 2 timeouts, 1 5xx.
      expect(call.html).toMatch(/caqh_timeout[\s\S]*?>2</);
      expect(call.html).toMatch(/caqh_5xx[\s\S]*?>1</);
      restoreEnv();
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
