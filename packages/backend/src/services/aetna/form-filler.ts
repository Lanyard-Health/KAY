import type { Page } from 'playwright';
import type { AetnaFormPayload } from './types.js';
import { logger } from '../../utils/logger.js';

const FORM_URL = process.env['AETNA_PORTAL_URL'] ?? 'https://extaz-oci.aetna.com/pocui/join-the-aetna-network';

interface FillResult {
  requestId: string | null;
  screenshots: Buffer[];
  log: string[];
}

class FormFillError extends Error {
  page: number;
  automationLog: string;
  screenshots: Buffer[];

  constructor(message: string, page: number, log: string[], screenshots: Buffer[]) {
    super(message);
    this.name = 'FormFillError';
    this.page = page;
    this.automationLog = log.join('\n');
    this.screenshots = screenshots;
  }
}

function log(lines: string[], msg: string): void {
  const ts = new Date().toISOString();
  lines.push(`[${ts}] ${msg}`);
  logger.info(`[aetna-filler] ${msg}`);
}

async function fillInput(page: Page, formcontrol: string, value: string): Promise<void> {
  const locator = page.locator(`[formcontrolname="${formcontrol}"]`);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await locator.clear();
  await locator.fill(value);
}

async function selectDropdown(page: Page, formcontrol: string, value: string): Promise<void> {
  const locator = page.locator(`[formcontrolname="${formcontrol}"]`);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await locator.selectOption({ label: value });
}

async function clickRadio(page: Page, id: string): Promise<void> {
  const label = page.locator(`label[for="${id}"]`);
  await label.waitFor({ state: 'visible', timeout: 10000 });
  await label.click();
}

async function clickCheckbox(page: Page, formcontrol: string): Promise<void> {
  const locator = page.locator(`[formcontrolname="${formcontrol}"]`);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  if (!(await locator.isChecked())) {
    await locator.click();
  }
}

async function clickNextButton(page: Page): Promise<void> {
  const next = page.locator('button:has-text("Next"), button:has-text("NEXT"), button:has-text("Continue")').first();
  await next.waitFor({ state: 'visible', timeout: 10000 });
  await next.click();
}

async function screenshotPage(page: Page): Promise<Buffer> {
  await page.waitForTimeout(500); // Let Angular finish rendering
  return await page.screenshot({ fullPage: true, type: 'png' });
}

// ---- Page fillers ----

async function fillGateway(page: Page, _payload: AetnaFormPayload, lines: string[]): Promise<void> {
  log(lines, 'Navigating to Aetna form');
  await page.goto(FORM_URL, { waitUntil: 'networkidle' });

  log(lines, 'Filling gateway dropdowns');
  // Three cascading dropdowns — select in sequence
  const firstDropdown = page.locator('mat-select').first();
  await firstDropdown.click();
  await page.locator('mat-option:has-text("Aetna")').click();
  await page.waitForTimeout(500);

  const secondDropdown = page.locator('mat-select').nth(1);
  await secondDropdown.click();
  await page.locator('mat-option:has-text("Medical")').click();
  await page.waitForTimeout(500);

  const thirdDropdown = page.locator('mat-select').nth(2);
  await thirdDropdown.click();
  // Select "Physician" subcategory by text; fall back to second option if not found
  const physicianOption = page.locator('mat-option:has-text("Physician")');
  if (await physicianOption.isVisible({ timeout: 3000 }).catch(() => false)) {
    await physicianOption.click();
  } else {
    log(lines, 'Warning: "Physician" option not found in subcategory dropdown, selecting second option');
    await page.locator('mat-option').nth(1).click();
  }
  await page.waitForTimeout(1000);
  log(lines, 'Gateway selections complete');
}

