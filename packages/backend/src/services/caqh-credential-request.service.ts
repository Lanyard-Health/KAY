/**
 * Staff-initiated "ask the provider for updated CAQH login" flow.
 *
 * Mirrors practiceInvitation.service: 32-byte random token, only the SHA-256
 * hash stored, single-use, 7-day expiry, rotation on re-send so the newest
 * email always carries the live link. The provider opens a public page (the
 * token is the credential), submits corrected CAQH username/password, and we
 * re-verify automatically and notify staff of the outcome in-app.
 */
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../utils/prisma.js';
import { caqhCredentialsService } from './caqh-credentials.service.js';
import { notificationService } from './notification.service.js';
import { renderProviderActionEmail } from './email-templates.js';
import { emailService } from './email.service.js';
import { logger } from '../utils/logger.js';

const REQUEST_TTL_DAYS = 7;
const TTL_MS = REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function updateUrl(rawToken: string): string {
  const base = process.env['FRONTEND_URL'] ?? 'https://portal.lanyardhealth.com';
  return `${base.replace(/\/$/, '')}/update-caqh-credentials/${rawToken}`;
}

// "pending" past its expiry reads as "expired" without needing a sweep job.
function effectiveStatus(req: { status: string; expiresAt: Date }): string {
  if (req.status === 'pending' && req.expiresAt.getTime() < Date.now()) return 'expired';
  return req.status;
}

/** "yingliu2024" → "yi•••••••24"; short names mask everything but the first char. */
export function maskUsername(username: string): string {
  if (username.length <= 3) return `${username[0] ?? ''}•••`;
  const head = username.slice(0, 2);
  const tail = username.length >= 8 ? username.slice(-1) : '';
  return `${head}${'•'.repeat(Math.min(username.length - head.length - tail.length, 8))}${tail}`;
}

async function sendRequestEmail(params: {
  email: string;
  firstName: string;
  usernameOnFile: string;
  lastChecked: Date | null;
  rawToken: string;
}) {
  const html = renderProviderActionEmail({
    previewText: 'The CAQH login we have for you needs a quick update.',
    heading: 'Your CAQH login needs a quick update',
    firstName: params.firstName,
    paragraphs: [
      'We keep your credentialing on track by syncing your CAQH ProView profile. When we last checked, the login we have on file did not work, so your sync is paused.',
      'Fixing it takes under a minute: confirm your username, enter your current CAQH password on our secure page, and we will take it from there.',
    ],
    facts: [
      { label: 'CAQH username', value: maskUsername(params.usernameOnFile) },
      {
        label: 'Last successful check',
        value: params.lastChecked
          ? params.lastChecked.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
          : 'Never verified',
      },
    ],
    factsNote: 'Username partly hidden for your security. The full username appears on the secure page.',
    cta: { label: 'Update CAQH login', url: updateUrl(params.rawToken) },
    secondaryLink: {
      label: 'Forgot your CAQH password? Reset it at CAQH ProView first.',
      url: 'https://proview.caqh.org/Login',
    },
    reassurance: `This link works once and expires in ${REQUEST_TTL_DAYS} days. After you submit, we re-check your CAQH connection automatically. We never show or email your password.`,
    supportSubject: 'Help with my CAQH login update',
  });

  const result = await emailService.sendEmail({
    to: params.email,
    subject: 'Your CAQH login needs a quick update',
    html,
    // Reuses an existing NotificationType exactly like the CAQH nudge emails do
    // (caqh-import.service) — the email-log table rejects invented values.
    notificationType: 'enrollment_follow_up',
  });
  if (!result.success) {
    logger.error('Failed to send CAQH credential request email', { error: result.error });
    throw new Error('EMAIL_SEND_FAILED');
  }
}

/**
 * Create a request (or rotate the pending one) and email the provider.
 * Throws NO_EMAIL if the provider has no email on file, NO_CREDENTIALS if
 * there's no saved username to correct.
 */
