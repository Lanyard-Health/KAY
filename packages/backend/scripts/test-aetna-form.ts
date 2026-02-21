/**
 * Live dry-run test for the Aetna form filler.
 *
 * Launches a visible Chromium browser, navigates to the real Aetna portal,
 * and runs fillAetnaForm() with sample data so you can watch it work.
 * Does NOT submit — holds at page 10 for review.
 *
 * Usage:
 *   cd packages/backend
 *   npx tsx scripts/test-aetna-form.ts
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapProviderToAetnaPayload } from '../src/services/aetna/field-mapper.js';
import { fillAetnaForm } from '../src/services/aetna/form-filler.js';
import type { AetnaProviderData } from '../src/services/aetna/types.js';

// ── Sample provider data (mirrors makeFullProvider from readiness tests) ──

const sampleProviderData: AetnaProviderData = {
  provider: {
    id: 'test-provider-1',
    npi: '1588667638',
    firstName: 'Jane',
    lastName: 'Doe',
    middleName: 'M',
    dateOfBirth: new Date(1980, 4, 15),
    gender: 'female',
    email: 'jane.doe@testpractice.com',
    phone: '555-123-4567',
    fax: '555-123-4568',
    providerType: 'psychiatrist',
    specialties: ['Internal Medicine'],
    languages: ['English'],
    caqhProviderId: '14587321',
    acceptingMedicare: true,
    acceptingMedicaid: false,
    ePrescribing: true,
    ssnEncrypted: null,
  },
  practice: {
    id: 'test-practice-1',
    name: 'Hartford Behavioral Health Group',
    phone: '555-999-0000',
    email: 'office@hbhg.com',
    website: 'https://hbhg.com',
  },
  primaryLocation: {
    addressLine1: '123 Main St',
    addressLine2: 'Suite 200',
    city: 'Hartford',
    state: 'CT',
    zipCode: '06101',
    county: 'Hartford',
    phone: '555-111-2222',
    fax: '555-111-2223',
    taxId: '33-2533352',
    groupNpi: '9876543210',
    acceptingNewPatients: true,
    languagesSpoken: ['English'],
    officeHours: null,
    billingAddressLine1: null,
    billingCity: null,
    billingState: null,
    billingZipCode: null,
  },
  primaryLicense: {
    licenseNumber: 'MD-12345',
    state: 'CT',
    expirationDate: new Date('2027-12-31'),
  },
  education: {
    degree: 'MD',
  },
  hospitalAffiliations: [],
  submitter: {
    firstName: 'Sarah',
    lastName: 'Johnson',
    email: 'sarah.johnson@hbhg.com',
    phone: '555-888-9999',
  },
  aetnaOverrides: {
    existingAetnaProvider: false,
    networkJoining: 'As a new individual provider',
    applicableSituation: 'I want to be contracted in the state selected below',
    providerClassification: 'Specialist',
    workingDays: 'WEEKDAYS ONLY (MONDAY-FRIDAY)',
  },
};

// ── Main ──

const SCREENSHOT_DIR = join(import.meta.dirname ?? '.', 'aetna-screenshots');

async function main() {
  // Build payload
  console.log('Building AetnaFormPayload from sample provider data...');
  const payload = mapProviderToAetnaPayload(sampleProviderData);
  console.log('Payload built. Pages:', Object.keys(payload).join(', '));

  // Ensure screenshot directory
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // Launch browser
  console.log('\nLaunching Chromium (headed, slowMo: 200ms)...');
  const browser = await chromium.launch({
    headless: false,
    slowMo: 200,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  try {
    console.log('Starting form fill...\n');
    const result = await fillAetnaForm(page, payload);

    // Save screenshots
    result.screenshots.forEach((buf, i) => {
      const path = join(SCREENSHOT_DIR, `page-${i + 2}.png`);
      writeFileSync(path, buf);
      console.log(`  Screenshot saved: ${path}`);
    });

    console.log('\n--- RESULT ---');
    console.log(`Request ID: ${result.requestId ?? '(not captured)'}`);
    console.log(`Pages filled: ${result.screenshots.length}`);
    console.log(`Log entries: ${result.log.length}`);
    console.log('\nAutomation log:');
    result.log.forEach((line) => console.log(`  ${line}`));

    console.log('\nForm fill complete. Browser is open for manual inspection.');
    console.log('Press Ctrl+C to close.\n');
  } catch (error: unknown) {
    // Check for FormFillError shape (page + automationLog)
    const err = error as { name?: string; message?: string; page?: number; automationLog?: string; screenshots?: Buffer[] };

    if (err.name === 'FormFillError') {
      console.error(`\n--- FORM FILL FAILED on Page ${err.page} ---`);
      console.error(`Error: ${err.message}`);
      console.error('\nAutomation log:');
      err.automationLog?.split('\n').forEach((line: string) => console.error(`  ${line}`));

      // Save any screenshots captured before failure
      err.screenshots?.forEach((buf: Buffer, i: number) => {
        const path = join(SCREENSHOT_DIR, `page-${i + 2}.png`);
        writeFileSync(path, buf);
        console.error(`  Screenshot saved: ${path}`);
      });

      // Save error screenshot
      try {
        const errorBuf = await page.screenshot({ fullPage: true, type: 'png' });
        const errorPath = join(SCREENSHOT_DIR, `error-page-${err.page}.png`);
        writeFileSync(errorPath, errorBuf);
        console.error(`  Error screenshot saved: ${errorPath}`);
      } catch { /* ignore */ }
    } else {
      console.error('\n--- UNEXPECTED ERROR ---');
      console.error(error);
    }

    console.error('\nBrowser is open for inspection. Press Ctrl+C to close.\n');
  }

  // Keep the process alive until Ctrl+C
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log('\nClosing browser...');
      browser.close().then(resolve).catch(resolve);
    });
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
