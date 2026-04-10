import { prisma } from '../utils/prisma.js';
import { emailService } from './email.service.js';
import { logger } from '../utils/logger.js';
import type { EmailSendStatus } from '@prisma/client';

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

    const subject = replaceMergeTags(template.subject, practice);
    const html = replaceMergeTags(template.body, practice);

    const result = await emailService.sendEmail({ to: practice.email, subject, html });

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

function replaceMergeTags(text: string, practice: { name: string; email: string | null }): string {
  return text
    .replace(/\{\{practiceName\}\}/g, practice.name)
    .replace(/\{\{practiceEmail\}\}/g, practice.email ?? '');
}
