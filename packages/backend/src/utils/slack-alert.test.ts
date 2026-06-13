import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendSlackAlert, __resetSlackAlertDedup } from './slack-alert.js';

const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/xxx';

describe('slack-alert', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalWebhook: string | undefined;

  beforeEach(() => {
    originalWebhook = process.env['SLACK_ALERT_WEBHOOK_URL'];
    __resetSlackAlertDedup();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    if (originalWebhook === undefined) delete process.env['SLACK_ALERT_WEBHOOK_URL'];
    else process.env['SLACK_ALERT_WEBHOOK_URL'] = originalWebhook;
    vi.unstubAllGlobals();
  });

  it('is a no-op (no POST) when the webhook env var is unset', async () => {
    delete process.env['SLACK_ALERT_WEBHOOK_URL'];
    const posted = await sendSlackAlert({ title: 'boom' });
    expect(posted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the webhook when configured', async () => {
    process.env['SLACK_ALERT_WEBHOOK_URL'] = WEBHOOK;
    const posted = await sendSlackAlert({ title: 'Unhandled server error', source: 'http-500' });
    expect(posted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).text).toContain('Unhandled server error');
  });

  it('scrubs SSN/NPI from title and error (same PHI policy as logs)', async () => {
    process.env['SLACK_ALERT_WEBHOOK_URL'] = WEBHOOK;
    await sendSlackAlert({
      title: 'failed for 123-45-6789',
      error: new Error('lookup failed for NPI 1234567890 (SSN 123-45-6789)'),
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body).text as string;
    expect(body).not.toContain('123-45-6789'); // SSN
    expect(body).not.toContain('1234567890'); // NPI
    expect(body).toContain('[REDACTED');
  });

  it('scrubs PII from the structured context object', async () => {
    process.env['SLACK_ALERT_WEBHOOK_URL'] = WEBHOOK;
    await sendSlackAlert({
      title: 'worker failed',
      context: { ssn: '123-45-6789', jobId: 'job-1' },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body).text as string;
    expect(body).not.toContain('123-45-6789');
    expect(body).toContain('job-1'); // non-PII context preserved
  });

  it('dedupes identical alerts within the window (one POST, not three)', async () => {
    process.env['SLACK_ALERT_WEBHOOK_URL'] = WEBHOOK;
    await sendSlackAlert({ title: 'same error', error: new Error('x') });
    await sendSlackAlert({ title: 'same error', error: new Error('x') });
    await sendSlackAlert({ title: 'same error', error: new Error('x') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still alerts for a genuinely different error', async () => {
    process.env['SLACK_ALERT_WEBHOOK_URL'] = WEBHOOK;
    await sendSlackAlert({ title: 'error one', error: new Error('a') });
    await sendSlackAlert({ title: 'error two', error: new Error('b') });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never throws and resolves false when the POST fails', async () => {
    process.env['SLACK_ALERT_WEBHOOK_URL'] = WEBHOOK;
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(sendSlackAlert({ title: 'boom' })).resolves.toBe(false);
  });
});
