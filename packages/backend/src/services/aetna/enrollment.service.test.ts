import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Hoisted mocks (accessible inside vi.mock factories) ----

const { mockSend, mockNewPage, mockBrowserClose, mockFillResult } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
  mockNewPage: vi.fn().mockResolvedValue({ setViewportSize: vi.fn().mockResolvedValue(undefined) }),
  mockBrowserClose: vi.fn().mockResolvedValue(undefined),
  mockFillResult: {
    requestId: 'REQ-12345',
    screenshots: [Buffer.from('page1'), Buffer.from('page2')],
    log: ['[2026-01-01T00:00:00.000Z] Filled form'],
  },
}));

// ---- Mocks ----

vi.mock('../../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('./form-filler.js', () => ({
  fillAetnaForm: vi.fn().mockResolvedValue(mockFillResult),
  submitFinalPage: vi.fn().mockResolvedValue(Buffer.from('confirmation')),
}));

vi.mock('./field-mapper.js', () => ({
  mapProviderToAetnaPayload: vi.fn().mockReturnValue({ gateway: {}, page2: {}, page3: {}, page4: {}, page5: {}, page6: {}, page7: {}, page8: {}, page9: {}, page10: {} }),
  maskSensitivePayload: vi.fn().mockImplementation((p: any) => p),
}));

vi.mock('./browser-pool.js', () => ({
  canLaunch: vi.fn().mockReturnValue(true),
  holdSession: vi.fn(),
  getSession: vi.fn().mockReturnValue({ browser: { close: vi.fn() }, page: {} }),
  releaseSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: function () { return { send: mockSend }; },
  PutObjectCommand: function (params: any) { return params; },
}));

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newPage: mockNewPage,
      close: mockBrowserClose,
    }),
  },
}));

// ---- Imports (after mocks) ----

import { startAetnaEnrollment, approveAndSubmit, rejectRun } from './enrollment.service.js';
import { prismaMock } from '../../../tests/helpers/mock-prisma.js';
import { canLaunch, holdSession, getSession, releaseSession } from './browser-pool.js';
import { fillAetnaForm, submitFinalPage } from './form-filler.js';

// ---- Helpers ----

function setupHappyPathMocks() {
  (canLaunch as any).mockReturnValue(true);
  prismaMock.payerEnrollment.findUnique.mockResolvedValue({ id: 'enroll-1', providerId: 'provider-1' } as any);
  prismaMock.provider.findUnique.mockResolvedValue({
    id: 'provider-1', npi: '1234567890', firstName: 'Jane', lastName: 'Doe',
    middleName: null, dateOfBirth: new Date(), gender: 'female', email: 'jane@test.com',
    phone: '555-123-4567', fax: null, providerType: 'psychiatrist', specialties: ['Psychiatry'],
    languages: ['English'], caqhProviderId: 'CAQH-12345', acceptingMedicare: true,
    acceptingMedicaid: false, ePrescribing: true, ssnEncrypted: null, practiceId: 'practice-1',
    practice: { id: 'practice-1', name: 'Test Practice', phone: '555-999-0000', email: 'office@test.com', website: null },
    practiceLocations: [{
      isPrimary: true, isActive: true, addressLine1: '123 Main St', addressLine2: null,
      city: 'Hartford', state: 'CT', zipCode: '06101', county: 'Hartford',
      phone: '555-111-2222', fax: null, taxIdEncrypted: '12-3456789', groupNpi: null,
      acceptingNewPatients: true, languagesSpoken: ['English'], officeHours: null,
      billingAddressLine1: null, billingCity: null, billingState: null, billingZipCode: null,
    }],
    licenses: [{ licenseNumber: 'MD-12345', state: 'CT', expirationDate: new Date('2027-12-31'), status: 'active' }],
    educations: [{ degree: 'md' }],
    hospitalAffiliations: [{ facilityName: 'Hartford Hospital', privilegeType: 'admitting', status: 'active' }],
  } as any);
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@test.com', phone: '555-123-4567',
  } as any);
  prismaMock.aetnaEnrollmentRun.update.mockResolvedValue({} as any);
  prismaMock.aetnaEnrollmentRun.findUnique.mockResolvedValue({ payerEnrollmentId: 'enroll-1' } as any);
  prismaMock.payerEnrollment.update.mockResolvedValue({} as any);
}

