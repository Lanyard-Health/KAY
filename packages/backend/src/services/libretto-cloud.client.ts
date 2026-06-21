/**
 * Libretto Cloud client — invoke a deployed Libretto workflow as a hosted job.
 *
 * Connectivity only (Step 1): lets the backend create a job, poll it, and read
 * the result. NOT yet wired into the submission engine, and NOT to be called
 * with provider PII until the data-handling/BAA question is settled — see
 * ~/.claude/plans/lanyard-libretto-next-steps.md.
 *
 * API conventions (from the libretto package source):
 *   - Base: https://api.libretto.sh (override with LIBRETTO_API_URL)
 *   - Auth: `x-api-key` header (LIBRETTO_API_KEY)
 *   - /v1/* uses an oRPC envelope: request body is { json: <input> },
 *     response unwraps to body.json.
 */

import { logger } from '../utils/logger.js';

const DEFAULT_BASE_URL = 'https://api.libretto.sh';

const TERMINAL_OK = new Set(['completed', 'succeeded', 'success']);
const TERMINAL_FAIL = new Set(['failed', 'error', 'cancelled', 'canceled']);

export interface LibrettoJob {
  job_id: string;
  workflow: string;
  status: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  created_at?: string;
  completed_at?: string;
  // Libretto may add fields; keep it open.
  [key: string]: unknown;
}

export class LibrettoCloudError extends Error {
  constructor(message: string, public readonly job?: LibrettoJob) {
    super(message);
    this.name = 'LibrettoCloudError';
  }
}

function config(): { baseUrl: string; apiKey: string } {
  const apiKey = process.env['LIBRETTO_API_KEY']?.trim();
  if (!apiKey) {
    throw new LibrettoCloudError('LIBRETTO_API_KEY is not set');
  }
  const baseUrl = (process.env['LIBRETTO_API_URL']?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
  return { baseUrl, apiKey };
}

/** POST an oRPC endpoint and return the unwrapped `json` payload. */
async function rpc<T>(path: string, input: unknown): Promise<T> {
  const { baseUrl, apiKey } = config();
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      Origin: baseUrl,
    },
    body: JSON.stringify({ json: input }),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new LibrettoCloudError(`Libretto ${path} failed: ${res.status} ${text.slice(0, 500)}`);
  }
  return ((body as { json?: T })?.json ?? body) as T;
}

/** Dispatch a deployed workflow. Returns the job id. */
export async function createJob(
  workflow: string,
  params: Record<string, unknown> = {},
  timeoutSeconds = 300
): Promise<string> {
  const job = await rpc<{ job_id: string; status: string }>('/v1/jobs/create', {
    workflow,
    params,
    timeout_seconds: timeoutSeconds,
  });
  logger.info('libretto: job created', { workflow, jobId: job.job_id, status: job.status });
  return job.job_id;
}

/** Fetch current job state. */
export async function getJob(jobId: string): Promise<LibrettoJob> {
  return rpc<LibrettoJob>('/v1/jobs/get', { id: jobId });
}

/**
 * Create a job and poll until it reaches a terminal state.
 * Resolves with the finished job (incl. `result`), or throws on failure/timeout.
 */
export async function runJob(
  workflow: string,
  params: Record<string, unknown> = {},
  opts: { timeoutSeconds?: number; pollMs?: number; maxWaitMs?: number } = {}
): Promise<LibrettoJob> {
  const { timeoutSeconds = 300, pollMs = 3000, maxWaitMs = 330_000 } = opts;
  const jobId = await createJob(workflow, params, timeoutSeconds);

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const job = await getJob(jobId);
    if (TERMINAL_OK.has(job.status)) {
      logger.info('libretto: job completed', { workflow, jobId, status: job.status });
      return job;
    }
    if (TERMINAL_FAIL.has(job.status)) {
      throw new LibrettoCloudError(`Libretto job ${jobId} ended ${job.status}`, job);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new LibrettoCloudError(`Libretto job ${jobId} did not finish within ${maxWaitMs}ms`);
}
