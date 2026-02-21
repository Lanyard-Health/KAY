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

// ---- Helpers ----

async function fillInput(page: Page, formcontrol: string, value: string): Promise<void> {
  const locator = page.locator(`[formcontrolname="${formcontrol}"]`);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await locator.click({ force: true });
  await locator.fill(value);
}

async function fillIfEnabled(page: Page, formcontrol: string, value: string): Promise<void> {
  const locator = page.locator(`[formcontrolname="${formcontrol}"]`);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  if (await locator.isDisabled()) return;
  await locator.click({ force: true });
  await locator.fill(value);
}

async function fillMaskedInput(page: Page, formcontrol: string, value: string): Promise<void> {
  const locator = page.locator(`[formcontrolname="${formcontrol}"]`);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await locator.click({ force: true });
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Backspace');
  for (const char of value) {
    await locator.press(char);
    await page.waitForTimeout(30);
  }
}

async function selectDropdown(page: Page, formcontrol: string, value: string): Promise<void> {
  const locator = page.locator(`[formcontrolname="${formcontrol}"]`);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await locator.selectOption({ label: value });
}

async function selectDropdownByValue(page: Page, formcontrol: string, value: string): Promise<void> {
  const locator = page.locator(`[formcontrolname="${formcontrol}"]`);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await locator.selectOption({ value });
}

/**
 * Click an Angular Material mat-radio-button by its visible text.
 * Uses page.evaluate() because mat-radio-button hides the real <input>.
 * @param sectionText - Optional keyword to scope by nearest parent containing this text
 * @param groupIndex - Optional 0-based index of mat-radio-group on the page
 */
async function clickMatRadio(
  page: Page, answer: string, sectionText?: string, groupIndex?: number,
): Promise<boolean> {
  return await page.evaluate(
    (args: { answer: string; sectionText?: string; groupIndex?: number }) => {
      let radios: Element[];
      if (args.groupIndex !== undefined) {
        const groups = document.querySelectorAll('mat-radio-group');
        const group = groups[args.groupIndex];
        if (!group) return false;
        radios = Array.from(group.querySelectorAll('mat-radio-button'));
      } else {
        radios = Array.from(document.querySelectorAll('mat-radio-button'));
      }

      let target: Element | null = null;

      if (!args.sectionText || args.groupIndex !== undefined) {
        for (const radio of radios) {
          if ((radio.textContent?.trim() ?? '').includes(args.answer)) { target = radio; break; }
        }
      } else {
        let bestDistance = Infinity;
        const keyword = args.sectionText.toLowerCase();
        for (const radio of radios) {
          if (!(radio.textContent?.trim() ?? '').includes(args.answer)) continue;
          let el: HTMLElement | null = radio as HTMLElement;
          for (let i = 1; i <= 8 && el; i++) {
            el = el.parentElement;
            if (!el) break;
            if (el.textContent?.toLowerCase().includes(keyword)) {
              if (i < bestDistance) { bestDistance = i; target = radio; }
              break;
            }
          }
        }
      }

      if (!target) return false;

      const inp = target.querySelector('input[type="radio"]') as HTMLInputElement | null;
      if (inp) {
        inp.checked = true;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const inner = target.querySelector('.mat-radio-inner-circle') ?? inp ?? target;
      (inner as HTMLElement).click();
      (target as HTMLElement).click();
      return true;
    },
    { answer, sectionText, groupIndex },
  );
}

/**
 * Click an Angular Material mat-checkbox using Playwright's native click
 * on .mat-checkbox-inner-container — Angular's real click target.
 * ONE click only — no double-toggling.
 */
async function clickMatCheckbox(page: Page, index?: number, sectionText?: string): Promise<boolean> {
  let locator;
  if (sectionText) {
    locator = page.locator(`mat-checkbox:has-text("${sectionText}") .mat-checkbox-inner-container`).first();
  } else {
    locator = page.locator('mat-checkbox .mat-checkbox-inner-container').nth(index ?? 0);
  }
  if (!(await locator.isVisible({ timeout: 5000 }).catch(() => false))) return false;
  await locator.click();
  return true;
}

/**
 * Force-check a hidden checkbox by ID (e.g. page 6's #EmailSub).
 */
async function forceCheckById(page: Page, id: string): Promise<boolean> {
  return await page.evaluate((cbId: string) => {
    const input = document.getElementById(cbId) as HTMLInputElement | null;
    if (!input) return false;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const wrapper = input.closest('mat-checkbox, .mat-checkbox, label');
    if (wrapper) (wrapper as HTMLElement).click();
    return true;
  }, id);
}

/**
 * Select an option from an Angular Material mat-select dropdown.
 */
async function selectMatOption(page: Page, labelText: string, optionIndex: number = 0): Promise<boolean> {
  const trigger = page.locator(`mat-select:near(:text("${labelText}"))`).first();
  if (!(await trigger.isVisible({ timeout: 3000 }).catch(() => false))) return false;
  await trigger.click({ force: true });
  await page.waitForTimeout(500);
  const options = page.locator('mat-option');
  const count = await options.count();
  if (count === 0) return false;
  const targetIndex = Math.min(optionIndex, count - 1);
  await options.nth(targetIndex).click({ force: true });
  await page.waitForTimeout(300);
  const backdrop = page.locator('.cdk-overlay-backdrop');
  if (await backdrop.isVisible({ timeout: 500 }).catch(() => false)) {
    await backdrop.click({ force: true });
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(300);
  return true;
}

async function clickNextButton(page: Page): Promise<void> {
  const next = page.locator('button:has-text("Next"), button:has-text("NEXT"), button:has-text("Continue")').first();
  await next.waitFor({ state: 'visible', timeout: 10000 });
  await next.click({ force: true });
}

async function dismissOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const sel of ['#kampyleInviteContainer', '#MDigitalInvitationWrapper', '.kampyle_vertical_button']) {
      document.querySelector(sel)?.remove();
    }
  });
}

