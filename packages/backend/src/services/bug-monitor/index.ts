import { bugSanitizer } from './sanitizer.js';
import { bugFingerprintService } from './fingerprint.js';
import { noiseFilter } from './noise-filter.js';
import { bugTriager } from './triage.js';
import { bugWriter } from './bug-writer.js';
import { linearClient } from './linear-client.js';
import { alertRouter } from './alert-router.js';
import { logger } from '../../utils/logger.js';
import { sendSlackAlert } from '../../utils/slack-alert.js';
import type { BugReport, BugSeverity, BugSource, BugWriteup, SanitizedBugReport, TriageResult } from './types.js';

interface InMemoryFingerprint {
  hash: string;
  source: string;
  title: string;
  errorClass: string | null;
  linearIssueId: string | null;
  linearIssueUrl: string | null;
  currentSeverity: string;
  occurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  metadata: Record<string, string> | null;
}

class BugMonitorService {
  private sanitizer = bugSanitizer;
  private fingerprinter = bugFingerprintService;
  private noiseFilter = noiseFilter;
  private triager = bugTriager;
  private linearClient = linearClient;
  private alertRouter = alertRouter;
  // In-memory fingerprint store (BugFingerprint model was removed — Sentry handles persistence)
  private fingerprints = new Map<string, InMemoryFingerprint>();

  async report(bug: BugReport): Promise<void> {
    // Kill switch
    if (process.env['LINEAR_BUG_MONITOR_ENABLED'] !== 'true') {
      logger.debug(JSON.stringify({ service: 'bugMonitor', action: 'skipped', reason: 'disabled', title: bug.title }));
      return;
    }

    // Pattern-based suppression: drop known dev-environment noise (Vite
    // chunk-cache crashes, dynamic-import failures from stale local
    // bundles) before they consume Linear quota or sanitizer cycles.
    const suppression = this.noiseFilter.shouldSuppress(bug);
    if (suppression.suppress) {
      logger.debug(JSON.stringify({
        service: 'bugMonitor',
        action: 'suppressed',
        reason: suppression.reason,
        title: bug.title,
      }));
      return;
    }

    try {
      // 1. Sanitize FIRST (SOC 2 requirement)
      const sanitized = this.sanitizer.scrub(bug);

      // 2. Generate fingerprint
      const hash = this.fingerprinter.generate(sanitized);

      // 3. Check for existing fingerprint
      const existing = this.fingerprints.get(hash);

      if (existing) {
        await this.handleDuplicate(existing, sanitized, hash);
      } else {
        await this.handleNew(sanitized, hash);
      }
    } catch (error) {
      // Bug monitor should NEVER crash the app
      logger.error(JSON.stringify({
        service: 'bugMonitor',
        action: 'reportFailed',
        error: error instanceof Error ? error.message : 'Unknown error',
        title: bug.title,
      }));
    }
  }

  private async handleDuplicate(existing: InMemoryFingerprint, report: SanitizedBugReport, hash: string): Promise<void> {
    // 1. Increment occurrence count and update lastSeenAt
    existing.occurrenceCount += 1;
    existing.lastSeenAt = new Date();
    existing.metadata = report.metadata as Record<string, string>;

    // 2. Check escalation
    const hourlyRate = existing.occurrenceCount;
    const daysSinceFirst = Math.max(1, Math.ceil((Date.now() - existing.firstSeenAt.getTime()) / 86400000));
    const dailyAvgRate = Math.max(1, existing.occurrenceCount / daysSinceFirst);
    const newSeverity = this.noiseFilter.checkEscalation(
      existing.currentSeverity as BugSeverity,
      hourlyRate,
      dailyAvgRate,
    );

    // 3. If severity escalated, update Linear issue
    if (newSeverity !== existing.currentSeverity && existing.linearIssueId) {
      const priorityMap: Record<BugSeverity, number> = { urgent: 1, high: 2, medium: 3, low: 4 };
      await this.linearClient.updateIssue(existing.linearIssueId, {
        priority: priorityMap[newSeverity],
        title: newSeverity === 'urgent' ? `[URGENT] ${existing.title}` : undefined,
      });
      existing.currentSeverity = newSeverity;
    }

    // 4. Add comment to Linear issue with occurrence count
    if (existing.linearIssueId) {
      await this.linearClient.addComment(
        existing.linearIssueId,
        `**Occurrence #${existing.occurrenceCount}** at ${new Date().toISOString()}\n\nLatest error: ${report.errorMessage.substring(0, 200)}`,
      );
    }

    // 5. Alert if escalated to urgent
    if (newSeverity === 'urgent' && existing.currentSeverity !== 'urgent') {
      await this.alertRouter.sendUrgentAlert(report, existing.linearIssueUrl);
    }
  }

