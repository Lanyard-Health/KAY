import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { CaqhService, CaqhDuplicateException, ProviderNotReadyForCaqhError } from './caqh.service.js';
import { renderProviderActionEmail } from './email-templates.js';
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

/**
 * Staff-facing labels for the roster resolver's missing-field codes (mirrors
 * the map in CaqhNotReadyModal.tsx). Unknown codes degrade to spaced lowercase
 * words, never raw snake_case.
 */
const MISSING_FIELD_LABELS: Record<string, string> = {
  practice_location_missing: 'a practice location',
  practiceState: 'a practice state',
  address1: 'a practice address line',
  city: 'a practice city',
  state: 'a practice state',
  zip: 'a practice ZIP code',
  npi: 'an NPI number',
  firstName: 'a first name',
  lastName: 'a last name',
  dateOfBirth: 'a date of birth',
  provider_not_found: 'a provider profile',
};

function humanizeMissingFields(codes: string[]): string {
  const labels = codes.map((code) => {
    if (MISSING_FIELD_LABELS[code]) return MISSING_FIELD_LABELS[code];
    if (code.startsWith('provider_type_')) return 'a recognized provider type or taxonomy';
    return code
      .replace(/\s*\(.*\)$/, '')
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .trim();
  });
  return [...new Set(labels)].join(', ');
}

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
 * to do in CAQH, never mention rosters, APIs, or sync jobs. Rendered through the
 * shared branded template (email-templates.ts).
 */
function waitingEmailContent(
  reason: WaitingReason,
  firstName: string
): { subject: string; html: string } {
  if (reason === 'waiting_attestation') {
    return {
      subject: 'Action needed: complete your CAQH attestation',
      html: renderProviderActionEmail({
        previewText: 'One step in CAQH ProView and we take care of the rest.',
        heading: 'One step left to import your CAQH profile',
        firstName,
        paragraphs: [
          'We tried to import your professional profile from CAQH, but your profile has not been attested yet. CAQH only releases your information after you review and attest to it.',
        ],
        steps: [
          'Log in to CAQH ProView',
          'Review your profile for accuracy',
          'Click Attest',
        ],
        cta: { label: 'Open CAQH ProView', url: 'https://proview.caqh.org' },
        reassurance:
          'We check once a day. As soon as you attest, your licenses, work history, and documents import automatically. Nothing else is needed from you.',
      }),
    };
  }
  return {
    subject: 'Action needed: authorize Lanyard Health in CAQH',
    html: renderProviderActionEmail({
      previewText: 'One step in CAQH ProView and we take care of the rest.',
      heading: 'One step left to import your CAQH profile',
      firstName,
      paragraphs: [
        'We tried to import your professional profile from CAQH, but your CAQH account currently shares information with specific organizations only, and Lanyard Health is not on that list yet.',
      ],
      steps: [
        'Log in to CAQH ProView',
        'Go to the Authorize section',
        'Select "All healthcare organizations", or add Lanyard Health to your list',
      ],
      cta: { label: 'Open CAQH ProView', url: 'https://proview.caqh.org' },
      reassurance:
        'We check once a day. As soon as access is granted, your profile imports automatically. Nothing else is needed from you.',
    }),
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
      // notificationType must be a valid NotificationType enum value — the email log
      // table rejects invented ones (staging finding 2026-06-11). These nudges are
      // follow-ups; the subject line distinguishes them in the log.
      .sendEmail({ to: params.providerEmail, subject, html, notificationType: 'enrollment_follow_up' })
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
      try {
        await getCaqhService().addToRoster(provider.id);
      } catch (error) {
        // CAQH's status endpoint can report NOT ON ROSTER for a provider we already
        // rostered (observed on demo: membership isn't reflected pre-attestation).
        // "Already on roster" means our goal is met — carry on, don't fail the import.
        if (error instanceof CaqhDuplicateException) {
          logger.info('caqh-import: provider already on roster — continuing', {
            providerId: provider.id,
          });
        } else {
          throw error;
        }
      }
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
    // An incomplete provider profile is an expected business outcome, not a
    // system failure: retries can't fix missing data, and a failed BullMQ job
    // pages Slack. Record a plain-English reason, tell admins in-app what to
    // add, and complete the job quietly.
    if (error instanceof ProviderNotReadyForCaqhError) {
      const missing = humanizeMissingFields(error.missingFields);
      await setImportStatus(
        provider.id,
        'failed',
        `Provider profile isn't complete enough for CAQH yet — missing: ${missing}.`.slice(0, 500)
      ).catch((err: unknown) => logger.error('caqh-import: failed to record failure status:', err));
      notificationService
        .notifyAdminUsers({
          type: 'caqh_import_stalled',
          title: 'CAQH import needs provider info',
          message: `A CAQH import couldn't start because the provider's profile is missing: ${missing}. Add the missing info on the provider page, then click Import from CAQH.`,
          actionUrl: `/providers/${provider.id}`,
          metadata: { providerId: provider.id, missingFields: error.missingFields, trigger: data.trigger },
        })
        .catch((err: unknown) => logger.error('caqh-import: failed to notify admins of not-ready provider:', err));
      logger.info('caqh-import: provider not roster-ready — parked without alerting', {
        providerId: provider.id,
        missingFields: error.missingFields,
        trigger: data.trigger,
      });
      return { outcome: 'failed' };
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    await setImportStatus(provider.id, 'failed', message.slice(0, 500)).catch((err: unknown) =>
      logger.error('caqh-import: failed to record failure status:', err)
    );
    // Rethrow so BullMQ retries transient failures (3 attempts, exponential backoff).
    throw error;
  }
}
