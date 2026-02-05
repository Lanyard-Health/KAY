import cron from 'node-cron';
import { followUpService } from './followup.service.js';
import { emailService } from './email.service.js';
import { logger } from '../utils/logger.js';

class SchedulerService {
  private followUpJob: cron.ScheduledTask | null = null;
  private isRunning = false;

  /**
   * Initialize all scheduled jobs
   * Note: Automatic scheduling is disabled. Follow-ups are sent based on
   * per-enrollment settings when manually triggered or via the API.
   */
  initialize(): void {
    if (!emailService.isConfigured()) {
      logger.info('[Scheduler] Email service not configured.');
      return;
    }

    logger.info('[Scheduler] Email configured. Follow-ups controlled per-enrollment.');
    logger.info('[Scheduler] Use POST /api/v1/follow-up/run to manually process due follow-ups.');
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
   * Stop all scheduled jobs
   */
  stop(): void {
    if (this.followUpJob) {
      this.followUpJob.stop();
      this.followUpJob = null;
      logger.info('[Scheduler] Follow-up job stopped');
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    emailConfigured: boolean;
    followUpJobRunning: boolean;
    schedule: string;
  } {
    return {
      emailConfigured: emailService.isConfigured(),
      followUpJobRunning: this.isRunning,
      schedule: process.env['FOLLOWUP_SCHEDULE'] || '0 9 * * *',
    };
  }
}

export const schedulerService = new SchedulerService();
export default schedulerService;