async function screenshotPage(page: Page): Promise<Buffer> {
  await page.waitForTimeout(500);
  return await page.screenshot({ fullPage: true, type: 'png' });
}

// ---- Page fillers ----

async function fillGateway(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<void> {
  log(lines, 'Navigating to Aetna form');
  await page.goto(FORM_URL, { waitUntil: 'networkidle' });

  log(lines, 'Filling gateway dropdowns');
  const gw = payload.gateway;

  await page.selectOption('#typeOfRFP', gw.network);
  await page.waitForTimeout(1000);

  const secondDropdown = page.locator('#typeOfRFP1');
  await secondDropdown.waitFor({ state: 'visible', timeout: 10000 });
  await secondDropdown.selectOption(gw.category);
  await page.waitForTimeout(1000);

  const thirdDropdown = page.locator('#typeOfRFP2');
  await thirdDropdown.waitFor({ state: 'visible', timeout: 10000 });
  await thirdDropdown.selectOption(gw.subcategory);
  await page.waitForTimeout(500);

  await page.click('button.primary-button');
  await page.waitForTimeout(3000);
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

  // Email acknowledgement
  log(lines, 'Handling email acknowledgement');
  const ackLink = page.locator('a:has-text("EMAIL ACKNOWLEDGEMENT"), a:has-text("email acknowledgement")').first();
  if (await ackLink.isVisible()) {
    await ackLink.click();
    await page.waitForTimeout(500);
  }
  await clickMatRadio(page, 'Agree');

  // Checkbox — single Playwright click on inner container
  await clickMatCheckbox(page, 0);

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);

  log(lines, 'Page 2 complete');
  return screenshot;
}

