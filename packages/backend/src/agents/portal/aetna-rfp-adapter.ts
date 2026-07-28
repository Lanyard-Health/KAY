import type { Page, Response } from 'playwright';
import { logger } from '../../utils/logger.js';
import { PlaywrightBaseAdapter, downloadFromS3, type PlaywrightSubmissionContext } from './playwright-base-adapter.js';
import type { AdapterType } from '@prisma/client';
import type { ResolvedCredential } from '../../services/credential.service.js';

/**
 * AetnaRfpAdapter — drives Aetna's public "Request for Participation" (RFP)
 * wizard at https://extaz-oci.aetna.com/pocui/join-the-aetna-network.
 *
 * The form is ONE Angular wizard (over a Spring Boot REST API) that branches by
 * line of business. Verified end-to-end on 2026-06-15 for the BEHAVIORAL_HEALTH
 * branch with a real consented test provider (recorded via Libretto, see
 * ~/Desktop/aetna-rfp-workflow.ts). Other lines reuse the shared gate/submitter/
 * network-check/contact/location steps but have different Step 2 (specialty) and
 * Step 6 (line-specific questions) — left as TODOs until each is walked live.
 *
 * Key facts that shape this adapter:
 *  - No portal login. It is a public form, so `login()` only navigates to the
 *    start URL. The ResolvedCredential is not used for auth; submitter contact
 *    info travels in `providerData.submitter` (resolved upstream from the
 *    practice admin or the PortalCredential.extraConfig vault).
 *  - Only NPI, Tax ID and CAQH Provider ID are validated by Aetna against real
 *    systems; every other field accepts our stored values.
 *  - The payer Request ID is returned in the npcheck response body
 *    (`data.requestId`) and also shown in a dialog. We capture it from the
 *    response (robust) and map it to EnrollmentRun.externalReference.
 *  - mat-radio toggles reliably only by clicking the underlying <input> by id
 *    with force; mat-select multiselects render options in a body-level overlay.
 *  - A Medallia ("kampyle") survey iframe pops mid-flow and intercepts clicks;
 *    we hide it before click-heavy sections.
 *
 * SAFETY: the final "Submit request for participation" click is the ONE step we
 * never executed during recon. It is implemented here but gated behind
 * `providerData.stopBeforeSubmit` (default false in production). When true, the
 * adapter fills everything, captures the Request ID, and returns WITHOUT filing.
 */

// Env-overridable so end-to-end tests can point at a local mock instead of
// creating a real saved application on Aetna's side (their network-check step
// files a real Request ID the moment it passes).
const LIVE_RFP_URL = 'https://extaz-oci.aetna.com/pocui/join-the-aetna-network';

/**
 * Resolve the RFP start URL with a live-portal safety latch.
 *
 * Aetna's network-check step files a REAL saved application (with a Request
 * ID) the moment it passes, so hitting the live portal must be an explicit,
 * deliberate choice — never a fallback someone forgot to configure. Rules:
 * - AETNA_RFP_START_URL set → use it (mock or live, your call).
 * - Unset + AETNA_RFP_ALLOW_LIVE=true → live portal (supervised runs).
 * - Unset otherwise → fail fast before the browser ever launches.
 */
export function getRfpStartUrl(): string {
  const explicit = process.env['AETNA_RFP_START_URL'];
  if (explicit) return explicit;
  if (process.env['AETNA_RFP_ALLOW_LIVE'] === 'true') return LIVE_RFP_URL;
  throw new Error(
    'Aetna RFP target not configured. Set AETNA_RFP_START_URL (e.g. the local mock form) ' +
      'or explicitly set AETNA_RFP_ALLOW_LIVE=true to submit to the REAL Aetna portal. ' +
      'This guard prevents accidental live submissions.'
  );
}

/** Line of business -> the "I am applying for" dropdown label. */
const APPLYING_FOR_LABEL: Record<AetnaLineOfBusiness, string> = {
  BEHAVIORAL_HEALTH: 'Behavioral Health',
  MEDICAL: 'Medical',
  DENTAL: 'Dental',
  FACILITY: 'Facility',
  PHARMACY: 'Pharmacy & Medicare Part D',
};

/** Enrollment context -> the "I am joining" dropdown label. */
const JOINING_LABEL: Record<AetnaJoining, string> = {
  INDIVIDUAL_NEW:
    'A individual provider applying under a SSN or TaxID/EIN that is not currently participating with Aetna',
  GROUP_NEW:
    'A provider group applying under a SSN or TaxID/EIN that is not currently participating with Aetna',
  EXISTING:
    'A provider applying under a SSN or TaxID/EIN that is currently participating with Aetna',
};

export type AetnaLineOfBusiness =
  | 'BEHAVIORAL_HEALTH'
  | 'MEDICAL'
  | 'DENTAL'
  | 'FACILITY'
  | 'PHARMACY';

export type AetnaJoining = 'INDIVIDUAL_NEW' | 'GROUP_NEW' | 'EXISTING';

/**
 * The field set this adapter needs. Built upstream by the recipe-resolver from
 * provider/practice records + the submitter contact. `providerData` on the
 * SubmissionAdapterInput is narrowed to this shape via `isAetnaRfpData`.
 */