  private async handleNew(report: SanitizedBugReport, hash: string): Promise<void> {
    // 1. AI triage
    const triage = await this.triager.triage(report);

    // 2. Create Linear issue
    const issue = await this.linearClient.createIssue(report, triage);

    // 3. Save fingerprint in memory
    this.fingerprints.set(hash, {
      hash,
      source: report.source,
      title: report.title,
      errorClass: report.errorClass || null,
      linearIssueId: issue?.id || null,
      linearIssueUrl: issue?.url || null,
      currentSeverity: triage.severity,
      occurrenceCount: 1,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      metadata: report.metadata as Record<string, string>,
    });

    // 4. Alert if urgent
    if (triage.severity === 'urgent') {
      await this.alertRouter.sendUrgentAlert(report, issue?.url || null);
    }

    logger.info(JSON.stringify({
      service: 'bugMonitor',
      action: 'newIssue',
      hash,
      severity: triage.severity,
      linearIssueId: issue?.id || 'pending',
      title: report.title,
    }));
  }

  /**
   * User-initiated (beta) bug report. Distinct from the automatic crash path:
   * - sanitize (PII hygiene — defense in depth even on synthetic staging data)
   * - AI "bug writer" structures the tester's words into a real ticket
   * - file to Linear under the "Beta feedback" label with the written body
   * - ping Slack so the team sees it land
   * NO fingerprint/dedupe: each tester's feedback is distinct, not a duplicate
   * crash. Never throws — beta feedback must not surface errors to the user.
   */
  async reportUserFeedback(report: BugReport): Promise<void> {
    if (process.env['LINEAR_BUG_MONITOR_ENABLED'] !== 'true') {
      logger.debug(JSON.stringify({ service: 'bugMonitor', action: 'userReportSkipped', reason: 'disabled' }));
      return;
    }

    try {
      const sanitized = this.sanitizer.scrub(report);
      const writeup = await bugWriter.write(sanitized);

      const issue = await this.linearClient.createIssue(
        { ...sanitized, title: writeup.title },
        { severity: writeup.severity, rootCause: '' },
        {
          titlePrefix: '[Beta]',
          labelIds: process.env['LINEAR_BETA_FEEDBACK_LABEL_ID']
            ? [process.env['LINEAR_BETA_FEEDBACK_LABEL_ID']]
            : undefined,
          descriptionMarkdown: this.buildUserReportDescription(sanitized, writeup),
        },
      );

      await sendSlackAlert({
        title: `Beta bug report: ${writeup.title}`,
        level: 'warning',
        source: 'beta-feedback',
        context: {
          area: writeup.area,
          severity: writeup.severity,
          reporter: sanitized.metadata['reporterEmail'] || sanitized.metadata['reporterUserId'] || 'unknown',
          issueUrl: issue?.url || 'unfiled',
        },
      });

      logger.info(JSON.stringify({
        service: 'bugMonitor',
        action: 'userReportFiled',
        severity: writeup.severity,
        linearIssueId: issue?.id || 'pending',
      }));
    } catch (error) {
      logger.error(JSON.stringify({
        service: 'bugMonitor',
        action: 'userReportFailed',
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }

  private buildUserReportDescription(report: SanitizedBugReport, writeup: BugWriteup): string {
    const m = report.metadata;
    const contextKeys = ['route', 'url', 'userAgent', 'appCommit', 'reporterEmail', 'reporterUserId', 'practiceId', 'userSeverity'];
    return [
      '**Beta tester feedback** (AI-structured from the reporter\'s description)',
      `**Severity:** ${writeup.severity} | **Area:** ${writeup.area}`,
      '',
      '## Steps to reproduce',
      ...(writeup.stepsToReproduce.length ? writeup.stepsToReproduce.map((s, i) => `${i + 1}. ${s}`) : ['Not specified']),
      '',
      '## Expected',
      writeup.expected || '_not specified_',
      '',
      '## Actual',
      writeup.actual || '_not specified_',
      '',
      '## Reporter\'s words',
      `> ${report.errorMessage.replace(/\n/g, '\n> ')}`,
      ...(m['screenshotKey'] ? ['', `## Screenshot`, `\`${m['screenshotKey']}\``] : []),
      '',
      '## Context',
      ...contextKeys.filter((k) => m[k]).map((k) => `- **${k}**: ${m[k]}`),
      '',
      '---',
      '*Submitted via the in-app beta bug widget*',
    ].join('\n');
  }
}

export let bugMonitor: BugMonitorService;

export function initBugMonitor(): void {
  bugMonitor = new BugMonitorService();

  logger.info(JSON.stringify({ service: 'bugMonitor', action: 'initialized' }));
}
