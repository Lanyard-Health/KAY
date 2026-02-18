import { logger } from '../../utils/logger.js';
import type { Browser, Page } from 'playwright';

/**
 * Manages held browser sessions for the review-then-submit flow.
 * Key: runId, Value: { browser, page, timeoutId }
 */
interface HeldSession {
  browser: Browser;
  page: Page;
  timeoutId: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, HeldSession>();
let activeBrowserCount = 0;
const MAX_CONCURRENT = 1;
const REVIEW_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export function getActiveCount(): number {
  return activeBrowserCount;
}

export function canLaunch(): boolean {
  return activeBrowserCount < MAX_CONCURRENT;
}

export function holdSession(
  runId: string,
  browser: Browser,
  page: Page,
  onTimeout: () => Promise<void>,
): void {
  activeBrowserCount++;
  const timeoutId = setTimeout(async () => {
    logger.warn(`Aetna run ${runId} review timed out after 30 minutes`);
    await onTimeout();
    releaseSession(runId);
  }, REVIEW_TIMEOUT_MS);

  sessions.set(runId, { browser, page, timeoutId });
}

export function getSession(runId: string): { browser: Browser; page: Page } | null {
  const session = sessions.get(runId);
  if (!session) return null;
  return { browser: session.browser, page: session.page };
}

export async function releaseSession(runId: string): Promise<void> {
  const session = sessions.get(runId);
  if (!session) return;

  clearTimeout(session.timeoutId);
  sessions.delete(runId);
  activeBrowserCount--;

  try {
    await session.browser.close();
  } catch (err) {
    logger.error(`Error closing browser for run ${runId}`, err);
  }
}
