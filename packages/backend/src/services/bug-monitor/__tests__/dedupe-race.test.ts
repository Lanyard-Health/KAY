import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BugReport } from '../types.js';

const { scrub, triage, createIssue, addComment, shouldSuppress, checkEscalation } = vi.hoisted(() => ({
  scrub: vi.fn(),
  triage: vi.fn(),
  createIssue: vi.fn(),
  addComment: vi.fn(),
  shouldSuppress: vi.fn(),
  checkEscalation: vi.fn(),
}));

vi.mock('../sanitizer.js', () => ({ bugSanitizer: { scrub } }));
vi.mock('../triage.js', () => ({ bugTriager: { triage } }));
vi.mock('../noise-filter.js', () => ({ noiseFilter: { shouldSuppress, checkEscalation } }));
vi.mock('../linear-client.js', () => ({
  linearClient: { createIssue, updateIssue: vi.fn(), addComment },
}));
vi.mock('../alert-router.js', () => ({ alertRouter: { sendUrgentAlert: vi.fn() } }));

import * as mod from '../index.js';

function input(): BugReport {
  return {
    source: 'backend',
    title: 'Connection is closed',
    errorMessage: 'Connection is closed.',
    errorClass: 'Error',
    stackTrace: 'Error: Connection is closed.\n    at Socket.onclose (/app/node_modules/ioredis/redis.js:12:9)',
    metadata: {},
    occurredAt: new Date('2026-07-24T21:14:01Z'),
    environment: 'development',
  };
}

describe('bugMonitor dedupe under concurrency (ENG-267..ENG-283)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['LINEAR_BUG_MONITOR_ENABLED'] = 'true';
    scrub.mockImplementation((r: BugReport) => r);
    shouldSuppress.mockReturnValue({ suppress: false });
    checkEscalation.mockReturnValue('low');
    createIssue.mockResolvedValue({ id: 'iss-1', url: 'https://linear.app/iss-1' });
    // Triage is a real AI call in production; the delay is what opens the
    // window that let 17 concurrent reports each file their own issue.
    triage.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ severity: 'low' }), 20)),
    );
    mod.initBugMonitor();
  });

  it('files exactly one Linear issue for 17 simultaneous identical errors', async () => {
    await Promise.all(Array.from({ length: 17 }, () => mod.bugMonitor.report(input())));

    expect(createIssue).toHaveBeenCalledTimes(1);
  });

  it('still dedupes when reports arrive after the issue exists', async () => {
    await mod.bugMonitor.report(input());
    await mod.bugMonitor.report(input());

    expect(createIssue).toHaveBeenCalledTimes(1);
    expect(addComment).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when issue creation fails so a retry can file it', async () => {
    createIssue.mockRejectedValueOnce(new Error('Linear 503'));
    await mod.bugMonitor.report(input());

    createIssue.mockResolvedValue({ id: 'iss-2', url: 'https://linear.app/iss-2' });
    await mod.bugMonitor.report(input());

    expect(createIssue).toHaveBeenCalledTimes(2);
  });
});
