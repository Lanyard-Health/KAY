/**
 * aetna-review.service — human-in-the-loop review lifecycle for Aetna RFP runs.
 *
 * A run launched here executes INLINE (not via the BullMQ queue — dev has no
 * Redis; see Task "Enable background jobs…") and keeps the Playwright session
 * alive while a human reviews per-page screenshots:
 *
 *   launch  → EnrollmentRun FILLING → adapter fills all pages, screenshotting
 *             each → AWAITING_REVIEW (browser kept open, Request ID captured)
 *   approve → adapter clicks "Submit request for participation" → SUBMITTED,
 *             confirmation number → externalReference, confirmation page
 *             archived as a provider Document
 *   reject  → browser closed, run CANCELLED with the reviewer's reason
 *
 * Sessions time out after REVIEW_TTL_MS: the browser is closed and the run is
 * marked FAILED with a clear "review window expired" error. (The Aetna wizard
 * itself will also expire the session server-side eventually — a stale approve
 * would fail loudly, never silently.)
 */
import type { Browser, BrowserContext, Page } from 'playwright';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { AetnaRfpAdapter, getRfpStartUrl, type AetnaRfpProviderData } from '../agents/portal/aetna-rfp-adapter.js';
import { buildAetnaRfpProviderData } from '../agents/portal/aetna-rfp-resolver.js';
import { launchBrowser, uploadToS3 } from '../agents/portal/playwright-base-adapter.js';

const REVIEW_TTL_MS = 25 * 60 * 1000; // Aetna's own session lives ~30 min

export interface AetnaScreenArtifact {
  label: string;
  s3Key: string;
}

interface ReviewSession {
  runId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  adapter: AetnaRfpAdapter;
  data: AetnaRfpProviderData;
  timer: NodeJS.Timeout;
}

const sessions = new Map<string, ReviewSession>();

async function closeSession(session: ReviewSession): Promise<void> {
  clearTimeout(session.timer);
  sessions.delete(session.runId);
  await session.browser.close().catch(() => undefined);
}

/** Launch a review run. Creates the EnrollmentRun synchronously and fills the
 * form in the background; callers poll the run for status. */
export async function launchAetnaReviewRun(args: {
  enrollmentId: string;
  providerId: string;
  practiceId: string;
  payerId: string;
  triggeredBy?: string;
}): Promise<{ runId: string }> {
  // Verify the RFP target is explicitly configured (mock URL or deliberate
  // live opt-in) so a forgotten env var surfaces here as a clear API error
  // instead of an accidental live submission. Throws with a 4xx-worthy message.
  try {
    getRfpStartUrl();
  } catch (err) {
    throw Object.assign(err as Error, { statusCode: 409 });
  }

  // Resolve the packet FIRST — fail-closed before any run row or footprint.
  const data = await buildAetnaRfpProviderData(
    { providerId: args.providerId, practiceId: args.practiceId, payerId: args.payerId },
    prisma
  );

  const run = await prisma.enrollmentRun.create({
    data: {
      enrollmentId: args.enrollmentId,
      status: 'FILLING',
      triggeredBy: args.triggeredBy ?? null,
    },
  });

  void fillInBackground(run.id, data).catch((err) => {
    logger.error('aetna-review: unexpected fill failure', { runId: run.id, error: err });
  });

  return { runId: run.id };
}

async function fillInBackground(runId: string, data: AetnaRfpProviderData): Promise<void> {
  const screens: AetnaScreenArtifact[] = [];
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
    const page = await context.newPage();
    const adapter = new AetnaRfpAdapter();

    adapter.onStepScreenshot = async (p, label) => {
      const buf = await p.screenshot({ fullPage: true });
      const s3Key = `submissions/${runId}/${label}.png`;
      await uploadToS3(s3Key, buf, 'image/png');
      screens.push({ label, s3Key });
    };

    await adapter.openForReview(page);
    const { requestId } = await adapter.fillForReview(page, data);

    const session: ReviewSession = {
      runId,
      browser,
      context,
      page,
      adapter,
      data,
      timer: setTimeout(() => void expireSession(runId), REVIEW_TTL_MS),
    };
    sessions.set(runId, session);

    await prisma.enrollmentRun.update({
      where: { id: runId },
      data: {
        status: 'AWAITING_REVIEW',
        externalReference: requestId,
        filledArtifacts: { kind: 'AETNA_SCREENS', screens } as object,
      },
    });
    logger.info('aetna-review: run awaiting review', { runId, requestId });
  } catch (err) {
    if (browser) await browser.close().catch(() => undefined);
    sessions.delete(runId);
    const message = err instanceof Error ? err.message : 'unknown error';
    await prisma.enrollmentRun
      .update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          filledArtifacts: { kind: 'AETNA_SCREENS', screens } as object,
          errorDetails: { message } as object,
        },
      })
      .catch(() => undefined);
    logger.error('aetna-review: fill failed', { runId, error: message });
  }
}

async function expireSession(runId: string): Promise<void> {
  const session = sessions.get(runId);
  if (!session) return;
  await closeSession(session);
  await prisma.enrollmentRun
    .updateMany({
      where: { id: runId, status: 'AWAITING_REVIEW' },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorDetails: {
          message:
            'Review window expired (25 min) before approval — the Aetna session was closed. Launch a new run.',
        } as object,
      },
    })
    .catch(() => undefined);
  logger.warn('aetna-review: session expired', { runId });
}

