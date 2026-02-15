import cron from 'node-cron';
import { followUpService } from './followup.service.js';
import { emailService } from './email.service.js';
import { isConfigured, generateExpirationAlerts } from './ai.service.js';
import { getConfiguredPayers, runScheduledDirectoryChecks } from './providerDirectory.service.js';
import { notificationService } from './notification.service.js';
import { ExpirationService } from './expiration.service.js';
import { CaqhService } from './caqh.service.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

class SchedulerService {
  private followUpJob: cron.ScheduledTask | null = null;
  private expirationAlertJob: cron.ScheduledTask | null = null;
  private expirationEmailJob: cron.ScheduledTask | null = null;
  private directoryCheckJob: cron.ScheduledTask | null = null;
  private notificationCleanupJob: cron.ScheduledTask | null = null;
  private caqhSyncJob: cron.ScheduledTask | null = null;
  private isRunning = false;
  private isExpirationJobRunning = false;
  private isExpirationEmailJobRunning = false;
  private isDirectoryJobRunning = false;
  private isCaqhSyncJobRunning = false;
  private expirationService = new ExpirationService();
  private caqhService = new CaqhService();

  /**
   * Initialize all scheduled jobs
   * Note: Automatic scheduling is disabled. Follow-ups are sent based on
   * per-enrollment settings when manually triggered or via the API.
   */
  initialize(): void {
    if (!emailService.isConfigured()) {
      logger.info('[Scheduler] Email service not configured.');
    } else {
      logger.info('[Scheduler] Email configured. Follow-ups controlled per-enrollment.');
      logger.info('[Scheduler] Use POST /api/v1/follow-up/run to manually process due follow-ups.');
    }

    // Schedule daily expiration alert generation
    if (isConfigured()) {
      const schedule = process.env['EXPIRATION_ALERT_SCHEDULE'] || '0 7 * * *';
      this.expirationAlertJob = cron.schedule(schedule, () => {
        this.runExpirationAlertJob();
      });
      logger.info(`[Scheduler] Expiration alert job scheduled: ${schedule}`);
    } else {
      logger.info('[Scheduler] AI not configured, expiration alert job not scheduled.');
    }

    // Schedule daily expiration email reminders
    if (emailService.isConfigured()) {
      const emailSchedule = process.env['EXPIRATION_EMAIL_SCHEDULE'] || '0 8 * * *';
      this.expirationEmailJob = cron.schedule(emailSchedule, () => {
        this.runExpirationEmailJob();
      });
      logger.info(`[Scheduler] Expiration email reminder job scheduled: ${emailSchedule}`);
    } else {
      logger.info('[Scheduler] Email not configured, expiration email reminder job not scheduled.');
    }

    // Schedule weekly directory verification checks
    if (getConfiguredPayers().length > 0) {
      const directorySchedule = process.env['DIRECTORY_CHECK_SCHEDULE'] || '0 3 * * 0';
      this.directoryCheckJob = cron.schedule(directorySchedule, () => {
        this.runDirectoryCheckJob();
      });
      logger.info(`[Scheduler] Directory check job scheduled: ${directorySchedule}`);
    } else {
      logger.info('[Scheduler] No directory adapters configured, directory check job not scheduled.');
    }

    // Schedule daily CAQH credential sync (2am)
    if (this.caqhService.isConfigured()) {
      const caqhSchedule = process.env['CAQH_SYNC_SCHEDULE'] || '0 2 * * *';
      this.caqhSyncJob = cron.schedule(caqhSchedule, () => {
        this.runCaqhSyncJob();
      });
      logger.info(`[Scheduler] CAQH sync job scheduled: ${caqhSchedule}`);
    } else {
      logger.info('[Scheduler] CAQH not configured, sync job not scheduled.');
    }

    // Schedule weekly notification cleanup (Sundays at 4am)
    this.notificationCleanupJob = cron.schedule('0 4 * * 0', () => {
      notificationService.cleanupOldNotifications(90)
        .catch((err) => logger.error('[Scheduler] Notification cleanup error:', err));
    });
    logger.info('[Scheduler] Notification cleanup job scheduled: 0 4 * * 0');
  }

