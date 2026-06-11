import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { CaqhService } from './caqh.service.js';
import { importCaqhDocuments } from './caqh-document-import.service.js';
import { emailService } from './email.service.js';
import { notificationService } from './notification.service.js';
import {
  enqueueCaqhImport,
  MAX_CAQH_IMPORT_RECHECKS,
  type CaqhImportJobData,
} from '../queues/caqh-import.queue.js';
import type { CaqhImportStatus } from '@prisma/client';

const RECHECK_DELAY_MS = 24 * 60 * 60 * 1000; // re-poll waiting providers daily

// Lazy — avoids a module-load-time CaqhService construction (route tests pin
// the first constructed instance).
let caqhServiceInstance: CaqhService | null = null;
function getCaqhService(): CaqhService {
  if (!caqhServiceInstance) caqhServiceInstance = new CaqhService();
  return caqhServiceInstance;
}

type WaitingReason = 'waiting_authorization' | 'waiting_attestation';

async function setImportStatus(
  providerId: string,
  status: CaqhImportStatus,
  error?: string
): Promise<void> {
  await prisma.providerProfile.update({
    where: { id: providerId },
    data: {
      caqhImportStatus: status,
      caqhImportError: error ?? null,
      caqhImportUpdatedAt: new Date(),
    },
  });
}

/**
 * Plain-English nudge emails for the two real-world blockers (per Kay 2026-06-11:
 * the common one is a provider who has never attested; specific-orgs-only
 * authorization is rare but possible). Copy must tell the provider exactly what
 * to do in CAQH — not mention rosters, APIs, or sync jobs.
 */
