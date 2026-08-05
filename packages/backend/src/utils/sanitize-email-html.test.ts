import { describe, it, expect } from 'vitest';
import { sanitizeEmailHtml } from './sanitize-email-html.js';

describe('sanitizeEmailHtml (ENG-233)', () => {
  it('drops script tags and their contents', () => {
    const out = sanitizeEmailHtml('<p>hi</p><script>alert(document.cookie)</script>');
    expect(out).toContain('hi');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
  });

  it('drops inline event handlers', () => {
    const out = sanitizeEmailHtml('<img src="https://x.test/a.png" onerror="alert(1)">');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert');
  });

  it('drops javascript: URLs', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
  });

  it('drops iframes and objects', () => {
    const out = sanitizeEmailHtml('<iframe src="https://evil.test"></iframe><object data="x"></object>');
    expect(out).not.toContain('iframe');
    expect(out).not.toContain('object');
  });

  it('keeps the table + inline-style markup real email templates rely on', () => {
    const html =
      '<table cellpadding="0"><tr><td style="color:#0A3D2E;padding:12px;text-align:center">' +
      '<a href="https://app.lanyardhealth.com">Open</a></td></tr></table>';
    const out = sanitizeEmailHtml(html);
    expect(out).toContain('<table');
    expect(out).toContain('color:#0A3D2E');
    expect(out).toContain('padding:12px');
    expect(out).toContain('https://app.lanyardhealth.com');
  });

  it('leaves {{placeholder}} tokens intact for send-time substitution', () => {
    const out = sanitizeEmailHtml('<p>Hello {{providerName}}, re {{payerName}}</p>');
    expect(out).toContain('{{providerName}}');
    expect(out).toContain('{{payerName}}');
  });
});
