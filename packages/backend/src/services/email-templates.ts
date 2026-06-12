/**
 * Branded transactional email template for provider-facing notifications.
 *
 * Email-client reality dictates the implementation: table layout, inline
 * styles, hex colors, no external fonts. The green header band shows the
 * hosted logo image; its alt text is styled to render as a white text
 * wordmark when image loading is disabled (the default for first-time
 * senders), so the email stays branded either way.
 *
 * Palette: deep forest green #0A3D2E on green-tinted neutrals. No pure black
 * or white anywhere; every neutral leans toward the brand hue.
 */

// White wordmark served by the production frontend (packages/frontend/public/
// email/). 480px source rendered at 240px = sharp on retina screens.
const LOGO_URL = 'https://portal.lanyardhealth.com/email/logo-wordmark-light.png';

const FONT_STACK =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const COLOR = {
  brand: '#0A3D2E',
  paper: '#F4F7F5', // page background, green-tinted
  card: '#FDFEFD', // card surface, just off white
  border: '#E2EAE5',
  heading: '#14241E',
  body: '#3A4A43',
  muted: '#7A8983',
  panel: '#EFF5F1', // action panel tint
  panelBorder: '#DCE7E0',
  onBrand: '#F4F9F6', // text on the green band
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ProviderActionEmailParams {
  /** Hidden inbox preview line (shows next to the subject in Gmail/Apple Mail). */
  previewText: string;
  heading: string;
  /** Provider first name; greeting renders as "Hi {firstName}," */
  firstName: string;
  /** Intro paragraphs, plain text (escaped). */
  paragraphs: string[];
  /** Optional numbered steps rendered inside the action panel. Plain text (escaped). */
  steps?: string[];
  /** Heading for the steps panel. Defaults to "What to do". */
  stepsTitle?: string;
  cta?: { label: string; url: string };
  /** Small muted helper link rendered under the CTA (e.g. login recovery). */
  secondaryLink?: { label: string; url: string };
  /** Calm closing line under the CTA, e.g. what happens automatically next. */
  reassurance?: string;
}

export function renderProviderActionEmail(params: ProviderActionEmailParams): string {
  const firstName = escapeHtml(params.firstName);
  const paragraphsHtml = params.paragraphs
    .map(
      (p) =>
        `<p style="margin: 0 0 16px 0; font-family: ${FONT_STACK}; font-size: 15px; line-height: 1.6; color: ${COLOR.body};">${escapeHtml(p)}</p>`
    )
    .join('\n');

  const stepsHtml = params.steps?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLOR.panel}; border: 1px solid ${COLOR.panelBorder}; border-radius: 8px; margin: 8px 0 24px 0;">
        <tr><td style="padding: 18px 22px;">
          <p style="margin: 0 0 10px 0; font-family: ${FONT_STACK}; font-size: 14px; font-weight: 600; color: ${COLOR.heading};">${escapeHtml(params.stepsTitle ?? 'What to do')}</p>
          <ol style="margin: 0; padding: 0 0 0 18px;">
            ${params.steps
              .map(
                (s) =>
                  `<li style="margin: 0 0 6px 0; font-family: ${FONT_STACK}; font-size: 14.5px; line-height: 1.55; color: ${COLOR.body};">${escapeHtml(s)}</li>`
              )
              .join('\n')}
          </ol>
        </td></tr>
      </table>`
    : '';

  const ctaHtml = params.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 12px 0;">
        <tr><td style="background-color: ${COLOR.brand}; border-radius: 8px;">
          <a href="${escapeHtml(params.cta.url)}" target="_blank" style="display: inline-block; padding: 12px 28px; font-family: ${FONT_STACK}; font-size: 15px; font-weight: 600; color: ${COLOR.onBrand}; text-decoration: none;">${escapeHtml(params.cta.label)}</a>
        </td></tr>
      </table>
      <p style="margin: 0 0 24px 0; font-family: ${FONT_STACK}; font-size: 12.5px; line-height: 1.5; color: ${COLOR.muted};">Or copy this address into your browser: ${escapeHtml(params.cta.url)}</p>`
    : '';

  const secondaryLinkHtml = params.secondaryLink
    ? `<p style="margin: 0 0 24px 0; font-family: ${FONT_STACK}; font-size: 13px; line-height: 1.5;"><a href="${escapeHtml(params.secondaryLink.url)}" target="_blank" style="color: ${COLOR.brand}; text-decoration: underline;">${escapeHtml(params.secondaryLink.label)}</a></p>`
    : '';

  const reassuranceHtml = params.reassurance
    ? `<p style="margin: 0; padding-top: 16px; border-top: 1px solid ${COLOR.border}; font-family: ${FONT_STACK}; font-size: 14px; line-height: 1.6; color: ${COLOR.body};">${escapeHtml(params.reassurance)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(params.heading)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${COLOR.paper};">
  <!-- Inbox preview text (hidden in the body) -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${escapeHtml(params.previewText)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLOR.paper};">
    <tr><td align="center" style="padding: 32px 16px;">

      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width: 560px; width: 100%; background-color: ${COLOR.card}; border: 1px solid ${COLOR.border}; border-radius: 12px; overflow: hidden;">
        <!-- Brand band -->
        <tr><td style="background-color: ${COLOR.brand}; padding: 22px 32px;">
          <img src="${LOGO_URL}" width="240" height="35" alt="Lanyard Health" style="display: block; border: 0; outline: none; font-family: ${FONT_STACK}; font-size: 17px; font-weight: 600; letter-spacing: 0.01em; color: ${COLOR.onBrand};" />
        </td></tr>

        <!-- Content -->
        <tr><td style="padding: 32px;">
          <h1 style="margin: 0 0 18px 0; font-family: ${FONT_STACK}; font-size: 20px; font-weight: 600; line-height: 1.35; color: ${COLOR.heading};">${escapeHtml(params.heading)}</h1>
          <p style="margin: 0 0 16px 0; font-family: ${FONT_STACK}; font-size: 15px; line-height: 1.6; color: ${COLOR.body};">Hi ${firstName},</p>
          ${paragraphsHtml}
          ${stepsHtml}
          ${ctaHtml}
          ${secondaryLinkHtml}
          ${reassuranceHtml}
        </td></tr>
      </table>

      <!-- Footer, outside the card -->
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width: 560px; width: 100%;">
        <tr><td style="padding: 20px 32px 0 32px;">
          <p style="margin: 0; font-family: ${FONT_STACK}; font-size: 12.5px; line-height: 1.6; color: ${COLOR.muted};">This is an automated notification from Lanyard Health about your credentialing. Please do not reply to this email.</p>
        </td></tr>
      </table>

    </td></tr>
  </table>
</body>
</html>`;
}
