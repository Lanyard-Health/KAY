/// <reference lib="dom" />
import puppeteer, { Browser, Page } from 'puppeteer';
import { prisma } from '../../utils/prisma.js';
import { logger } from '../../utils/logger.js';
import type {
  PayerAdapter,
  SubmissionInput,
  ReadinessCheck,
  PayerAdapterResult,
} from './payer-adapter.js';

const MOCK_AVAILITY_BASE_URL =
  process.env['MOCK_AVAILITY_BASE_URL'] ?? 'http://localhost:3002/mock-availity';

// Demo mode controls — let the audience SEE the browser drive itself.
const HEADED = process.env['PUPPETEER_HEADED'] === 'true';
const SLOWMO_MS = parseInt(process.env['PUPPETEER_SLOWMO_MS'] ?? '0', 10);

// Concurrency: only one browser session at a time, modeled on
// caqh-credentials.service.ts — payer portal serialization protects against
// rate limits and login-conflict edge cases.
let activeBrowser = false;
const waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
const MAX_QUEUE_DEPTH = 3;
const QUEUE_TIMEOUT_MS = 60_000;

async function acquireLock(): Promise<void> {
  if (!activeBrowser) {
    activeBrowser = true;
    return;
  }
  if (waitQueue.length >= MAX_QUEUE_DEPTH) {
    throw new Error('Availity submission busy, try again later');
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waitQueue.findIndex((w) => w.resolve === resolve);
      if (idx !== -1) waitQueue.splice(idx, 1);
      reject(new Error('Availity submission timed out waiting for availability'));
    }, QUEUE_TIMEOUT_MS);
    waitQueue.push({
      resolve: () => { clearTimeout(timer); resolve(); },
      reject: (err: Error) => { clearTimeout(timer); reject(err); },
    });
  });
}

function releaseLock(): void {
  if (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    next.resolve();
  } else {
    activeBrowser = false;
  }
}

interface ProviderDataForSubmission {
  firstName: string;
  lastName: string;
  npi: string;
  taxonomy: string;
  licenseNumber: string;
  licenseState: string;
  licenseExpiration: string;
  practiceAddress: string;
  practiceCity: string;
  practiceState: string;
  practiceZip: string;
  practicePhone: string;
  specialty: string;
}

async function loadProviderData(providerId: string): Promise<ProviderDataForSubmission> {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: {
      firstName: true,
      lastName: true,
      npi: true,
      taxonomy: true,
      providerType: true,
      licenses: {
        where: { status: 'active' },
        select: { licenseNumber: true, state: true, expirationDate: true },
        orderBy: { expirationDate: 'desc' },
        take: 1,
      },
      practiceLocations: {
        where: { isPrimary: true },
        select: {
          addressLine1: true,
          city: true,
          state: true,
          zipCode: true,
          phone: true,
        },
        take: 1,
      },
    },
  });

  if (!provider) {
    throw new Error(`Provider ${providerId} not found`);
  }

  const license = provider.licenses[0];
  const location = provider.practiceLocations[0];

  return {
    firstName: provider.firstName,
    lastName: provider.lastName,
    npi: provider.npi ?? '',
    taxonomy: provider.taxonomy ?? '',
    licenseNumber: license?.licenseNumber ?? '',
    licenseState: license?.state ?? '',
    licenseExpiration: license?.expirationDate?.toISOString().slice(0, 10) ?? '',
    practiceAddress: location?.addressLine1 ?? '',
    practiceCity: location?.city ?? '',
    practiceState: location?.state ?? '',
    practiceZip: location?.zipCode ?? '',
    practicePhone: location?.phone ?? '',
    specialty: provider.providerType ?? '',
  };
}

export class AvailityAdapter implements PayerAdapter {
  readonly adapterType = 'availity_demo';

  async checkReadiness(input: SubmissionInput): Promise<ReadinessCheck> {
    const provider = await prisma.providerProfile.findUnique({
      where: { id: input.providerId },
      select: {
        npi: true,
        firstName: true,
        lastName: true,
        licenses: { where: { status: 'active' }, select: { id: true }, take: 1 },
      },
    });

    const missingFields: string[] = [];
    const warnings: string[] = [];

    if (!provider) {
      return { ready: false, missingFields: ['provider'], warnings: ['Provider not found'] };
    }
    if (!provider.npi) missingFields.push('npi');
    if (!provider.firstName) missingFields.push('firstName');
    if (!provider.lastName) missingFields.push('lastName');
    if (provider.licenses.length === 0) missingFields.push('active_license');

    if (HEADED) {
      warnings.push('Headed-browser demo mode is enabled (PUPPETEER_HEADED=true).');
    }

    return {
      ready: missingFields.length === 0,
      missingFields,
      warnings,
    };
  }

