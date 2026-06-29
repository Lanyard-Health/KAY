/**
 * Follow-Up Step Executor
 *
 * Daily cron job that checks all active FollowUpRuns, determines which steps
 * are due, and either auto-sends emails (routine) or creates PendingApprovals
 * (high-stakes actions requiring human review).
 *
 * Design principle: routine actions happen automatically, high-stakes actions
 * require human approval, the team is notified of everything.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { emailService } from './email.service.js';
import { notificationService } from './notification.service.js';
import { createFollowUpApproval } from './workflow-approval.service.js';
import { subjectName } from '../utils/enrollmentSubject.js';

// ─── Types ─────────────────────────────────────────────────

export interface ExecutorSummary {
  emailsSent: number;
  approvalsCreated: number;
  skippedNotDue: number;
  skippedTerminal: number;
  stalled: number;
  completed: number;
  errors: number;
}

const TERMINAL_ENROLLMENT_STATUSES = ['approved', 'denied', 'terminated'];
const STALE_RUN_DAYS = 90;

// ─── Template Rendering ───────────────────────────────────

interface TemplateVars {
  provider_name: string;
  provider_npi: string;
  payer_name: string;
  payer_phone: string;
  payer_email: string;
  submission_date: string;
  reference_number: string;
  days_elapsed: string;
  staff_name: string;
  practice_name: string;
}

function renderTemplate(template: string, vars: TemplateVars): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
  }
  return result;
}

function buildTemplateVars(enrollment: any): TemplateVars {
  const provider = enrollment.provider;
  const payer = enrollment.payer;
  const contacts = enrollment.payerTrack?.contacts || [];
  const phoneContact = contacts.find((c: any) => c.phone);
  const emailContact = contacts.find((c: any) => c.email);

  const submittedAt = enrollment.applicationDate || enrollment.createdAt;
  const daysElapsed = Math.floor(
    (Date.now() - new Date(submittedAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    provider_name: `${provider.firstName} ${provider.lastName}`,
    provider_npi: provider.npi || '',
    payer_name: payer.name || '',
    payer_phone: phoneContact?.phone || '',
    payer_email: emailContact?.email || '',
    submission_date: new Date(submittedAt).toLocaleDateString('en-US'),
    reference_number: enrollment.providerNumber || enrollment.id,
    days_elapsed: String(daysElapsed),
    staff_name: 'Lanyard Health Credentialing Team',
    practice_name: provider.practice?.name || 'Lanyard Health',
  };
}

// ─── Auto-Send Decision ───────────────────────────────────

function shouldAutoSend(step: { channel: string; escalationLevel: number; requiresApproval: boolean }): boolean {
  if (step.channel === 'phone_call') return false;
  if (step.escalationLevel >= 2) return false;
  if (step.requiresApproval) return false;
  return true;
}

// ─── Step Advancement ─────────────────────────────────────

export async function advanceStep(
  prisma: PrismaClient,
  runId: string,
  totalSteps: number
): Promise<{ completed: boolean }> {
  const run = await prisma.followUpRun.findUnique({ where: { id: runId } });
  if (!run) return { completed: false };

  const newStepOrder = run.currentStepOrder + 1;
  const isComplete = newStepOrder > totalSteps;

  await prisma.followUpRun.update({
    where: { id: runId },
    data: {
      currentStepOrder: newStepOrder,
      lastExecutedAt: new Date(),
      ...(isComplete && { status: 'completed', completedAt: new Date() }),
    },
  });

  return { completed: isComplete };
}

// ─── Core Executor ────────────────────────────────────────

export async function executeAllDueSteps(prisma: PrismaClient): Promise<ExecutorSummary> {
  const summary: ExecutorSummary = {
    emailsSent: 0,
    approvalsCreated: 0,
    skippedNotDue: 0,
    skippedTerminal: 0,
    stalled: 0,
    completed: 0,
    errors: 0,
  };

  // 1. Query all active runs with full context
  const activeRuns = await prisma.followUpRun.findMany({
    where: { status: 'active' },
    include: {
      template: {
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
      },
      enrollment: {
        include: {
          provider: {
            include: { practice: { select: { name: true } } },
          },
          practice: { select: { name: true } },
          payer: true,
          payerTrack: {
            include: { contacts: true },
          },
        },
      },
      approvals: {
        where: { status: 'pending' },
        select: { followUpStepOrder: true },
      },
    },
  });

  logger.info(`[FollowUpExecutor] Processing ${activeRuns.length} active runs`);

  for (const run of activeRuns) {
    try {
      const enrollment = run.enrollment;
      const provider = enrollment.provider;
      const payer = enrollment.payer;
      const steps = run.template.steps;
      const providerName = subjectName(provider, enrollment.practice);

      // 2a. Skip terminal enrollments
      if (TERMINAL_ENROLLMENT_STATUSES.includes(enrollment.status)) {
        logger.info(`[FollowUpExecutor] Run ${run.id}: enrollment ${enrollment.id} is ${enrollment.status}, skipping`);
        summary.skippedTerminal++;
        continue;
      }

      // 2b. Stale run detection (>90 days)
      const runAgeDays = Math.floor(
        (Date.now() - new Date(run.startedAt).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (runAgeDays > STALE_RUN_DAYS) {
        await prisma.followUpRun.update({
          where: { id: run.id },
          data: { status: 'stalled' },
        });
        await notificationService.notifyAdminUsers({
          type: 'system_announcement',
          title: 'Follow-Up Run Stalled',
          message: `Follow-up for ${providerName} / ${payer.name} has been active for ${runAgeDays} days with no resolution. Marked as stalled.`,
          actionUrl: `/enrollments/${enrollment.id}`,
        });
        logger.warn(`[FollowUpExecutor] Run ${run.id}: stalled after ${runAgeDays} days`);
        summary.stalled++;
        continue;
      }

      // 2c. Find current step
      const currentStep = steps.find((s) => s.stepOrder === run.currentStepOrder);
      if (!currentStep) {
        // currentStepOrder exceeds step count — mark completed
        await prisma.followUpRun.update({
          where: { id: run.id },
          data: { status: 'completed', completedAt: new Date() },
        });
        logger.info(`[FollowUpExecutor] Run ${run.id}: no more steps, marked completed`);
        summary.completed++;
        continue;
      }

      // 2d. Calculate due date
      const referenceDate = run.lastExecutedAt || run.startedAt;
      const dueDate = new Date(referenceDate);
      dueDate.setDate(dueDate.getDate() + currentStep.triggerDaysAfterPrev);

      if (new Date() < dueDate) {
        summary.skippedNotDue++;
        continue;
      }

      // 2e. Check for existing pending approval (prevent duplicates)
      const hasPendingApproval = run.approvals.some(
        (a) => a.followUpStepOrder === currentStep.stepOrder
      );
      if (hasPendingApproval) {
        logger.info(`[FollowUpExecutor] Run ${run.id}: step ${currentStep.stepOrder} already has pending approval, skipping`);
        summary.skippedNotDue++;
        continue;
      }

      // 3. Execute: auto-send or require approval
      const vars = buildTemplateVars(enrollment);

      if (shouldAutoSend(currentStep)) {
        // ── AUTO-SEND EMAIL ──
        const recipientEmail = enrollment.followUpEmail
          || enrollment.payerTrack?.contacts?.find((c: any) => c.email)?.email;

        if (!recipientEmail) {
          logger.warn(`[FollowUpExecutor] Run ${run.id}: no recipient email found, skipping`);
          await notificationService.notifyAdminUsers({
            type: 'system_announcement',
            title: 'Follow-Up Missing Email',
            message: `Cannot auto-send follow-up for ${providerName} / ${payer.name} — no recipient email configured.`,
            actionUrl: `/enrollments/${enrollment.id}`,
          });
          summary.errors++;
          continue;
        }

        const renderedSubject = currentStep.emailSubject
          ? renderTemplate(currentStep.emailSubject, vars)
          : `Follow-Up: ${providerName} / ${payer.name}`;
        const renderedBody = currentStep.emailBodyTemplate
          ? renderTemplate(currentStep.emailBodyTemplate, vars)
          : '';

        // Wrap plain text in basic HTML
        const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; white-space: pre-line;">${renderedBody}</div>`;

        const sendResult = await emailService.sendEmail({
          to: recipientEmail,
          subject: renderedSubject,
          html,
          notificationType: 'enrollment_follow_up',
        });

        if (!sendResult.success) {
          logger.error(`[FollowUpExecutor] Run ${run.id}: email send failed: ${sendResult.error}`);
          await notificationService.notifyAdminUsers({
            type: 'system_announcement',
            title: 'Follow-Up Email Failed',
            message: `Follow-up email failed for ${providerName} / ${payer.name} — manual action needed. Error: ${sendResult.error}`,
            actionUrl: `/enrollments/${enrollment.id}`,
          });
          summary.errors++;
          continue; // Do NOT advance — retry next cron run
        }

        // Advance step
        const { completed } = await advanceStep(prisma, run.id, steps.length);

        // Notify team
        await notificationService.notifyAdminUsers({
          type: 'system_announcement',
          title: 'Follow-Up Email Auto-Sent',
          message: `Follow-up email auto-sent to ${payer.name} for ${providerName} — ${renderedSubject}`,
          actionUrl: `/enrollments/${enrollment.id}`,
        });

        if (completed) {
          summary.completed++;
        }
        summary.emailsSent++;
        logger.info(`[FollowUpExecutor] Run ${run.id}: auto-sent email to ${recipientEmail} (step ${currentStep.stepOrder})`);
      } else {
        // ── REQUIRE APPROVAL ──
        const renderedSubject = currentStep.emailSubject
          ? renderTemplate(currentStep.emailSubject, vars)
          : null;
        const renderedBody = currentStep.emailBodyTemplate
          ? renderTemplate(currentStep.emailBodyTemplate, vars)
          : null;
        const renderedScript = currentStep.retellScriptTemplate
          ? renderTemplate(currentStep.retellScriptTemplate, vars)
          : null;

        const recipientEmail = enrollment.followUpEmail
          || enrollment.payerTrack?.contacts?.find((c: any) => c.email)?.email
          || null;

        const result = await createFollowUpApproval(prisma, run.id, currentStep.stepOrder, {
          providerName,
          payerName: payer.name,
          enrollmentId: enrollment.id,
          stepName: currentStep.name,
          channel: currentStep.channel,
          escalationLevel: currentStep.escalationLevel,
          emailSubject: renderedSubject,
          emailBody: renderedBody,
          emailRecipient: recipientEmail,
          retellScript: renderedScript,
          retellAgentId: currentStep.retellAgentId,
        });

        if (result.created) {
          await notificationService.notifyAdminUsers({
            type: 'system_announcement',
            title: 'Follow-Up Approval Needed',
            message: `Follow-up approval needed: ${currentStep.channel} to ${payer.name} for ${providerName} (${currentStep.name})`,
            actionUrl: `/enrollments/${enrollment.id}`,
          });
          summary.approvalsCreated++;
          logger.info(`[FollowUpExecutor] Run ${run.id}: created approval for step ${currentStep.stepOrder} (${currentStep.channel})`);
        } else {
          // Already existed (shouldn't happen due to earlier check, but safe)
          summary.skippedNotDue++;
        }
      }
    } catch (err) {
      logger.error(`[FollowUpExecutor] Error processing run ${run.id}:`, err);
      summary.errors++;
    }
  }

  logger.info(
    `[FollowUpExecutor] Completed: ${summary.emailsSent} emails sent, ${summary.approvalsCreated} approvals created, ` +
    `${summary.skippedNotDue} skipped (not due), ${summary.skippedTerminal} skipped (terminal), ` +
    `${summary.stalled} stalled, ${summary.completed} completed, ${summary.errors} errors`
  );

  return summary;
}