async function fillPage2(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 2: Submitter Information');
  const p = payload.page2;

  await fillInput(page, 'lastName', p['lastName'] as string);
  await fillInput(page, 'firstName', p['firstName'] as string);
  await selectDropdown(page, 'role', p['role'] as string);
  await fillInput(page, 'email', p['email'] as string);
  await fillInput(page, 'verifyEmail', p['verifyEmail'] as string);
  await fillInput(page, 'phoneNumber', p['phoneNumber'] as string);
  await fillInput(page, 'newNpiId', p['newNpiId'] as string);

  // Email acknowledgement: click the link first, then select Agree
  log(lines, 'Handling email acknowledgement');
  const ackLink = page.locator('a:has-text("EMAIL ACKNOWLEDGEMENT"), a:has-text("email acknowledgement")').first();
  if (await ackLink.isVisible()) {
    await ackLink.click();
    await page.waitForTimeout(500);
  }
  await clickRadio(page, 'agree-input');
  await clickCheckbox(page, 'checkboxSelect');

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);

  log(lines, 'Page 2 complete');
  return screenshot;
}

async function fillPage3(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<{ screenshot: Buffer; requestId: string | null }> {
  log(lines, 'Filling Page 3: Network & Tax Information');
  const p = payload.page3;

  // Existing Aetna provider? radio
  const isExisting = p['existingAetnaProvider'] as string;
  await clickRadio(page, isExisting === 'Yes' ? 'Yes-input' : 'No-input');

  await selectDropdown(page, 'networkJoining', p['networkJoining'] as string);
  await selectDropdown(page, 'applicableSituation', p['applicableSituation'] as string);
  await selectDropdown(page, 'state', p['state'] as string);
  await fillInput(page, 'zipCode', p['zipCode'] as string);
  await selectDropdown(page, 'taxIdType', p['taxIdType'] as string);
  await fillInput(page, 'taxIDName', p['taxIDName'] as string);
  await fillInput(page, 'taxID', p['taxID'] as string);
  await fillInput(page, 'verifyTaxID', p['verifyTaxID'] as string);
  await fillInput(page, 'practLastName', p['practLastName'] as string);
  await fillInput(page, 'practFirstName', p['practFirstName'] as string);
  await fillInput(page, 'npi', p['npi'] as string);
  await clickCheckbox(page, 'checkboxSelect');

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(2000); // Wait for Request ID to populate

  // Capture the Request ID from the page after submit
  let requestId: string | null = null;
  try {
    const requestIdEl = page.locator('text=/Request ID/i').first();
    if (await requestIdEl.isVisible()) {
      const text = await requestIdEl.textContent();
      const match = text?.match(/Request ID[:\s]*([A-Z0-9-]+)/i);
      if (match) requestId = match[1] ?? null;
    }
    // Fallback: look for the value in a span or heading near "Request ID"
    if (!requestId) {
      const idSpan = page.locator('[class*="request-id"], [data-testid*="request"]').first();
      if (await idSpan.isVisible()) {
        requestId = (await idSpan.textContent())?.trim() ?? null;
      }
    }
  } catch {
    log(lines, 'Warning: Could not capture Request ID from page 3');
  }

  log(lines, `Page 3 complete. Request ID: ${requestId ?? 'not captured'}`);
  return { screenshot, requestId };
}

async function fillPage4(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 4: Degree & Specialty');
  const p = payload.page4;

  await selectDropdown(page, 'degreeType', p['degreeType'] as string);
  await page.waitForTimeout(1000); // Wait for specialty dropdown to populate based on degree

  await selectDropdown(page, 'specialty', p['specialty'] as string);

  // Provider classification radio
  const classification = (p['providerClassification'] as string) || 'Specialist';
  await clickRadio(page, `${classification}-input`);
  await clickCheckbox(page, 'checkboxSelect');

  const screenshot = await screenshotPage(page);

  // Page 4 uses a hyperlink (not button) to proceed
  log(lines, 'Clicking hyperlink to proceed from Page 4');
  const continueLink = page.locator('a:has-text("Continue"), a:has-text("Next"), a:has-text("click here")').first();
  await continueLink.click();

  // Dismiss "Credentialing with CAQH" popup
  await page.waitForTimeout(1000);
  const ackButton = page.locator('button:has-text("Acknowledge"), button:has-text("Continue")').first();
  if (await ackButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    log(lines, 'Dismissing CAQH credentialing popup');
    await ackButton.click();
  }

  await page.waitForTimeout(1000);
  log(lines, 'Page 4 complete');
  return screenshot;
}

async function fillPage5(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 5: Provider Details & Credentials');
  const p = payload.page5;

  await fillInput(page, 'lastName', p['lastName'] as string);
  await fillInput(page, 'firstName', p['firstName'] as string);
  if (p['middleInitial']) await fillInput(page, 'middleInitial', p['middleInitial'] as string);
  await fillInput(page, 'dob', p['dob'] as string);
  await selectDropdown(page, 'state', p['state'] as string);
  await fillInput(page, 'medicalLicenseNumber', p['medicalLicenseNumber'] as string);
  await fillInput(page, 'medLicenseExpDate', p['medLicenseExpDate'] as string);
  await fillInput(page, 'caqhID', p['caqhID'] as string);
  if (p['providerURL']) await fillInput(page, 'providerURL', p['providerURL'] as string);

  // Accepting new patients radio
  const accepting = p['acceptingNewPatients'] as string;
  await clickRadio(page, accepting === 'Yes' ? 'Yes-input' : 'mat-radio-20-input');

  // Electronic prescribing radio
  const ePrescribing = p['electronicPrescribing'] as string;
  await clickRadio(page, ePrescribing === 'Yes' ? 'electronicPrescribingYes-input' : 'electronicPrescribingNo-input');

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);
  log(lines, 'Page 5 complete');
  return screenshot;
}