async function fillPage3(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<{ screenshot: Buffer; requestId: string | null }> {
  log(lines, 'Filling Page 3: Network & Tax Information');
  const p = payload.page3;

  // Telehealth radio
  const telehealth = p['teleHealthService'] as string;
  await clickMatRadio(page, telehealth, 'telehealth');
  await page.waitForTimeout(500);

  await selectDropdownByValue(page, 'networkJoining', p['networkJoining'] as string);
  await selectDropdownByValue(page, 'applicableSituation', p['applicableSituation'] as string);
  await selectDropdownByValue(page, 'state', p['state'] as string);
  await fillInput(page, 'zipCode', p['zipCode'] as string);
  await page.waitForTimeout(500);

  // Minnesota applicant radio (only visible when MN selected)
  const mnRadio = page.locator('mat-radio-button:has-text("No")');
  if (await mnRadio.first().isVisible({ timeout: 1000 }).catch(() => false)) {
    const mnAnswer = (p['mnapplicant'] as string) || 'no';
    await clickMatRadio(page, mnAnswer === 'yes' ? 'Yes' : 'No', 'minnesota');
  }

  await selectDropdownByValue(page, 'taxIdType', p['taxIdType'] as string);
  await page.waitForTimeout(500);
  await fillInput(page, 'taxIDName', p['taxIDName'] as string);
  await fillMaskedInput(page, 'taxID', p['taxID'] as string);
  await page.waitForTimeout(500);
  await fillMaskedInput(page, 'verifyTaxID', p['verifyTaxID'] as string);
  await page.waitForTimeout(500);
  await fillInput(page, 'practLastName', p['practLastName'] as string);
  await fillInput(page, 'practFirstName', p['practFirstName'] as string);
  await fillInput(page, 'npi', p['npi'] as string);

  // Checkbox
  await clickMatCheckbox(page, 0);

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(3000);

  // Capture Request ID
  let requestId: string | null = null;
  try {
    const requestIdEl = page.locator('text=/Request ID/i').first();
    await requestIdEl.waitFor({ state: 'visible', timeout: 10000 });
    const text = await requestIdEl.textContent();
    const match = text?.match(/Request ID[:\s]*is[:\s]*(\d+)/i) ?? text?.match(/Request ID[:\s]*([A-Z0-9-]+)/i);
    if (match) requestId = match[1] ?? null;
  } catch {
    const submitErrors = await page.locator('.submitErr').allTextContents();
    const errorText = submitErrors.filter(e => e.trim()).join('; ');
    if (errorText) {
      throw new Error(`Page 3 validation errors: ${errorText}`);
    }
    log(lines, 'Warning: Could not find Request ID element');
  }

  log(lines, `Page 3 complete. Request ID: ${requestId ?? 'not captured'}`);

  const continueSession = page.locator('button:has-text("Continue Session")');
  if (await continueSession.isVisible({ timeout: 3000 }).catch(() => false)) {
    log(lines, 'Clicking "Continue Session"');
    await continueSession.click({ force: true });
    await page.waitForTimeout(3000);
  }

  return { screenshot, requestId };
}

async function fillPage4(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 4: Degree & Specialty');
  const p = payload.page4;

  await selectDropdownByValue(page, 'degreeType', p['degreeType'] as string);
  await page.waitForTimeout(2000);
  await selectDropdownByValue(page, 'specialty', p['specialty'] as string);

  // Provider classification radio (PCP or Specialist)
  const classification = (p['providerClassification'] as string) || 'Specialist';
  await clickMatRadio(page, classification);

  // Acupuncture radio — try section match, fallback to last "No" radio
  let acuClicked = await clickMatRadio(page, 'No', 'acupuncture');
  if (!acuClicked) {
    acuClicked = await clickMatRadio(page, 'No', 'ACUPUNCTURE');
  }
  if (!acuClicked) {
    await page.evaluate(() => {
      const radios = Array.from(document.querySelectorAll('mat-radio-button'));
      const noRadios = radios.filter(r => (r.textContent?.trim() ?? '').includes('No'));
      if (noRadios.length > 0) {
        const last = noRadios[noRadios.length - 1]!;
        const inp = last.querySelector('input[type="radio"]') as HTMLInputElement | null;
        if (inp) { inp.checked = true; inp.dispatchEvent(new Event('change', { bubbles: true })); }
        (last as HTMLElement).click();
      }
    });
  }

  // Checkbox
  await clickMatCheckbox(page, 0);

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(2000);

  // Dismiss CAQH credentialing popup — try up to 3 times
  for (let attempt = 0; attempt < 3; attempt++) {
    const ackButton = page.locator('button:has-text("Acknowledge"), button:has-text("OK")').first();
    if (await ackButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      log(lines, 'Dismissing CAQH credentialing popup');
      await ackButton.click({ force: true });
      await page.waitForTimeout(1000);
    } else {
      break;
    }
  }

  log(lines, 'Page 4 complete');
  return screenshot;
}

async function fillPage5(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 5: Provider Details & Credentials');
  const p = payload.page5;

  // Use fillIfEnabled — CAQH may pre-fill and disable some fields
  await fillIfEnabled(page, 'lastName', p['lastName'] as string);
  await fillIfEnabled(page, 'firstName', p['firstName'] as string);
  if (p['middleInitial']) await fillIfEnabled(page, 'middleInitial', p['middleInitial'] as string);
  await fillIfEnabled(page, 'dob', p['dob'] as string);

  // State dropdown
  try {
    await selectDropdown(page, 'state', p['state'] as string);
  } catch {
    await fillIfEnabled(page, 'state', p['state'] as string);
  }

  await fillIfEnabled(page, 'medicalLicenseNumber', p['medicalLicenseNumber'] as string);
  await fillIfEnabled(page, 'medLicenseExpDate', p['medLicenseExpDate'] as string);
  await fillIfEnabled(page, 'caqhID', p['caqhID'] as string);
  if (p['providerURL']) await fillIfEnabled(page, 'providerURL', p['providerURL'] as string);

  // Accepting new patients radio
  const accepting = p['acceptingNewPatients'] as string;
  await clickMatRadio(page, accepting, 'accepting new patients');

  // Electronic prescribing radio
  const ePrescribing = p['electronicPrescribing'] as string;
  await clickMatRadio(page, ePrescribing, 'electronic prescribing');

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);
  log(lines, 'Page 5 complete');
  return screenshot;
}

