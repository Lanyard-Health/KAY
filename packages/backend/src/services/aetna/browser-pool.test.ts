import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  canLaunch,
  getActiveCount,
  holdSession,
  getSession,
  releaseSession,
} from './browser-pool.js';

function makeMockBrowser() {
  return { close: vi.fn().mockResolvedValue(undefined) } as any;
}

function makeMockPage() {
  return {} as any;
}

describe('browser-pool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up any held sessions to reset module-level state
    // We try releasing common test runIds
    for (const id of ['run-1', 'run-2', 'run-3', 'run-timeout', 'run-idempotent', 'run-close-err']) {
      await releaseSession(id);
    }
    vi.useRealTimers();
  });

  describe('canLaunch', () => {
    it('returns true when no browsers are active', () => {
      expect(canLaunch()).toBe(true);
    });

    it('returns false when at capacity', () => {
      holdSession('run-1', makeMockBrowser(), makeMockPage(), vi.fn());
      expect(canLaunch()).toBe(false);
    });
  });

  describe('getActiveCount', () => {
    it('returns 0 initially', () => {
      expect(getActiveCount()).toBe(0);
    });

    it('increments on hold and decrements on release', async () => {
      holdSession('run-1', makeMockBrowser(), makeMockPage(), vi.fn());
      expect(getActiveCount()).toBe(1);

      await releaseSession('run-1');
      expect(getActiveCount()).toBe(0);
    });
  });

  describe('holdSession', () => {
    it('stores session retrievable via getSession', () => {
      const browser = makeMockBrowser();
      const page = makeMockPage();
      holdSession('run-1', browser, page, vi.fn());

      const session = getSession('run-1');
      expect(session).not.toBeNull();
      expect(session!.browser).toBe(browser);
      expect(session!.page).toBe(page);
    });

    it('fires onTimeout callback after 30 minutes', async () => {
      const onTimeout = vi.fn().mockResolvedValue(undefined);
      holdSession('run-timeout', makeMockBrowser(), makeMockPage(), onTimeout);

      // Advance past the 30-minute timeout
      vi.advanceTimersByTime(30 * 60 * 1000);
      await vi.runAllTimersAsync();

      expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('releases session after timeout fires', async () => {
      const onTimeout = vi.fn().mockResolvedValue(undefined);
      holdSession('run-timeout', makeMockBrowser(), makeMockPage(), onTimeout);

      vi.advanceTimersByTime(30 * 60 * 1000);
      await vi.runAllTimersAsync();

      expect(getSession('run-timeout')).toBeNull();
    });
  });

  describe('getSession', () => {
    it('returns null for unknown runId', () => {
      expect(getSession('nonexistent')).toBeNull();
    });
  });

  describe('releaseSession', () => {
    it('decrements count and calls browser.close()', async () => {
      const browser = makeMockBrowser();
      holdSession('run-1', browser, makeMockPage(), vi.fn());

      await releaseSession('run-1');

      expect(getActiveCount()).toBe(0);
      expect(browser.close).toHaveBeenCalledOnce();
      expect(getSession('run-1')).toBeNull();
    });

    it('is idempotent — second call does not throw or double-decrement', async () => {
      holdSession('run-idempotent', makeMockBrowser(), makeMockPage(), vi.fn());
      await releaseSession('run-idempotent');
      const countAfterFirst = getActiveCount();

      await releaseSession('run-idempotent'); // second call
      expect(getActiveCount()).toBe(countAfterFirst);
    });

    it('logs error but does not throw if browser.close() rejects', async () => {
      const browser = { close: vi.fn().mockRejectedValue(new Error('close failed')) } as any;
      holdSession('run-close-err', browser, makeMockPage(), vi.fn());

      await expect(releaseSession('run-close-err')).resolves.toBeUndefined();
    });
  });
});