export interface AetnaRfpProviderData {
  payer: 'Aetna' | 'First Health';
  lineOfBusiness: AetnaLineOfBusiness;
  joining: AetnaJoining;

  submitter: {
    lastName: string;
    firstName: string;
    role: string;
    email: string;
    phone: string;
  };

  provider: {
    lastName: string;
    firstName: string;
    npi: string;
    taxIdType: 'E' | 'S';
    taxIdName: string;
    taxId: string;
    caqhId: string;
    dob: string; // MM/DD/YYYY
    licenseNumber: string;
    licenseExp: string; // MM/DD/YYYY
    degree: string; // e.g. "MFT"
    primarySpecialty: string; // e.g. "Marriage and Family Therapist"
  };

  location: {
    state: string; // full name, e.g. "Kansas"
    zip: string;
    street: string;
    city: string;
    phone: string;
    fax: string;
    placeOfService: 'Office based' | 'Hospital / facility based';
    adaAccessible: boolean;
    accessAccommodations?: string;
    staffLanguages?: string[];
    interpreterLanguages?: string[];
    facilityFee?: boolean;
  };

  /** Telehealth conditional branch (required when `telehealth` is true). All
   * values are the EXACT Aetna option labels (verified against the reference
   * submission PDF, Request ID 06412261). */
  telehealthDetail?: {
    services: string; // e.g. "Hybrid services"
    methods: string[]; // e.g. ["Video Conference", "Telephone"]
    types: string[]; // e.g. ["Behavioral Health Services"]
    hipaaAttested: boolean;
  };

  /** W9 attachment for the Other Information step. The adapter downloads the
   * S3 object to a temp file and uploads it via the form's file input. */
  w9?: { s3Key: string; fileName: string };

  providerLanguages?: string[];
  medicarePtan?: string;
  hospitalAdmittingPrivileges?: boolean;
  facilityAdmittingPrivileges?: boolean;

  // Behavioral-health step (Step 6) — required when lineOfBusiness is BEHAVIORAL_HEALTH.
  // Both are multiselects on Aetna's form, so each carries one-or-more values;
  // the adapter selects every element.
  behavioralHealth?: {
    ageGroup: string[]; // e.g. ["Adults (Ages 18-64)", "Geriatric (Ages 65+)"]
    practiceFocus: string[]; // e.g. ["Anxiety Disorders", "Depression"]
  };

  // Attestation radios. Optional; an omitted value is treated as false == "No",
  // which is the original hardcoded behavior — so nothing changes until a value
  // is passed. (medicaid drives Aetna's misspelled "medicad" control.)
  medicareCertified?: boolean;
  medicaidCertified?: boolean;
  hospitalist?: boolean;
  aslOffered?: boolean;
  ePrescribing?: boolean;
  aetnaEapParticipation?: boolean;

  telehealth: boolean;

  /** When true, fill everything but DO NOT click the final Submit. */
  stopBeforeSubmit?: boolean;
}

export class AetnaRfpAdapter extends PlaywrightBaseAdapter {
  readonly adapterType: AdapterType = 'AETNA_RFP';

  // Request ID captured from the npcheck API response (or the dialog as fallback).
  private capturedRequestId: string | null = null;
  private capturedConfirmationNumber: string | null = null;

  /** Optional per-page screenshot hook — set by the review workflow so staff
   * can inspect every filled page before approving the final submit. */
  onStepScreenshot?: (page: Page, label: string) => Promise<void>;

  get requestId(): string | null {
    return this.capturedRequestId;
  }