  async submit(input: SubmissionInput): Promise<PayerAdapterResult> {
    await acquireLock();
    let browser: Browser | null = null;

    try {
      const providerData = await loadProviderData(input.providerId);
      const credentials = (input.credentials ?? {}) as { username?: string; password?: string };
      const username = credentials.username ?? 'demo';
      const password = credentials.password ?? 'demo123';

      logger.info('Launching Availity demo browser submission', {
        workflowId: input.workflowId,
        providerId: input.providerId,
        headed: HEADED,
      });

      browser = await puppeteer.launch({
        headless: !HEADED,
        slowMo: SLOWMO_MS,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          // Suppress Chrome's "Save password?" / autofill / translate bubbles
          // that block the demo flow when running headed.
          '--disable-features=PasswordManagerOnboarding,PasswordCheck,Translate,AutofillServerCommunication,SafeBrowsingEnhancedProtection',
          '--disable-save-password-bubble',
          '--disable-translate',
          '--password-store=basic',
          '--use-mock-keychain',
          '--no-default-browser-check',
          '--no-first-run',
        ],
        defaultViewport: null,
      });

      // Belt-and-suspenders: clear any permissions the Chrome profile may
      // have inherited; cuts off password-manager / autofill prompts the
      // launch flags don't always suppress on certain Chrome builds.
      try {
        const context = browser.defaultBrowserContext();
        await context.clearPermissionOverrides?.();
      } catch { /* swallow */ }

      const page: Page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 820 });

      // Defensive: auto-dismiss any browser-level dialogs (alert/confirm/prompt)
      // so an unexpected popup never hangs the demo.
      page.on('dialog', async (dialog) => {
        logger.info('Auto-dismissing browser dialog during Availity demo', {
          type: dialog.type(),
          message: dialog.message(),
        });
        try { await dialog.dismiss(); } catch { /* swallow */ }
      });

      // Step 1 — login
      await page.goto(`${MOCK_AVAILITY_BASE_URL}/login.html`, {
        waitUntil: 'networkidle2',
        timeout: 15_000,
      });
      await page.waitForSelector('#username', { timeout: 5_000 });
      await page.type('#username', username, { delay: 40 });
      await page.type('#password', password, { delay: 40 });
      await Promise.all([
        page.click('#login-button'),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10_000 }),
      ]);

      // Step 2 — dashboard → click "Submit New Enrollment"
      await page.waitForSelector('#submit-enrollment-button', { timeout: 5_000 });
      await Promise.all([
        page.click('#submit-enrollment-button'),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10_000 }),
      ]);

      // Step 3 — fill the enrollment form
      await page.waitForSelector('#firstName', { timeout: 5_000 });
      await typeIfPresent(page, '#firstName', providerData.firstName);
      await typeIfPresent(page, '#lastName', providerData.lastName);
      await typeIfPresent(page, '#npi', providerData.npi);
      await typeIfPresent(page, '#taxonomyCode', providerData.taxonomy);
      await typeIfPresent(page, '#licenseNumber', providerData.licenseNumber);
      await typeIfPresent(page, '#licenseState', providerData.licenseState);
      await typeIfPresent(page, '#licenseExpiration', providerData.licenseExpiration);
      await typeIfPresent(page, '#practiceAddress', providerData.practiceAddress);
      await typeIfPresent(page, '#practiceCity', providerData.practiceCity);
      await typeIfPresent(page, '#practiceState', providerData.practiceState);
      await typeIfPresent(page, '#practiceZip', providerData.practiceZip);
      await typeIfPresent(page, '#practicePhone', providerData.practicePhone);
      await typeIfPresent(page, '#specialty', providerData.specialty);

      // Step 4 — submit and wait for the confirmation page
      await Promise.all([
        page.click('#submit-button'),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10_000 }),
      ]);
      await page.waitForSelector('#confirmation-number', { timeout: 5_000 });
      const confirmationNumber = await page.$eval(
        '#confirmation-number',
        (el) => el.textContent?.trim() ?? '',
      );
      const submittedAt = await page.$eval(
        '#submitted-at',
        (el) => el.textContent?.trim() ?? '',
      );

      logger.info('Availity demo submission completed', {
        workflowId: input.workflowId,
        confirmationNumber,
      });

      return {
        success: true,
        submissionId: confirmationNumber,
        confirmationNumber,
        details: {
          providerName: `${providerData.firstName} ${providerData.lastName}`,
          npi: providerData.npi,
          submittedAt,
          mockEnvironment: true,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Availity demo submission failed', {
        workflowId: input.workflowId,
        error: message,
      });
      return { success: false, error: message };
    } finally {
      if (browser) {
        try { await browser.close(); } catch { /* swallow */ }
      }
      releaseLock();
    }
  }
}

async function typeIfPresent(page: Page, selector: string, value: string): Promise<void> {
  if (!value) return;
  const el = await page.$(selector);
  if (!el) return;
  await page.type(selector, value, { delay: 25 });
}
