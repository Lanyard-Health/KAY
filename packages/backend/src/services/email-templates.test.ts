import { describe, it, expect } from 'vitest';
import { renderProviderActionEmail } from './email-templates.js';

const baseParams = {
  previewText: 'One step and we take care of the rest.',
  heading: 'One step left',
  firstName: 'Jane',
  paragraphs: ['We tried to import your profile.'],
  steps: ['Log in', 'Click Attest'],
  cta: { label: 'Open CAQH ProView', url: 'https://proview.caqh.org' },
  reassurance: 'We check once a day.',
};

describe('renderProviderActionEmail', () => {
  it('renders heading, greeting, steps, CTA, and reassurance', () => {
    const html = renderProviderActionEmail(baseParams);
    expect(html).toContain('One step left');
    expect(html).toContain('Hi Jane,');
    expect(html).toContain('Click Attest');
    expect(html).toContain('href="https://proview.caqh.org"');
    expect(html).toContain('We check once a day.');
    expect(html).toContain('Lanyard Health');
  });

  it('escapes HTML in user-supplied values', () => {
    const html = renderProviderActionEmail({
      ...baseParams,
      firstName: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('uses email-safe styling: no external CSS, brand green present', () => {
    const html = renderProviderActionEmail(baseParams);
    expect(html).toContain('#0A3D2E'); // brand green
    expect(html).not.toMatch(/<link|@import|url\(/); // no external fonts/stylesheets
    expect(html).not.toContain('#000');
    expect(html).not.toMatch(/#fff\b|#ffffff/i); // tinted neutrals only
  });

  it('header logo is the hosted wordmark with a text fallback for blocked images', () => {
    const html = renderProviderActionEmail(baseParams);
    expect(html).toContain('https://portal.lanyardhealth.com/email/logo-wordmark-light.png');
    expect(html).toMatch(/<img[^>]*alt="Lanyard Health"/); // alt renders as wordmark when images are off
  });

  it('omits steps and CTA blocks when not provided', () => {
    const html = renderProviderActionEmail({
      previewText: 'p',
      heading: 'h',
      firstName: 'Jane',
      paragraphs: ['body'],
    });
    expect(html).not.toContain('What to do');
    expect(html).not.toContain('Open CAQH');
  });
});
