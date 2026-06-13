import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BugReport } from '../types.js';

const { scrub, write, createIssue, sendSlackAlert } = vi.hoisted(() => ({
  scrub: vi.fn(),
  write: vi.fn(),
  createIssue: vi.fn(),
  sendSlackAlert: vi.fn(),
}));

vi.mock('../sanitizer.js', () => ({ bugSanitizer: { scrub } }));
vi.mock('../bug-writer.js', () => ({ bugWriter: { write } }));
vi.mock('../linear-client.js', () => ({
  linearClient: { createIssue, updateIssue: vi.fn(), addComment: vi.fn() },
}));
vi.mock('../../../utils/slack-alert.js', () => ({ sendSlackAlert }));

import * as mod from '../index.js';

function input(): BugReport {
  return {
    source: 'user-report',
    title: 'save did nothing',
    errorMessage: 'I clicked save on the provider and nothing happened',
    metadata: { userSeverity: 'blocked', reporterEmail: 'beta@x.com', route: '/providers/1' },
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    environment: 'development',
  };
}

describe('bugMonitor.reportUserFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['LINEAR_BUG_MONITOR_ENABLED'] = 'true';
    process.env['LINEAR_BETA_FEEDBACK_LABEL_ID'] = 'beta-label-id';
    scrub.mockImplementation((r: BugReport) => ({ ...r, _sanitized: true }));
    write.mockResolvedValue({
      title: 'Save button does nothing',
      stepsToReproduce: ['Open provider', 'Click Save'],
      expected: 'Saves',
      actual: 'Nothing',
      area: 'Provider detail',
      severity: 'high',
    });
    createIssue.mockResolvedValue({ id: 'iss-1', url: 'https://linear.app/iss-1' });
    sendSlackAlert.mockResolvedValue(true);
    mod.initBugMonitor();
  });

  it('sanitizes, AI-writes, files to Linear under the Beta label, and pings Slack', async () => {
    await mod.bugMonitor.reportUserFeedback(input());

    expect(scrub).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(createIssue).toHaveBeenCalledTimes(1);

    const [report, triage, opts] = createIssue.mock.calls[0];
    expect(report.title).toBe('Save button does nothing'); // AI-written title used
    expect(triage.severity).toBe('high');
    expect(opts.titlePrefix).toBe('[Beta]');
    expect(opts.labelIds).toEqual(['beta-label-id']);
    expect(opts.descriptionMarkdown).toContain('Beta tester feedback');
    expect(opts.descriptionMarkdown).toContain('Steps to reproduce');

    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert.mock.calls[0][0].source).toBe('beta-feedback');
  });

  it('does nothing when the bug monitor is disabled (kill switch)', async () => {
    process.env['LINEAR_BUG_MONITOR_ENABLED'] = 'false';
    await mod.bugMonitor.reportUserFeedback(input());
    expect(write).not.toHaveBeenCalled();
    expect(createIssue).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('never throws if Linear filing fails (beta feedback must not error the user)', async () => {
    createIssue.mockRejectedValueOnce(new Error('linear down'));
    await expect(mod.bugMonitor.reportUserFeedback(input())).resolves.toBeUndefined();
  });

  it('does NOT fingerprint/dedupe — two identical reports both file', async () => {
    await mod.bugMonitor.reportUserFeedback(input());
    await mod.bugMonitor.reportUserFeedback(input());
    expect(createIssue).toHaveBeenCalledTimes(2);
  });
});