  private async shot(page: Page, label: string): Promise<void> {
    if (!this.onStepScreenshot) return;
    try {
      await this.onStepScreenshot(page, label);
    } catch (err) {
      logger.warn('AetnaRfpAdapter: step screenshot failed', {
        label,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  /**
   * Review-session entry point 1: open the start page and wire the response
   * listeners. Equivalent to login() but public, for the human-in-the-loop
   * review flow that owns its own browser lifecycle.
   */
  async openForReview(page: Page): Promise<void> {
    page.on('response', (res: Response) => {
      if (res.url().includes('/api/provider/update/submitrequest')) {
        void this.captureConfirmationFromResponse(res);
      }
    });
    await page.goto(getRfpStartUrl(), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  }

  /**
   * Review-session entry point 2: fill every page up to (but not including)
   * the final "Submit request for participation" click. Returns the captured
   * Aetna Request ID. Throws if any step fails or the submit page is not
   * reached.
   */
  async fillForReview(page: Page, data: AetnaRfpProviderData): Promise<{ requestId: string | null }> {
    this.assertSupported(data);
    await this.fillAllSteps(page, data);
    return { requestId: this.capturedRequestId };
  }

  /**
   * Review-session entry point 3: perform the final submit on an already
   * filled, paused session, and capture the confirmation number.
   */
  async approveAndSubmit(
    page: Page
  ): Promise<{ requestId: string | null; confirmationNumber: string | null }> {
    await page
      .locator('button:has-text("Submit request for participation")')
      .first()
      .click();
    await page.waitForTimeout(8000);
    if (!this.capturedConfirmationNumber) {
      this.capturedConfirmationNumber = await this.readNumberFromDom(
        page,
        /(?:Confirmation|Request ID)[^0-9]*([0-9]{5,})/i
      );
    }
    await this.shot(page, '09-confirmation');
    return {
      requestId: this.capturedRequestId,
      confirmationNumber: this.capturedConfirmationNumber,
    };
  }

  /** Fail fast on branches this adapter has not implemented. */
  private assertSupported(data: AetnaRfpProviderData): void {
    if (data.lineOfBusiness !== 'BEHAVIORAL_HEALTH') {
      throw new Error(
        `Aetna RFP: line of business '${data.lineOfBusiness}' is not supported yet — only Behavioral Health has been implemented and verified. Medical/Dental/Facility/Pharmacy are a later phase.`
      );
    }
    if (data.telehealth && !data.telehealthDetail) {
      throw new Error(
        'Aetna RFP: telehealth=Yes requires telehealthDetail (services, methods, types, HIPAA attestation) — fill the Payer Submission Details section.'
      );
    }
  }

  /**
   * No portal login — this is a public form. We just open the start page and
   * wire a response listener that snags the Request ID / confirmation number
   * straight from Aetna's own API responses.
   */
  protected async login(
    ctx: PlaywrightSubmissionContext,
    _credential: ResolvedCredential
  ): Promise<void> {
    const { page } = ctx;

    // The Request ID is captured synchronously via waitForResponse in
    // fillNetworkCheck (single source of truth). Here we only listen for the
    // final submit confirmation.
    page.on('response', (res: Response) => {
      if (res.url().includes('/api/provider/update/submitrequest')) {
        void this.captureConfirmationFromResponse(res);
      }
    });

    await page.goto(getRfpStartUrl(), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  }

  protected async executeSubmission(
    ctx: PlaywrightSubmissionContext
  ): Promise<{
    confirmationNumber?: string;
    externalReference?: string;
    rawResponseText?: string;
  }> {
    const { page } = ctx;
    const data = ctx.input.providerData;
    if (!isAetnaRfpData(data)) {
      throw new Error('AetnaRfpAdapter: providerData is not in AetnaRfpProviderData shape');
    }

    this.assertSupported(data);

    await this.fillAllSteps(page, data);

    if (data.stopBeforeSubmit) {
      logger.info('AetnaRfpAdapter: stopBeforeSubmit set — not filing', {
        enrollmentRunId: ctx.input.enrollmentRunId,
        requestId: this.capturedRequestId,
      });
      return {
        externalReference: this.capturedRequestId ?? undefined,
        rawResponseText: 'Reached submit page; stopBeforeSubmit=true, not filed.',
      };
    }

    // Final submit. The post-submit confirmation parsing below is the one step
    // not verified during recon — capture confirmationNumber from the
    // submitrequest API response (wired in login()) plus a DOM fallback.
    await page
      .locator('button:has-text("Submit request for participation")')
      .first()
      .click();
    await page.waitForTimeout(8000);

    if (!this.capturedConfirmationNumber) {
      this.capturedConfirmationNumber = await this.readNumberFromDom(
        page,
        /Confirmation[^0-9]*([0-9]{5,})/i
      );
    }

    return {
      confirmationNumber: this.capturedConfirmationNumber ?? undefined,
      externalReference: this.capturedRequestId ?? undefined,
      rawResponseText: 'Aetna RFP submitted.',
    };
  }

  // ─── Step blocks ────────────────────────────────────────────────────────

  /** Every wizard page in order, with per-page screenshots, stopping at the
   * final submit confirmation page (never clicking Submit). */
  private async fillAllSteps(page: Page, data: AetnaRfpProviderData): Promise<void> {
    await this.fillGate(page, data);
    await this.shot(page, '01-gate');
    await this.fillSubmitter(page, data);
    await this.shot(page, '02-submitter');
    await this.fillNetworkCheck(page, data); // generates Request ID
    await this.shot(page, '03-network-check');
    await this.fillSpecialtyBH(page, data);
    await this.shot(page, '04-specialty');
    await this.fillContacting(page, data);
    await this.shot(page, '05-contacting');
    await this.fillLocation(page, data);
    await this.shot(page, '06-location');
    await this.fillAddresses(page);
    await this.shot(page, '07-addresses');
    await this.fillOther(page, data);
    await this.shot(page, '08-other');
    await this.fillBehavioralHealth(page, data);
    await this.shot(page, '09-review');

    const reachedSubmit =
      (await page
        .locator('button:has-text("Submit request for participation")')
        .count()) > 0;
    if (!reachedSubmit) {
      throw new Error('AetnaRfpAdapter: did not reach the final submit confirmation page');
    }
  }

  /** Gate: three cascading dropdowns -> Continue. */
  private async fillGate(page: Page, d: AetnaRfpProviderData): Promise<void> {
    await page.selectOption('#typeOfRFP', { label: d.payer });
    await page.waitForTimeout(800);
    await page.selectOption('#typeOfRFP1', {
      label: APPLYING_FOR_LABEL[d.lineOfBusiness],
    });
    await page.waitForTimeout(800);
    await page.selectOption('#typeOfRFP2', { label: JOINING_LABEL[d.joining] });
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Continue")').first().click();
    await page.waitForTimeout(3000);
  }

  /** Submitter page (/verify-sub) incl. the email-acknowledgement review-then-agree. */
  private async fillSubmitter(page: Page, d: AetnaRfpProviderData): Promise<void> {
    await page.locator('#lastName').fill(d.submitter.lastName);
    await page.locator('#firstName').fill(d.submitter.firstName);
    await page.selectOption('#role', { label: d.submitter.role });
    await page.locator('#email').fill(d.submitter.email);
    await page.locator('#verifyEmail').fill(d.submitter.email);
    await page.locator('#phoneNumber').fill(d.submitter.phone);
    await page.locator('#npi').fill(d.provider.npi);

    // Review-then-Agree: opening the acknowledgement (a new tab) enables the
    // Agree radio on this page.
    await page.locator('a.text-links:has-text("EMAIL ACKNOWLEDGEMENT")').click();
    await page.waitForTimeout(1200);
    await page.getByRole('radio', { name: 'Agree', exact: true }).click({ force: true });
    await page.locator('#checkboxSelect').check({ force: true });
    await page.locator('button:has-text("Continue")').first().click();
    await page.waitForTimeout(3000);
  }

  /** Step 1 Network Check (/np-check) — fires the participation check + Request ID. */
  private async fillNetworkCheck(page: Page, d: AetnaRfpProviderData): Promise<void> {
    await this.dismissMedallia(page);
    await page
      .locator('mat-radio-group[formcontrolname="teleHealthService"]')
      .getByText(d.telehealth ? 'Yes' : 'No', { exact: true })
      .click();
    if (d.telehealth) {
      // Answering Yes reveals the conditional "I provide" field (e.g. "Hybrid
      // services"). Fill it with the exact Aetna label or fail loudly BEFORE
      // the network check creates an Aetna footprint.
      await page.waitForTimeout(1000);
      await this.pickConditionalOption(
        page,
        d.telehealthDetail!.services,
        'network-check "I provide" (telehealth services)'
      );
    }
    await page.selectOption('#networkJoining', { index: 0 });
    await page.selectOption('#applicableSituation', {
      label: 'I want to be contracted in the state selected below',
    });
    await page.selectOption('#state', { label: d.location.state });
    await page.locator('#zipCode').fill(d.location.zip);
    await page.selectOption('#taxIdType', {
      label:
        d.provider.taxIdType === 'E'
          ? 'E - Employer identification number'
          : 'S - Social Security number',
    });
    await page.locator('#taxIDName').fill(d.provider.taxIdName);

    // Tax ID field is masked and resists .fill() — type it. Verify must match.
    await this.dismissMedallia(page);
    await page.locator('#taxId').click();
    await page.locator('#taxId').pressSequentially(d.provider.taxId, { delay: 60 });
    await page.locator('#verifyTaxID').click();
    await page.locator('#verifyTaxID').pressSequentially(d.provider.taxId, { delay: 60 });
    await page.locator('#practLastName').fill(d.provider.lastName);
    await page.locator('#practFirstName').fill(d.provider.firstName);
    await page.locator('#npi').fill(d.provider.npi);
    await page.locator('#checkboxSelect').check({ force: true });
    await page.locator('button:visible:has-text("Continue")').first().click();
    await page.waitForTimeout(6000);

    // Participation interstitial (a CDK overlay). Choose "None of the above
    // apply" and click the overlay's OWN Continue (the page button is behind it).
    await page
      .locator('input[type=checkbox][id="None of the above apply"]')
      .check({ force: true });
    await page.locator('#checkboxSelect').check({ force: true });
    // Clicking the interstitial's Continue fires the npcheck POST that commits
    // the application and returns the Request ID. Await the response together
    // with the click; that response is the SINGLE source of truth for the
    // Request ID (Aetna is slow, so allow 30s).
    const [npResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          r.url().includes('/api/provider/update/npcheck') &&
          r.url().includes('sendEmail=YES'),
        { timeout: 30_000 }
      ),
      page
        .locator('.cdk-overlay-pane button:visible:has-text("Continue")')
        .first()
        .click(),
    ]);

    // Passing the network check creates a real saved application at Aetna. If we
    // cannot read the Request ID off this response, that application is orphaned
    // (we can't resume against it), so fail loudly the moment it is created.
    const requestId = await this.extractRequestId(npResponse);
    if (!requestId) {
      throw new Error(
        'AetnaRfpAdapter: npcheck succeeded but no Request ID in the response — a saved application may now be orphaned at Aetna (cannot resume without the Request ID)'
      );
    }
    this.capturedRequestId = requestId;
    logger.info('AetnaRfpAdapter: captured Aetna Request ID', { requestId });

    // The Request-ID dialog offers "Continue session" to proceed.
    await page.locator('button:visible:has-text("Continue session")').first().click();
    await page.waitForTimeout(4000);
  }

  /** Step 2 Specialty Details (/panel-check) — BH branch incl. BH-manual review-then-agree. */
  private async fillSpecialtyBH(page: Page, d: AetnaRfpProviderData): Promise<void> {
    await page.selectOption('#degreeType', { label: d.provider.degree });
    await page.waitForTimeout(1000);
    await page.selectOption('#specialty', { label: d.provider.primarySpecialty });
    await page.locator('a:has-text("Behavioral Health Provider Manual")').first().click();
    await page.waitForTimeout(1200);
    await page.getByRole('radio', { name: 'Agree', exact: true }).click({ force: true });
    await page.locator('#checkboxSelect').check({ force: true });
    await page.locator('button:visible:has-text("Continue")').first().click();
    await page.waitForTimeout(4000);
  }

  /** Step 3 Contact / Contracting (/provider-info -> /provider-info-one). */
  private async fillContacting(page: Page, d: AetnaRfpProviderData): Promise<void> {
    // CAQH credentialing modal -> acknowledge.
    await page.locator('button:visible:has-text("Acknowledge and continue")').first().click();
    await page.waitForTimeout(1500);

    // NOTE: /provider-info (DOB, license, CAQH ID, hospitalist, e-prescribing)
    // is filled by fillProviderInfo() — split out for readability.
    await this.fillProviderInfo(page, d);

    // /provider-info-one: contracting contact + preferred method + signature.
    await page.getByRole('radio', { name: 'Submitter', exact: true }).first().click({ force: true });
    await page.waitForTimeout(1000);
    await page.locator('#EmailSub-input').check({ force: true });
    await page.waitForTimeout(800);
    await page
      .locator('mat-radio-group[formcontrolname="authRadioGroup"]')
      .getByRole('radio', { name: 'Submitter', exact: true })
      .click({ force: true });
    await page.locator('button:visible:has-text("Continue")').first().click();
    await page.waitForTimeout(3500);
  }

  /** Step 3 provider-info sub-fields (DOB / license / CAQH ID / two Y/N). */
  private async fillProviderInfo(page: Page, d: AetnaRfpProviderData): Promise<void> {
    await page.locator('#dob').fill(d.provider.dob);
    await page.locator('#medicalLicenseNumber').fill(d.provider.licenseNumber);
    await page.locator('#medLicenseExpDate').fill(d.provider.licenseExp);
    // CAQH Provider ID is validated against CAQH — must be real.
    await page.locator('#caqhID').click();
    await page.locator('#caqhID').pressSequentially(d.provider.caqhId, { delay: 50 });
    await page.locator('#caqhID').blur();
    // Hospitalist / electronic-prescribing attestations — pick Yes/No by text
    // within the radio group (default No). Hospitalist is the group containing
    // #Yes-input; e-prescribing the one containing #electronicPrescribingYes-input.
    await page
      .locator('mat-radio-group:has(#Yes-input)')
      .getByText(d.hospitalist ? 'Yes' : 'No', { exact: true })
      .click({ force: true });
    await page
      .locator('mat-radio-group:has(#electronicPrescribingYes-input)')
      .getByText(d.ePrescribing ? 'Yes' : 'No', { exact: true })
      .click({ force: true });
    await page.locator('button:visible:has-text("Continue")').first().click();
    await page.waitForTimeout(3500);
  }

  /** Step 4 Location (/location-one). */
  private async fillLocation(page: Page, d: AetnaRfpProviderData): Promise<void> {
    await page
      .locator('mat-radio-group[formcontrolname="placeOfService"]')
      .getByRole('radio', { name: d.location.placeOfService, exact: true })
      .click({ force: true });
    await page.locator('#street').fill(d.location.street);
    await page.locator('#city').fill(d.location.city);
    await page.locator('#phoneNumber').fill(d.location.phone);
    await page.locator('#faxNumber').fill(d.location.fax);
    // State / ZIP / County are pre-filled & locked (county derives from ZIP).
    // Languages autocompletes (office staff / interpreter) — not enforced at
    // validation, so best-effort by input id/label; never fail the run.
    await this.fillLanguagesBestEffort(page, d.location.staffLanguages, [
      'staffLanguage',
      'officeStaffLanguage',
      'languagesSpokenByOfficeStaff',
    ]);
    await this.fillLanguagesBestEffort(page, d.location.interpreterLanguages, [
      'interpreterLanguage',
      'languagesSpokenByInterpreter',
    ]);
    // Facility fee — optional Yes/No; best-effort (control name unverified).
    if (d.location.facilityFee !== undefined) {
      await this.pickYesNoBestEffort(page, ['facilityFee', 'facilityFees'], d.location.facilityFee);
    }
    // ADA accessible (required) — click the input id directly (label clicks do
    // not register here).
    await this.checkRadioInput(page, d.location.adaAccessible
      ? 'locationSpecific_yes-input'
      : 'locationSpecific_no-input');
    if (d.location.accessAccommodations) {
      await this.fillFirstMatchBestEffort(
        page,
        ['#accessAccommodations', 'input[formcontrolname="accessAccommodations"]'],
        d.location.accessAccommodations
      );
    }
    // Telehealth at this location — the conditional branch the reference
    // submission exercises (telehealth=Yes, Hybrid). REQUIRED fields when
    // telehealth is on, so these fail loudly rather than submit incomplete.
    if (d.telehealth) {
      await this.fillLocationTelehealth(page, d.telehealthDetail!);
    }
    await page.locator('button:visible:has-text("Continue")').first().click();
    await page.waitForTimeout(3500);
  }

  /**
   * Location-page telehealth block: "Telehealth services at this location" =
   * Yes reveals services-provided select, methods + types multiselects, and
   * the HIPAA-platform attestation. Selector strategy: exact formcontrolnames
   * were not captured during the 2026-06-15 recon walk (telehealth was No), so
   * each control is located by a small candidate list and fails loudly with
   * the field name if none match.
   */
  private async fillLocationTelehealth(
    page: Page,
    t: NonNullable<AetnaRfpProviderData['telehealthDetail']>
  ): Promise<void> {
    await this.dismissMedallia(page);
    // 1. Telehealth at this location: Yes (may be pre-answered from np-check).
    const groups = [
      'teleHealthService',
      'telehealthLocation',
      'teleHealthLocation',
      'telehealthServices',
    ];
    let toggled = false;
    for (const name of groups) {
      const group = page.locator(`mat-radio-group[formcontrolname="${name}"]`);
      if ((await group.count()) > 0) {
        await group.getByText('Yes', { exact: true }).first().click({ force: true });
        toggled = true;
        break;
      }
    }
    if (toggled) await page.waitForTimeout(1200);

    // 2. Services provided (e.g. "Hybrid services").
    await this.pickConditionalOption(page, t.services, 'location telehealth "services provided"');

    // 3. Methods + types — multiselects; select EVERY configured value. The
    //    two dropdowns are distinguished by their option vocabularies, so pick
    //    from whichever visible mat-select contains the option text.
    for (const method of t.methods) {
      await this.pickFromAnyMultiSelect(page, method, 'telehealth methods');
    }
    for (const type of t.types) {
      await this.pickFromAnyMultiSelect(page, type, 'telehealth types');
    }

    // 4. HIPAA-compliant platform attestation — required radio.
    await this.pickYesNoBestEffort(
      page,
      ['hipaaCompliant', 'hipaaCompliantPlatform', 'hipaaAttestation'],
      t.hipaaAttested,
      /* required */ true,
      'telehealth HIPAA-platform attestation'
    );
  }

  /** Step 4b Addresses (/location-second). */
  private async fillAddresses(page: Page): Promise<void> {
    await this.checkRadioInput(page, 'Same as primary service location address-input'); // mailing
    await this.checkRadioInput(page, 'Same as primary service location address -input'); // billing (trailing space)
    await this.checkRadioInput(page, 'additionalServiceRadio_no-input');
    await page.locator('button:visible:has-text("Continue")').first().click();
    await page.waitForTimeout(3500);
  }

  /** Step 5 Other (/other-info) — admitting privileges + the W9 attachment.
   * All controls on this page are optional to Aetna, so the radios are
   * best-effort; the W9 upload fails loudly if configured but not uploadable
   * (a missing attachment the reviewer expects is worse than a failed run). */
  private async fillOther(page: Page, d: AetnaRfpProviderData): Promise<void> {
    await this.dismissMedallia(page);
    if (d.hospitalAdmittingPrivileges !== undefined) {
      await this.pickYesNoBestEffort(
        page,
        ['hospitalAdmittingPrivileges', 'hospitalAdmitting'],
        d.hospitalAdmittingPrivileges
      );
    }
    if (d.facilityAdmittingPrivileges !== undefined) {
      await this.pickYesNoBestEffort(
        page,
        ['facilityAdmittingPrivileges', 'facilityAdmitting'],
        d.facilityAdmittingPrivileges
      );
    }
    if (d.w9?.s3Key) {
      await this.uploadW9(page, d.w9);
    }
    await page.locator('button:visible:has-text("Continue")').first().click();
    await page.waitForTimeout(3500);
  }

  /** Download the W9 from S3 to a temp file and attach it via the page's file
   * input. Fails loudly — a configured W9 must actually be attached. */
  private async uploadW9(page: Page, w9: { s3Key: string; fileName: string }): Promise<void> {
    const fileInput = page.locator('input[type="file"]');
    if ((await fileInput.count()) === 0) {
      throw new Error(
        'Aetna RFP: W9 is configured but no file-upload input was found on the Other Information page.'
      );
    }
    const bytes = await downloadFromS3(w9.s3Key);
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs/promises');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aetna-w9-'));
    const safeName = w9.fileName.replace(/[^\w.-]/g, '_') || 'w9.pdf';
    const filePath = path.join(dir, safeName);
    await fs.writeFile(filePath, bytes);
    try {
      await fileInput.first().setInputFiles(filePath);
      await page.waitForTimeout(3000); // allow the upload to register
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Step 6 Behavioral Health (/question-info). */
  private async fillBehavioralHealth(page: Page, d: AetnaRfpProviderData): Promise<void> {
    const bh = d.behavioralHealth;
    if (!bh) {
      throw new Error('AetnaRfpAdapter: behavioralHealth data required for BH line of business');
    }
    // Fail before touching the form: a BH packet with no age group or no focus
    // would otherwise select nothing in the multiselect and submit incomplete.
    if (bh.ageGroup.length === 0 || bh.practiceFocus.length === 0) {
      throw new Error(
        'AetnaRfpAdapter: behavioralHealth.ageGroup and practiceFocus must each have at least one value'
      );
    }
    // Age groups — multiselect; select EVERY value (one open/pick/close per
    // element, the interaction verified live on 2026-06-15).
    for (const ageGroup of bh.ageGroup) {
      await this.pickFromMultiSelect(page, 'ageGroupsDropdown', ageGroup);
    }
    // Attestation radios — driven by the top-level inputs, default No. Selected
    // by visible Yes/No text within each radio group (keyed off the known
    // formcontrolnames) rather than guessed input ids. (Aetna misspells the
    // medicaid control's formcontrolname as "medicad".)
    await this.pickYesNo(page, 'medicareCertified', d.medicareCertified);
    if (d.medicareCertified && d.medicarePtan) {
      // Medicare PTAN — revealed by medicareCertified=Yes. Best-effort by
      // candidate ids (control unverified live); it is display data, not a
      // gate, so a miss logs rather than fails.
      await page.waitForTimeout(800);
      await this.fillFirstMatchBestEffort(
        page,
        ['#ptan', '#medicarePtan', 'input[formcontrolname="ptan"]', 'input[formcontrolname="medicareCertificationNumber"]'],
        d.medicarePtan
      );
    }
    await this.pickYesNo(page, 'medicadCertified', d.medicaidCertified);
    await this.pickYesNo(page, 'aetnaEAPProgram', d.aetnaEapParticipation);
    await this.pickYesNo(page, 'americanSignLang', d.aslOffered);
    // Provider languages — autocomplete, not validation-enforced; best-effort.
    await this.fillLanguagesBestEffort(page, d.providerLanguages, [
      'providerLanguage',
      'languagesSpokenByProvider',
    ]);
    // Practice focus — multiselect; select EVERY value.
    for (const focus of bh.practiceFocus) {
      await this.pickFromMultiSelect(page, 'practiceFocusDropdown', focus);
    }
    await page.locator('button:visible:has-text("Continue")').first().click();
    await page.waitForTimeout(4000);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Hide the Medallia survey iframe that intercepts pointer events mid-flow. */
  private async dismissMedallia(page: Page): Promise<void> {
    await page.evaluate(
      `(() => { ['#MDigitalInvitationWrapper','#kampyleInviteContainer','#kampyleInvite'].forEach(s => { const e = document.querySelector(s); if (e) e.style.display = 'none'; }); })()`
    );
  }

  /**
   * Select an option by its exact label from whichever control on the page
   * offers it — native <select> first, then mat-select overlays. Used for
   * conditional fields whose ids were not captured during recon. Throws a
   * precise error naming the field if no control offers the label.
   */
  private async pickConditionalOption(
    page: Page,
    optionLabel: string,
    fieldName: string
  ): Promise<void> {
    // Native selects: find one whose options include the label.
    const selects = page.locator('select:visible');
    const count = await selects.count();
    for (let i = 0; i < count; i++) {
      const sel = selects.nth(i);
      const labels = await sel.locator('option').allTextContents();
      if (labels.some((l) => l.trim() === optionLabel)) {
        const already = await sel.evaluate(
          (el, want) => (el as HTMLSelectElement).selectedOptions[0]?.text.trim() === want,
          optionLabel
        );
        if (!already) await sel.selectOption({ label: optionLabel });
        return;
      }
    }
    // mat-selects: open each visible one and look for the option in the overlay.
    const matSelects = page.locator('mat-select:visible');
    const matCount = await matSelects.count();
    for (let i = 0; i < matCount; i++) {
      await matSelects.nth(i).click();
      await page.waitForTimeout(700);
      const option = page.locator('.cdk-overlay-pane mat-option', { hasText: optionLabel });
      if ((await option.count()) > 0) {
        await option.first().click();
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        return;
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    throw new Error(
      `Aetna RFP: could not find a control offering option '${optionLabel}' for ${fieldName} — the form may have changed; walk this page live and update the adapter.`
    );
  }

  /** Pick one value from whichever visible mat-select multiselect offers it.
   * Fails loudly naming the field — telehealth multiselects are required. */
  private async pickFromAnyMultiSelect(
    page: Page,
    optionText: string,
    fieldName: string
  ): Promise<void> {
    const matSelects = page.locator('mat-select:visible');
    const matCount = await matSelects.count();
    for (let i = 0; i < matCount; i++) {
      await matSelects.nth(i).click();
      await page.waitForTimeout(700);
      const option = page.locator('.cdk-overlay-pane mat-option', { hasText: optionText });
      if ((await option.count()) > 0) {
        const opt = option.first();
        const selected = (await opt.getAttribute('aria-selected')) === 'true';
        if (!selected) await opt.click();
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        return;
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    throw new Error(
      `Aetna RFP: no multiselect offers option '${optionText}' for ${fieldName} — check the stored value against Aetna's option labels.`
    );
  }

  /**
   * Yes/No radio by a list of candidate formcontrolnames. Optional controls
   * log-and-continue on a miss; required ones throw naming the field.
   */
  private async pickYesNoBestEffort(
    page: Page,
    candidates: string[],
    value: boolean,
    required = false,
    fieldName?: string
  ): Promise<void> {
    for (const name of candidates) {
      const group = page.locator(`mat-radio-group[formcontrolname="${name}"]`);
      if ((await group.count()) > 0) {
        await group
          .getByText(value ? 'Yes' : 'No', { exact: true })
          .first()
          .click({ force: true });
        await page.waitForTimeout(150);
        return;
      }
    }
    if (required) {
      throw new Error(
        `Aetna RFP: required control not found (tried formcontrolnames: ${candidates.join(', ')}) for ${fieldName ?? candidates[0]} — walk this page live and update the adapter.`
      );
    }
    logger.warn('AetnaRfpAdapter: optional Yes/No control not found, skipping', { candidates });
  }

  /** Fill the first selector that matches; log-and-skip when none do. */
  private async fillFirstMatchBestEffort(
    page: Page,
    selectors: string[],
    value: string
  ): Promise<void> {
    for (const sel of selectors) {
      const loc = page.locator(sel);
      if ((await loc.count()) > 0) {
        await loc.first().fill(value);
        return;
      }
    }
    logger.warn('AetnaRfpAdapter: optional field not found, skipping', { selectors });
  }

  /** Language autocompletes — type each value then Enter. Never fails. */
  private async fillLanguagesBestEffort(
    page: Page,
    values: string[] | undefined,
    controlCandidates: string[]
  ): Promise<void> {
    if (!values || values.length === 0) return;
    for (const name of controlCandidates) {
      const loc = page.locator(
        `input[formcontrolname="${name}"], #${name}`
      );
      if ((await loc.count()) > 0) {
        try {
          const input = loc.first();
          for (const v of values) {
            await input.click();
            await input.pressSequentially(v, { delay: 40 });
            await page.waitForTimeout(700);
            const opt = page.locator('.cdk-overlay-pane mat-option', { hasText: v });
            if ((await opt.count()) > 0) {
              await opt.first().click();
            } else {
              await page.keyboard.press('Enter');
            }
            await page.waitForTimeout(300);
          }
        } catch (err) {
          logger.warn('AetnaRfpAdapter: language autocomplete fill failed, continuing', {
            control: name,
            error: err instanceof Error ? err.message : 'unknown',
          });
        }
        return;
      }
    }
    logger.warn('AetnaRfpAdapter: language control not found, skipping', { controlCandidates });
  }

  /** Reliable mat-radio toggle: click the underlying <input> by id with force. */
  private async checkRadioInput(page: Page, inputId: string): Promise<void> {
    await page.locator(`input[id="${inputId}"]`).click({ force: true });
    await page.waitForTimeout(150);
  }

  /**
   * Pick Yes/No in a mat-radio-group by its formcontrolname, selecting the
   * option by visible text (no guessed input ids). `value` true -> "Yes".
   */
  private async pickYesNo(
    page: Page,
    formControlName: string,
    value: boolean | undefined
  ): Promise<void> {
    await page
      .locator(`mat-radio-group[formcontrolname="${formControlName}"]`)
      .getByText(value ? 'Yes' : 'No', { exact: true })
      .click({ force: true });
    await page.waitForTimeout(150);
  }

  /** Open a mat-select multiselect, pick an option in the overlay, close it. */
  private async pickFromMultiSelect(
    page: Page,
    selectId: string,
    optionText: string
  ): Promise<void> {
    await page.locator(`#${selectId}`).click();
    await page.waitForTimeout(900);
    await page
      .locator('.cdk-overlay-pane mat-option', { hasText: optionText })
      .first()
      .click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  private async readNumberFromDom(page: Page, pattern: RegExp): Promise<string | null> {
    const body = await page.evaluate(`document.body.innerText`);
    const match = typeof body === 'string' ? body.match(pattern) : null;
    return match?.[1] ?? null;
  }

  /** Parse the payer Request ID out of an npcheck API response (null if absent). */
  private async extractRequestId(res: Response): Promise<string | null> {
    try {
      const json = (await res.json()) as { data?: { requestId?: string } };
      return json?.data?.requestId ?? null;
    } catch {
      return null;
    }
  }

  private async captureConfirmationFromResponse(res: Response): Promise<void> {
    try {
      const json = (await res.json()) as {
        data?: { confirmationNumber?: string; requestId?: string };
      };
      const num = json?.data?.confirmationNumber ?? json?.data?.requestId;
      if (num) this.capturedConfirmationNumber = num;
    } catch {
      // DOM fallback covers it.
    }
  }
}

/** Runtime type guard narrowing the `unknown` providerData to our shape. */
export function isAetnaRfpData(value: unknown): value is AetnaRfpProviderData {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['payer'] === 'string' &&
    typeof v['lineOfBusiness'] === 'string' &&
    typeof v['joining'] === 'string' &&
    typeof v['submitter'] === 'object' &&
    typeof v['provider'] === 'object' &&
    typeof v['location'] === 'object'
  );
}
