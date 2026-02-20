import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { getRedisConfig } from '../utils/redis.js';
import { logger } from '../utils/logger.js';
import { logAgentEvent } from './event-logger.js';
import { emitWorkflowEvent } from './websocket.js';
import { QUEUE_NAMES } from './queues.js';

// ==========================================
// Worker configuration
// ==========================================

interface WorkerConfig {
  queueName: string;
  agentName: string;
  concurrency: number;
}

const WORKER_CONFIGS: WorkerConfig[] = [
  { queueName: QUEUE_NAMES.ORCHESTRATOR, agentName: 'orchestrator', concurrency: 3 },
  { queueName: QUEUE_NAMES.DOCUMENT, agentName: 'document_parser', concurrency: 2 },
  { queueName: QUEUE_NAMES.PORTAL, agentName: 'portal_interaction', concurrency: 1 },
  { queueName: QUEUE_NAMES.MONITOR, agentName: 'monitor', concurrency: 5 },
  { queueName: QUEUE_NAMES.EXCEPTION, agentName: 'exception', concurrency: 2 },
  { queueName: QUEUE_NAMES.APPROVAL, agentName: 'approval', concurrency: 2 },
];

// ==========================================
// Module-level worker storage
// ==========================================

const workers: Worker[] = [];

// ==========================================
// Placeholder processor factory
// ==========================================

function createPlaceholderProcessor(agentName: string) {
  return async (job: Job): Promise<{ status: string; agent: string }> => {
    logger.info(`[${agentName}] Received job ${job.id} (${job.name})`, {
      agent: agentName,
      jobId: job.id,
      jobName: job.name,
    });

    const workflowId = (job.data as Record<string, unknown>)?.['workflowId'] as string | undefined;

    if (workflowId) {
      await logAgentEvent({
        workflowId,
        agent: agentName,
        action: 'job_received',
        data: { jobId: job.id, jobName: job.name },
      });

      emitWorkflowEvent(workflowId, 'agent:job_received', {
        agent: agentName,
        jobId: job.id,
        jobName: job.name,
        workflowId,
      });
    }

    return { status: 'placeholder', agent: agentName };
  };
}

// ==========================================
// Public API
// ==========================================

/**
 * Creates BullMQ Worker instances for all 6 agent queues.
 * Each worker uses a placeholder processor that will be replaced
 * with real agent logic in Phase 2+.
 */
export function initializeWorkers(): void {
  const connection = getRedisConfig();

  for (const config of WORKER_CONFIGS) {
    const worker = new Worker(
      config.queueName,
      createPlaceholderProcessor(config.agentName),
      {
        connection,
        concurrency: config.concurrency,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      }
    );

    worker.on('completed', (job) => {
      logger.info(`[${config.agentName}] Job ${job.id} completed`, {
        agent: config.agentName,
        jobId: job.id,
        jobName: job.name,
      });
    });

    worker.on('failed', (job, err) => {
      logger.error(`[${config.agentName}] Job ${job?.id} failed: ${err.message}`, {
        agent: config.agentName,
        jobId: job?.id,
        jobName: job?.name,
        error: err.message,
      });
    });

    workers.push(worker);
    logger.info(`Worker created: ${config.queueName} (agent: ${config.agentName}, concurrency: ${config.concurrency})`);
  }
}

/**
 * Closes all workers in parallel and clears the worker array.
 * Call during graceful shutdown.
 */
export async function closeAllWorkers(): Promise<void> {
  await Promise.all(
    workers.map(async (worker) => {
      await worker.close();
    })
  );
  workers.length = 0;
  logger.info('All agent workers closed');
}
