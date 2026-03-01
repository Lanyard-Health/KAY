import { prisma } from '../utils/prisma.js';
import { createWorkflow } from '../agents/coordinator.service.js';
import { logger } from '../utils/logger.js';

let cachedSystemUserId: string | null = null;

async function getSystemUserId(): Promise<string> {
  if (cachedSystemUserId) return cachedSystemUserId;
  const admin = await prisma.user.findFirst({
    where: { role: 'admin' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) throw new Error('No admin user found for automation');
  cachedSystemUserId = admin.id;
  return admin.id;
}

interface AutomationResult {
  triggered: number;
  skippedDuplicate: number;
  skippedNoAction: number;
  errors: { reason: string; providerId?: string }[];
}

/**
 * Check for an existing active workflow for the same provider + enrollment combo.
 * Returns true if one exists (should skip).
 */
async function hasActiveWorkflow(
  providerId: string,
  enrollmentId?: string,
  goalContains?: string,
): Promise<boolean> {
  const where: Record<string, unknown> = {
    providerId,
    status: { in: ['planning', 'active', 'waiting_approval'] },
  };
  if (enrollmentId) {
    where['enrollmentId'] = enrollmentId;
  }
  if (goalContains) {
    where['goal'] = { contains: goalContains, mode: 'insensitive' };
  }
  const count = await prisma.agentWorkflow.count({ where });
  return count > 0;
}

/**
 * Trigger 1: Overdue follow-ups
 * Enrollments in submitted/pending_review that haven't had a follow-up
 * within their configured frequency.
 */
async function triggerOverdueFollowUps(result: AutomationResult): Promise<void> {
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const enrollments = await prisma.payerEnrollment.findMany({
    where: {
      status: { in: ['submitted', 'pending_review'] },
      followUpEnabled: true,
      OR: [
        // Next follow-up date has passed
        { nextFollowUpDate: { lte: now } },
        // Never followed up and application is >14 days old
        {
          lastFollowUpSentAt: null,
          applicationDate: { lt: fourteenDaysAgo },
        },
      ],
    },
    include: {
      provider: { select: { id: true, firstName: true, lastName: true } },
      payer: { select: { id: true, name: true } },
    },
    take: 50,
  });

  for (const enrollment of enrollments) {
    try {
      if (await hasActiveWorkflow(enrollment.providerId, enrollment.id)) {
        result.skippedDuplicate++;
        continue;
      }

      const providerName = `${enrollment.provider.firstName} ${enrollment.provider.lastName}`;
      const payerName = enrollment.payer.name;

      await createWorkflow({
        goal: `Send follow-up for ${providerName}'s ${payerName} enrollment`,
        providerId: enrollment.providerId,
        payerId: enrollment.payerId,
        enrollmentId: enrollment.id,
        priority: 'normal',
        requestedBy: await getSystemUserId(),
      });

      result.triggered++;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      result.errors.push({ reason: `Follow-up: ${errMsg}`, providerId: enrollment.providerId });
    }
  }
}

/**
 * Trigger 2: Expiring credentials
 * Provider licenses, board certifications, or malpractice insurance
 * expiring within 30 days with no active workflow.
 */
async function triggerExpiringCredentials(result: AutomationResult): Promise<void> {
  const now = new Date();
  const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Check licenses expiring soon
  const expiringLicenses = await prisma.license.findMany({
    where: {
      expirationDate: { gte: now, lte: thirtyDaysOut },
      status: 'active',
    },
    include: {
      provider: { select: { id: true, firstName: true, lastName: true } },
    },
    take: 50,
  });

  for (const license of expiringLicenses) {
    try {
      if (await hasActiveWorkflow(license.providerId, undefined, 'license')) {
        result.skippedDuplicate++;
        continue;
      }

      const providerName = `${license.provider.firstName} ${license.provider.lastName}`;
      await createWorkflow({
        goal: `Renew expiring ${license.licenseType} license for ${providerName}`,
        providerId: license.providerId,
        priority: 'high',
        requestedBy: await getSystemUserId(),
      });

      result.triggered++;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      result.errors.push({ reason: `License expiry: ${errMsg}`, providerId: license.providerId });
    }
  }

  // Check board certifications expiring soon
  const expiringCerts = await prisma.boardCertification.findMany({
    where: {
      expirationDate: { gte: now, lte: thirtyDaysOut },
      status: 'active',
    },
    include: {
      provider: { select: { id: true, firstName: true, lastName: true } },
    },
    take: 50,
  });

  for (const cert of expiringCerts) {
    try {
      if (await hasActiveWorkflow(cert.providerId, undefined, 'board certification')) {
        result.skippedDuplicate++;
        continue;
      }

      const providerName = `${cert.provider.firstName} ${cert.provider.lastName}`;
      await createWorkflow({
        goal: `Renew expiring ${cert.boardName} board certification for ${providerName}`,
        providerId: cert.providerId,
        priority: 'high',
        requestedBy: await getSystemUserId(),
      });

      result.triggered++;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      result.errors.push({ reason: `Cert expiry: ${errMsg}`, providerId: cert.providerId });
    }
  }

  // Check malpractice insurance expiring soon
  const expiringMalpractice = await prisma.malpracticeInsurance.findMany({
    where: {
      expirationDate: { gte: now, lte: thirtyDaysOut },
      status: 'active',
    },
    include: {
      provider: { select: { id: true, firstName: true, lastName: true } },
    },
    take: 50,
  });

  for (const insurance of expiringMalpractice) {
    try {
      if (await hasActiveWorkflow(insurance.providerId, undefined, 'malpractice')) {
        result.skippedDuplicate++;
        continue;
      }

      const providerName = `${insurance.provider.firstName} ${insurance.provider.lastName}`;
      await createWorkflow({
        goal: `Renew expiring malpractice insurance for ${providerName}`,
        providerId: insurance.providerId,
        priority: 'high',
        requestedBy: await getSystemUserId(),
      });

      result.triggered++;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      result.errors.push({ reason: `Malpractice expiry: ${errMsg}`, providerId: insurance.providerId });
    }
  }
}

/**
 * Trigger 3: Stale enrollments
 * Enrollments in in_progress or not_started for >30 days with no recent activity.
 */
async function triggerStaleEnrollments(result: AutomationResult): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const staleEnrollments = await prisma.payerEnrollment.findMany({
    where: {
      status: { in: ['not_started', 'in_progress'] },
      updatedAt: { lt: thirtyDaysAgo },
    },
    include: {
      provider: { select: { id: true, firstName: true, lastName: true } },
      payer: { select: { id: true, name: true } },
    },
    take: 50,
  });

  for (const enrollment of staleEnrollments) {
    try {
      if (await hasActiveWorkflow(enrollment.providerId, enrollment.id)) {
        result.skippedDuplicate++;
        continue;
      }

      const providerName = `${enrollment.provider.firstName} ${enrollment.provider.lastName}`;
      const payerName = enrollment.payer.name;

      await createWorkflow({
        goal: `Review stale ${payerName} enrollment for ${providerName}`,
        providerId: enrollment.providerId,
        payerId: enrollment.payerId,
        enrollmentId: enrollment.id,
        priority: 'normal',
        requestedBy: await getSystemUserId(),
      });

      result.triggered++;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      result.errors.push({ reason: `Stale enrollment: ${errMsg}`, providerId: enrollment.providerId });
    }
  }
}

/**
 * Trigger 4: SLA breach approaching
 * Enrollments where slaTargetDate is within 7 days.
 */
async function triggerSlaBreachApproaching(result: AutomationResult): Promise<void> {
  const now = new Date();
  const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const threeDaysOut = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const atRisk = await prisma.payerEnrollment.findMany({
    where: {
      slaTargetDate: { gte: now, lte: sevenDaysOut },
      status: { notIn: ['approved', 'denied', 'terminated'] },
    },
    include: {
      provider: { select: { id: true, firstName: true, lastName: true } },
      payer: { select: { id: true, name: true } },
    },
    take: 50,
  });

  for (const enrollment of atRisk) {
    try {
      if (await hasActiveWorkflow(enrollment.providerId, enrollment.id)) {
        result.skippedDuplicate++;
        continue;
      }

      const providerName = `${enrollment.provider.firstName} ${enrollment.provider.lastName}`;
      const payerName = enrollment.payer.name;
      const daysLeft = Math.ceil(
        (new Date(enrollment.slaTargetDate!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );
      const priority = enrollment.slaTargetDate! <= threeDaysOut ? 'urgent' : 'high';

      await createWorkflow({
        goal: `Urgent: ${payerName} enrollment for ${providerName} approaching SLA deadline (${daysLeft}d)`,
        providerId: enrollment.providerId,
        payerId: enrollment.payerId,
        enrollmentId: enrollment.id,
        priority,
        requestedBy: await getSystemUserId(),
      });

      result.triggered++;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      result.errors.push({ reason: `SLA breach: ${errMsg}`, providerId: enrollment.providerId });
    }
  }
}

/**
 * Run all automation triggers. Safe to call on a schedule —
 * deduplication prevents duplicate workflows.
 */
export async function runAutomation(): Promise<AutomationResult> {
  const result: AutomationResult = {
    triggered: 0,
    skippedDuplicate: 0,
    skippedNoAction: 0,
    errors: [],
  };

  logger.info('[AgentAutomation] Starting automation run...');

  try {
    await triggerOverdueFollowUps(result);
  } catch (error) {
    logger.error('[AgentAutomation] Overdue follow-ups trigger failed:', error);
    result.errors.push({ reason: `Overdue follow-ups trigger failed: ${error}` });
  }

  try {
    await triggerExpiringCredentials(result);
  } catch (error) {
    logger.error('[AgentAutomation] Expiring credentials trigger failed:', error);
    result.errors.push({ reason: `Expiring credentials trigger failed: ${error}` });
  }

  try {
    await triggerStaleEnrollments(result);
  } catch (error) {
    logger.error('[AgentAutomation] Stale enrollments trigger failed:', error);
    result.errors.push({ reason: `Stale enrollments trigger failed: ${error}` });
  }

  try {
    await triggerSlaBreachApproaching(result);
  } catch (error) {
    logger.error('[AgentAutomation] SLA breach trigger failed:', error);
    result.errors.push({ reason: `SLA breach trigger failed: ${error}` });
  }

  logger.info(
    `[AgentAutomation] Run complete: ${result.triggered} triggered, ${result.skippedDuplicate} skipped (duplicate), ${result.errors.length} errors`,
  );

  return result;
}