  /**
   * Run the follow-up job manually or as scheduled
   */
  async runFollowUpJob(): Promise<{
    processed: number;
    successful: number;
    failed: number;
    results: Array<{
      enrollmentId: string;
      providerName: string;
      payerName: string;
      email: string;
      success: boolean;
      error?: string;
    }>;
  }> {
    if (this.isRunning) {
      logger.info('[Scheduler] Follow-up job already running, skipping...');
      return { processed: 0, successful: 0, failed: 0, results: [] };
    }

    this.isRunning = true;
    logger.info('[Scheduler] Starting follow-up job...');

    try {
      const result = await followUpService.processAllDueFollowUps();

      logger.info(`[Scheduler] Follow-up job completed:`);
      logger.info(`  - Processed: ${result.processed}`);
      logger.info(`  - Successful: ${result.successful}`);
      logger.info(`  - Failed: ${result.failed}`);

      if (result.failed > 0) {
        logger.info('[Scheduler] Failed follow-ups:');
        result.results
          .filter((r: { success: boolean }) => !r.success)
          .forEach((r: { providerName: string; payerName: string; error?: string }) => {
            logger.info(`  - ${r.providerName} / ${r.payerName}: ${r.error}`);
          });
      }

      return result;
    } catch (error) {
      logger.error('[Scheduler] Follow-up job error:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run the expiration alert job
   */
  async runExpirationAlertJob(): Promise<void> {
    if (this.isExpirationJobRunning) {
      logger.info('[Scheduler] Expiration alert job already running, skipping...');
      return;
    }

    this.isExpirationJobRunning = true;
    logger.info('[Scheduler] Starting expiration alert job...');

    try {
      const result = await generateExpirationAlerts(90);
      logger.info(`[Scheduler] Expiration alert job completed:`);
      logger.info(`  - Generated: ${result.generated}`);
      logger.info(`  - Skipped: ${result.skipped}`);
      logger.info(`  - Providers processed: ${result.providersProcessed}`);
      if (result.errors.length > 0) {
        logger.info(`  - Errors: ${result.errors.join(', ')}`);
      }
    } catch (error) {
      logger.error('[Scheduler] Expiration alert job error:', error);
    } finally {
      this.isExpirationJobRunning = false;
    }
  }

  /**
   * Run the expiration email reminder job
   */
  async runExpirationEmailJob(): Promise<{ sent: number; failed: number }> {
    if (this.isExpirationEmailJobRunning) {
      logger.info('[Scheduler] Expiration email job already running, skipping...');
      return { sent: 0, failed: 0 };
    }

    this.isExpirationEmailJobRunning = true;
    logger.info('[Scheduler] Starting expiration email reminder job...');

    try {
      const result = await this.expirationService.sendExpirationReminders();
      logger.info(`[Scheduler] Expiration email reminder job completed:`);
      logger.info(`  - Sent: ${result.sent}`);
      logger.info(`  - Failed: ${result.failed}`);
      return result;
    } catch (error) {
      logger.error('[Scheduler] Expiration email reminder job error:', error);
      throw error;
    } finally {
      this.isExpirationEmailJobRunning = false;
    }
  }

  /**
   * Run the directory check job
   */
  async runDirectoryCheckJob(): Promise<void> {
    if (this.isDirectoryJobRunning) {
      logger.info('[Scheduler] Directory check job already running, skipping...');
      return;
    }

    this.isDirectoryJobRunning = true;
    logger.info('[Scheduler] Starting directory check job...');

    try {
      const result = await runScheduledDirectoryChecks();
      logger.info(`[Scheduler] Directory check job completed:`);
      logger.info(`  - Checked: ${result.checked}`);
      logger.info(`  - Alerts: ${result.alerts}`);
      logger.info(`  - Errors: ${result.errors}`);
    } catch (error) {
      logger.error('[Scheduler] Directory check job error:', error);
    } finally {
      this.isDirectoryJobRunning = false;
    }
  }

  /**
   * Run the CAQH credential sync job for all eligible providers.
   */
  async runCaqhSyncJob(): Promise<{
    synced: number;
    failed: number;
    skipped: number;
    results: Array<{ providerId: string; providerName: string; success: boolean; error?: string; changes?: any }>;
  }> {
    if (this.isCaqhSyncJobRunning) {
      logger.info('[Scheduler] CAQH sync job already running, skipping...');
      return { synced: 0, failed: 0, skipped: 0, results: [] };
    }

    this.isCaqhSyncJobRunning = true;
    logger.info('[Scheduler] Starting CAQH sync job...');

    const results: Array<{ providerId: string; providerName: string; success: boolean; error?: string; changes?: any }> = [];
    let synced = 0;
    let failed = 0;

    try {
      // Find all providers with verified CAQH credentials
      const providers = await prisma.provider.findMany({
        where: {
          caqhProviderId: { not: null },
          caqhCredentialsValid: true,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          caqhProviderId: true,
        },
      });

      if (providers.length === 0) {
        logger.info('[Scheduler] CAQH sync: no eligible providers found.');
        return { synced: 0, failed: 0, skipped: 0, results: [] };
      }

      logger.info(`[Scheduler] CAQH sync: found ${providers.length} eligible providers.`);

      for (const provider of providers) {
        const providerName = `${provider.firstName} ${provider.lastName}`;
        try {
          const result = await this.caqhService.syncProvider(provider.id, provider.caqhProviderId!);
          const totalChanges =
            result.changes.licenses.created + result.changes.licenses.updated +
            result.changes.certifications.created + result.changes.certifications.updated +
            result.changes.education.created + result.changes.education.updated +
            result.changes.malpractice.created + result.changes.malpractice.updated;

          results.push({ providerId: provider.id, providerName, success: true, changes: result.changes });
          synced++;

          if (totalChanges > 0) {
            await notificationService.notifyAdminUsers({
              type: 'system_announcement',
              title: 'CAQH Sync Update',
              message: `CAQH sync updated ${totalChanges} credential(s) for ${providerName}.`,
              actionUrl: `/providers/${provider.id}`,
            });
          }

          logger.info(`[Scheduler] CAQH sync completed for ${providerName}: ${totalChanges} changes`);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          results.push({ providerId: provider.id, providerName, success: false, error: errMsg });
          failed++;
          logger.error(`[Scheduler] CAQH sync failed for ${providerName}: ${errMsg}`);
        }
      }

      logger.info(`[Scheduler] CAQH sync job completed: ${synced} synced, ${failed} failed`);
      return { synced, failed, skipped: 0, results };
    } catch (error) {
      logger.error('[Scheduler] CAQH sync job error:', error);
      throw error;
    } finally {
      this.isCaqhSyncJobRunning = false;
    }
  }

  /**
   * Stop all scheduled jobs
   */
  stop(): void {
    if (this.followUpJob) {
      this.followUpJob.stop();
      this.followUpJob = null;
      logger.info('[Scheduler] Follow-up job stopped');
    }
    if (this.expirationAlertJob) {
      this.expirationAlertJob.stop();
      this.expirationAlertJob = null;
      logger.info('[Scheduler] Expiration alert job stopped');
    }
    if (this.expirationEmailJob) {
      this.expirationEmailJob.stop();
      this.expirationEmailJob = null;
      logger.info('[Scheduler] Expiration email reminder job stopped');
    }
    if (this.directoryCheckJob) {
      this.directoryCheckJob.stop();
      this.directoryCheckJob = null;
      logger.info('[Scheduler] Directory check job stopped');
    }
    if (this.caqhSyncJob) {
      this.caqhSyncJob.stop();
      this.caqhSyncJob = null;
      logger.info('[Scheduler] CAQH sync job stopped');
    }
    if (this.notificationCleanupJob) {
      this.notificationCleanupJob.stop();
      this.notificationCleanupJob = null;
      logger.info('[Scheduler] Notification cleanup job stopped');
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    emailConfigured: boolean;
    aiConfigured: boolean;
    followUpJobRunning: boolean;
    expirationAlertJobRunning: boolean;
    expirationEmailJobRunning: boolean;
    directoryCheckConfigured: boolean;
    directoryCheckJobRunning: boolean;
    caqhSyncConfigured: boolean;
    caqhSyncJobRunning: boolean;
    followUpSchedule: string;
    expirationAlertSchedule: string;
    expirationEmailSchedule: string;
    directoryCheckSchedule: string;
    caqhSyncSchedule: string;
  } {
    return {
      emailConfigured: emailService.isConfigured(),
      aiConfigured: isConfigured(),
      followUpJobRunning: this.isRunning,
      expirationAlertJobRunning: this.isExpirationJobRunning,
      expirationEmailJobRunning: this.isExpirationEmailJobRunning,
      directoryCheckConfigured: getConfiguredPayers().length > 0,
      directoryCheckJobRunning: this.isDirectoryJobRunning,
      caqhSyncConfigured: this.caqhService.isConfigured(),
      caqhSyncJobRunning: this.isCaqhSyncJobRunning,
      followUpSchedule: process.env['FOLLOWUP_SCHEDULE'] || '0 9 * * *',
      expirationAlertSchedule: process.env['EXPIRATION_ALERT_SCHEDULE'] || '0 7 * * *',
      expirationEmailSchedule: process.env['EXPIRATION_EMAIL_SCHEDULE'] || '0 8 * * *',
      directoryCheckSchedule: process.env['DIRECTORY_CHECK_SCHEDULE'] || '0 3 * * 0',
      caqhSyncSchedule: process.env['CAQH_SYNC_SCHEDULE'] || '0 2 * * *',
    };
  }
}

export const schedulerService = new SchedulerService();
export default schedulerService;
