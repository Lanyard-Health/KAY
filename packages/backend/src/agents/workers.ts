import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import { getRedisConfig, logRedisClientErrors } from '../utils/redis.js';
import { logger } from '../utils/logger.js';
import { sendSlackAlert } from '../utils/slack-alert.js';
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
import { registerSubmissionAdapters } from './portal/adapter-factory.js';
import { processCaqhImportJob } from '../services/caqh-import.service.js';
import type { CaqhImportJobData } from '../queues/caqh-import.queue.js';

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
  // Concurrency 1 — serialize CAQH API access (same courtesy as the nightly sync).
  { queueName: QUEUE_NAMES.CAQH_IMPORT, agentName: 'caqh_import', concurrency: 1 },
];

// ==========================================
// Module-level worker storage
// ==========================================

const workers: Worker[] = [];

// ==========================================
// Failure classification
// ==========================================

/**
 * True when a job failed because the data it referenced no longer exists —
 * e.g. its workflow/record was deleted, or a stale queued job points at data
 * that has since been wiped. These failures are permanent and not actionable,
 * so the worker's failed-handler logs them quietly and keeps them OUT of
 * Sentry. That preserves alerting signal for genuine, fixable failures.
 *
 * Covers our own `<Entity> ... not found` throws and Prisma's P2025
 * ("record required but not found") raised by updates against a missing row.
 */
export function isReferencedEntityMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if ((err as { code?: string }).code === 'P2025') return true;
  const message = (err as { message?: string }).message ?? '';
  return /\bnot found\.?$/i.test(message);
}

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
  if (agentName === 'caqh_import') {
    return async (job: Job) => {
      return processCaqhImportJob(job.data as CaqhImportJobData);
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
  registerSubmissionAdapters();
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

    logRedisClientErrors(worker, `[${config.agentName}] worker`);

    worker.on('completed', (job) => {
      logger.info(`[${config.agentName}] Job ${job.id} completed`, {
        agent: config.agentName,
        jobId: job.id,
        jobName: job.name,
      });
    });

    worker.on('failed', (job, err) => {
      // A job whose referenced data was deleted (stale queue entry, wiped demo
      // data, a workflow removed mid-flight) is a permanent, non-actionable
      // failure. Log it quietly and do NOT alert Sentry — otherwise these drown
      // out real errors and train us to ignore the alerts.
      if (isReferencedEntityMissing(err)) {
        logger.warn(
          `[${config.agentName}] Job ${job?.id} skipped — referenced data no longer exists: ${err.message}`,
          { agent: config.agentName, jobId: job?.id, jobName: job?.name }
        );
        return;
      }
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
      void sendSlackAlert({
        title: `Background worker failed: ${config.agentName}`,
        level: 'error',
        error: err,
        source: 'agent-worker',
        context: { queue: config.queueName, jobName: job?.name, jobId: job?.id },
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