describe('enrollment.service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Re-setup mocks after restoreAllMocks
    (canLaunch as any).mockReturnValue(true);
    (holdSession as any).mockImplementation(vi.fn());
    (getSession as any).mockReturnValue({ browser: { close: vi.fn() }, page: {} });
    (releaseSession as any).mockResolvedValue(undefined);
    (fillAetnaForm as any).mockResolvedValue(mockFillResult);
    (submitFinalPage as any).mockResolvedValue(Buffer.from('confirmation'));
    mockSend.mockResolvedValue({});
    mockNewPage.mockResolvedValue({ setViewportSize: vi.fn().mockResolvedValue(undefined) });
    mockBrowserClose.mockResolvedValue(undefined);
    setupHappyPathMocks();
  });

  describe('startAetnaEnrollment', () => {
    it('happy path: loads data, fills form, uploads screenshots, holds session, sets awaiting_review', async () => {
      await startAetnaEnrollment('enroll-1', 'run-1', 'user-1');

      // Should update to filling, then awaiting_review
      const updateCalls = prismaMock.aetnaEnrollmentRun.update.mock.calls;
      expect(updateCalls.some((c: any) => c[0].data.status === 'filling')).toBe(true);
      expect(updateCalls.some((c: any) => c[0].data.status === 'awaiting_review')).toBe(true);

      // Should upload screenshots to S3
      expect(mockSend).toHaveBeenCalled();

      // Should hold the session
      expect(holdSession).toHaveBeenCalledWith('run-1', expect.anything(), expect.anything(), expect.any(Function));
    });

    it('sets run to failed when browser pool is busy', async () => {
      (canLaunch as any).mockReturnValue(false);

      await startAetnaEnrollment('enroll-1', 'run-1', 'user-1');

      expect(prismaMock.aetnaEnrollmentRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('busy') }),
        }),
      );
    });

    it('sets run to failed when enrollment not found', async () => {
      prismaMock.payerEnrollment.findUnique.mockResolvedValue(null);

      await startAetnaEnrollment('nonexistent', 'run-1', 'user-1');

      const failedCall = prismaMock.aetnaEnrollmentRun.update.mock.calls.find(
        (c: any) => c[0].data.status === 'failed',
      );
      expect(failedCall).toBeDefined();
      expect(failedCall![0].data.errorMessage).toContain('Enrollment not found');
    });

    it('sets run to failed when provider not found', async () => {
      prismaMock.provider.findUnique.mockResolvedValue(null);

      await startAetnaEnrollment('enroll-1', 'run-1', 'user-1');

      const failedCall = prismaMock.aetnaEnrollmentRun.update.mock.calls.find(
        (c: any) => c[0].data.status === 'failed',
      );
      expect(failedCall).toBeDefined();
      expect(failedCall![0].data.errorMessage).toContain('Provider not found');
    });

    it('stores errorPage, errorMessage, automationLog on FormFillError', async () => {
      const formFillError = new Error('Field not found') as any;
      formFillError.name = 'FormFillError';
      formFillError.page = 3;
      formFillError.automationLog = 'log line 1\nlog line 2';
      formFillError.screenshots = [Buffer.from('err-screenshot')];
      (fillAetnaForm as any).mockRejectedValue(formFillError);

      await startAetnaEnrollment('enroll-1', 'run-1', 'user-1');

      const failedCall = prismaMock.aetnaEnrollmentRun.update.mock.calls.find(
        (c: any) => c[0].data.status === 'failed',
      );
      expect(failedCall).toBeDefined();
      expect(failedCall![0].data.errorMessage).toBe('Field not found');
      expect(failedCall![0].data.errorPage).toBe(3);
      expect(failedCall![0].data.automationLog).toBe('log line 1\nlog line 2');
    });

    it('sets run to failed on S3 upload failure', async () => {
      mockSend.mockRejectedValue(new Error('S3 upload failed'));

      await startAetnaEnrollment('enroll-1', 'run-1', 'user-1');

      const failedCall = prismaMock.aetnaEnrollmentRun.update.mock.calls.find(
        (c: any) => c[0].data.status === 'failed',
      );
      expect(failedCall).toBeDefined();
      expect(failedCall![0].data.errorMessage).toContain('S3 upload failed');
    });

    it('holdSession timeout callback updates run to timed_out', async () => {
      let capturedOnTimeout: (() => Promise<void>) | undefined;
      (holdSession as any).mockImplementation((_runId: string, _browser: any, _page: any, onTimeout: () => Promise<void>) => {
        capturedOnTimeout = onTimeout;
      });

      await startAetnaEnrollment('enroll-1', 'run-1', 'user-1');

      expect(capturedOnTimeout).toBeDefined();
      await capturedOnTimeout!();

      expect(prismaMock.aetnaEnrollmentRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'timed_out' }),
        }),
      );
    });

    it('closes browser on error', async () => {
      (fillAetnaForm as any).mockRejectedValue(new Error('Form fill crash'));

      await startAetnaEnrollment('enroll-1', 'run-1', 'user-1');

      expect(mockBrowserClose).toHaveBeenCalled();
    });
  });

  describe('approveAndSubmit', () => {
    it('happy path: submits, uploads confirmation, updates to completed, updates parent enrollment, releases session', async () => {
      await approveAndSubmit('run-1');

      // Should update to submitting, then completed
      const updateCalls = prismaMock.aetnaEnrollmentRun.update.mock.calls;
      expect(updateCalls.some((c: any) => c[0].data.status === 'submitting')).toBe(true);
      expect(updateCalls.some((c: any) => c[0].data.status === 'completed')).toBe(true);

      // Should upload confirmation screenshot
      expect(mockSend).toHaveBeenCalled();

      // Should update parent enrollment
      expect(prismaMock.payerEnrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'submitted' }),
        }),
      );

      // Should release session
      expect(releaseSession).toHaveBeenCalledWith('run-1');
    });

    it('throws when session not found', async () => {
      (getSession as any).mockReturnValue(null);

      await expect(approveAndSubmit('run-1')).rejects.toThrow('Browser session expired');
    });

    it('updates to failed and releases session on submission failure', async () => {
      (submitFinalPage as any).mockRejectedValue(new Error('Submit button not found'));

      await approveAndSubmit('run-1');

      const failedCall = prismaMock.aetnaEnrollmentRun.update.mock.calls.find(
        (c: any) => c[0].data.status === 'failed',
      );
      expect(failedCall).toBeDefined();
      expect(failedCall![0].data.errorMessage).toContain('Submit button not found');

      // Should still release session
      expect(releaseSession).toHaveBeenCalledWith('run-1');
    });
  });

  describe('rejectRun', () => {
    it('calls releaseSession and updates to rejected with completedAt', async () => {
      await rejectRun('run-1');

      expect(releaseSession).toHaveBeenCalledWith('run-1');
      expect(prismaMock.aetnaEnrollmentRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'rejected',
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('works even if session was already released', async () => {
      (releaseSession as any).mockResolvedValue(undefined);

      await expect(rejectRun('run-1')).resolves.toBeUndefined();
    });
  });
});