async function fillPage6(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 6: Contact Preferences');
  const p = payload.page6;

  // Contracting contact — first radio group
  const contact = p['contractingContact'] as string;
  await clickMatRadio(page, contact, 'contact person for contracting');

  // Preferred contact method — hidden checkbox
  const method = p['preferredContactMethod'] as string;
  if (method === 'Email') await forceCheckById(page, 'EmailSub');
  else if (method === 'Phone') await forceCheckById(page, 'PhoneSub');
  else if (method === 'Fax') await forceCheckById(page, 'FaxSub');

  // Authorized contact — second radio group
  const authContact = p['authorizedContact'] as string;
  await clickMatRadio(page, authContact, undefined, 1);

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);

  // Handle intermediate review page ("Practitioner Information" summary)
  try {
    const reviewNext = page.locator('button:has-text("Next"), button:has-text("Continue")').first();
    if (await reviewNext.isVisible({ timeout: 3000 }).catch(() => false)) {
      const heading = page.locator('text=/Practitioner Information/i').first();
      if (await heading.isVisible({ timeout: 1000 }).catch(() => false)) {
        log(lines, 'Detected intermediate review page — clicking Next');
        await reviewNext.click({ force: true });
        await page.waitForTimeout(2000);
      }
    }
  } catch {
    // No intermediate page — continue
  }

  log(lines, 'Page 6 complete');
  return screenshot;
}

async function fillPage7(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 7: Primary Practice Location');
  const p = payload.page7;

  await fillIfEnabled(page, 'street', p['street'] as string);
  if (p['street2']) await fillIfEnabled(page, 'street2', p['street2'] as string);
  await fillIfEnabled(page, 'city', p['city'] as string);
  await fillIfEnabled(page, 'state', p['state'] as string);
  await fillIfEnabled(page, 'zipcode', p['zipcode'] as string);
  await fillIfEnabled(page, 'county', p['county'] as string);
  await fillIfEnabled(page, 'phoneNumber', p['phoneNumber'] as string);
  await fillIfEnabled(page, 'faxNumber', p['faxNumber'] as string);

  // Languages — Material chip input (try multiple possible IDs)
  const languages = (p['languages'] as string).split(', ').filter(Boolean);
  if (languages.length > 0) {
    let chipInput = page.locator('#mat-chip-list-input-2');
    if (!(await chipInput.isVisible({ timeout: 2000 }).catch(() => false))) {
      chipInput = page.locator('#mat-chip-list-input-0');
    }
    if (!(await chipInput.isVisible({ timeout: 2000 }).catch(() => false))) {
      chipInput = page.locator('input[placeholder*="anguage"], input[aria-label*="anguage"]').first();
    }
    try {
      for (const lang of languages) {
        await chipInput.fill(lang);
        await chipInput.press('Enter');
        await page.waitForTimeout(200);
      }
    } catch {
      log(lines, 'Warning: Could not fill language chip input');
    }
  }

  // Working days dropdown
  if (p['workingDays']) {
    try {
      await selectDropdown(page, 'workingDays', p['workingDays'] as string);
    } catch {
      log(lines, 'Warning: Could not select workingDays dropdown');
    }
  }

  // Facility Fee radio — No
  await clickMatRadio(page, 'No', 'facility fee');

  // ADA accessible
  const adaClicked = await clickMatRadio(page, 'Yes', 'ada accessible');
  if (!adaClicked) {
    await clickMatRadio(page, 'Yes', 'ADA');
  }

  // ACCESS ACCOMMODATIONS dropdown (if visible)
  try { await selectMatOption(page, 'ACCESS ACCOMMODATIONS', 0); } catch { /* optional */ }

  // FREQUENCY dropdown (if visible)
  try { await selectMatOption(page, 'FREQUENCY', 0); } catch { /* optional */ }

  // Attestation checkbox
  await clickMatCheckbox(page, 0);

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);
  log(lines, 'Page 7 complete');
  return screenshot;
}

