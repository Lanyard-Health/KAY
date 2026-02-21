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

import { initializeWorkers, closeAllWorkers } from './workers.js';

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

  describe('initializeWorkers', () => {
    it('creates 6 workers (one per queue)', () => {
      initializeWorkers();

      expect(MockWorker).toHaveBeenCalledTimes(6);
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
    });

    it('registers completed and failed event handlers on each worker', () => {
      initializeWorkers();

      // Each worker should have 2 event handlers (completed + failed)
      // 6 workers * 2 events = 12 .on() calls
      expect(mockOn).toHaveBeenCalledTimes(12);
    });
  });

  describe('closeAllWorkers', () => {
    it('closes all workers and clears the array', async () => {
      initializeWorkers();
      mockClose.mockClear();

      await closeAllWorkers();

      expect(mockClose).toHaveBeenCalledTimes(6);
    });

    it('handles being called when no workers exist', async () => {
      await closeAllWorkers();

      expect(mockClose).not.toHaveBeenCalled();
    });
  });
});
