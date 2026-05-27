import cron from 'node-cron';
import * as Sentry from '@sentry/node';
import { followUpService } from './followup.service.js';
import { emailService } from './email.service.js';
import { isConfigured, generateExpirationAlerts } from './ai.service.js';
import { notificationService } from './notification.service.js';
import { ExpirationService } from './expiration.service.js';
import { CaqhService } from './caqh.service.js';
import { executeAllDueSteps, ExecutorSummary } from './followUpExecutor.service.js';
import { sweepStalledTasks } from './stalled-task.service.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Classify a CAQH sync error message into a stable bucket for log analytics
 * and Sentry fingerprinting. Stable across runs so the same failure mode
 * dedups in Sentry instead of creating one issue per provider.
 */
function classifyCaqhSyncError(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown';
  if (err.name && err.name !== 'Error') return err.name;
  const m = err.message;
  if (m.includes('CAQH API request timed out')) return 'caqh_timeout';
  if (/CAQH API error: 5\d\d/.test(m)) return 'caqh_5xx';
  if (/CAQH API error: 4\d\d/.test(m)) return 'caqh_4xx';
  if (m.includes('CAQH API returned invalid JSON')) return 'caqh_invalid_json';
  if (m.includes('Failed to parse CAQH credentialing')) return 'caqh_xml_parse_error';
  if (m.includes('CAQH status response missing attestation date')) return 'caqh_missing_attestation_date';
  return 'caqh_other';
}

class SchedulerService {
  private followUpJob: cron.ScheduledTask | null = null;
  private followUpExecutorJob: cron.ScheduledTask | null = null;
  private expirationAlertJob: cron.ScheduledTask | null = null;
  private expirationEmailJob: cron.ScheduledTask | null = null;
  private notificationCleanupJob: cron.ScheduledTask | null = null;
  private caqhSyncJob: cron.ScheduledTask | null = null;
  private stalledTaskJob: cron.ScheduledTask | null = null;
  private isRunning = false;
  private isFollowUpExecutorRunning = false;
  private isExpirationJobRunning = false;
  private isExpirationEmailJobRunning = false;
  private isCaqhSyncJobRunning = false;
  private isStalledTaskJobRunning = false;
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

    // Schedule daily follow-up step executor (template-driven system)
    if (emailService.isConfigured()) {
      const executorSchedule = process.env['FOLLOW_UP_EXECUTOR_SCHEDULE'] || '0 9 * * *';
      this.followUpExecutorJob = cron.schedule(executorSchedule, () => {
        this.runFollowUpExecutorJob();
      });
      logger.info(`[Scheduler] Follow-up executor job scheduled: ${executorSchedule}`);
    } else {
      logger.info('[Scheduler] Email not configured, follow-up executor job not scheduled.');
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

    // Schedule stalled-task watchdog (every 15 min) — recovers agent jobs
    // orphaned by Redis restart / deploy. See stalled-task.service.ts.
    const stalledSchedule = process.env['STALLED_TASK_SCHEDULE'] || '*/15 * * * *';
    this.stalledTaskJob = cron.schedule(stalledSchedule, () => {
      this.runStalledTaskJob();
    });
    logger.info(`[Scheduler] Stalled-task watchdog scheduled: ${stalledSchedule}`);
  }

