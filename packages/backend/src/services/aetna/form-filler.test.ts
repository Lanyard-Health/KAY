import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AetnaFormPayload } from './types.js';

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { fillAetnaForm, submitFinalPage } from './form-filler.js';

/** Creates a mock Playwright Locator with full chaining support */
function makeMockLocator(overrides: Record<string, any> = {}) {
  const locator: any = {
    waitFor: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    isChecked: vi.fn().mockResolvedValue(false),
    isVisible: vi.fn().mockResolvedValue(true),
    isDisabled: vi.fn().mockResolvedValue(false),
    textContent: vi.fn().mockResolvedValue(null),
    allTextContents: vi.fn().mockResolvedValue([]),
    check: vi.fn().mockResolvedValue(undefined),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(0),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  locator.first = vi.fn().mockReturnValue(locator);
  locator.nth = vi.fn().mockReturnValue(locator);
  return locator;
}

/** Creates a mock Playwright Page */
function makeMockPage(locatorOverrides: Record<string, any> = {}) {
  const mockLocator = makeMockLocator(locatorOverrides);
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue(mockLocator),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(true),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    _mockLocator: mockLocator, // exposed for assertions
  } as any;
}

/** Minimal valid AetnaFormPayload for testing */
function makeTestPayload(): AetnaFormPayload {
  return {
    gateway: { network: 'Aetna', category: 'MED', subcategory: 'new individual provider' },
    page2: {
      lastName: 'Smith', firstName: 'John', role: 'Provider',
      email: 'john@test.com', verifyEmail: 'john@test.com',
      phoneNumber: '555-123-4567', newNpiId: '1234567890',
    },
    page3: {
      teleHealthService: 'No', networkJoining: 'As a new individual provider',
      applicableSituation: 'I want to be contracted in the state selected below', state: 'Connecticut', zipCode: '06101',
      mnapplicant: 'no', taxIdType: 'S - Social Security number', taxIDName: 'John Smith', taxID: '123456789',
      verifyTaxID: '123456789', practLastName: 'Smith',
      practFirstName: 'John', npi: '1234567890',
    },
    page4: { degreeType: 'MD', specialty: 'Psychiatry', providerClassification: 'Specialist' },
    page5: {
      lastName: 'Smith', firstName: 'John', middleInitial: 'A',
      dob: '05/15/1980', state: 'CT', medicalLicenseNumber: 'MD-12345',
      medLicenseExpDate: '12/31/2027', caqhID: 'CAQH-12345',
      providerURL: '', acceptingNewPatients: 'Yes', electronicPrescribing: 'Yes',
    },
    page6: { contractingContact: 'Provider', preferredContactMethod: 'Email', authorizedContact: 'Provider' },
    page7: {
      street: '123 Main St', street2: '', city: 'Hartford', state: 'CT',
      zipcode: '06101', county: 'Hartford', phoneNumber: '555-111-2222',
      faxNumber: '555-111-2223', languages: 'English', workingDays: 'Monday-Friday',
    },
    page8: {
      mailingAddress: 'Same as primary service location address',
      billingAddress: 'Same as primary service location address',
      additionalServiceLocations: 'No',
    },
    page9: { hospitalPrivileges: 'Yes', facilityBased: 'No' },
    page10: {
      medicareCertified: 'Yes', medicaidCertified: 'No',
      aetnaEAPProgram: 'No', americanSignLanguage: 'No',
    },
  };
}

describe('form-filler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fillAetnaForm', () => {
    it('navigates to the portal URL via page.goto', async () => {
      const page = makeMockPage();
      await fillAetnaForm(page, makeTestPayload());

      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('aetna'),
        expect.objectContaining({ waitUntil: 'networkidle' }),
      );
    });

    it('calls locator with formcontrolname selectors', async () => {
      const page = makeMockPage();
      await fillAetnaForm(page, makeTestPayload());

      // Should have called locator many times for form fields
      const locatorCalls = page.locator.mock.calls.map((c: any[]) => c[0]);
      const formcontrolCalls = locatorCalls.filter((s: string) => s.includes('formcontrolname'));
      expect(formcontrolCalls.length).toBeGreaterThan(10);
    });

    it('returns FillResult with screenshots array (one per page)', async () => {
      const page = makeMockPage();
      const result = await fillAetnaForm(page, makeTestPayload());

      expect(result.screenshots).toBeDefined();
      expect(Array.isArray(result.screenshots)).toBe(true);
      // Pages 2-10 = 9 screenshots
      expect(result.screenshots.length).toBe(9);
      expect(result.screenshots[0]).toBeInstanceOf(Buffer);
    });

    it('returns requestId from page 3 when visible', async () => {
      const mockLocator = makeMockLocator({
        isVisible: vi.fn().mockResolvedValue(true),
        textContent: vi.fn().mockResolvedValue('Request ID: REQ-12345'),
      });
      const page = makeMockPage();
      // Override the locator for the request ID element
      page.locator.mockImplementation((selector: string) => {
        if (selector.includes('Request ID') || selector.includes('request-id') || selector.includes('request')) {
          return mockLocator;
        }
        return makeMockLocator();
      });

      const result = await fillAetnaForm(page, makeTestPayload());
      expect(result.requestId).toBe('REQ-12345');
    });

    it('returns requestId: null when element not visible', async () => {
      const page = makeMockPage({
        isVisible: vi.fn().mockResolvedValue(false),
        textContent: vi.fn().mockResolvedValue(null),
      });

      const result = await fillAetnaForm(page, makeTestPayload());
      expect(result.requestId).toBeNull();
    });

    it('includes timestamped log entries', async () => {
      const page = makeMockPage();
      const result = await fillAetnaForm(page, makeTestPayload());

      expect(result.log.length).toBeGreaterThan(0);
      // Each log entry should have an ISO timestamp
      for (const entry of result.log) {
        expect(entry).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
      }
    });

    it('on error at page N, throws FormFillError with page, automationLog, and screenshots', async () => {
      const page = makeMockPage();
      // Make page 2 fillInput fail by having locator throw on waitFor
      let callCount = 0;
      const failingLocator = makeMockLocator({
        waitFor: vi.fn().mockImplementation(() => {
          callCount++;
          // Let gateway calls through, fail on page 2
          if (callCount > 15) throw new Error('Element not found');
          return Promise.resolve();
        }),
      });
      page.locator.mockReturnValue(failingLocator);

      try {
        await fillAetnaForm(page, makeTestPayload());
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.name).toBe('FormFillError');
        expect(typeof err.page).toBe('number');
        expect(typeof err.automationLog).toBe('string');
        expect(Array.isArray(err.screenshots)).toBe(true);
      }
    });
  });

  describe('submitFinalPage', () => {
    it('clicks submit button and returns screenshot', async () => {
      const page = makeMockPage();
      const result = await submitFinalPage(page);

      expect(result).toBeInstanceOf(Buffer);
      // Should have called locator for the submit button
      expect(page.locator).toHaveBeenCalledWith(
        expect.stringContaining('Submit Request for Participation'),
      );
    });
  });

  describe('FormFillError', () => {
    it('has correct name, stores page number, log, screenshots', async () => {
      const page = makeMockPage();
      // Force an error by making goto throw
      page.goto.mockRejectedValue(new Error('Network error'));

      try {
        await fillAetnaForm(page, makeTestPayload());
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.name).toBe('FormFillError');
        expect(err.page).toBe(1); // Fails on gateway (page 1)
        expect(err.automationLog).toContain('Navigating to Aetna form');
        expect(err.automationLog).toContain('ERROR on page 1');
        expect(err.message).toBe('Network error');
      }
    });
  });
});
