import type { Page, Response } from 'playwright';
import { logger } from '../../utils/logger.js';
import { PlaywrightBaseAdapter, type PlaywrightSubmissionContext } from './playwright-base-adapter.js';
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

const RFP_START_URL =
  'https://extaz-oci.aetna.com/pocui/join-the-aetna-network';

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
  };

  // Behavioral-health step (Step 6) — required when lineOfBusiness is BEHAVIORAL_HEALTH.
  behavioralHealth?: {
    ageGroup: string; // e.g. "Adults (Ages 18-64)"
    practiceFocus: string; // e.g. "Anxiety Disorders"
    medicareCertified: boolean;
    medicaidCertified: boolean;
    eapParticipation: boolean;
    americanSignLanguage: boolean;
  };

  telehealth: boolean;

  /** When true, fill everything but DO NOT click the final Submit. */
  stopBeforeSubmit?: boolean;
}

export class AetnaRfpAdapter extends PlaywrightBaseAdapter {
  readonly adapterType: AdapterType = 'AETNA_RFP';

  // Request ID captured from the npcheck API response (or the dialog as fallback).
  private capturedRequestId: string | null = null;
  private capturedConfirmationNumber: string | null = null;

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

    await page.goto(RFP_START_URL, { waitUntil: 'domcontentloaded' });
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

    // Guard the telehealth=Yes path: it reveals a conditional virtual-care field
    // this adapter never fills, so it would break mid-run AFTER a footprint is
    // already created. Block it up front until that branch is walked live.
    if (data.telehealth) {
      throw new Error('telehealth=Yes path not implemented');
    }

    if (data.lineOfBusiness !== 'BEHAVIORAL_HEALTH') {
      // The shared steps work for all lines, but Step 2 (specialty) and Step 6
      // (line-specific questions) have only been verified for Behavioral Health.
      // TODO: walk Medical/Dental/Facility/Pharmacy live, then implement their
      // Step 2 + Step 6 branches and remove this guard.
      throw new Error(
        `AetnaRfpAdapter: line of business ${data.lineOfBusiness} not yet implemented (only BEHAVIORAL_HEALTH is verified)`
      );
    }

    await this.fillGate(page, data);
    await this.fillSubmitter(page, data);
    await this.fillNetworkCheck(page, data); // generates Request ID
    await this.fillSpecialtyBH(page, data);
    await this.fillContacting(page, data);
    await this.fillLocation(page, data);
    await this.fillAddresses(page);
    await this.passThroughOther(page);
    await this.fillBehavioralHealth(page, data);

    const reachedSubmit =
      (await page
        .locator('button:has-text("Submit request for participation")')
        .count()) > 0;
    if (!reachedSubmit) {
      throw new Error('AetnaRfpAdapter: did not reach the final submit confirmation page');
    }

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
    // Hospitalist? -> No ; Electronic prescribing? -> No
    await page
      .locator('mat-radio-group:has(#Yes-input)')
      .getByText('No', { exact: true })
      .click({ force: true });
    await page
      .locator('mat-radio-group:has(#electronicPrescribingYes-input)')
      .getByText('No', { exact: true })
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
    // ADA accessible (required) — click the input id directly (label clicks do
    // not register here).
    await this.checkRadioInput(page, d.location.adaAccessible
      ? 'locationSpecific_yes-input'
      : 'locationSpecific_no-input');
    // Languages fields are autocompletes but are not enforced at validation.
    await page.locator('button:visible:has-text("Continue")').first().click();
    await page.waitForTimeout(3500);
  }

  /** Step 4b Addresses (/location-second). */
  private async fillAddresses(page: Page): Promise<void> {
    await this.checkRadioInput(page, 'Same as primary service location address-input'); // mailing
    await this.checkRadioInput(page, 'Same as primary service location address -input'); // billing (trailing space)
    await this.checkRadioInput(page, 'additionalServiceRadio_no-input');
    await page.locator('button:visible:has-text("Continue")').first().click();
    await page.waitForTimeout(3500);
  }

  /** Step 5 Other (/other-info) — all optional, pass straight through. */
  private async passThroughOther(page: Page): Promise<void> {
    await page.locator('button:visible:has-text("Continue")').first().click();
    await page.waitForTimeout(3500);
  }

  /** Step 6 Behavioral Health (/question-info). */
  private async fillBehavioralHealth(page: Page, d: AetnaRfpProviderData): Promise<void> {
    const bh = d.behavioralHealth;
    if (!bh) {
      throw new Error('AetnaRfpAdapter: behavioralHealth data required for BH line of business');
    }
    await this.pickFromMultiSelect(page, 'ageGroupsDropdown', bh.ageGroup);
    await this.checkRadioInput(page, bh.medicareCertified ? 'medicareCertifiedYes-input' : 'medicareCertifiedNo-input');
    await this.checkRadioInput(page, bh.medicaidCertified ? 'medicadCertifiedYes-input' : 'medicadCertifiedNo-input'); // Aetna's spelling
    await this.checkRadioInput(page, bh.eapParticipation ? 'aetnaEAPProgramYes-input' : 'aetnaEAPProgramNo-input');
    await this.checkRadioInput(page, bh.americanSignLanguage ? 'americanSignLangYes-input' : 'americanSignLangNo-input');
    await this.pickFromMultiSelect(page, 'practiceFocusDropdown', bh.practiceFocus);
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

  /** Reliable mat-radio toggle: click the underlying <input> by id with force. */
  private async checkRadioInput(page: Page, inputId: string): Promise<void> {
    await page.locator(`input[id="${inputId}"]`).click({ force: true });
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
