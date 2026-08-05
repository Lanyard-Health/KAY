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

  // The seeded templates are full HTML documents. Everything below was found
  // by running the real "Welcome — Signup Complete" template through this
  // function and diffing; each case is something it actually lost.

  it('preserves the doctype', () => {
    const out = sanitizeEmailHtml('<!DOCTYPE html>\n<html><body><p>hi</p></body></html>');
    expect(out.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
  });

  it('preserves charset and viewport meta tags', () => {
    const out = sanitizeEmailHtml(
      '<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width" /><title>T</title></head>',
    );
    expect(out).toContain('charset="UTF-8"');
    expect(out).toContain('width=device-width');
    expect(out).toContain('<title>');
  });

  it('strips http-equiv so a meta refresh cannot redirect the viewer', () => {
    const out = sanitizeEmailHtml('<meta http-equiv="refresh" content="0;url=https://evil.test">');
    expect(out).not.toContain('http-equiv');
    expect(out).not.toContain('refresh');
  });

  it('refuses a <style> block, which sanitize-html cannot sanitize inside', () => {
    const out = sanitizeEmailHtml('<style>body{x:expression(alert(1))}</style><p>ok</p>');
    expect(out).toBe('<p>ok</p>');
  });

  it('keeps the visual CSS real templates use', () => {
    const style =
      'box-shadow:0 1px 3px rgba(10,61,46,0.06);overflow:hidden;' +
      'filter:brightness(0) invert(1);border-top:1px solid #e5ebe8';
    const out = sanitizeEmailHtml(`<div style="${style}">x</div>`);
    expect(out).toContain('box-shadow');
    expect(out).toContain('overflow:hidden');
    expect(out).toContain('brightness(0)');
    expect(out).toContain('border-top');
  });

  it('blocks the filter values that are script vectors', () => {
    const progid = sanitizeEmailHtml(
      '<p style="filter:progid:DXImageTransform.Microsoft.gradient()">x</p>',
    );
    const url = sanitizeEmailHtml('<p style="filter:url(evil.svg#x)">x</p>');
    expect(progid).not.toContain('progid');
    expect(url).not.toContain('url(');
  });
});
