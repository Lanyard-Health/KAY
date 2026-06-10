import { prisma } from '../utils/prisma.js';
import { emailService } from './email.service.js';
import { logger } from '../utils/logger.js';
import type { EmailSendStatus } from '@prisma/client';

interface MergeContext {
  practiceName: string;
  practiceEmail: string;
  firstName: string;
  lastName: string;
  dashboardUrl: string;
}

/**
 * Fires a template-driven automated email for a given trigger event.
 * Non-blocking — logs errors but never throws.
 */
export async function triggerAutomatedEmail(triggerEvent: string, practiceId: string): Promise<void> {
  try {
    const template = await prisma.emailTemplate.findFirst({
      where: { triggerEvent, isActive: true, type: 'AUTOMATED_ONBOARDING' },
    });
    if (!template) return;

    const practice = await prisma.practice.findUnique({ where: { id: practiceId } });
    if (!practice || !practice.email) return;

    // Find the primary owner (SUPER_ADMIN of this practice) for first-name greeting.
    // Falls back to any practice admin user if SUPER_ADMIN isn't set.
    const owner = await prisma.userPractice.findFirst({
      where: { practiceId, role: 'SUPER_ADMIN' },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });

    const ctx: MergeContext = {
      practiceName: practice.name,
      practiceEmail: practice.email,
      firstName: owner?.user.firstName ?? 'there',
      lastName: owner?.user.lastName ?? '',
      dashboardUrl: process.env['FRONTEND_URL'] ?? 'https://portal.lanyardhealth.com',
    };

    const subject = replaceMergeTags(template.subject, ctx);
    const html = replaceMergeTags(template.body, ctx);

    const result = await emailService.sendEmail({
      to: practice.email,
      subject,
      html,
      replyTo: process.env['REPLY_TO_EMAIL'] ?? undefined,
    });

    const status: EmailSendStatus = result.success ? 'SENT' : 'FAILED';

    await prisma.emailLog.create({
      data: {
        templateId: template.id,
        practiceId,
        to: practice.email,
        subject,
        status,
        resendId: result.messageId ?? null,
        errorMessage: result.error ?? null,
        sentAt: result.success ? new Date() : null,
      },
    });

    if (!result.success) {
      logger.error(`Automated email failed [${triggerEvent}] to practice ${practiceId}: ${result.error}`);
    }
  } catch (err) {
    logger.error(`triggerAutomatedEmail error [${triggerEvent}] for practice ${practiceId}:`, err);
  }
}

function replaceMergeTags(text: string, ctx: MergeContext): string {
  return text
    .replace(/\{\{practiceName\}\}/g, ctx.practiceName)
    .replace(/\{\{practiceEmail\}\}/g, ctx.practiceEmail)
    .replace(/\{\{firstName\}\}/g, ctx.firstName)
    .replace(/\{\{lastName\}\}/g, ctx.lastName)
    .replace(/\{\{dashboardUrl\}\}/g, ctx.dashboardUrl);
}