async function fillPage6(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 6: Contact Preferences');
  const p = payload.page6;

  // Contracting contact
  await clickRadio(page, `${p['contractingContact']}-input`);

  // Preferred contact method
  const method = p['preferredContactMethod'] as string;
  if (method === 'Email') await page.locator('#EmailSub').check();
  else if (method === 'Phone') await page.locator('#PhoneSub').check();
  else if (method === 'Fax') await page.locator('#FaxSub').check();

  // Authorized contact
  await clickRadio(page, `auth_${p['authorizedContact']}-input`);

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);
  log(lines, 'Page 6 complete');
  return screenshot;
}

async function fillPage7(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 7: Primary Practice Location');
  const p = payload.page7;

  await fillInput(page, 'street', p['street'] as string);
  if (p['street2']) await fillInput(page, 'street2', p['street2'] as string);
  await fillInput(page, 'city', p['city'] as string);
  await fillInput(page, 'state', p['state'] as string);
  await fillInput(page, 'zipcode', p['zipcode'] as string);
  await fillInput(page, 'county', p['county'] as string);
  await fillInput(page, 'phoneNumber', p['phoneNumber'] as string);
  await fillInput(page, 'faxNumber', p['faxNumber'] as string);

  // Languages — Material chip input
  const languages = (p['languages'] as string).split(', ').filter(Boolean);
  if (languages.length > 0) {
    const chipInput = page.locator('#mat-chip-list-input-2');
    for (const lang of languages) {
      await chipInput.fill(lang);
      await chipInput.press('Enter');
      await page.waitForTimeout(200);
    }
  }

  if (p['workingDays']) await selectDropdown(page, 'workingDays', p['workingDays'] as string);
  await clickCheckbox(page, 'checkboxAttest');

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);
  log(lines, 'Page 7 complete');
  return screenshot;
}

async function fillPage8(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 8: Mailing & Billing Addresses');
  const p = payload.page8;

  // Mailing address
  await clickRadio(page, `${p['mailingAddress']}-input`);

  // Billing address
  await clickRadio(page, `${p['billingAddress']}-input`);

  // If new billing address, fill the additional fields
  if (p['billingAddress'] === 'New billing address' && p['billingStreet']) {
    await fillInput(page, 'billingStreet', p['billingStreet'] as string);
    await fillInput(page, 'billingCity', p['billingCity'] as string);
    await fillInput(page, 'billingState', p['billingState'] as string);
    await fillInput(page, 'billingZipCode', p['billingZipCode'] as string);
  }

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);
  log(lines, 'Page 8 complete');
  return screenshot;
}

