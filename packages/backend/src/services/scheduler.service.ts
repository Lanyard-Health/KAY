import cron from 'node-cron';
import { followUpService } from './followup.service.js';
import { emailService } from './email.service.js';
import { isConfigured, generateExpirationAlerts } from './ai.service.js';
import { getConfiguredPayers, runScheduledDirectoryChecks } from './providerDirectory.service.js';
import { notificationService } from './notification.service.js';
import { logger } from '../utils/logger.js';

class SchedulerService {
  private followUpJob: cron.ScheduledTask | null = null;
  private expirationAlertJob: cron.ScheduledTask | null = null;
  private directoryCheckJob: cron.ScheduledTask | null = null;
  private notificationCleanupJob: cron.ScheduledTask | null = null;
  private isRunning = false;
  private isExpirationJobRunning = false;
  private isDirectoryJobRunning = false;

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
    if (this.directoryCheckJob) {
      this.directoryCheckJob.stop();
      this.directoryCheckJob = null;
      logger.info('[Scheduler] Directory check job stopped');
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
    directoryCheckConfigured: boolean;
    directoryCheckJobRunning: boolean;
    followUpSchedule: string;
    expirationAlertSchedule: string;
    directoryCheckSchedule: string;
  } {
    return {
      emailConfigured: emailService.isConfigured(),
      aiConfigured: isConfigured(),
      followUpJobRunning: this.isRunning,
      expirationAlertJobRunning: this.isExpirationJobRunning,
      directoryCheckConfigured: getConfiguredPayers().length > 0,
      directoryCheckJobRunning: this.isDirectoryJobRunning,
      followUpSchedule: process.env['FOLLOWUP_SCHEDULE'] || '0 9 * * *',
      expirationAlertSchedule: process.env['EXPIRATION_ALERT_SCHEDULE'] || '0 7 * * *',
      directoryCheckSchedule: process.env['DIRECTORY_CHECK_SCHEDULE'] || '0 3 * * 0',
    };
  }
}

export const schedulerService = new SchedulerService();
export default schedulerService;