  /**
   * Run one sweep of the stalled-task watchdog. Skips if a previous sweep
   * is still in flight (sweeps should finish in seconds; a multi-tick run
   * would only happen under extreme orphan counts).
   */
  async runStalledTaskJob(): Promise<void> {
    if (this.isStalledTaskJobRunning) {
      logger.info('[Scheduler] Stalled-task watchdog already running, skipping...');
      return;
    }

    this.isStalledTaskJobRunning = true;
    try {
      const result = await sweepStalledTasks();
      if (result.scanned > 0) {
        logger.info(
          `[Scheduler] Stalled-task watchdog: scanned=${result.scanned} reenqueued=${result.reenqueued} failed=${result.failed} errors=${result.errors.length}`,
        );
        if (result.errors.length > 0) {
          Sentry.captureMessage('Stalled-task watchdog encountered errors', {
            level: 'warning',
            tags: { job: 'stalled-task-watchdog' },
            extra: { errors: result.errors },
          });
        }
      }
    } catch (err) {
      logger.error('[Scheduler] Stalled-task watchdog error:', err);
      Sentry.captureException(err, { tags: { job: 'stalled-task-watchdog' } });
    } finally {
      this.isStalledTaskJobRunning = false;
    }
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
   * Run the follow-up step executor (template-driven system)
   */
  async runFollowUpExecutorJob(): Promise<ExecutorSummary> {
    if (this.isFollowUpExecutorRunning) {
      logger.info('[Scheduler] Follow-up executor already running, skipping...');
      return { emailsSent: 0, approvalsCreated: 0, skippedNotDue: 0, skippedTerminal: 0, stalled: 0, completed: 0, errors: 0 };
    }

    this.isFollowUpExecutorRunning = true;
    logger.info('[Scheduler] Starting follow-up executor job...');

    try {
      const result = await executeAllDueSteps(prisma);

      logger.info(`[Scheduler] Follow-up executor completed:`);
      logger.info(`  - Emails sent: ${result.emailsSent}`);
      logger.info(`  - Approvals created: ${result.approvalsCreated}`);
      logger.info(`  - Skipped (not due): ${result.skippedNotDue}`);
      logger.info(`  - Stalled: ${result.stalled}`);

      return result;
    } catch (error) {
      logger.error('[Scheduler] Follow-up executor error:', error);
      throw error;
    } finally {
      this.isFollowUpExecutorRunning = false;
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
      const providers = await prisma.providerProfile.findMany({
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
        const startedAt = Date.now();
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
          // Issue #207: structured error log + Sentry capture for analytics-driven
          // observability. errorClass is stable so Sentry dedups by failure mode,
          // not per-provider.
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          const errorClass = classifyCaqhSyncError(error);
          const durationMs = Date.now() - startedAt;
          results.push({ providerId: provider.id, providerName, success: false, error: errMsg });
          failed++;

          logger.error({
            event: 'caqh_sync_provider_failed',
            providerId: provider.id,
            providerName,
            errorClass,
            errorMessage: errMsg,
            durationMs,
          });

          // Sentry: tag with job + providerId for filtering, fingerprint on
          // [job, errorClass] so repeated 5xx / timeout / etc. dedup into one
          // issue instead of creating one per provider per night.
          Sentry.withScope((scope) => {
            scope.setTags({ job: 'caqh-sync', providerId: provider.id, errorClass });
            scope.setFingerprint(['caqh-sync', errorClass]);
            Sentry.captureException(error);
          });
        }
      }

      const total = providers.length;
      logger.info(`[Scheduler] CAQH sync job completed: ${synced} synced, ${failed} failed`);

      // Always-on in-app summary notification (admins see this in their badge).
      // No actionUrl — admin sync-logs UI doesn't exist yet (separate PR).
      await notificationService.notifyAdminUsers({
        type: 'system_announcement',
        title: 'CAQH nightly sync complete',
        message: `${synced}/${total} synced, ${failed} failed.`,
      });

      // Threshold email alert. Wrapped so a Resend/SES outage doesn't cascade
      // and break the sync job itself; email failures go to Sentry but the
      // job completes normally.
      if (failed > 0 && total > 0) {
        const threshold = Number(process.env['CAQH_SYNC_ALERT_THRESHOLD'] ?? '0.25');
        const failureRate = failed / total;
        if (failureRate >= threshold) {
          try {
            await this.sendCaqhSyncFailureEmail({ synced, failed, total, threshold, results });
          } catch (emailErr) {
            logger.error({
              event: 'caqh_sync_alert_email_failed',
              error: emailErr instanceof Error ? emailErr.message : 'Unknown error',
            });
            Sentry.withScope((scope) => {
              scope.setTags({ job: 'caqh-sync', stage: 'alert_email' });
              Sentry.captureException(emailErr);
            });
          }
        }
      }

      return { synced, failed, skipped: 0, results };
    } catch (error) {
      logger.error('[Scheduler] CAQH sync job error:', error);
      throw error;
    } finally {
      this.isCaqhSyncJobRunning = false;
    }
  }

  /**
   * Send a threshold-triggered failure-rate email to ADMIN_EMAIL.
   * No-op if ADMIN_EMAIL is not set or email service is not configured.
   * Per-error-class breakdown is the actionable signal — tells admins
   * whether failures are transient (caqh_5xx, caqh_timeout) or structural
   * (caqh_xml_parse_error, caqh_missing_attestation_date).
   */
  private async sendCaqhSyncFailureEmail(params: {
    synced: number;
    failed: number;
    total: number;
    threshold: number;
    results: Array<{ providerName: string; success: boolean; error?: string }>;
  }): Promise<void> {
    const adminEmail = process.env['ADMIN_EMAIL'];
    if (!adminEmail) {
      logger.warn('[Scheduler] CAQH sync failure rate exceeded threshold but ADMIN_EMAIL is not set — skipping email alert');
      return;
    }
    if (!emailService.isConfigured()) {
      logger.warn('[Scheduler] CAQH sync failure rate exceeded threshold but emailService is not configured — skipping email alert');
      return;
    }

    const { synced, failed, total, threshold, results } = params;
    const failureRate = ((failed / total) * 100).toFixed(1);
    const thresholdPct = (threshold * 100).toFixed(0);

    // Group failures by classified errorClass for the actionable breakdown.
    const byClass = new Map<string, number>();
    for (const r of results) {
      if (r.success) continue;
      const cls = classifyCaqhSyncError(r.error ? new Error(r.error) : null);
      byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
    }
    const breakdownRows = [...byClass.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cls, count]) => `<tr><td style="padding:6px 12px;border:1px solid #e5e7eb;">${cls}</td><td style="padding:6px 12px;border:1px solid #e5e7eb;text-align:right;">${count}</td></tr>`)
      .join('');

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;">
        <h2 style="color:#dc2626;margin-bottom:16px;">CAQH Nightly Sync — Failure Threshold Exceeded</h2>
        <p>The nightly CAQH credential sync had a <strong>${failureRate}% failure rate</strong> (threshold: ${thresholdPct}%).</p>
        <p><strong>${synced}/${total}</strong> providers synced; <strong>${failed}/${total}</strong> failed.</p>
        <h3>Failure breakdown by error class</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
          <thead>
            <tr><th style="padding:6px 12px;border:1px solid #e5e7eb;text-align:left;background:#f9fafb;">Error class</th><th style="padding:6px 12px;border:1px solid #e5e7eb;text-align:right;background:#f9fafb;">Count</th></tr>
          </thead>
          <tbody>${breakdownRows}</tbody>
        </table>
        <p>Full per-provider error messages are in <code>caqh_sync_logs</code> (filter by <code>direction='pull'</code> and <code>status='failed'</code>) and Sentry (filter by tag <code>job:caqh-sync</code>).</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
        <p style="color:#6b7280;font-size:12px;">Sent by Lanyard CAQH sync scheduler. Adjust threshold via <code>CAQH_SYNC_ALERT_THRESHOLD</code>.</p>
      </div>
    `;

    const result = await emailService.sendEmail({
      to: adminEmail,
      subject: `[CAQH] Nightly sync ${failureRate}% failure rate (${failed}/${total})`,
      html,
    });

    if (!result.success) {
      // emailService.sendEmail returns errors instead of throwing; surface
      // failures to Sentry the same way as a thrown exception.
      throw new Error(`emailService.sendEmail returned failure: ${result.error ?? 'unknown'}`);
    }

    logger.info({
      event: 'caqh_sync_alert_email_sent',
      to: adminEmail,
      failureRate: Number(failureRate),
      failed,
      total,
    });
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
    if (this.followUpExecutorJob) {
      this.followUpExecutorJob.stop();
      this.followUpExecutorJob = null;
      logger.info('[Scheduler] Follow-up executor job stopped');
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
    followUpExecutorJobRunning: boolean;
    expirationAlertJobRunning: boolean;
    expirationEmailJobRunning: boolean;
    caqhSyncConfigured: boolean;
    caqhSyncJobRunning: boolean;
    followUpSchedule: string;
    followUpExecutorSchedule: string;
    expirationAlertSchedule: string;
    expirationEmailSchedule: string;
    caqhSyncSchedule: string;
  } {
    return {
      emailConfigured: emailService.isConfigured(),
      aiConfigured: isConfigured(),
      followUpJobRunning: this.isRunning,
      followUpExecutorJobRunning: this.isFollowUpExecutorRunning,
      expirationAlertJobRunning: this.isExpirationJobRunning,
      expirationEmailJobRunning: this.isExpirationEmailJobRunning,
      caqhSyncConfigured: this.caqhService.isConfigured(),
      caqhSyncJobRunning: this.isCaqhSyncJobRunning,
      followUpSchedule: process.env['FOLLOWUP_SCHEDULE'] || '0 9 * * *',
      followUpExecutorSchedule: process.env['FOLLOW_UP_EXECUTOR_SCHEDULE'] || '0 9 * * *',
      expirationAlertSchedule: process.env['EXPIRATION_ALERT_SCHEDULE'] || '0 7 * * *',
      expirationEmailSchedule: process.env['EXPIRATION_EMAIL_SCHEDULE'] || '0 8 * * *',
      caqhSyncSchedule: process.env['CAQH_SYNC_SCHEDULE'] || '0 2 * * *',
    };
  }
}

export const schedulerService = new SchedulerService();
export default schedulerService;
