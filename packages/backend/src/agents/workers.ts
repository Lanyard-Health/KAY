import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import { getRedisConfig } from '../utils/redis.js';
import { logger } from '../utils/logger.js';
import { logAgentEvent } from './event-logger.js';
import { emitWorkflowEvent } from './websocket.js';
import { QUEUE_NAMES, QUEUE_LOCK_DURATIONS } from './queues.js';
import type { QueueName } from './queues.js';
import { processPortalJob } from './portal/portal-agent.js';
import type { PortalJobData } from './portal/portal-agent.js';
import { registerPortalAdapters } from './portal/index.js';
import { processDocumentJob } from './document-agent.js';
import type { DocumentJobData } from './document-agent.js';
import { processOrchestratorJob } from './orchestrator/orchestrator.service.js';
import type { OrchestratorJobData } from './orchestrator/orchestrator.service.js';
import { routeAndProcessOrchestratorJob } from '../services/workflow-router.service.js';
import { processMonitorJob } from './monitor/monitor-agent.js';
import type { MonitorJobData } from './monitor/types.js';
import { processExceptionJob } from './exception/exception-agent.js';
import type { ExceptionJobData } from './exception/types.js';
import { startMonitorCron, stopMonitorCron } from './monitor/monitor-cron.js';
import { processApprovalJob } from './approval/approval-agent.js';
import type { ApprovalJobData } from './approval/types.js';
import { withAgentTelemetry } from './action-telemetry.js';
import { processSubmissionJob } from '../queues/submission.worker.js';
import type { SubmissionJobData } from '../queues/submission.queue.js';
import { registerPhase1Adapters } from './portal/adapter-factory.js';

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
  { queueName: QUEUE_NAMES.SUBMISSION, agentName: 'submission', concurrency: 1 },
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
// Processor selection
// ==========================================

function getProcessor(agentName: string) {
  if (agentName === 'orchestrator') {
    return async (job: Job) => {
      const data = job.data as OrchestratorJobData;
      // Router decides stepper vs LLM based on DETERMINISTIC_STEPPER flag and
      // job shape. Defaults to LLM (today's behavior) unless flag is enabled.
      return routeAndProcessOrchestratorJob(data, processOrchestratorJob);
    };
  }
  if (agentName === 'portal_interaction') {
    return async (job: Job) => {
      const data = job.data as PortalJobData;
      return processPortalJob(data);
    };
  }
  if (agentName === 'document_parser') {
    return async (job: Job) => {
      const data = job.data as DocumentJobData;
      return processDocumentJob(data);
    };
  }
  if (agentName === 'monitor') {
    return async (job: Job) => {
      const data = job.data as MonitorJobData;
      return processMonitorJob(data);
    };
  }
  if (agentName === 'exception') {
    return async (job: Job) => {
      const data = job.data as ExceptionJobData;
      return processExceptionJob(data);
    };
  }
  if (agentName === 'approval') {
    return async (job: Job) => {
      const data = job.data as ApprovalJobData;
      return processApprovalJob(data);
    };
  }
  if (agentName === 'submission') {
    return async (job: Job) => {
      return processSubmissionJob(job as Job<SubmissionJobData>);
    };
  }
  return createPlaceholderProcessor(agentName);
}

// ==========================================
// Public API
// ==========================================

/**
 * Creates BullMQ Worker instances for all 6 agent queues.
 * Registers payer adapters and wires real processors where available.
 */
export function initializeWorkers(): void {
  if (workers.length > 0) {
    logger.warn('initializeWorkers called but workers already exist — skipping duplicate initialization');
    return;
  }

  registerPortalAdapters();
  registerPhase1Adapters();
  startMonitorCron();
  const connection = getRedisConfig();

  for (const config of WORKER_CONFIGS) {
    const lockDuration = QUEUE_LOCK_DURATIONS[config.queueName as QueueName] ?? 30_000;
    // withAgentTelemetry wraps the processor so every invocation produces
    // exactly one AgentAction row. The worker.on('completed'|'failed')
    // handlers below intentionally do not write AgentAction — telemetry is
    // captured inside the processor closure to guarantee one-row-per-call
    // and to keep providerId/practiceId/cost derivation co-located with
    // the work that produced the metrics.
    const worker = new Worker(
      config.queueName,
      withAgentTelemetry(
        config.agentName,
        getProcessor(config.agentName) as (job: Job) => Promise<unknown>
      ),
      {
        connection,
        concurrency: config.concurrency,
        lockDuration,
        stalledInterval: lockDuration + 30_000, // check for stalled jobs slightly after lock expires
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
      // Surface worker failures to Sentry. The backend Sentry init (utils/sentry.ts)
      // already scrubs PII from the event payload before send.
      Sentry.captureException(err, {
        tags: {
          source: 'agent-worker',
          agent: config.agentName,
          queue: config.queueName,
          jobName: job?.name ?? 'unknown',
        },
        extra: { jobId: job?.id, attempts: job?.attemptsMade },
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
  stopMonitorCron();
  await Promise.all(
    workers.map(async (worker) => {
      await worker.close();
    })
  );
  workers.length = 0;
  logger.info('All agent workers closed');
}