async function fillPage8(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 8: Mailing & Billing Addresses');
  const p = payload.page8;

  // Mailing address radio
  const mailingText = p['mailingAddress'] as string;
  await clickMatRadio(page, mailingText, 'mailing');

  // Billing address radio
  const billingText = p['billingAddress'] as string;
  await clickMatRadio(page, billingText, 'billing');

  // If new billing address, fill the additional fields
  if (billingText.toLowerCase().includes('new') && p['billingStreet']) {
    await fillInput(page, 'billingStreet', p['billingStreet'] as string);
    await fillInput(page, 'billingCity', p['billingCity'] as string);
    await fillInput(page, 'billingState', p['billingState'] as string);
    await fillInput(page, 'billingZipCode', p['billingZipCode'] as string);
  }

  // Additional service locations radio
  const addlLocations = (p['additionalServiceLocations'] as string) || 'No';
  await clickMatRadio(page, addlLocations, 'additional service');

  const screenshot = await screenshotPage(page);
  await clickNextButton(page);
  await page.waitForTimeout(1000);
  log(lines, 'Page 8 complete');
  return screenshot;
}

async function fillPage9(page: Page, payload: AetnaFormPayload, lines: string[]): Promise<Buffer> {
  log(lines, 'Filling Page 9: Hospital Privileges & Attachments');
  const p = payload.page9;

  // Hospital privileges radio
  const hasPrivileges = p['hospitalPrivileges'] as string;
  await clickMatRadio(page, hasPrivileges, 'hospital privileges');

  // Facility-based radio
  const facilityBased = p['facilityBased'] as string;
  await clickMatRadio(page, facilityBased, 'facility based');

  // Optional mat-select dropdowns
  try { await selectMatOption(page, 'AGE GROUP', 0); } catch { /* optional */ }
  try { await selectMatOption(page, 'PROVIDER PRACTICE FOCUS', 0); } catch { /* optional */ }
  try { await selectMatOption(page, 'RACE', 0); } catch { /* optional */ }
  try { await selectMatOption(page, 'SEXUAL ORIENTATION', 0); } catch { /* optional */ }
  try { await selectMatOption(page, 'DISABILITY', 0); } catch { /* optional */ }

  // Language chip (if present on page 9)
  try {
    const langChip = page.locator('input[placeholder*="anguage"]').first();
    if (await langChip.isVisible({ timeout: 1000 }).catch(() => false)) {
      await langChip.fill('English');
      await langChip.press('Enter');
      await page.waitForTimeout(200);
    }
  } catch { /* optional */ }

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
  await clickMatRadio(page, medicare, 'medicare');

  const medicaid = p['medicaidCertified'] as string;
  await clickMatRadio(page, medicaid, 'medicaid');

  const eap = p['aetnaEAPProgram'] as string;
  await clickMatRadio(page, eap, 'EAP');

  const asl = p['americanSignLanguage'] as string;
  await clickMatRadio(page, asl, 'american sign');

  const screenshot = await screenshotPage(page);

  // DO NOT click submit — hold here for human review
  log(lines, 'Page 10 filled. HOLDING FOR HUMAN REVIEW — submit button NOT clicked.');
  return screenshot;
}

/**
 * Submit the final form — called only after human approval.
 */
export async function submitFinalPage(page: Page): Promise<Buffer> {
  const submitButton = page.locator('button:has-text("Submit Request for Participation")').first();
  await submitButton.waitFor({ state: 'visible', timeout: 10000 });
  await submitButton.click();
  await page.waitForTimeout(3000);

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
  let currentPage = 1;

  try {
    await fillGateway(page, payload, lines);

    currentPage = 2;
    await dismissOverlays(page);
    screenshots.push(await fillPage2(page, payload, lines));

    currentPage = 3;
    await dismissOverlays(page);
    const page3Result = await fillPage3(page, payload, lines);
    screenshots.push(page3Result.screenshot);

    currentPage = 4;
    await dismissOverlays(page);
    screenshots.push(await fillPage4(page, payload, lines));
    currentPage = 5;
    await dismissOverlays(page);
    screenshots.push(await fillPage5(page, payload, lines));
    currentPage = 6;
    await dismissOverlays(page);
    screenshots.push(await fillPage6(page, payload, lines));
    currentPage = 7;
    await dismissOverlays(page);
    screenshots.push(await fillPage7(page, payload, lines));
    currentPage = 8;
    await dismissOverlays(page);
    screenshots.push(await fillPage8(page, payload, lines));
    currentPage = 9;
    await dismissOverlays(page);
    screenshots.push(await fillPage9(page, payload, lines));
    currentPage = 10;
    await dismissOverlays(page);
    screenshots.push(await fillPage10(page, payload, lines));

    return { requestId: page3Result.requestId, screenshots, log: lines };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(lines, `ERROR on page ${currentPage}: ${msg}`);
    try { screenshots.push(await screenshotPage(page)); } catch { /* ignore */ }
    throw new FormFillError(msg, currentPage, lines, screenshots);
  }
}