export async function createCredentialRequest(providerId: string, requestedById?: string | null) {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      firstName: true,
      email: true,
      caqhUsername: true,
      caqhCredentialsLastChecked: true,
    },
  });
  if (!provider) throw new Error('PROVIDER_NOT_FOUND');
  if (!provider.email) throw new Error('NO_EMAIL');
  if (!provider.caqhUsername) throw new Error('NO_CREDENTIALS');

  const rawToken = randomBytes(32).toString('hex');
  const existing = await prisma.caqhCredentialRequest.findFirst({
    where: { providerId, status: 'pending' },
    select: { id: true },
  });

  // Re-send rotates the pending request's token and refreshes the deadline;
  // the previous link stops working (only the hash is stored).
  const request = existing
    ? await prisma.caqhCredentialRequest.update({
        where: { id: existing.id },
        data: { tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + TTL_MS), requestedById: requestedById ?? null },
        select: { id: true, status: true, expiresAt: true },
      })
    : await prisma.caqhCredentialRequest.create({
        data: {
          providerId,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + TTL_MS),
          requestedById: requestedById ?? null,
        },
        select: { id: true, status: true, expiresAt: true },
      });

  await sendRequestEmail({
    email: provider.email,
    firstName: provider.firstName,
    usernameOnFile: provider.caqhUsername,
    lastChecked: provider.caqhCredentialsLastChecked,
    rawToken,
  });

  return { ...request, resent: !!existing };
}

/** Public token lookup: minimal detail for rendering the update form. */
export async function getRequestByToken(rawToken: string) {
  const request = await prisma.caqhCredentialRequest.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      provider: { select: { firstName: true, caqhUsername: true } },
    },
  });
  if (!request) return null;
  return {
    status: effectiveStatus(request),
    firstName: request.provider.firstName,
    usernameOnFile: request.provider.caqhUsername ?? '',
  };
}

/**
 * Public completion: saves the corrected credentials (encrypted, validity flags
 * reset by saveCredentials), consumes the token, then fires an async re-verify
 * whose outcome lands as an in-app notification for staff.
 */
export async function completeCredentialRequest(rawToken: string, username: string, password: string) {
  const request = await prisma.caqhCredentialRequest.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, status: true, expiresAt: true, providerId: true, provider: { select: { firstName: true, lastName: true } } },
  });
  if (!request) throw new Error('NOT_FOUND');
  const status = effectiveStatus(request);
  if (status === 'completed') throw new Error('ALREADY_USED');
  if (status === 'revoked') throw new Error('REVOKED');
  if (status === 'expired') {
    await prisma.caqhCredentialRequest.update({ where: { id: request.id }, data: { status: 'expired' } });
    throw new Error('EXPIRED');
  }

  await caqhCredentialsService.saveCredentials(request.providerId, username, password);
  await prisma.caqhCredentialRequest.update({
    where: { id: request.id },
    data: { status: 'completed', completedAt: new Date() },
  });

  const providerName = `${request.provider.firstName} ${request.provider.lastName}`;
  // Fire-and-forget: the provider's submit must not wait on a ~15s Puppeteer run.
  caqhCredentialsService
    .verifyAndUpdateProvider(request.providerId)
    .then((result) =>
      notificationService.notifyAdminUsers({
        type: 'caqh_credentials_updated',
        title: 'Provider updated their CAQH login',
        message: result.valid
          ? `${providerName} submitted a new CAQH login and it verified successfully.`
          : `${providerName} submitted a new CAQH login but verification still failed (${result.message}). You may need to follow up directly.`,
        actionUrl: `/providers/${request.providerId}`,
        metadata: { providerId: request.providerId, verified: result.valid },
      })
    )
    .catch((err: unknown) => logger.error('Post-submit CAQH re-verify failed:', err));

  return { providerId: request.providerId };
}