/** Approve: perform the final submit, capture the confirmation, archive it. */
export async function approveAetnaRun(
  runId: string,
  reviewerId?: string
): Promise<{ requestId: string | null; confirmationNumber: string | null }> {
  const session = sessions.get(runId);
  if (!session) {
    throw Object.assign(
      new Error(
        'No live review session for this run — it may have expired or the server restarted. Launch a new run.'
      ),
      { statusCode: 409 }
    );
  }
  const run = await prisma.enrollmentRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== 'AWAITING_REVIEW') {
    throw Object.assign(new Error(`Run is not awaiting review (status: ${run?.status ?? 'missing'})`), {
      statusCode: 409,
    });
  }

  await prisma.enrollmentRun.update({
    where: { id: runId },
    data: { status: 'SUBMITTING', reviewedAt: new Date() },
  });

  try {
    const { requestId, confirmationNumber } = await session.adapter.approveAndSubmit(session.page);

    // Archive the confirmation page (PDF preferred, PNG fallback) as a
    // provider Document so it lives with the enrollment paper trail.
    let confirmationKey: string | null = null;
    let confirmationMime = 'application/pdf';
    let confirmationBytes: Buffer | null = null;
    try {
      confirmationBytes = await session.page.pdf({ format: 'Letter' });
      confirmationKey = `submissions/${runId}/aetna-confirmation.pdf`;
    } catch {
      confirmationBytes = await session.page.screenshot({ fullPage: true });
      confirmationKey = `submissions/${runId}/aetna-confirmation.png`;
      confirmationMime = 'image/png';
    }
    await uploadToS3(confirmationKey, confirmationBytes, confirmationMime);

    const enrollment = await prisma.enrollment.findUnique({
      where: { id: run.enrollmentId },
      select: { providerId: true, practiceId: true },
    });
    if (enrollment) {
      const fileName = confirmationKey.split('/').pop()!;
      await prisma.document.create({
        data: {
          providerId: enrollment.providerId,
          practiceId: enrollment.practiceId,
          fileName,
          originalFileName: fileName,
          fileSize: confirmationBytes.length,
          mimeType: confirmationMime,
          s3Key: confirmationKey,
          documentType: 'other',
          description: `Aetna RFP submission confirmation${
            confirmationNumber || requestId ? ` (Request ID ${confirmationNumber ?? requestId})` : ''
          }`,
        },
      });
    }

    const reference = confirmationNumber ?? requestId ?? null;
    await prisma.enrollmentRun.update({
      where: { id: runId },
      data: {
        status: reference ? 'SUBMITTED' : 'NEEDS_REVIEW',
        submittedAt: new Date(),
        completedAt: new Date(),
        externalReference: reference ?? run.externalReference,
        confirmationNumber: confirmationNumber ?? null,
        filledArtifacts: appendScreen(run.filledArtifacts, {
          label: '10-confirmation-archive',
          s3Key: confirmationKey,
        }),
      },
    });

    // Reflect the submission on the parent enrollment: stamp the application
    // date (first submission wins) and the payer tracking ID.
    if (reference) {
      const enrollment = await prisma.enrollment.findUnique({
        where: { id: run.enrollmentId },
        select: { applicationDate: true },
      });
      await prisma.enrollment.update({
        where: { id: run.enrollmentId },
        data: {
          applicationDate: enrollment?.applicationDate ?? new Date(),
          confirmationNumber: reference,
        },
      });
    }

    logger.info('aetna-review: approved and submitted', {
      runId,
      requestId,
      confirmationNumber,
      reviewerId,
    });
    return { requestId, confirmationNumber };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    await prisma.enrollmentRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorDetails: { message: `Final submit failed: ${message}` } as object,
      },
    });
    throw err;
  } finally {
    await closeSession(session);
  }
}

/** Reject: close the browser without submitting; record the reason. */
export async function rejectAetnaRun(runId: string, reason: string, reviewerId?: string): Promise<void> {
  const session = sessions.get(runId);
  if (session) await closeSession(session);

  const updated = await prisma.enrollmentRun.updateMany({
    where: { id: runId, status: { in: ['AWAITING_REVIEW', 'FILLING'] } },
    data: {
      status: 'CANCELLED',
      reviewedAt: new Date(),
      completedAt: new Date(),
      errorDetails: { message: `Rejected by reviewer: ${reason}` } as object,
    },
  });
  if (updated.count === 0) {
    throw Object.assign(new Error('Run is not in a reviewable state'), { statusCode: 409 });
  }
  logger.info('aetna-review: rejected', { runId, reason, reviewerId });
}

/** Whether a live (approvable) browser session exists for a run. */
export function hasLiveSession(runId: string): boolean {
  return sessions.has(runId);
}

function appendScreen(existing: unknown, screen: AetnaScreenArtifact): object {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as { kind?: string; screens?: AetnaScreenArtifact[] })
      : {};
  return {
    kind: 'AETNA_SCREENS',
    screens: [...(base.screens ?? []), screen],
  };
}
