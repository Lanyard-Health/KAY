import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==========================================
// Mocks — vi.hoisted so they're available in vi.mock factories
// ==========================================

const { mockClose, mockOn, MockWorker } = vi.hoisted(() => {
  const mockClose = vi.fn().mockResolvedValue(undefined);
  const mockOn = vi.fn().mockReturnThis();
  const MockWorker = vi.fn().mockImplementation(function (
    _name: string,
    _processor: unknown,
    _opts: unknown
  ) {
    return { close: mockClose, on: mockOn };
  });
  return { mockClose, mockOn, MockWorker };
});

vi.mock('bullmq', () => ({
  Worker: MockWorker,
}));

vi.mock('../utils/redis.js', () => ({
  getRedisConfig: vi.fn(() => ({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  })),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./event-logger.js', () => ({
  logAgentEvent: vi.fn().mockResolvedValue(null),
}));

vi.mock('./websocket.js', () => ({
  emitWorkflowEvent: vi.fn(),
}));

vi.mock('./portal/portal-agent.js', () => ({
  processPortalJob: vi.fn().mockResolvedValue({ status: 'completed' }),
}));

vi.mock('./portal/index.js', () => ({
  registerPortalAdapters: vi.fn(),
}));

vi.mock('./document-agent.js', () => ({
  processDocumentJob: vi.fn().mockResolvedValue({ status: 'completed' }),
}));

vi.mock('./orchestrator/orchestrator.service.js', () => ({
  processOrchestratorJob: vi.fn().mockResolvedValue({ status: 'completed' }),
}));

vi.mock('./monitor/monitor-agent.js', () => ({
  processMonitorJob: vi.fn().mockResolvedValue({ status: 'completed' }),
}));

vi.mock('./monitor/monitor-cron.js', () => ({
  startMonitorCron: vi.fn(),
  stopMonitorCron: vi.fn(),
}));

vi.mock('./exception/exception-agent.js', () => ({
  processExceptionJob: vi.fn().mockResolvedValue({ status: 'completed' }),
}));

vi.mock('./approval/approval-agent.js', () => ({
  processApprovalJob: vi.fn().mockResolvedValue({ action: 'scheduled_expiry' }),
}));

// Keep the real Sentry SDK intact (other init-time code depends on it) but spy
// on captureException so we can assert exactly when an alert is/ isn't fired.
vi.mock('@sentry/node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/node')>();
  return { ...actual, captureException: vi.fn() };
});

import * as Sentry from '@sentry/node';
import { logger } from '../utils/logger.js';
import { initializeWorkers, closeAllWorkers, isReferencedEntityMissing } from './workers.js';

// ==========================================
// Tests
// ==========================================

describe('workers', () => {
  beforeEach(async () => {
    // Clear workers from prior tests, then reset mock call counts
    await closeAllWorkers();
    vi.clearAllMocks();
  });

  it('exports initializeWorkers as a function', () => {
    expect(typeof initializeWorkers).toBe('function');
  });

  it('exports closeAllWorkers as a function', () => {
    expect(typeof closeAllWorkers).toBe('function');
  });

  describe('isReferencedEntityMissing', () => {
    it('flags our "<Entity> ... not found" throws (deleted/stale workflow or provider)', () => {
      expect(isReferencedEntityMissing(new Error('Workflow wf-1 not found'))).toBe(true);
      expect(isReferencedEntityMissing(new Error('Provider prov-9 not found'))).toBe(true);
    });

    it('flags Prisma P2025 (record required but not found — the "record to update not found" case)', () => {
      expect(
        isReferencedEntityMissing({ code: 'P2025', message: 'Record to update not found.' })
      ).toBe(true);
      // Robust to empty/odd messages as long as the Prisma code is present.
      expect(isReferencedEntityMissing({ code: 'P2025', message: '' })).toBe(true);
    });

    it('does NOT flag genuine, actionable failures (these must still reach Sentry)', () => {
      expect(isReferencedEntityMissing(new Error('Payer portal returned 500'))).toBe(false);
      expect(isReferencedEntityMissing(new Error('connect ECONNREFUSED 127.0.0.1:6379'))).toBe(false);
      expect(isReferencedEntityMissing(new Error('Not found, but more text after'))).toBe(false);
      expect(isReferencedEntityMissing(null)).toBe(false);
      expect(isReferencedEntityMissing(undefined)).toBe(false);
      expect(isReferencedEntityMissing('a string')).toBe(false);
    });
  });

  describe("worker 'failed' handler — Sentry alerting wiring", () => {
    // Pull the actual 'failed' callback that initializeWorkers() registered on a
    // worker, so we exercise the real handler (not just the classifier helper).
    function getFailedHandler(): (job: unknown, err: unknown) => void {
      initializeWorkers();
      const call = mockOn.mock.calls.find((c) => c[0] === 'failed');
      if (!call) throw new Error("no 'failed' handler was registered");
      return call[1] as (job: unknown, err: unknown) => void;
    }

    const job = { id: '551', name: 'plan_workflow' };

    it('a deleted-workflow failure logs a warning and does NOT alert Sentry', () => {
      const handler = getFailedHandler();
      handler(job, new Error('Workflow wf-1 not found'));

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('the Job-551 case (Prisma P2025 record-not-found) does NOT alert Sentry', () => {
      const handler = getFailedHandler();
      handler(job, Object.assign(new Error(''), { code: 'P2025' }));

      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('a genuine, actionable failure STILL logs an error and alerts Sentry', () => {
      const handler = getFailedHandler();
      const err = new Error('Payer portal returned 500');
      handler(job, err);

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalledWith(err, expect.any(Object));
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('initializeWorkers', () => {
    it('creates 8 workers (one per queue)', () => {
      initializeWorkers();

      expect(MockWorker).toHaveBeenCalledTimes(8);
    });

    it('creates workers for all expected queue names', () => {
      initializeWorkers();

      const queueNames = MockWorker.mock.calls.map(
        (call: unknown[]) => call[0]
      );
      expect(queueNames).toContain('agent-orchestrator');
      expect(queueNames).toContain('agent-document');
      expect(queueNames).toContain('agent-portal');
      expect(queueNames).toContain('agent-monitor');
      expect(queueNames).toContain('agent-exception');
      expect(queueNames).toContain('agent-approval');
      expect(queueNames).toContain('submission');
      expect(queueNames).toContain('caqh-import');
    });

    it('uses real processor for document_parser worker', () => {
      initializeWorkers();

      // Find the call for the document queue
      const documentCall = MockWorker.mock.calls.find(
        (call: unknown[]) => call[0] === 'agent-document'
      );
      expect(documentCall).toBeDefined();
      // The processor (second arg) should be a function
      expect(typeof documentCall![1]).toBe('function');
    });

    it('registers completed and failed event handlers on each worker', () => {
      initializeWorkers();

      // Each worker should have 2 event handlers (completed + failed)
      // 8 workers * 2 events = 16 .on() calls
      expect(mockOn).toHaveBeenCalledTimes(16);
    });
  });

  describe('closeAllWorkers', () => {
    it('closes all workers and clears the array', async () => {
      initializeWorkers();
      mockClose.mockClear();

      await closeAllWorkers();

      expect(mockClose).toHaveBeenCalledTimes(8);
    });

    it('handles being called when no workers exist', async () => {
      await closeAllWorkers();

      expect(mockClose).not.toHaveBeenCalled();
    });
  });
});
