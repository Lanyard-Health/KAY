/**
 * Follow-up Instantiation Service
 *
 * When an enrollment is submitted, this service finds the active
 * FollowUpTemplate for its PayerTrack and creates a FollowUpRun
 * to schedule the follow-up communication sequence.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

// ─── Types ─────────────────────────────────────────────────

interface FollowUpInstantiationResult {
  runCreated: boolean;
  templateFound: boolean;
  templateId: string | null;
  templateName: string | null;
  runId: string | null;
  firstStepChannel: string | null;
  firstStepTriggerDays: number | null;
}

// ─── Core Logic ────────────────────────────────────────────

/**
 * Find the active FollowUpTemplate for a PayerTrack and create a
 * FollowUpRun record for the given enrollment.
 *
 * Returns early with templateFound=false if no active template exists.
 * Also returns early if a FollowUpRun already exists for this enrollment
 * (prevents duplicate runs on repeated status changes).
 */
export async function instantiateFollowUp(
  prisma: PrismaClient,
  enrollmentId: string,
  payerTrackId: string
): Promise<FollowUpInstantiationResult> {
  // 1. Check for existing active run (prevent duplicates)
  const existingRun = await prisma.followUpRun.findFirst({
    where: {
      enrollmentId,
      status: { in: ['active', 'paused'] },
    },
  });

  if (existingRun) {
    logger.info(
      `FollowUpRun already exists for enrollment ${enrollmentId} (run ${existingRun.id}, status: ${existingRun.status}). Skipping.`
    );
    return {
      runCreated: false,
      templateFound: true,
      templateId: existingRun.templateId,
      templateName: null,
      runId: existingRun.id,
      firstStepChannel: null,
      firstStepTriggerDays: null,
    };
  }

  // 2. Find the active template for this PayerTrack (highest version)
  const template = await prisma.followUpTemplate.findFirst({
    where: {
      payerTrackId,
      status: 'active',
    },
    include: {
      steps: { orderBy: { stepOrder: 'asc' } },
    },
    orderBy: { version: 'desc' },
  });

  if (!template) {
    logger.info(`No active FollowUpTemplate found for PayerTrack ${payerTrackId}`);
    return {
      runCreated: false,
      templateFound: false,
      templateId: null,
      templateName: null,
      runId: null,
      firstStepChannel: null,
      firstStepTriggerDays: null,
    };
  }

  if (template.steps.length === 0) {
    logger.warn(`FollowUpTemplate "${template.name}" has no steps. Skipping instantiation.`);
    return {
      runCreated: false,
      templateFound: true,
      templateId: template.id,
      templateName: template.name,
      runId: null,
      firstStepChannel: null,
      firstStepTriggerDays: null,
    };
  }

  // 3. Create the FollowUpRun
  const firstStep = template.steps[0]!;
  const run = await prisma.followUpRun.create({
    data: {
      enrollmentId,
      templateId: template.id,
      status: 'active',
      currentStepOrder: 1,
      startedAt: new Date(),
    },
  });

  logger.info(
    `Created FollowUpRun ${run.id} from template "${template.name}" (v${template.version}) ` +
    `for enrollment ${enrollmentId}. First step: "${firstStep.name}" (${firstStep.channel}, ` +
    `trigger in ${firstStep.triggerDaysAfterPrev} days)`
  );

  return {
    runCreated: true,
    templateFound: true,
    templateId: template.id,
    templateName: template.name,
    runId: run.id,
    firstStepChannel: firstStep.channel,
    firstStepTriggerDays: firstStep.triggerDaysAfterPrev,
  };
}
