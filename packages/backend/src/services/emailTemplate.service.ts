import { prisma } from '../utils/prisma.js';
import { emailService } from './email.service.js';
import { logger } from '../utils/logger.js';
import type { EmailTemplateType, EmailSendStatus } from '@prisma/client';

export async function listTemplates(type?: EmailTemplateType) {
  return prisma.emailTemplate.findMany({
    where: {
      isActive: true,
      ...(type ? { type } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getTemplate(id: string) {
  return prisma.emailTemplate.findUnique({ where: { id } });
}

export async function createTemplate(data: {
  name: string;
  subject: string;
  body: string;
  type: EmailTemplateType;
  triggerEvent?: string;
  createdBy: string;
}) {
  return prisma.emailTemplate.create({ data });
}

export async function updateTemplate(
  id: string,
  data: {
    name?: string;
    subject?: string;
    body?: string;
    type?: EmailTemplateType;
    triggerEvent?: string | null;
  },
) {
  return prisma.emailTemplate.update({ where: { id }, data });
}

export async function softDeleteTemplate(id: string) {
  return prisma.emailTemplate.update({
    where: { id },
    data: { isActive: false },
  });
}

export async function sendTemplate(templateId: string, practiceId: string) {
  const template = await prisma.emailTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new Error('Template not found');
  if (!template.isActive) throw new Error('Template is inactive');

  const practice = await prisma.practice.findUnique({ where: { id: practiceId } });
  if (!practice) throw new Error('Practice not found');
  if (!practice.email) throw new Error('Practice has no email address');

  const subject = replaceMergeTags(template.subject, practice);
  const html = replaceMergeTags(template.body, practice);

  const result = await emailService.sendEmail({ to: practice.email, subject, html });

  const status: EmailSendStatus = result.success ? 'SENT' : 'FAILED';

  const log = await prisma.emailLog.create({
    data: {
      templateId,
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
    logger.error(`Email send failed for template ${templateId} to practice ${practiceId}: ${result.error}`);
  }

  return log;
}

export async function listEmailLogs(filters: { practiceId?: string; status?: EmailSendStatus }) {
  return prisma.emailLog.findMany({
    where: {
      ...(filters.practiceId ? { practiceId: filters.practiceId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: { template: true, practice: { select: { id: true, name: true } } },
  });
}

function replaceMergeTags(text: string, practice: { name: string; email: string | null }): string {
  return text
    .replace(/\{\{practiceName\}\}/g, practice.name)
    .replace(/\{\{practiceEmail\}\}/g, practice.email ?? '');
}
