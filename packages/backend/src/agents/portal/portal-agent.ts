import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import { logAgentEvent } from '../event-logger.js';
import { emitWorkflowEvent } from '../websocket.js';
import { getAdapter } from './payer-adapter.js';
import { decryptSafe } from '../../utils/crypto.js';

// ==========================================
// Types
// ==========================================

export interface PortalJobData {
  workflowId: string;
  taskId: string;
  providerId: string;
  payerId: string;
  enrollmentId?: string;
  action: 'submit_to_portal' | 'check_readiness';
}

export interface PortalJobResult {
  status: 'completed' | 'failed' | 'needs_approval';
  data?: Record<string, unknown>;
  error?: string;
}

// ==========================================
// Processor
// ==========================================

export async function processPortalJob(data: PortalJobData): Promise<PortalJobResult> {
  const { workflowId, taskId, providerId, payerId, action } = data;

  logger.info(`[portal_interaction] Processing ${action}`, {
    workflowId,
    taskId,
    providerId,
    payerId,
  });

  // Mark task in-progress
  await prisma.agentTask.update({
    where: { id: taskId },
    data: { status: 'in_progress', startedAt: new Date() },
  });

  try {
    // Load adapter config for this payer
    const adapterConfig = await prisma.payerSubmissionConfig.findUnique({
      where: { payerId },
    });

    if (!adapterConfig || !adapterConfig.isActive) {
      const error = adapterConfig
        ? 'Payer adapter is disabled'
        : 'No adapter configured for this payer';

      await markTaskFailed(taskId, workflowId, error);
      return { status: 'failed', error };
    }

    const adapter = getAdapter(adapterConfig.adapterType);
    if (!adapter) {
      const error = `Unknown adapter type: ${adapterConfig.adapterType}`;
      await markTaskFailed(taskId, workflowId, error);
      return { status: 'failed', error };
    }

    const submissionInput = {
      workflowId,
      taskId,
      providerId,
      payerId,
      enrollmentId: data.enrollmentId,
      config: (adapterConfig.config ?? {}) as Record<string, unknown>,
      credentials: adapterConfig.credentialsEncrypted
        ? JSON.parse(decryptSafe(adapterConfig.credentialsEncrypted)) as Record<string, unknown>
        : undefined,
    };

    if (action === 'check_readiness') {
      const readiness = await adapter.checkReadiness(submissionInput);

      await prisma.agentTask.update({
        where: { id: taskId },
        data: {
          status: 'completed',
          output: readiness as any,
          completedAt: new Date(),
        },
      });

      await logAgentEvent({
        workflowId,
        taskId,
        agent: 'portal_interaction',
        action: 'readiness_checked',
        data: readiness as any,
      });

      emitWorkflowEvent(workflowId, 'agent:readiness_checked', {
        taskId,
        readiness,
      });

      return { status: 'completed', data: readiness as any };
    }

    // action === 'submit_to_portal'
    const result = await adapter.submit(submissionInput);

    if (result.success) {
      await prisma.agentTask.update({
        where: { id: taskId },
        data: {
          status: 'completed',
          output: result as any,
          completedAt: new Date(),
        },
      });

      await logAgentEvent({
        workflowId,
        taskId,
        agent: 'portal_interaction',
        action: 'portal_submission_completed',
        data: {
          submissionId: result.submissionId,
          confirmationNumber: result.confirmationNumber,
        } as any,
      });

      emitWorkflowEvent(workflowId, 'agent:portal_submission_completed', {
        taskId,
        result,
      });

      return { status: 'completed', data: result as any };
    }

    // Submission failed
    await markTaskFailed(taskId, workflowId, result.error ?? 'Submission failed');
    return { status: 'failed', error: result.error };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[portal_interaction] Job failed: ${message}`, {
      workflowId,
      taskId,
      error: message,
    });

    await markTaskFailed(taskId, workflowId, message);
    return { status: 'failed', error: message };
  }
}

async function markTaskFailed(taskId: string, workflowId: string, error: string): Promise<void> {
  await prisma.agentTask.update({
    where: { id: taskId },
    data: {
      status: 'failed',
      error: { message: error } as any,
      completedAt: new Date(),
    },
  });

  await logAgentEvent({
    workflowId,
    taskId,
    agent: 'portal_interaction',
    action: 'portal_job_failed',
    data: { error } as any,
    level: 'error',
  });

  emitWorkflowEvent(workflowId, 'agent:portal_job_failed', {
    taskId,
    error,
  });
}
