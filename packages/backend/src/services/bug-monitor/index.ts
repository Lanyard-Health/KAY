import type { PrismaClient } from '@prisma/client';
import { bugSanitizer } from './sanitizer.js';
import { bugFingerprintService } from './fingerprint.js';
import { noiseFilter } from './noise-filter.js';
import { bugTriager } from './triage.js';
import { linearClient } from './linear-client.js';
import { alertRouter } from './alert-router.js';
import type { BugReport, BugSeverity, BugSource, SanitizedBugReport, TriageResult } from './types.js';

class BugMonitorService {
  private sanitizer = bugSanitizer;
  private fingerprinter = bugFingerprintService;
  private noiseFilter = noiseFilter;
  private triager = bugTriager;
  private linearClient = linearClient;
  private alertRouter = alertRouter;
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async report(bug: BugReport): Promise<void> {
    // Kill switch
    if (process.env['LINEAR_BUG_MONITOR_ENABLED'] !== 'true') {
      console.log(JSON.stringify({ service: 'bugMonitor', action: 'skipped', reason: 'disabled', title: bug.title }));
      return;
    }

    try {
      // 1. Sanitize FIRST (SOC 2 requirement)
      const sanitized = this.sanitizer.scrub(bug);

      // 2. Generate fingerprint
      const hash = this.fingerprinter.generate(sanitized);

      // 3. Check for existing fingerprint in DB
      const existing = await this.prisma.bugFingerprint.findUnique({ where: { hash } });

      if (existing) {
        await this.handleDuplicate(existing, sanitized, hash);
      } else {
        await this.handleNew(sanitized, hash);
      }
    } catch (error) {
      // Bug monitor should NEVER crash the app
      console.error(JSON.stringify({
        service: 'bugMonitor',
        action: 'reportFailed',
        error: error instanceof Error ? error.message : 'Unknown error',
        title: bug.title,
      }));
    }
  }

  private async handleDuplicate(existing: any, report: SanitizedBugReport, hash: string): Promise<void> {
    // 1. Increment occurrence count and update lastSeenAt
    const updated = await this.prisma.bugFingerprint.update({
      where: { hash },
      data: {
        occurrenceCount: { increment: 1 },
        lastSeenAt: new Date(),
        metadata: report.metadata as any,
      },
    });

    // 2. Check escalation
    const hourlyRate = updated.occurrenceCount;
    const daysSinceFirst = Math.max(1, Math.ceil((Date.now() - updated.firstSeenAt.getTime()) / 86400000));
    const dailyAvgRate = Math.max(1, updated.occurrenceCount / daysSinceFirst);
    const newSeverity = this.noiseFilter.checkEscalation(
      updated.currentSeverity as BugSeverity,
      hourlyRate,
      dailyAvgRate,
    );

    // 3. If severity escalated, update Linear issue
    if (newSeverity !== updated.currentSeverity && existing.linearIssueId) {
      const priorityMap: Record<BugSeverity, number> = { urgent: 1, high: 2, medium: 3, low: 4 };
      await this.linearClient.updateIssue(existing.linearIssueId, {
        priority: priorityMap[newSeverity],
        title: newSeverity === 'urgent' ? `[URGENT] ${existing.title}` : undefined,
      });
      await this.prisma.bugFingerprint.update({
        where: { hash },
        data: { currentSeverity: newSeverity },
      });
    }

    // 4. Add comment to Linear issue with occurrence count
    if (existing.linearIssueId) {
      await this.linearClient.addComment(
        existing.linearIssueId,
        `**Occurrence #${updated.occurrenceCount}** at ${new Date().toISOString()}\n\nLatest error: ${report.errorMessage.substring(0, 200)}`,
      );
    }

    // 5. Alert if escalated to urgent
    if (newSeverity === 'urgent' && updated.currentSeverity !== 'urgent') {
      await this.alertRouter.sendUrgentAlert(report, existing.linearIssueUrl);
    }
  }

  private async handleNew(report: SanitizedBugReport, hash: string): Promise<void> {
    // 1. AI triage
    const triage = await this.triager.triage(report);

    // 2. Create Linear issue
    const issue = await this.linearClient.createIssue(report, triage);

    // 3. Save fingerprint to DB
    await this.prisma.bugFingerprint.create({
      data: {
        hash,
        source: report.source,
        title: report.title,
        errorClass: report.errorClass || null,
        linearIssueId: issue?.id || null,
        linearIssueUrl: issue?.url || null,
        currentSeverity: triage.severity,
        pendingSync: issue === null, // If Linear was unreachable, mark for retry
        metadata: report.metadata as any,
      },
    });

    // 4. Alert if urgent
    if (triage.severity === 'urgent') {
      await this.alertRouter.sendUrgentAlert(report, issue?.url || null);
    }

    console.log(JSON.stringify({
      service: 'bugMonitor',
      action: 'newIssue',
      hash,
      severity: triage.severity,
      linearIssueId: issue?.id || 'pending',
      title: report.title,
    }));
  }

  // --- Background Jobs ---

  async retryPendingSyncs(): Promise<void> {
    const pending = await this.prisma.bugFingerprint.findMany({
      where: { pendingSync: true },
      take: 20,
    });

    for (const fp of pending) {
      const triage: TriageResult = {
        severity: fp.currentSeverity as BugSeverity,
        rootCause: 'Retried from pending sync queue',
      };
      const fakeReport: SanitizedBugReport = {
        source: fp.source as BugSource,
        title: fp.title,
        errorMessage: fp.title,
        errorClass: fp.errorClass || undefined,
        metadata: (fp.metadata as Record<string, string>) || {},
        occurredAt: fp.firstSeenAt,
        environment: 'production',
        _sanitized: true,
      };

      const issue = await this.linearClient.createIssue(fakeReport, triage);
      if (issue) {
        await this.prisma.bugFingerprint.update({
          where: { id: fp.id },
          data: {
            pendingSync: false,
            linearIssueId: issue.id,
            linearIssueUrl: issue.url,
          },
        });
      }
    }
  }

  async archiveOldFingerprints(): Promise<void> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await this.prisma.bugFingerprint.deleteMany({
      where: {
        resolvedAt: { not: null, lt: ninetyDaysAgo },
      },
    });
  }
}

export let bugMonitor: BugMonitorService;

export function initBugMonitor(prisma: PrismaClient): void {
  bugMonitor = new BugMonitorService(prisma);

  // Retry pending Linear syncs every 15 minutes
  setInterval(() => bugMonitor.retryPendingSyncs(), 15 * 60 * 1000);

  // Archive old resolved fingerprints weekly (Sunday 4am UTC)
  setInterval(() => {
    if (new Date().getUTCHours() === 4 && new Date().getUTCDay() === 0) {
      bugMonitor.archiveOldFingerprints();
    }
  }, 60 * 60 * 1000);

  console.log(JSON.stringify({ service: 'bugMonitor', action: 'initialized' }));
}