async function fillPage9(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 9: Hospital Privileges & Attachments');
  const p = payload.page9;

  const hasPrivileges = p['hospitalPrivileges'] as string;
  await clickRadio(page, hasPrivileges === 'Yes' ? 'privilegeYes-input' : 'privilegeNo-input');

  const facilityBased = p['facilityBased'] as string;
  await clickRadio(page, facilityBased === 'Yes' ? 'facilityYes-input' : 'facilityNo-input');

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);
  log(lines, 'Page 9 complete');
  return screenshot;
}

async function fillPage10(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 10: Additional Questions (WILL NOT SUBMIT)');
  const p = payload.page10;

  const medicare = p['medicareCertified'] as string;
  await clickRadio(page, medicare === 'Yes' ? 'medicareCertifiedYes-input' : 'medicareCertifiedNo-input');

  const medicaid = p['medicaidCertified'] as string;
  await clickRadio(page, medicaid === 'Yes' ? 'medicadCertifiedYes-input' : 'medicadCertifiedNo-input');

  const eap = p['aetnaEAPProgram'] as string;
  await clickRadio(page, eap === 'Yes' ? 'aetnaEAPProgramYes-input' : 'aetnaEAPProgramNo-input');

  const asl = p['americanSignLanguage'] as string;
  await clickRadio(page, asl === 'Yes' ? 'americanSignLangYes-input' : 'americanSignLangNo-input');

  const screenshot = await screenshotPage(page);

  // DO NOT click submit — hold here for human review
  log(lines, 'Page 10 filled. HOLDING FOR HUMAN REVIEW — submit button NOT clicked.');
  return screenshot;
}

/**
 * Submit the final form — called only after human approval.
 */
export async function submitFinalPage(page: Page): Promise<Buffer> {
  // Click the submit button inside the review popup
  const submitButton = page.locator('button:has-text("Submit Request for Participation")').first();
  await submitButton.waitFor({ state: 'visible', timeout: 10000 });
  await submitButton.click();
  await page.waitForTimeout(3000); // Wait for confirmation

  return await screenshotPage(page);
}

/**
 * Fill all pages of the Aetna enrollment form.
 * Returns screenshots, request ID, and log.
 * Does NOT submit — browser is held for review.
 */
export async function fillAetnaForm(page: Page, payload: AetnaFormPayload): Promise<FillResult> {
  const lines: string[] = [];
  const screenshots: Buffer[] = [];
  let currentPage = 1; // gateway = 1

  try {
    await fillGateway(page, payload, lines);

    currentPage = 2;
    screenshots.push(await fillPage2(page, payload, lines));

    currentPage = 3;
    const page3Result = await fillPage3(page, payload, lines);
    screenshots.push(page3Result.screenshot);

    currentPage = 4;
    screenshots.push(await fillPage4(page, payload, lines));
    currentPage = 5;
    screenshots.push(await fillPage5(page, payload, lines));
    currentPage = 6;
    screenshots.push(await fillPage6(page, payload, lines));
    currentPage = 7;
    screenshots.push(await fillPage7(page, payload, lines));
    currentPage = 8;
    screenshots.push(await fillPage8(page, payload, lines));
    currentPage = 9;
    screenshots.push(await fillPage9(page, payload, lines));
    currentPage = 10;
    screenshots.push(await fillPage10(page, payload, lines));

    return { requestId: page3Result.requestId, screenshots, log: lines };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(lines, `ERROR on page ${currentPage}: ${msg}`);
    // Take error screenshot
    try { screenshots.push(await screenshotPage(page)); } catch { /* ignore */ }
    throw new FormFillError(msg, currentPage, lines, screenshots);
  }
}
