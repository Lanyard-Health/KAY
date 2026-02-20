import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

import type { Prisma } from '@prisma/client';

export interface LogAgentEventInput {
  workflowId: string;
  taskId?: string;
  agent: string;
  action: string;
  data: Prisma.InputJsonValue;
  level?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Logs an agent event to the database.
 * CRITICAL: This function must never throw — if the database write fails,
 * it logs a warning and returns null so event logging never crashes an agent.
 */
export async function logAgentEvent(input: LogAgentEventInput) {
  try {
    const event = await prisma.agentEvent.create({
      data: {
        workflowId: input.workflowId,
        taskId: input.taskId ?? null,
        agent: input.agent,
        action: input.action,
        data: input.data,
        level: input.level ?? 'info',
      },
    });
    return event;
  } catch (err) {
    logger.warn('Failed to log agent event', {
      error: err,
      agent: input.agent,
      action: input.action,
      workflowId: input.workflowId,
    });
    return null;
  }
}
