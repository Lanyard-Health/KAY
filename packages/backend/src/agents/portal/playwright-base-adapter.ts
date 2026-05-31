import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '../../utils/logger.js';
import type {
  SubmissionPortalAdapter,
  SubmissionAdapterInput,
  SubmissionResult,
} from './submission-adapter.js';
import type { AdapterType } from '@prisma/client';
import type { ResolvedCredential } from '../../services/credential.service.js';

/**
 * PlaywrightBaseAdapter — abstract parent for every Playwright-driven payer
 * portal adapter. Provides browser lifecycle, pre/post screenshot capture,
 * timeout enforcement, and portal-level error detection so concrete adapters
 * only need to implement the payer-specific navigation flow.
 *
 * Concrete adapters override `executeSubmission()` and receive a logged-in
 * Page-like context. They must NOT touch credentials directly — credentials
 * are passed in as `ResolvedCredential` and consumed inside this base class
 * (login flow is delegated via the abstract login() method).
 *
 * Hard timeout: each submission is capped at SUBMISSION_TIMEOUT_MS. If the
 * concrete adapter blocks past that, the run is aborted and FAILED.
 */
const SUBMISSION_TIMEOUT_MS = 5 * 60 * 1000;

export interface PlaywrightSubmissionContext {
  page: Page;
  input: SubmissionAdapterInput;
}

export abstract class PlaywrightBaseAdapter implements SubmissionPortalAdapter {
  abstract readonly adapterType: AdapterType;

  /**
   * Subclasses implement the payer-specific login flow. The base class
   * supplies a fresh, isolated browser context.
   */
  protected abstract login(
    ctx: PlaywrightSubmissionContext,
    credential: ResolvedCredential
  ): Promise<void>;

  /**
   * Subclasses implement the actual submission steps (navigate to form,
   * fill fields, click submit, wait for confirmation page).
   */
  protected abstract executeSubmission(
    ctx: PlaywrightSubmissionContext
  ): Promise<{
    confirmationNumber?: string;
    externalReference?: string;
    rawResponseText?: string;
  }>;

  async submit(
    input: SubmissionAdapterInput,
    credential: ResolvedCredential
  ): Promise<SubmissionResult> {
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let preScreenshotKey: string | undefined;
    let postScreenshotKey: string | undefined;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Submission exceeded ${SUBMISSION_TIMEOUT_MS}ms timeout`)),
        SUBMISSION_TIMEOUT_MS
      )
    );

    try {
      const work = (async () => {
        browser = await launchBrowser();
        context = await browser.newContext();
        const page: Page = await context.newPage();

        // Intercept network responses to capture confirmation numbers many
        // payer portals emit only via JSON or redirect — concrete adapters
        // can read this via `page.on('response', ...)` themselves.

        const ctx: PlaywrightSubmissionContext = { page, input };

        await this.login(ctx, credential);

        preScreenshotKey = await this.captureScreenshot(
          page,
          input.enrollmentRunId,
          'pre'
        );

        const portalError = await this.detectPortalError(page);
        if (portalError) {
          throw new Error(`Portal error detected before submission: ${portalError}`);
        }

        const result = await this.executeSubmission(ctx);

        postScreenshotKey = await this.captureScreenshot(
          page,
          input.enrollmentRunId,
          'post'
        );

        return result;
      })();

      const result = await Promise.race([work, timeoutPromise]);

      return {
        success: true,
        confirmationNumber: result.confirmationNumber,
        externalReference: result.externalReference,
        rawResponseText: result.rawResponseText,
        preScreenshotKey,
        postScreenshotKey,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Try to capture a post-failure screenshot — best-effort.
      if (context) {
        try {
          const pages = context.pages();
          if (pages.length > 0) {
            postScreenshotKey = await this.captureScreenshot(
              pages[0]!,
              input.enrollmentRunId,
              'post-failure'
            );
          }
        } catch (screenshotErr) {
          logger.warn('PlaywrightBaseAdapter: failure-screenshot capture failed', {
            enrollmentRunId: input.enrollmentRunId,
            error: screenshotErr instanceof Error ? screenshotErr.message : 'unknown',
          });
        }
      }

      logger.error('PlaywrightBaseAdapter: submission failed', {
        enrollmentRunId: input.enrollmentRunId,
        adapterType: this.adapterType,
        error: errorMessage,
      });

      return {
        success: false,
        errorMessage,
        preScreenshotKey,
        postScreenshotKey,
      };
    } finally {
      if (context) {
        await context.close().catch(() => undefined);
      }
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  /**
   * Inspects the page for common portal-level error indicators (banner text,
   * known error selectors, session-timeout messages). Concrete adapters may
   * override to add payer-specific detection.
   *
   * Returns the error message if found, or null.
   */
  protected async detectPortalError(page: Page): Promise<string | null> {
    const SELECTORS = [
      '[role="alert"]',
      '.alert-danger',
      '.error-message',
      '[data-testid="error-banner"]',
    ];
    for (const sel of SELECTORS) {
      try {
        const el = await page.$(sel);
        if (!el) continue;
        const text = (await el.textContent())?.trim();
        if (text && text.length > 0) return text;
      } catch {
        // selector lookup failed — keep trying others
      }
    }
    return null;
  }

  /**
   * Capture a screenshot and upload it to S3 under
   *   submissions/{enrollmentRunId}/{label}.png
   *
   * Returns the S3 key (not a URL — signing happens at read time).
   */
  protected async captureScreenshot(
    page: Page,
    enrollmentRunId: string,
    label: string
  ): Promise<string> {
    const bytes = await page.screenshot({ fullPage: true, type: 'png' });
    const key = `submissions/${enrollmentRunId}/${label}.png`;
    await uploadToS3(key, bytes, 'image/png');
    return key;
  }
}

// ─── S3 helper (singleton client) ───────────────────────────────────────

let s3ClientSingleton: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3ClientSingleton) return s3ClientSingleton;
  const s3Endpoint = process.env['S3_ENDPOINT'];
  s3ClientSingleton = new S3Client({
    region: process.env['AWS_REGION'] || 'us-east-1',
    ...(s3Endpoint && { endpoint: s3Endpoint, forcePathStyle: true }),
    ...(process.env['AWS_ACCESS_KEY_ID'] && {
      credentials: {
        accessKeyId: process.env['AWS_ACCESS_KEY_ID']!,
        secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] || '',
      },
    }),
  });
  return s3ClientSingleton;
}

async function uploadToS3(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const bucket = process.env['S3_BUCKET_NAME'] || 'credentials-documents';
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(body),
      ContentType: contentType,
    })
  );
}

// ─── Browser launch ─────────────────────────────────────────────────────

async function launchBrowser(): Promise<Browser> {
  const headless = process.env['NODE_ENV'] === 'production' || process.env['CI'] === 'true';
  return chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}