function waitingEmailContent(
  reason: WaitingReason,
  firstName: string
): { subject: string; html: string } {
  if (reason === 'waiting_attestation') {
    return {
      subject: 'Action needed: complete your CAQH attestation',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0A3D2E;">One step left to import your CAQH profile</h2>
          <p>Dear ${firstName},</p>
          <p>We tried to import your professional profile from CAQH, but your CAQH profile
          hasn't been attested yet. CAQH only releases your information after you review
          and attest to it.</p>
          <p><strong>What to do:</strong> log in at
          <a href="https://proview.caqh.org">proview.caqh.org</a>, review your profile,
          and click <strong>Attest</strong>. That's it — we check daily and will import
          your licenses, work history, and documents automatically once you've attested.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #6b7280; font-size: 12px;">
            This is an automated notification from Lanyard Health. Please do not reply to this email.
          </p>
        </div>
      `,
    };
  }
  return {
    subject: 'Action needed: authorize Lanyard Health in CAQH',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0A3D2E;">One step left to import your CAQH profile</h2>
        <p>Dear ${firstName},</p>
        <p>We tried to import your professional profile from CAQH, but your CAQH account is
        set to share your information with specific organizations only, and Lanyard Health
        isn't on that list yet.</p>
        <p><strong>What to do:</strong> log in at
        <a href="https://proview.caqh.org">proview.caqh.org</a>, go to
        <strong>Authorize</strong>, and either select "All healthcare organizations" or add
        <strong>Lanyard Health</strong> to your authorized list. We check daily and will
        import your profile automatically once access is granted.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="color: #6b7280; font-size: 12px;">
          This is an automated notification from Lanyard Health. Please do not reply to this email.
        </p>
      </div>
    `,
  };
}

/**
 * Park the provider in a waiting_* state, nudge them by email (only on the
 * transition into the state — daily rechecks must not re-spam), and schedule
 * the next re-poll. After MAX_CAQH_IMPORT_RECHECKS unanswered polls, give up
 * and alert admins.
 */
async function parkInWaitingState(params: {
  providerId: string;
  providerEmail: string;
  providerFirstName: string;
  previousStatus: CaqhImportStatus | null;
  reason: WaitingReason;
  recheckCount: number;
}): Promise<void> {
  const { providerId, reason, recheckCount } = params;

  if (recheckCount >= MAX_CAQH_IMPORT_RECHECKS) {
    await setImportStatus(
      providerId,
      'failed',
      `Gave up after ${recheckCount} daily re-checks in ${reason} state — provider has not acted in CAQH`
    );
    notificationService
      .notifyAdminUsers({
        type: 'caqh_import_stalled',
        title: 'CAQH import gave up waiting',
        message: `CAQH import for a provider stalled in "${reason.replace('_', ' ')}" for ${recheckCount} days and has been marked failed. Follow up with the provider directly.`,
        actionUrl: `/providers/${providerId}`,
        metadata: { providerId, reason, recheckCount },
      })
      .catch((err: unknown) => logger.error('Failed to notify admins of stalled CAQH import:', err));
    return;
  }

  await setImportStatus(providerId, reason);

  // Email only when entering the state — rechecks that find the same blocker stay quiet.
  if (params.previousStatus !== reason && emailService.isConfigured()) {
    const { subject, html } = waitingEmailContent(reason, params.providerFirstName);
    emailService
      .sendEmail({ to: params.providerEmail, subject, html, notificationType: `caqh_import_${reason}` })
      .catch((err: unknown) => logger.error('Failed to send CAQH waiting email:', err));
  }

  await enqueueCaqhImport({
    providerId,
    trigger: 'recheck',
    recheckCount: recheckCount + 1,
    delayMs: RECHECK_DELAY_MS,
  });
}

/**
 * The CAQH-first onboarding import job.
 *
 * Flow: roster-add if needed → status check → branch:
 *  - not authorized (specific-orgs-only)  → waiting_authorization + email + daily recheck
 *  - never attested (no attestation date) → waiting_attestation + email + daily recheck
 *  - otherwise                            → full profile sync (existing syncProvider)
 *
 * Unexpected errors (network, CAQH 5xx) are rethrown so BullMQ's retry/backoff
 * handles them; the status is left as failed-with-message in the meantime so the
 * UI never shows a stuck "in progress".
 */
export async function processCaqhImportJob(data: CaqhImportJobData): Promise<{
  outcome: 'completed' | WaitingReason | 'failed';
  syncId?: string;
}> {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: data.providerId },
    select: {
      id: true,
      email: true,
      firstName: true,
      caqhProviderId: true,
      caqhImportStatus: true,
    },
  });

  if (!provider) {
    logger.error('caqh-import: provider not found', { providerId: data.providerId });
    return { outcome: 'failed' };
  }
  if (!provider.caqhProviderId) {
    await setImportStatus(provider.id, 'failed', 'Provider has no CAQH Provider ID');
    return { outcome: 'failed' };
  }

  const previousStatus = provider.caqhImportStatus;
  await setImportStatus(provider.id, 'in_progress');

  try {
    let status = await getCaqhService().checkStatus(provider.caqhProviderId);

    // Step 1: make sure the provider is on our roster.
    if (status.roster_status === 'NOT ON ROSTER') {
      logger.info('caqh-import: adding provider to roster', { providerId: provider.id });
      await getCaqhService().addToRoster(provider.id);
      status = await getCaqhService().checkStatus(provider.caqhProviderId);
    }

    // Step 2: can we actually pull? Two known blockers, each with its own
    // provider-facing nudge (plan §PR2; authorization is the rare case,
    // missing attestation is the one we've hit 4× in real sync logs).
    if (status.authorization_flag === 'N') {
      await parkInWaitingState({
        providerId: provider.id,
        providerEmail: provider.email,
        providerFirstName: provider.firstName,
        previousStatus,
        reason: 'waiting_authorization',
        recheckCount: data.recheckCount,
      });
      return { outcome: 'waiting_authorization' };
    }

    const attestationDate = status.provider_status_date || status.anniversary_date;
    if (!attestationDate) {
      await parkInWaitingState({
        providerId: provider.id,
        providerEmail: provider.email,
        providerFirstName: provider.firstName,
        previousStatus,
        reason: 'waiting_attestation',
        recheckCount: data.recheckCount,
      });
      return { outcome: 'waiting_attestation' };
    }

    // Step 3: pull the full profile via the existing sync pipeline.
    const { syncId } = await getCaqhService().syncProvider(provider.id, provider.caqhProviderId);

    // Step 4: pull their actual documents into our document system. Non-fatal —
    // a document hiccup must not mark a successful profile import as failed;
    // failures are logged and re-runs are idempotent.
    try {
      const docSummary = await importCaqhDocuments(provider.id);
      logger.info('caqh-import: document ingestion summary', { providerId: provider.id, ...docSummary });
    } catch (docError) {
      logger.error('caqh-import: document ingestion failed (profile import unaffected)', {
        providerId: provider.id,
        error: docError instanceof Error ? docError.message : String(docError),
      });
    }

    await prisma.providerProfile.update({
      where: { id: provider.id },
      data: {
        caqhImportStatus: 'completed',
        caqhImportError: null,
        caqhImportUpdatedAt: new Date(),
        caqhLastSync: new Date(),
      },
    });

    logger.info('caqh-import: completed', { providerId: provider.id, syncId, trigger: data.trigger });
    return { outcome: 'completed', syncId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await setImportStatus(provider.id, 'failed', message.slice(0, 500)).catch((err: unknown) =>
      logger.error('caqh-import: failed to record failure status:', err)
    );
    // Rethrow so BullMQ retries transient failures (3 attempts, exponential backoff).
    throw error;
  }
}
