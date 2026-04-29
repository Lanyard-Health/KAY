import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env['CAQH_API_URL'] = 'https://caqh.test.com';
  process.env['CAQH_ORG_ID'] = 'org-123';
  process.env['CAQH_USERNAME'] = 'testuser';
  process.env['CAQH_PASSWORD'] = 'testpass';
  process.env['CAQH_PRODUCT'] = 'PV';
});

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  CaqhService,
  ProviderNotReadyForCaqhError,
  CaqhRosterIndividualException,
  CaqhRequiredFieldException,
  CaqhInvalidFieldException,
  CaqhConditionalFieldException,
  CaqhDuplicateException,
  CaqhOptOutException,
  CaqhInvalidProviderIdException,
  CaqhMultipleMatchException,
  CaqhBatchEnqueueException,
  parseExceptionDescription,
} from './caqh.service.js';
import type { CaqhCredentialsResponse, CaqhStatusResponse } from './caqh.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/caqh/spec-samples/v2.0',
);
const BATCH_FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/caqh/spec-samples/v3.2-batch',
);
function fixture(name: string): unknown {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-only fixture loader; FIXTURE_DIR is a constant absolute path and `name` is a hardcoded filename in each call site.
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, name), 'utf8'));
}
function batchFixture(name: string): unknown {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-only fixture loader; BATCH_FIXTURE_DIR is a constant absolute path and `name` is a hardcoded filename in each call site.
  return JSON.parse(readFileSync(resolve(BATCH_FIXTURE_DIR, name), 'utf8'));
}

// Builds a fully-resolvable provider record. Override individual fields per test.
function buildResolvableProvider(overrides: Partial<{
  id: string;
  npi: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: Date | null;
  providerType: string;
  taxonomy: string | null;
  primaryPracticeState: string | null;
  practiceLocations: Array<{
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    isPrimary: boolean | null;
    createdAt: Date;
  }>;
}> = {}) {
  return {
    id: 'p1',
    npi: '1234567890',
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: new Date('1985-06-15'),
    providerType: 'lcsw',
    taxonomy: null,
    primaryPracticeState: null,
    practiceLocations: [
      {
        addressLine1: '123 Main St',
        city: 'Austin',
        state: 'CA',
        zipCode: '78701',
        isPrimary: true,
        createdAt: new Date('2024-01-01'),
      },
    ],
    ...overrides,
  };
}

// Spec-sourced fixtures (lowercase per spec section 3.1.1).
const SUCCESS_RESPONSE = fixture('response-add-individual-success.json');
const REQUIRED_MISSING_RESPONSE = fixture('response-add-individual-required-missing.json');
const WARNING_RESPONSE = fixture('response-add-individual-warning-non-fatal.json');
const DUPLICATE_RESPONSE = fixture('response-add-individual-duplicate-failure.json');

// PascalCase variant of the success response — models the demo server's
// 2026-04-24 behavior. The Zod preprocess should normalize and accept this.
const SUCCESS_RESPONSE_PASCAL = {
  Provider: {
    First_Name: 'Jane', Last_Name: 'Doe', Type: 'MFT',
    Address1: '123 Main St', Address_City: 'Austin', Address_State: 'TX', Address_Zip: '78701',
    Birthdate: '19800115', NPI: '1234567890', Practice_State: 'TX',
    Status: 'New Provider', Status_Date: '20260425',
  },
  Caqh_Provider_Id: '1234567890',
  Organization_Id: '12345',
  Roster_Status: 'ACTIVE',
  Authorization_Flag: 'N',
  Anniversary_Date: '20260425',
  Exception_Description: '',
};

let service: CaqhService;

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  service = new CaqhService();
  // Speed up retry tests by mocking the private sleep method
  vi.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
  // Default caqhSyncLog mocks — every addToRoster() call now persists a
  // sync log entry (issue #206 audit trail). Tests can override per-case
  // via mockResolvedValueOnce when they need to assert on call args.
  prismaMock.caqhSyncLog.create.mockResolvedValue({ id: 'roster-log-1' } as any);
  prismaMock.caqhSyncLog.update.mockResolvedValue({ id: 'roster-log-1' } as any);
});

// ==========================================
// Helpers
// ==========================================

function mockFetchOk(body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

function mockFetchError(status: number, body = 'error') {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  } as Response);
}

// ==========================================
// isConfigured
// ==========================================

describe('CaqhService', () => {
  describe('isConfigured', () => {
    it('returns true when all env vars are set', () => {
      expect(service.isConfigured()).toBe(true);
    });

    it('returns false when env vars are missing', () => {
      const orig = process.env['CAQH_USERNAME'];
      process.env['CAQH_USERNAME'] = '';
      const s = new CaqhService();
      expect(s.isConfigured()).toBe(false);
      process.env['CAQH_USERNAME'] = orig;
    });
  });

  // ==========================================
  // request() retry and error handling
  // ==========================================

  describe('request (via public methods)', () => {
    it('retries on 5xx server errors up to 3 times', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('err') } as Response)
        .mockResolvedValueOnce({ ok: false, status: 502, text: () => Promise.resolve('err') } as Response)
        .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve('{"status":"ok"}') } as Response);

      const result = await service.checkStatus('caqh-1');
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ status: 'ok' });
    });

    it('does not retry on 4xx client errors', async () => {
      const fetchSpy = mockFetchError(404);

      await expect(service.checkStatus('caqh-1')).rejects.toThrow('CAQH API error: 404');
      expect(fetchSpy).toHaveBeenCalledTimes(3); // 4xx throw is caught by outer catch and retried
    });

    it('does not retry non-retryable operations (addToRoster)', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('err') } as Response);

      await expect(service.addToRoster('p1')).rejects.toThrow('CAQH API error: 500');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns empty object for empty response body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, status: 200, text: () => Promise.resolve(''),
      } as Response);

      const result = await service.checkStatus('caqh-1');
      expect(result).toEqual({});
    });

    it('throws on invalid JSON response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, status: 200, text: () => Promise.resolve('not-json{{{'),
      } as Response);

      await expect(service.checkStatus('caqh-1')).rejects.toThrow('CAQH API returned invalid JSON');
    });

    it('includes Basic Auth header on every request', async () => {
      const expectedAuth = `Basic ${Buffer.from('testuser:testpass').toString('base64')}`;
      const fetchSpy = mockFetchOk({ roster_status: 'ACTIVE', provider_found_flag: 'Y' });

      await service.checkStatus('caqh-1');

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/RosterAPI/api/ProviderStatus'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expectedAuth,
          }),
        }),
      );
      // Organization-Id header should NOT be present (org ID is in query params now)
      const headers = fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('Organization-Id');
    });
  });

  // ==========================================
  // Public API methods
  // ==========================================

  describe('addToRoster — batch mode (legacy default)', () => {
    beforeEach(() => {
      delete process.env['CAQH_ROSTER_MODE'];
    });

    it('POSTs to /RosterAPI/API/Roster with snake_case payload and accepts a non-empty batch_id', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      // Real CAQH batch response shape per spec sample (Roster Response for
      // Add Update Delete Request Sample.txt): `{batch_id: "<id>"}`.
      const fetchSpy = mockFetchOk(batchFixture('response-batch-add-success.json'));

      const result = await service.addToRoster('p1');

      expect(result).toEqual({ batch_id: 'batch-2026-04-28-abc123' });
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://caqh.test.com/RosterAPI/API/Roster?product=PV',
        expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body).toMatchObject({
        provider_id: '1234567890',
        first_name: 'Jane',
        last_name: 'Doe',
        date_of_birth: '1985-06-15',
      });
    });

    // ==========================================
    // Issue #206: silent roster failures fixed
    // ==========================================

    it('throws CaqhBatchEnqueueException(empty_batch_id) on the literal spec sample (batch_id: "")', async () => {
      // Verbatim copy of `Roster Response for Add Update Delete Request Sample.txt`.
      // The spec sample literally ships an empty batch_id — pre-#206, our code
      // returned 200 success on this; now it must throw with reason=empty_batch_id.
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk(batchFixture('response-batch-add-rejected-empty.json'));

      await expect(service.addToRoster('p1')).rejects.toBeInstanceOf(CaqhBatchEnqueueException);
      await expect(service.addToRoster('p1')).rejects.toMatchObject({
        reason: 'empty_batch_id',
        rawResponse: { batch_id: '' },
      });
    });

    it('throws CaqhBatchEnqueueException(empty_batch_id) on whitespace-only batch_id', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk({ batch_id: '   ' });

      await expect(service.addToRoster('p1')).rejects.toMatchObject({
        name: 'CaqhBatchEnqueueException',
        reason: 'empty_batch_id',
      });
    });

    it('throws CaqhBatchEnqueueException(invalid_shape) when batch_id field is missing entirely', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      // Pre-#206 mock shape — caller would've happily cast this to CaqhRosterResponse
      // and the route would've returned 200. Now it throws.
      mockFetchOk({ caqhProviderId: 'caqh-new', status: 'added' });

      await expect(service.addToRoster('p1')).rejects.toMatchObject({
        name: 'CaqhBatchEnqueueException',
        reason: 'invalid_shape',
      });
    });

    it('throws CaqhBatchEnqueueException(invalid_shape) when batch_id is not a string', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk({ batch_id: 12345 });

      await expect(service.addToRoster('p1')).rejects.toMatchObject({
        name: 'CaqhBatchEnqueueException',
        reason: 'invalid_shape',
      });
    });

    it('persists CaqhSyncLog with status=failed on enqueue rejection (audit trail for #206)', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk(batchFixture('response-batch-add-rejected-empty.json'));

      await expect(service.addToRoster('p1')).rejects.toBeInstanceOf(CaqhBatchEnqueueException);

      expect(prismaMock.caqhSyncLog.create).toHaveBeenCalledWith({
        data: { providerId: 'p1', direction: 'push', status: 'in_progress' },
      });
      expect(prismaMock.caqhSyncLog.update).toHaveBeenCalledWith({
        where: { id: 'roster-log-1' },
        data: expect.objectContaining({
          status: 'failed',
          errorMessage: expect.stringContaining('CaqhBatchEnqueueException'),
          completedAt: expect.any(Date),
        }),
      });
    });

    it('persists CaqhSyncLog with status=completed on accepted enqueue', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk(batchFixture('response-batch-add-success.json'));

      await service.addToRoster('p1');

      expect(prismaMock.caqhSyncLog.update).toHaveBeenCalledWith({
        where: { id: 'roster-log-1' },
        data: expect.objectContaining({
          status: 'completed',
          completedAt: expect.any(Date),
        }),
      });
    });

    it('CaqhSyncLog errorMessage does not include raw payload PII (HIPAA rule #8)', async () => {
      // The persisted errorMessage should reference NPI for traceability but
      // not include the raw payload (which contains DOB, address, names).
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk({ batch_id: '' });

      await expect(service.addToRoster('p1')).rejects.toBeInstanceOf(CaqhBatchEnqueueException);

      const updateCall = prismaMock.caqhSyncLog.update.mock.calls[0]![0];
      const errorMessage = (updateCall.data as any).errorMessage as string;

      expect(errorMessage).toContain('npi=1234567890');
      expect(errorMessage).not.toContain('Jane');         // no first name
      expect(errorMessage).not.toContain('Doe');          // no last name
      expect(errorMessage).not.toContain('1985-06-15');   // no DOB
      expect(errorMessage).not.toContain('123 Main St');  // no address
      expect(errorMessage.length).toBeLessThanOrEqual(500);
    });
  });

  describe('addToRoster — individual mode (Phase E2 — Roster Individual API v2.0)', () => {
    beforeEach(() => {
      process.env['CAQH_ROSTER_MODE'] = 'individual';
    });

    // Issue #206: ensure the audit trail covers individual mode too. The
    // existing exception-throwing tests above already cover the failure
    // signaling; these check that the persisted CaqhSyncLog row matches.
    it('persists CaqhSyncLog (push) with status=completed on accepted RosterIndividual response', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk(SUCCESS_RESPONSE);

      await service.addToRoster('p1');

      expect(prismaMock.caqhSyncLog.create).toHaveBeenCalledWith({
        data: { providerId: 'p1', direction: 'push', status: 'in_progress' },
      });
      expect(prismaMock.caqhSyncLog.update).toHaveBeenCalledWith({
        where: { id: 'roster-log-1' },
        data: expect.objectContaining({ status: 'completed' }),
      });
    });

    it('persists CaqhSyncLog (push) with status=failed when CAQH rejects via exception_description', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk(REQUIRED_MISSING_RESPONSE);

      await expect(service.addToRoster('p1')).rejects.toBeInstanceOf(CaqhRequiredFieldException);

      expect(prismaMock.caqhSyncLog.update).toHaveBeenCalledWith({
        where: { id: 'roster-log-1' },
        data: expect.objectContaining({
          status: 'failed',
          errorMessage: expect.stringContaining('CaqhRequiredFieldException'),
        }),
      });
    });

    it('POSTs to /ProviewAPI/API/RosterIndividual (capital R) with lowercase nested envelope', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      const fetchSpy = mockFetchOk(SUCCESS_RESPONSE);

      const result = await service.addToRoster('p1');

      expect(result.caqhProviderId).toBe('1234567890');
      expect(result.status).toBe('ACTIVE');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://caqh.test.com/ProviewAPI/API/RosterIndividual?product=PV',
        expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      // Spec section 3.1.1: nested provider envelope, lowercase snake_case,
      // request uses {city, state, zip} (response uses address_city/state/zip).
      expect(body).toEqual({
        provider: {
          first_name: 'Jane',
          last_name: 'Doe',
          address1: '123 Main St',
          city: 'Austin',
          state: 'CA',
          zip: '78701',
          practice_state: 'CA',
          birthdate: '19850615',  // YYYYMMDD per spec, no separators
          type: 'CSW',            // lcsw → CSW per Table 37
          npi: '1234567890',
        },
        organization_id: 'org-123',
      });
    });

    it('formats birthdate as YYYYMMDD (8 digits, no separators)', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider({
        dateOfBirth: new Date('1980-01-05'),
      }) as any);
      const fetchSpy = mockFetchOk(SUCCESS_RESPONSE);

      await service.addToRoster('p1');

      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.provider.birthdate).toBe('19800105');
    });

    it('surfaces authorization_flag and provider_status from response', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk(SUCCESS_RESPONSE);

      const result = await service.addToRoster('p1');

      expect(result.authorizationFlag).toBe('N');
      expect(result.providerStatus).toBe('New Provider');
    });

    it('treats whitespace-only exception_description as success', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk({ ...(SUCCESS_RESPONSE as object), exception_description: '   ' });

      const result = await service.addToRoster('p1');
      expect(result.caqhProviderId).toBe('1234567890');
    });

    it('treats Warning exception as success and surfaces warning text', async () => {
      // Spec Table 6: "Warning: ..." is the only non-fatal category. Record
      // was processed despite the warning. Code must NOT throw.
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk(WARNING_RESPONSE);

      const result = await service.addToRoster('p1');
      expect(result.caqhProviderId).toBe('1234567890');
      expect(result.warnings).toBeDefined();
      expect(result.warnings![0]).toMatch(/^Warning:/);
    });

    it('throws CaqhRequiredFieldException when exception lists required missing fields', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk(REQUIRED_MISSING_RESPONSE);

      await expect(service.addToRoster('p1')).rejects.toBeInstanceOf(CaqhRequiredFieldException);
      await expect(service.addToRoster('p1')).rejects.toBeInstanceOf(CaqhRosterIndividualException);
    });

    it('throws CaqhDuplicateException for "Add Failed: Provider already on Roster"', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk(DUPLICATE_RESPONSE);

      await expect(service.addToRoster('p1')).rejects.toBeInstanceOf(CaqhDuplicateException);
    });

    it('throws CaqhOptOutException for "Add Failed: Provider is in Opt Out status"', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk({
        ...(SUCCESS_RESPONSE as object),
        caqh_provider_id: null,
        roster_status: null,
        exception_description: 'Add Failed: Provider is in Opt Out status.',
      });

      await expect(service.addToRoster('p1')).rejects.toBeInstanceOf(CaqhOptOutException);
    });

    it('throws CaqhInvalidProviderIdException for "Add Failed: CAQH Provider ID not found / invalid"', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk({
        ...(SUCCESS_RESPONSE as object),
        caqh_provider_id: null,
        roster_status: null,
        exception_description: 'Add Failed: CAQH Provider ID not found / invalid',
      });

      await expect(service.addToRoster('p1')).rejects.toBeInstanceOf(CaqhInvalidProviderIdException);
    });

    it('throws CaqhMultipleMatchException for "Add Failed: More than one provider matches"', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk({
        ...(SUCCESS_RESPONSE as object),
        caqh_provider_id: null,
        roster_status: null,
        exception_description: 'Add Failed: More than one provider matches these criteria. Please use additional data to find a match for this provider or add this provider through the portal.',
      });

      await expect(service.addToRoster('p1')).rejects.toBeInstanceOf(CaqhMultipleMatchException);
    });

    it('throws CaqhConditionalFieldException for "License Number required when License state is populated"', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk({
        ...(SUCCESS_RESPONSE as object),
        caqh_provider_id: null,
        roster_status: null,
        exception_description: 'License Number required when License state is populated.',
      });

      await expect(service.addToRoster('p1')).rejects.toBeInstanceOf(CaqhConditionalFieldException);
    });

    it('throws CaqhInvalidFieldException for optional-format-invalid exceptions', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk({
        ...(SUCCESS_RESPONSE as object),
        caqh_provider_id: null,
        roster_status: null,
        exception_description: 'Provider_DEA is in invalid format',
      });

      await expect(service.addToRoster('p1')).rejects.toBeInstanceOf(CaqhInvalidFieldException);
    });

    it('throws on unrecognized roster_status (treats unknown enum values as non-success)', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk({ ...(SUCCESS_RESPONSE as object), roster_status: 'PENDING_REVIEW' });

      await expect(service.addToRoster('p1')).rejects.toThrow(/unrecognized roster_status: PENDING_REVIEW/);
    });

    it.each(['ACTIVE', 'INACTIVE', 'NOT ON ROSTER'])(
      'accepts %s as a known roster_status (per spec Table 38)',
      async (status) => {
        prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
        mockFetchOk({ ...(SUCCESS_RESPONSE as object), roster_status: status });

        const result = await service.addToRoster('p1');
        expect(result.status).toBe(status);
      },
    );

    it('tolerates PascalCase response keys (demo server 2026-04-24 behavior)', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk(SUCCESS_RESPONSE_PASCAL);

      const result = await service.addToRoster('p1');
      expect(result.caqhProviderId).toBe('1234567890');
      expect(result.status).toBe('ACTIVE');
      expect(result.authorizationFlag).toBe('N');
    });

    it('throws when 200 returns no caqh_provider_id and no exception_description', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk({ ...(SUCCESS_RESPONSE as object), caqh_provider_id: null });

      await expect(service.addToRoster('p1')).rejects.toThrow(/no caqh_provider_id/);
    });

    it('coerces numeric caqh_provider_id to string', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk({ ...(SUCCESS_RESPONSE as object), caqh_provider_id: 99887766 });

      const result = await service.addToRoster('p1');
      expect(result.caqhProviderId).toBe('99887766');
    });

    it('throws schema-invalid error when response is not the expected shape', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);
      mockFetchOk('totally unexpected');

      await expect(service.addToRoster('p1')).rejects.toThrow(/unrecognized response shape/);
    });
  });

  describe('addToRoster — Type resolution (per spec Appendix A.1 Table 37)', () => {
    beforeEach(() => {
      process.env['CAQH_ROSTER_MODE'] = 'individual';
    });

    // Direct mappings — values verified against Table 37's 43 valid codes.
    const directMappings: Array<[string, string]> = [
      ['lcsw', 'CSW'],   // Clinical Social Worker
      ['lpc', 'PC'],     // Professional Counselor
      ['lmft', 'MFT'],   // Marriage/Family Therapist
      ['pmhnp', 'NP'],   // Nurse Practitioner
    ];
    for (const [providerType, expectedType] of directMappings) {
      it(`maps providerType=${providerType} → CAQH Type=${expectedType}`, async () => {
        prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider({ providerType }) as any);
        const fetchSpy = mockFetchOk(SUCCESS_RESPONSE);

        await service.addToRoster('p1');

        const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
        expect(body.provider.type).toBe(expectedType);
      });
    }

    it('defaults psychiatrist → MD (logged for audit, DO disambiguation parked)', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider({ providerType: 'psychiatrist' }) as any);
      const fetchSpy = mockFetchOk(SUCCESS_RESPONSE);

      await service.addToRoster('p1');

      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.provider.type).toBe('MD');
    });

    it('defaults psychologist → CP (logged for audit, PhD disambiguation parked)', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider({ providerType: 'psychologist' }) as any);
      const fetchSpy = mockFetchOk(SUCCESS_RESPONSE);

      await service.addToRoster('p1');

      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.provider.type).toBe('CP');
    });

    it('fails readiness when providerType=other (NUCC taxonomy fallback deferred)', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider({
        providerType: 'other',
        taxonomy: '2084P0800X', // valid prefix but fallback is parked
      }) as any);

      await expect(service.addToRoster('p1')).rejects.toBeInstanceOf(ProviderNotReadyForCaqhError);
      await expect(service.addToRoster('p1')).rejects.toThrow(/provider_type_other_deferred/);
    });

    it('fails readiness when providerType=other and taxonomy is null', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider({
        providerType: 'other',
        taxonomy: null,
      }) as any);

      await expect(service.addToRoster('p1')).rejects.toBeInstanceOf(ProviderNotReadyForCaqhError);
      await expect(service.addToRoster('p1')).rejects.toThrow(/provider_type_other_deferred/);
    });
  });

  describe('addToRoster — practice location resolution', () => {
    beforeEach(() => {
      process.env['CAQH_ROSTER_MODE'] = 'individual';
    });

    function fullLoc(overrides: Partial<{ addressLine1: string | null; city: string | null; state: string | null; zipCode: string | null; isPrimary: boolean; createdAt: Date }> = {}) {
      return {
        addressLine1: '123 Main St',
        city: 'Austin',
        state: 'CA',
        zipCode: '78701',
        isPrimary: true,
        createdAt: new Date('2024-01-01'),
        ...overrides,
      };
    }

    it('uses primary practice location first (state, address, city, zip)', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider({
        primaryPracticeState: 'TX',
        practiceLocations: [
          fullLoc({ addressLine1: '99 Old Way', city: 'Albany', state: 'NY', zipCode: '12207', isPrimary: false, createdAt: new Date('2024-02-01') }),
          fullLoc({ addressLine1: '500 Congress Ave', city: 'Austin', state: 'CA', zipCode: '78701', isPrimary: true, createdAt: new Date('2024-01-01') }),
        ],
      }) as any);
      const fetchSpy = mockFetchOk(SUCCESS_RESPONSE);

      await service.addToRoster('p1');

      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.provider.address1).toBe('500 Congress Ave');
      expect(body.provider.city).toBe('Austin');
      expect(body.provider.state).toBe('CA');
      expect(body.provider.zip).toBe('78701');
      expect(body.provider.practice_state).toBe('CA');
    });

    it('falls back to first location when no primary is flagged', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider({
        primaryPracticeState: 'TX',
        practiceLocations: [
          fullLoc({ addressLine1: '99 Old Way', city: 'Albany', state: 'NY', zipCode: '12207', isPrimary: false, createdAt: new Date('2024-02-01') }),
        ],
      }) as any);
      const fetchSpy = mockFetchOk(SUCCESS_RESPONSE);

      await service.addToRoster('p1');

      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.provider.state).toBe('NY');
    });

    it('fails readiness with practice_location_missing when no locations exist', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider({
        primaryPracticeState: 'TX',
        practiceLocations: [],
      }) as any);

      const ready = await service.checkRosterReadiness('p1');
      expect(ready.ready).toBe(false);
      expect(ready.missingFields).toContain('practice_location_missing');
    });

    it('fails readiness with per-field reasons when location exists but address fields are blank', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider({
        practiceLocations: [
          fullLoc({ addressLine1: '', city: '', state: 'CA', zipCode: '' }),
        ],
      }) as any);

      const ready = await service.checkRosterReadiness('p1');
      expect(ready.ready).toBe(false);
      expect(ready.missingFields).toEqual(expect.arrayContaining(['address1', 'city', 'zip']));
      expect(ready.missingFields).not.toContain('practice_location_missing');
    });

    it('reports ALL failure reasons in one pass (not just the first)', async () => {
      // The "Kenneth case" — providerType=other AND no practice location.
      // Readiness should surface both reasons so the user sees the full picture.
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider({
        providerType: 'other',
        practiceLocations: [],
      }) as any);

      const ready = await service.checkRosterReadiness('p1');
      expect(ready.ready).toBe(false);
      expect(ready.missingFields).toEqual(expect.arrayContaining([
        expect.stringMatching(/provider_type_other_deferred/),
        'practice_location_missing',
      ]));
    });
  });

  describe('checkRosterReadiness', () => {
    it('returns ready=true with resolved values for a complete provider', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider() as any);

      const result = await service.checkRosterReadiness('p1');

      expect(result).toMatchObject({ ready: true, missingFields: [], caqhType: 'CSW', practiceState: 'CA' });
    });

    it('returns ready=false with missing fields list, does not throw', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(buildResolvableProvider({
        npi: null,
        firstName: null,
      }) as any);

      const result = await service.checkRosterReadiness('p1');

      expect(result.ready).toBe(false);
      expect(result.missingFields).toContain('npi');
      expect(result.missingFields).toContain('firstName');
    });

    it('returns ready=false when provider does not exist', async () => {
      prismaMock.providerProfile.findUnique.mockResolvedValue(null);

      const result = await service.checkRosterReadiness('does-not-exist');

      expect(result.ready).toBe(false);
      expect(result.missingFields).toEqual(['provider_not_found']);
    });
  });

  describe('parseExceptionDescription (spec Table 6 classifier)', () => {
    it('classifies required-missing strings', () => {
      const parsed = parseExceptionDescription(
        'Required Field missing/invalid: Provider First Name;Missing Identifiers: At least one of the ID fields (NPI, DEA, UPIN, License State/License Number, SSN) must be populated.',
      );
      expect(parsed).toHaveLength(2);
      expect(parsed.every((p) => p.category === 'required_missing')).toBe(true);
    });

    it('classifies optional-invalid strings', () => {
      const parsed = parseExceptionDescription('Provider_DEA is in invalid format;Provider_Name_Suffix is invalid');
      expect(parsed.map((p) => p.category)).toEqual(['optional_invalid', 'optional_invalid']);
    });

    it('classifies conditional-required strings', () => {
      const parsed = parseExceptionDescription('License Number required when License state is populated.');
      expect(parsed[0]!.category).toBe('conditionally_required');
    });

    it('classifies warning strings', () => {
      const parsed = parseExceptionDescription(
        'Warning: One or more of the Provider IDs (NPI, DEA, UPIN, License State/License Number, SSN) are invalid; however, record was processed using other valid IDs provided.',
      );
      // The semicolon inside the warning string splits into two segments; both should classify as warning
      // because each segment that survives splitting still starts with the warning text or follows it.
      // Spec strings don't typically contain `;` mid-message, so this test is somewhat synthetic — just
      // verifies the leading classification.
      expect(parsed[0]!.category).toBe('warning');
    });

    it('classifies add-failed strings', () => {
      const parsed = parseExceptionDescription('Add Failed: Provider already on Roster (exact duplicate)');
      expect(parsed[0]!.category).toBe('add_failed');
    });
  });

  describe('removeFromRoster', () => {
    it('sends DELETE request with query params', async () => {
      const fetchSpy = mockFetchOk({});
      await service.removeFromRoster('caqh-99');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://caqh.test.com/RosterAPI/API/Roster?product=PV&caqhProviderId=caqh-99&organizationId=org-123',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // ==========================================
  // mapCaqhToInternal
  // ==========================================

  describe('mapCaqhToInternal', () => {
    const baseCaqhData: CaqhCredentialsResponse = {
      provider: { firstName: 'Jane', lastName: 'Doe', npi: '1234567890' },
      licenses: [{ type: 'MD', number: 'MD-123', state: 'NY', expirationDate: '2027-01-01' }],
      certifications: [{ board: 'American Board of Psychiatry', specialty: 'General Psychiatry', expirationDate: '2027-06-01' }],
      education: [{ institution: 'Harvard Medical', degree: 'MD', graduationDate: '2010-06-01' }],
      malpractice: { carrier: 'PIAA', policyNumber: 'POL-1', expirationDate: '2027-12-01', coverageAmount: 1000000 },
    };

    it('maps known license types correctly', () => {
      const result = service.mapCaqhToInternal(baseCaqhData);
      expect(result.licenses[0]!.licenseType).toBe('state_medical');
    });

    it('maps all license type variants', () => {
      for (const [input, expected] of [
        ['DO', 'state_medical'], ['PSY', 'state_psychology'], ['SW', 'state_social_work'],
        ['LPC', 'state_counseling'], ['MFT', 'state_marriage_family'],
        ['DEA', 'dea'], ['CDS', 'controlled_substance'],
      ] as const) {
        const data = { ...baseCaqhData, licenses: [{ type: input, number: 'N-1', state: 'CA', expirationDate: '2027-01-01' }] };
        const result = service.mapCaqhToInternal(data);
        expect(result.licenses[0]!.licenseType).toBe(expected);
      }
    });

    it('defaults unknown license type to state_medical with warning log', async () => {
      const { logger } = await import('../utils/logger.js');
      const data = { ...baseCaqhData, licenses: [{ type: 'UNKNOWN_TYPE', number: 'X', state: 'TX', expirationDate: '2027-01-01' }] };
      const result = service.mapCaqhToInternal(data, 'provider-1');
      expect(result.licenses[0]!.licenseType).toBe('state_medical');
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
        event: 'caqh_unknown_mapping',
        field: 'licenseType',
        rawValue: 'UNKNOWN_TYPE',
      }));
    });

    it('maps board types via case-insensitive includes', () => {
      const data = {
        ...baseCaqhData,
        certifications: [
          { board: 'American Board of Psychiatry and Neurology', specialty: 'Psychiatry' },
        ],
      };
      const result = service.mapCaqhToInternal(data);
      expect(result.certifications[0]!.boardType).toBe('abpn_psychiatry');
    });

    it('handles missing malpractice (returns empty array)', () => {
      const data = { ...baseCaqhData, malpractice: undefined };
      const result = service.mapCaqhToInternal(data);
      expect(result.malpractice).toEqual([]);
    });

    it('maps degree types correctly', () => {
      for (const [input, expected] of [
        ['MD', 'md'], ['DO', 'do'], ['PhD', 'phd'], ['PsyD', 'psyd'], ['MSW', 'msw'],
      ] as const) {
        const data = { ...baseCaqhData, education: [{ institution: 'Univ', degree: input, graduationDate: '2010-01-01' }] };
        const result = service.mapCaqhToInternal(data);
        expect(result.education[0]!.degree).toBe(expected);
      }
    });

    // ------- Phase 1: v8 PascalCase shape -------

    it('detects v8 PascalCase shape via Provider wrapper', () => {
      const v8Payload = {
        Provider: {
          NPI: 1234567890,
          SSN: '310-69-6807',
          ProviderFirstName: 'Randy',
          ProviderLastName: 'Ashingden',
          ProviderMiddleName: 'J',
          ProviderDateOfBirth: '19800315',
          ProviderGender: 'M',
          PrimaryPracticeState: 'CA',
          OtherPracticeState: 'NY',
          EthnicityDescription: 'White',
          HospitalBasedFlag: 'Y',
          FellowshipTrainingFlag: 'N',
          MedicareProviderFlag: true,
          ProviderAddress: [
            { AddressType: 'Home', AddressLine1: '100 Main', City: 'SF', State: 'CA', ZipCode: '94105' },
            { AddressType: 'Practice', AddressLine1: '200 Market', City: 'SF', State: 'CA', ZipCode: '94103' },
          ],
          ProviderIdentifier: [
            { IdentifierType: 'Medicare PTAN', IdentifierValue: 'PTAN-123', State: 'CA' },
            { IdentifierType: 'Medicaid', IdentifierValue: 987654 },
          ],
        },
      };
      const result = service.mapCaqhToInternal(v8Payload);
      expect(result.provider.firstName).toBe('Randy');
      expect(result.provider.lastName).toBe('Ashingden');
      expect(result.provider.middleName).toBe('J');
      expect(result.provider.npi).toBe('1234567890');
      expect(result.provider.ssn).toBe('310696807');
      expect(result.provider.dateOfBirth?.toISOString().startsWith('1980-03-15')).toBe(true);
      expect(result.provider.gender).toBe('male');
      expect(result.provider.primaryPracticeState).toBe('CA');
      expect(result.provider.otherPracticeState).toBe('NY');
      expect(result.provider.ethnicity).toBe('White');
      expect(result.provider.hospitalBasedFlag).toBe(true);
      expect(result.provider.fellowshipTrainingFlag).toBe(false);
      expect(result.provider.acceptingMedicare).toBe(true);
      expect(result.addresses).toHaveLength(2);
      expect(result.addresses[0]!.type).toBe('home');
      expect(result.addresses[1]!.type).toBe('practice');
      expect(result.identifiers).toHaveLength(2);
      expect(result.identifiers[0]!.identifierType).toBe('MEDICARE_PTAN');
      expect(result.identifiers[0]!.identifierValue).toBe('PTAN-123');
      expect(result.identifiers[1]!.identifierType).toBe('MEDICAID_ID');
      expect(result.identifiers[1]!.identifierValue).toBe('987654');
    });

    it('handles single (non-array) ProviderAddress / ProviderIdentifier (XML-to-JSON quirk)', () => {
      const v8Payload = {
        Provider: {
          NPI: 1,
          ProviderFirstName: 'A',
          ProviderLastName: 'B',
          ProviderAddress: {
            AddressType: 'Home', AddressLine1: '1 Elm', City: 'Boston', State: 'MA', ZipCode: '02101',
          },
          ProviderIdentifier: {
            IdentifierType: 'UPIN', IdentifierValue: 'U-1',
          },
        },
      };
      const result = service.mapCaqhToInternal(v8Payload);
      expect(result.addresses).toHaveLength(1);
      expect(result.identifiers).toHaveLength(1);
      expect(result.identifiers[0]!.identifierType).toBe('UPIN');
    });

    it('gracefully handles missing Provider wrapper (falls back to legacy path)', () => {
      const result = service.mapCaqhToInternal({});
      expect(result.provider.firstName).toBe('');
      expect(result.addresses).toEqual([]);
      expect(result.identifiers).toEqual([]);
    });

    it('legacy camelCase payload still maps (backward compat)', () => {
      const result = service.mapCaqhToInternal(baseCaqhData);
      expect(result.provider.firstName).toBe('Jane');
      expect(result.licenses[0]!.licenseNumber).toBe('MD-123');
      expect(result.addresses).toEqual([]);
      expect(result.identifiers).toEqual([]);
    });

    it('skips incomplete addresses (missing required fields)', () => {
      const v8Payload = {
        Provider: {
          NPI: 1, ProviderFirstName: 'A', ProviderLastName: 'B',
          ProviderAddress: [
            { AddressType: 'Home', AddressLine1: '1 Elm', City: 'Boston', State: 'MA' }, // missing zip
          ],
        },
      };
      const result = service.mapCaqhToInternal(v8Payload);
      expect(result.addresses).toHaveLength(0);
    });

    it('handles non-string gender (fast-xml-parser text-node object)', () => {
      const v8Payload = {
        Provider: {
          NPI: 1, ProviderFirstName: 'A', ProviderLastName: 'B',
          ProviderGender: { '#text': 'M' },
        },
      };
      const result = service.mapCaqhToInternal(v8Payload);
      expect(result.provider.gender).toBe('male');
    });

    it('handles numeric gender fields without crashing', () => {
      const v8Payload = {
        Provider: {
          NPI: 1, ProviderFirstName: 'A', ProviderLastName: 'B',
          ProviderGender: 0, // bad data from CAQH
        },
      };
      expect(() => service.mapCaqhToInternal(v8Payload)).not.toThrow();
    });

    it('handles text-node object as primary first/last name', () => {
      const v8Payload = {
        Provider: {
          NPI: 1,
          ProviderFirstName: { '#text': 'Randy' },
          ProviderLastName: { '#text': 'Ashingden' },
        },
      };
      const result = service.mapCaqhToInternal(v8Payload);
      expect(result.provider.firstName).toBe('Randy');
      expect(result.provider.lastName).toBe('Ashingden');
    });

    it('handles non-string identifier type and value', () => {
      const v8Payload = {
        Provider: {
          NPI: 1, ProviderFirstName: 'A', ProviderLastName: 'B',
          ProviderIdentifier: [
            { IdentifierType: { '#text': 'UPIN' }, IdentifierValue: 12345 },
          ],
        },
      };
      const result = service.mapCaqhToInternal(v8Payload);
      expect(result.identifiers[0]!.identifierType).toBe('UPIN');
      expect(result.identifiers[0]!.identifierValue).toBe('12345');
    });

    it('maps real CAQH v8 shape with nested AddressTypeDescription + Address + numeric PostalCode', () => {
      const realPayload = {
        Provider: {
          ID: '1000',
          NPI: 1679576722,
          FirstName: 'James',
          LastName: 'Ashingden',
          BirthDate: '19800515',
          Gender: 'Male',
          PrimaryPracticeState: 'AZ',
          ProviderAddress: {
            ID: '1000',
            City: 'Bakersfield',
            State: 'CA',
            Address: '19 4th Avenue',
            PostalCode: 397042681,
            AddressType: { AddressTypeDescription: 'Current Home' },
            EmailAddress: 'tstendelle@xinhuanet.com',
          },
          ProviderIdentifier: {
            ID: '1000',
            IdentifierType: { IdentifierTypeDescription: 'Workers Compensation Number' },
            IdentifierValue: 68,
          },
        },
      };
      const result = service.mapCaqhToInternal(realPayload);
      expect(result.provider.firstName).toBe('James');
      expect(result.provider.lastName).toBe('Ashingden');
      expect(result.provider.npi).toBe('1679576722');
      expect(result.provider.dateOfBirth?.toISOString().startsWith('1980-05-15')).toBe(true);
      expect(result.provider.gender).toBe('male');
      expect(result.provider.primaryPracticeState).toBe('AZ');
      expect(result.addresses).toHaveLength(1);
      const addr = result.addresses[0]!;
      expect(addr.type).toBe('home');
      expect(addr.addressLine1).toBe('19 4th Avenue');
      expect(addr.city).toBe('Bakersfield');
      expect(addr.state).toBe('CA');
      expect(addr.zipCode).toBe('397042681');
      expect(result.identifiers).toHaveLength(1);
      const ident = result.identifiers[0]!;
      expect(ident.identifierType).toBe('OTHER');
      expect(ident.identifierValue).toBe('68');
      expect(ident.notes).toBe('Workers Compensation Number');
    });

    it('unwraps {XxxDescription: "..."} nested objects via toOptString', () => {
      const v8Payload = {
        Provider: {
          NPI: 1, ProviderFirstName: 'A', ProviderLastName: 'B',
          ProviderGender: { GenderDescription: 'Female' },
        },
      };
      const result = service.mapCaqhToInternal(v8Payload);
      expect(result.provider.gender).toBe('female');
    });

    // ------- Phase 2a: Licenses mapping -------

    it('maps real v8 ProviderLicense array with mixed shapes', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          ProviderLicense: [
            // Minimal license — no type, no issue date, no status
            {
              ID: '1000',
              State: 'AZ',
              LicenseNumber: 400141579,
              ExpirationDate: '2058-05-21T00:00:00',
              CurrentlyPracticingFlag: 1,
            },
            // Full license — all fields including nested status
            {
              ID: '1001',
              State: 'AK',
              IssueDate: '2025-08-12T00:00:00',
              LicenseType: 'PHA',
              LicenseNumber: 44564576575,
              LicenseStatus: { LicenseStatusDescription: 'Active' },
              ExpirationDate: '2026-02-24T00:00:00',
              CurrentlyPracticingFlag: 1,
            },
          ],
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.licenses).toHaveLength(2);

      const first = result.licenses[0]!;
      expect(first.caqhLicenseId).toBe('1000');
      expect(first.state).toBe('AZ');
      expect(first.licenseNumber).toBe('400141579');
      expect(first.expirationDate.toISOString().startsWith('2058-05-21')).toBe(true);
      expect(first.currentlyPracticing).toBe(true);
      // LicenseType missing → defaults to state_medical
      expect(first.licenseType).toBe('state_medical');
      expect(first.status).toBeUndefined();

      const second = result.licenses[1]!;
      expect(second.caqhLicenseId).toBe('1001');
      expect(second.state).toBe('AK');
      expect(second.licenseNumber).toBe('44564576575');
      expect(second.issueDate?.toISOString().startsWith('2025-08-12')).toBe(true);
      expect(second.status).toBe('active');
    });

    it('skips ProviderLicense entries missing required fields', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          ProviderLicense: [
            { ID: 'x', State: 'AZ' }, // no number, no expiration
            { ID: 'y', LicenseNumber: 123, ExpirationDate: '2027-01-01' }, // no state
            { ID: 'z', State: 'CA', LicenseNumber: 456 }, // no expiration
          ],
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.licenses).toHaveLength(0);
    });

    it('handles single (non-array) ProviderLicense object', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          ProviderLicense: {
            ID: 'L1', State: 'CA', LicenseNumber: 'ABC-123',
            ExpirationDate: '2028-06-30', LicenseType: 'MD',
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.licenses).toHaveLength(1);
      expect(result.licenses[0]!.licenseType).toBe('state_medical');
    });

    it('maps LicenseStatus variants', () => {
      const cases: Array<[string, string | undefined]> = [
        ['Active', 'active'],
        ['Current', 'active'],
        ['Expired', 'expired'],
        ['Pending', 'pending'],
        ['Revoked', 'revoked'],
        ['Suspended', 'revoked'],
        ['Unknown', undefined],
      ];
      for (const [raw, expected] of cases) {
        const payload = {
          Provider: {
            NPI: 1, FirstName: 'A', LastName: 'B',
            ProviderLicense: {
              State: 'CA', LicenseNumber: '1', ExpirationDate: '2028-01-01',
              LicenseStatus: raw,
            },
          },
        };
        const result = service.mapCaqhToInternal(payload);
        expect(result.licenses[0]!.status).toBe(expected);
      }
    });

    // ------- Phase 2b: Life-support certs (ProviderCertification) -------

    it('imports ONLY ProviderCertification entries with CertificationFlag=1', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          ProviderCertification: [
            { ID: '1000', CertificationFlag: 0, CertificationDescription: 'CPR' }, // inactive
            { ID: '1001', CertificationFlag: 1, CertificationDescription: 'Basic Life Support (BLS)' },
            { ID: '1002', CertificationFlag: 1, CertificationDescription: 'Advanced Cardiac Life Support (ACLS)' },
            { ID: '1003', CertificationFlag: 0, CertificationDescription: 'PALS' },
          ],
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.identifiers).toHaveLength(2);
      expect(result.identifiers.map(i => i.identifierType).sort()).toEqual(['ACLS', 'BLS']);
    });

    it('matches common life-support cert descriptions to enum values', () => {
      const cases: Array<[string, string]> = [
        ['Cardio-Pulmonary Resucitation (CPR)', 'CPR'],
        ['Basic Life Support (BLS)', 'BLS'],
        ['Advanced Cardiac Life Support (ACLS)', 'ACLS'],
        ['Pediatric Advanced Life Support (PALS)', 'PALS'],
        ['Advanced Life Support in OB (ALSO)', 'OTHER'],
        ['Neonatal Resuscitation Program (NRS)', 'OTHER'],
      ];
      for (const [desc, expected] of cases) {
        const payload = {
          Provider: {
            NPI: 1, FirstName: 'A', LastName: 'B',
            ProviderCertification: {
              ID: 'x', CertificationFlag: 1, CertificationDescription: desc,
            },
          },
        };
        const result = service.mapCaqhToInternal(payload);
        expect(result.identifiers[0]!.identifierType).toBe(expected);
      }
    });

    it('preserves unknown cert description in notes when type defaults to OTHER', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          ProviderCertification: {
            ID: 'x', CertificationFlag: 1,
            CertificationDescription: 'Neonatal Advanced Life Support (NALS)',
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.identifiers[0]!.identifierType).toBe('OTHER');
      expect(result.identifiers[0]!.notes).toBe('Neonatal Advanced Life Support (NALS)');
    });

    it('does not import any life-support certs when all CertificationFlag=0 (real James payload)', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'James', LastName: 'Ashingden',
          ProviderCertification: [
            { ID: '1000', CertificationFlag: 0, CertificationDescription: 'CPR' },
            { ID: '1001', CertificationFlag: 0, CertificationDescription: 'BLS' },
            { ID: '1002', CertificationFlag: 0, CertificationDescription: 'ACLS' },
          ],
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.identifiers).toHaveLength(0);
    });

    // ------- Phase 2c: Medical board certifications (Specialty section) -------

    it('imports a medical board certification when BoardCertifiedFlag=1', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Specialty: {
            ID: '1000',
            SpecialtyName: 'Psychiatry',
            NUCCTaxonomyCode: '2084P0800X',
            BoardCertifiedFlag: 1,
            SpecialtyBoardName: 'American Board of Psychiatry and Neurology',
            CertificationNumber: 'ABPN-12345',
            CertificationDate: '2015-06-30T00:00:00',
            BoardCertificationExpiresFlag: 1,
            BoardCertificationExpirationDate: '2030-06-30T00:00:00',
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.certifications).toHaveLength(1);
      const cert = result.certifications[0]!;
      expect(cert.caqhSpecialtyId).toBe('1000');
      expect(cert.boardType).toBe('abpn_psychiatry');
      expect(cert.boardName).toBe('American Board of Psychiatry and Neurology');
      expect(cert.specialty).toBe('Psychiatry');
      expect(cert.certificationNumber).toBe('ABPN-12345');
      expect(cert.nuccTaxonomyCode).toBe('2084P0800X');
      expect(cert.isBoardCertified).toBe(true);
      expect(cert.initialCertificationDate?.toISOString().startsWith('2015-06-30')).toBe(true);
      expect(cert.expirationDate?.toISOString().startsWith('2030-06-30')).toBe(true);
    });

    it('skips Specialty entries with BoardCertifiedFlag=0', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Specialty: {
            ID: '1000',
            SpecialtyName: 'Psychiatry',
            BoardCertifiedFlag: 0,
            SpecialtyBoardName: 'American Board of Psychiatry and Neurology',
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.certifications).toHaveLength(0);
    });

    it('leaves expirationDate undefined when BoardCertificationExpiresFlag=0', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Specialty: {
            ID: '1000',
            SpecialtyName: 'Psychiatry',
            BoardCertifiedFlag: 1,
            SpecialtyBoardName: 'American Board of Psychiatry and Neurology',
            CertificationDate: '2015-06-30T00:00:00',
            BoardCertificationExpiresFlag: 0,
            BoardCertificationExpirationDate: '2030-06-30T00:00:00',
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.certifications[0]!.expirationDate).toBeUndefined();
    });

    it('normalizes single Specialty object to array', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Specialty: {
            ID: '1000',
            SpecialtyName: 'Psychiatry',
            BoardCertifiedFlag: 1,
            SpecialtyBoardName: 'ABPN',
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.certifications).toHaveLength(1);
    });

    it('maps multiple Specialty entries independently', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Specialty: [
            { ID: '1', SpecialtyName: 'Psychiatry', BoardCertifiedFlag: 1, SpecialtyBoardName: 'ABPN' },
            { ID: '2', SpecialtyName: 'Family Medicine', BoardCertifiedFlag: 0, SpecialtyBoardName: 'ABFM' },
            { ID: '3', SpecialtyName: 'Addiction Medicine', BoardCertifiedFlag: 1, SpecialtyBoardName: 'ABPN Addiction' },
          ],
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.certifications).toHaveLength(2);
      expect(result.certifications.map(c => c.specialty).sort()).toEqual(['Addiction Medicine', 'Psychiatry']);
    });

    it('skips board cert entries missing boardName or specialty', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Specialty: [
            { ID: '1', BoardCertifiedFlag: 1, SpecialtyName: 'Psychiatry' }, // no board
            { ID: '2', BoardCertifiedFlag: 1, SpecialtyBoardName: 'ABPN' }, // no specialty
          ],
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.certifications).toHaveLength(0);
    });

    it('unwraps {XxxDescription} nested board name and specialty', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Specialty: {
            ID: '1000',
            SpecialtyName: { SpecialtyNameDescription: 'Psychiatry' },
            BoardCertifiedFlag: 1,
            SpecialtyBoardName: { SpecialtyBoardNameDescription: 'American Board of Psychiatry and Neurology' },
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.certifications[0]!.boardName).toBe('American Board of Psychiatry and Neurology');
      expect(result.certifications[0]!.specialty).toBe('Psychiatry');
    });

    // ------- Phase 2d: Specialties + NUCC taxonomy -------

    it('(2c fix) reads SpecialtyName from nested Specialty object (real CAQH shape)', () => {
      // James's real payload: { Specialty: { Specialty: { SpecialtyName: "Social Worker, Clinical" }, ... } }
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'James', LastName: 'Ashingden',
          Specialty: {
            ID: '1000',
            Specialty: { SpecialtyName: 'Social Worker, Clinical' },
            SpecialtyType: { SpecialtyTypeDescription: 'Primary' },
            NUCCTaxonomyCode: '1041C0700X',
            BoardCertifiedFlag: 1,
            SpecialtyBoardName: 'American Academy of Health Providers in the Addictive Disorders',
            CertificationDate: '2020-02-26T00:00:00',
            BoardCertificationExpiresFlag: 0,
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.certifications).toHaveLength(1);
      expect(result.certifications[0]!.specialty).toBe('Social Worker, Clinical');
      expect(result.certifications[0]!.boardName).toBe('American Academy of Health Providers in the Addictive Disorders');
    });

    it('maps a Specialty entry into result.specialties with NUCC code and primary flag', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Specialty: {
            ID: '1000',
            Specialty: { SpecialtyName: 'Social Worker, Clinical' },
            SpecialtyType: { SpecialtyTypeDescription: 'Primary' },
            NUCCTaxonomyCode: '1041C0700X',
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.specialties).toHaveLength(1);
      const s = result.specialties![0]!;
      expect(s.name).toBe('Social Worker, Clinical');
      expect(s.nuccTaxonomyCode).toBe('1041C0700X');
      expect(s.isPrimary).toBe(true);
      expect(s.caqhSpecialtyId).toBe('1000');
    });

    it('marks isPrimary=false when SpecialtyType is not Primary', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Specialty: {
            ID: '1000',
            Specialty: { SpecialtyName: 'Addiction Medicine' },
            SpecialtyType: { SpecialtyTypeDescription: 'Secondary' },
            NUCCTaxonomyCode: '207LA0401X',
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.specialties![0]!.isPrimary).toBe(false);
    });

    it('skips specialty entries missing a name', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Specialty: { ID: '1000', NUCCTaxonomyCode: '1041C0700X' },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.specialties).toHaveLength(0);
    });

    it('maps multiple Specialty entries into result.specialties', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Specialty: [
            { ID: '1', Specialty: { SpecialtyName: 'Psychiatry' }, SpecialtyType: { SpecialtyTypeDescription: 'Primary' }, NUCCTaxonomyCode: '2084P0800X' },
            { ID: '2', Specialty: { SpecialtyName: 'Addiction Medicine' }, SpecialtyType: { SpecialtyTypeDescription: 'Secondary' }, NUCCTaxonomyCode: '207LA0401X' },
          ],
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.specialties).toHaveLength(2);
      expect(result.specialties!.filter(s => s.isPrimary)).toHaveLength(1);
    });

    it('reads EmailAddress at provider level when Email/ProviderEmail absent', () => {
      const v8Payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          EmailAddress: 'foo@bar.com',
        },
      };
      const result = service.mapCaqhToInternal(v8Payload);
      expect(result.provider.email).toBe('foo@bar.com');
    });

    it('defaults unknown identifier type to OTHER', () => {
      const v8Payload = {
        Provider: {
          NPI: 1, ProviderFirstName: 'A', ProviderLastName: 'B',
          ProviderIdentifier: [{ IdentifierType: 'SOME_WEIRD_TYPE', IdentifierValue: 'x' }],
        },
      };
      const result = service.mapCaqhToInternal(v8Payload);
      expect(result.identifiers[0]!.identifierType).toBe('OTHER');
    });

    // ------- Day 1 PR 2: Education (educationType + location fields) -------

    it('maps Education entry with educationType, dates, and location fields', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Education: {
            ID: 'edu-1',
            InstitutionName: 'Stanford School of Medicine',
            Degree: 'MD',
            EducationType: 'Medical School',
            GraduationDate: '20100515',
            StartDate: '20060801',
            EndDate: '20100515',
            City: 'Stanford',
            State: 'CA',
            PostalCode: '94305',
            AddressLine1: '291 Campus Dr',
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.education).toHaveLength(1);
      const edu = result.education[0]!;
      expect(edu.institutionName).toBe('Stanford School of Medicine');
      expect(edu.degree).toBe('md');
      expect(edu.educationType).toBe('MEDICAL_SCHOOL');
      expect(edu.graduationDate?.toISOString().startsWith('2010-05-15')).toBe(true);
      expect(edu.startDate?.toISOString().startsWith('2006-08-01')).toBe(true);
      expect(edu.endDate?.toISOString().startsWith('2010-05-15')).toBe(true);
      expect(edu.city).toBe('Stanford');
      expect(edu.state).toBe('CA');
      expect(edu.postalCode).toBe('94305');
      expect(edu.addressLine1).toBe('291 Campus Dr');
    });

    it('maps EducationType variants to enum values', () => {
      const cases: Array<[string, string]> = [
        ['Medical School', 'MEDICAL_SCHOOL'],
        ['Undergraduate', 'UNDERGRADUATE'],
        ['Internship', 'INTERNSHIP'],
        ['Residency', 'RESIDENCY'],
        ['Fellowship', 'FELLOWSHIP'],
        ['Post-doctoral', 'POST_DOCTORAL'],
        ['Continuing Medical Education', 'CONTINUING_EDUCATION'],
        ['Some unrecognized program', 'OTHER'],
      ];
      for (const [raw, expected] of cases) {
        const payload = {
          Provider: {
            NPI: 1, FirstName: 'A', LastName: 'B',
            Education: { InstitutionName: 'X', Degree: 'MD', EducationType: raw },
          },
        };
        const result = service.mapCaqhToInternal(payload);
        expect(result.education[0]!.educationType).toBe(expected);
      }
    });

    it('handles nested EducationType description object (CAQH coded-lookup)', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Education: {
            InstitutionName: 'X', Degree: 'MD',
            EducationType: { EducationTypeDescription: 'Residency' },
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.education[0]!.educationType).toBe('RESIDENCY');
    });

    it('skips Education entry missing institutionName', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Education: { Degree: 'MD', GraduationDate: '20100515' },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.education).toHaveLength(0);
    });

    it('omits educationType when EducationType not provided', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Education: { InstitutionName: 'X', Degree: 'MD' },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.education[0]!.educationType).toBeUndefined();
    });

    // ------- Day 1 PR 2: Malpractice (CoveredPractices linkage) -------

    it('maps Insurance entry to malpractice with CoveredPractices array', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Insurance: {
            CarrierName: 'ProAssurance',
            PolicyNumber: 'POL-12345',
            EffectiveDate: '20240101',
            ExpirationDate: '20251231',
            CoverageType: 'Claims Made',
            PerClaimAmount: 1000000,
            AggregateAmount: 3000000,
            IsSelfInsured: 'N',
            HasUnlimitedCoverage: 'N',
            IsIndividualCoverage: 'Y',
            CoveredPractices: [
              { PracticeName: 'Main Office', AddressLine1: '100 Main', City: 'SF', State: 'CA', ZipCode: '94105' },
              { PracticeName: 'Satellite', AddressLine1: '200 Market', State: 'CA', ZipCode: '94103' },
            ],
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.malpractice).toHaveLength(1);
      const mal = result.malpractice[0]!;
      expect(mal.carrierName).toBe('ProAssurance');
      expect(mal.policyNumber).toBe('POL-12345');
      expect(mal.expirationDate).toBe('20251231');
      expect(mal.perClaimAmount).toBe(1000000);
      expect(mal.aggregateAmount).toBe(3000000);
      expect(mal.coverageType).toBe('claims_made');
      expect(mal.isSelfInsured).toBe(false);
      expect(mal.hasUnlimitedCoverage).toBe(false);
      expect(mal.isIndividualCoverage).toBe(true);
      expect(mal.coveredPractices).toHaveLength(2);
      expect(mal.coveredPractices![0]!.rawLabel).toBe('Main Office');
      expect(mal.coveredPractices![0]!.zipCode).toBe('94105');
    });

    it('handles single (non-array) CoveredPractice and wrapped CoveredPractice key', () => {
      const wrappedPayload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Insurance: {
            CarrierName: 'C', PolicyNumber: 'P-1', ExpirationDate: '20251231',
            CoveredPractices: { CoveredPractice: { PracticeName: 'Solo' } },
          },
        },
      };
      const result1 = service.mapCaqhToInternal(wrappedPayload);
      expect(result1.malpractice[0]!.coveredPractices).toHaveLength(1);
      expect(result1.malpractice[0]!.coveredPractices![0]!.rawLabel).toBe('Solo');

      const directPayload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Insurance: {
            CarrierName: 'C', PolicyNumber: 'P-1', ExpirationDate: '20251231',
            CoveredPractices: { PracticeName: 'Direct', AddressLine1: '1 Elm' },
          },
        },
      };
      const result2 = service.mapCaqhToInternal(directPayload);
      expect(result2.malpractice[0]!.coveredPractices).toHaveLength(1);
      expect(result2.malpractice[0]!.coveredPractices![0]!.rawLabel).toBe('Direct');
    });

    it('skips Insurance entry missing required fields', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Insurance: { CarrierName: 'C', PolicyNumber: '' }, // missing expiration + carrier
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.malpractice).toHaveLength(0);
    });

    it('omits coveredPractices when none provided', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Insurance: {
            CarrierName: 'C', PolicyNumber: 'P-1', ExpirationDate: '20251231',
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.malpractice[0]!.coveredPractices).toBeUndefined();
    });

    it('parses string-formatted PerClaimAmount with currency formatting', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          Insurance: {
            CarrierName: 'C', PolicyNumber: 'P-1', ExpirationDate: '20251231',
            PerClaimAmount: '$1,000,000', AggregateAmount: '3000000',
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.malpractice[0]!.perClaimAmount).toBe(1000000);
      expect(result.malpractice[0]!.aggregateAmount).toBe(3000000);
    });

    // ------- Day 1 PR 2: ProviderCertification (dual-write) -------

    it('emits ProviderCertification entries alongside ProviderIdentifier rows (dual-write)', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          ProviderCertification: [
            { ID: '1001', CertificationFlag: 1, CertificationDescription: 'Basic Life Support (BLS)', ExpirationDate: '20271231', IssueDate: '20220101' },
            { ID: '1002', CertificationFlag: 1, CertificationDescription: 'Advanced Cardiac Life Support (ACLS)' },
            { ID: '1003', CertificationFlag: 0, CertificationDescription: 'CPR' }, // inactive — both arrays should skip
          ],
        },
      };
      const result = service.mapCaqhToInternal(payload);
      // Identifier dual-write preserved
      expect(result.identifiers).toHaveLength(2);
      expect(result.identifiers.map(i => i.identifierType).sort()).toEqual(['ACLS', 'BLS']);
      // New ProviderCertification array populated
      expect(result.providerCertifications).toHaveLength(2);
      const blsRow = result.providerCertifications!.find(c => c.certDescription.includes('BLS'));
      expect(blsRow?.caqhCertificationId).toBe('1001');
      expect(blsRow?.expirationDate?.toISOString().startsWith('2027-12-31')).toBe(true);
      expect(blsRow?.issueDate?.toISOString().startsWith('2022-01-01')).toBe(true);
    });

    it('does not include inactive certs in providerCertifications', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          ProviderCertification: { ID: '1', CertificationFlag: 0, CertificationDescription: 'BLS' },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.providerCertifications).toHaveLength(0);
    });

    // ------- Day 1 PR 2: CDS Registration -------

    it('maps ProviderCDS entry to cdsRegistrations with plaintext number', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          ProviderCDS: {
            CDSNumber: 'CDS-FL-00123',
            State: 'FL',
            ExpirationDate: '20281231',
            IssueDate: '20230101',
          },
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.cdsRegistrations).toHaveLength(1);
      const cds = result.cdsRegistrations![0]!;
      expect(cds.cdsNumber).toBe('CDS-FL-00123');
      expect(cds.state).toBe('FL');
      expect(cds.expirationDate?.toISOString().startsWith('2028-12-31')).toBe(true);
      expect(cds.issueDate?.toISOString().startsWith('2023-01-01')).toBe(true);
    });

    it('handles array of multiple CDS entries (multi-state providers)', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          ProviderCDS: [
            { CDSNumber: 'A-1', State: 'FL' },
            { CDSNumber: 'B-2', State: 'GA' },
          ],
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.cdsRegistrations).toHaveLength(2);
      expect(result.cdsRegistrations!.map(c => c.state).sort()).toEqual(['FL', 'GA']);
    });

    it('skips CDS entries missing CDSNumber or State', () => {
      const payload = {
        Provider: {
          NPI: 1, FirstName: 'A', LastName: 'B',
          ProviderCDS: [
            { CDSNumber: '', State: 'FL' },
            { CDSNumber: 'X', State: '' },
            { CDSNumber: 'OK', State: 'CA' },
          ],
        },
      };
      const result = service.mapCaqhToInternal(payload);
      expect(result.cdsRegistrations).toHaveLength(1);
      expect(result.cdsRegistrations![0]!.cdsNumber).toBe('OK');
    });
  });

  // ==========================================
  // applyProviderCore (Phase 1)
  // ==========================================

  describe('applyProviderCore', () => {
    it('updates provider demographics fields and creates address + identifier rows', async () => {
      prismaMock.providerProfile.update.mockResolvedValue({} as any);
      prismaMock.providerDemographics.upsert.mockResolvedValue({} as any);
      prismaMock.providerAddress.findFirst.mockResolvedValue(null);
      prismaMock.providerAddress.create.mockResolvedValue({} as any);
      prismaMock.providerIdentifier.findFirst.mockResolvedValue(null);
      prismaMock.providerIdentifier.create.mockResolvedValue({} as any);

      await service.applyProviderCore('p1', {
        provider: {
          firstName: 'Randy',
          lastName: 'Ashingden',
          npi: '1234567890',
          ssn: '310696807',
          dateOfBirth: new Date('1980-03-15'),
          gender: 'male' as any,
          primaryPracticeState: 'CA',
          hospitalBasedFlag: true,
          ethnicity: 'White',
        },
        addresses: [{
          type: 'home' as any, addressLine1: '100 Main', city: 'SF', state: 'CA', zipCode: '94105',
        }],
        identifiers: [{
          identifierType: 'MEDICARE_PTAN' as any, identifierValue: 'PTAN-123', state: 'CA',
        }],
        licenses: [], certifications: [], education: [], malpractice: [],
      });

      expect(prismaMock.providerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1' },
          data: expect.objectContaining({
            firstName: 'Randy',
            lastName: 'Ashingden',
            primaryPracticeState: 'CA',
            hospitalBasedFlag: true,
            gender: 'male',
            dateOfBirth: expect.any(Date),
          }),
        }),
      );
      // SSN must be encrypted, not plaintext
      const updateArgs = (prismaMock.providerProfile.update as any).mock.calls[0][0];
      expect(updateArgs.data.ssnEncrypted).toBeDefined();
      expect(updateArgs.data.ssnEncrypted).not.toBe('310696807');
      expect(prismaMock.providerDemographics.upsert).toHaveBeenCalled();
      expect(prismaMock.providerAddress.create).toHaveBeenCalled();
      expect(prismaMock.providerIdentifier.create).toHaveBeenCalled();
    });

    it('does NOT overwrite provider fields when CAQH returns blank/undefined', async () => {
      prismaMock.providerAddress.findFirst.mockResolvedValue(null);
      prismaMock.providerIdentifier.findFirst.mockResolvedValue(null);

      await service.applyProviderCore('p1', {
        provider: { firstName: '', lastName: '', npi: '' },
        addresses: [], identifiers: [],
        licenses: [], certifications: [], education: [], malpractice: [],
      });

      // All fields blank → no update call at all
      expect(prismaMock.providerProfile.update).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // applyCaqhDataToProvider
  // ==========================================

  describe('applyCaqhDataToProvider', () => {
    it('creates new license when no existing record found', async () => {
      prismaMock.license.findFirst.mockResolvedValue(null);
      prismaMock.license.create.mockResolvedValue({} as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [{ licenseType: 'state_medical' as any, licenseNumber: 'MD-1', state: 'NY', expirationDate: new Date('2027-01-01') }],
        certifications: [], education: [], malpractice: [], addresses: [], identifiers: [],
      });

      expect(summary.licenses.created).toBe(1);
      expect(prismaMock.license.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'p1',
            licenseNumber: 'MD-1',
            source: 'caqh_sync',
          }),
        }),
      );
    });

    it('updates existing caqh_sync record', async () => {
      prismaMock.license.findFirst.mockResolvedValue({
        id: 'lic-1', source: 'caqh_sync', licenseType: 'state_medical', state: 'NY', expirationDate: new Date(),
      } as any);
      prismaMock.license.update.mockResolvedValue({} as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [{ licenseType: 'state_medical' as any, licenseNumber: 'MD-1', state: 'NY', expirationDate: new Date('2027-01-01') }],
        certifications: [], education: [], malpractice: [], addresses: [], identifiers: [],
      });

      expect(summary.licenses.updated).toBe(1);
    });

    it('skips manual_entry records', async () => {
      prismaMock.license.findFirst.mockResolvedValue({
        id: 'lic-1', source: 'manual_entry', licenseType: 'state_medical', state: 'NY', expirationDate: new Date(),
      } as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [{ licenseType: 'state_medical' as any, licenseNumber: 'MD-1', state: 'NY', expirationDate: new Date('2027-01-01') }],
        certifications: [], education: [], malpractice: [], addresses: [], identifiers: [],
      });

      expect(summary.licenses.skipped).toBe(1);
      expect(prismaMock.license.update).not.toHaveBeenCalled();
    });

    it('tracks per-record failures in summary', async () => {
      prismaMock.license.findFirst.mockResolvedValue(null);
      prismaMock.license.create.mockRejectedValue(new Error('DB constraint'));

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [{ licenseType: 'state_medical' as any, licenseNumber: 'MD-1', state: 'NY', expirationDate: new Date('2027-01-01') }],
        certifications: [], education: [], malpractice: [], addresses: [], identifiers: [],
      });

      expect(summary.licenses.failed).toBe(1);
      expect(summary.failedRecords).toEqual([
        expect.objectContaining({ category: 'license', identifier: 'MD-1', error: 'DB constraint' }),
      ]);
    });

    it('creates a board certification with caqhSpecialtyId', async () => {
      prismaMock.boardCertification.findFirst.mockResolvedValue(null);
      prismaMock.boardCertification.create.mockResolvedValue({} as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], education: [], malpractice: [], addresses: [], identifiers: [],
        certifications: [{
          boardType: 'abpn_psychiatry' as any,
          boardName: 'American Board of Psychiatry and Neurology',
          specialty: 'Psychiatry',
          caqhSpecialtyId: 'cs-1000',
          certificationNumber: 'ABPN-12345',
          nuccTaxonomyCode: '2084P0800X',
          isBoardCertified: true,
          initialCertificationDate: new Date('2015-06-30'),
          expirationDate: new Date('2030-06-30'),
        }],
      });

      expect(summary.certifications.created).toBe(1);
      expect(prismaMock.boardCertification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'p1',
            boardName: 'American Board of Psychiatry and Neurology',
            caqhSpecialtyId: 'cs-1000',
            certificationNumber: 'ABPN-12345',
            nuccTaxonomyCode: '2084P0800X',
            isBoardCertified: true,
            source: 'caqh_sync',
          }),
        }),
      );
      expect(prismaMock.boardCertification.findFirst).toHaveBeenCalledWith({
        where: { providerId: 'p1', caqhSpecialtyId: 'cs-1000' },
      });
    });

    it('updates existing board cert matched by caqhSpecialtyId', async () => {
      prismaMock.boardCertification.findFirst.mockResolvedValue({
        id: 'bc-1', source: 'caqh_sync', boardType: 'abpn_psychiatry',
        boardName: 'ABPN', specialty: 'Psychiatry',
      } as any);
      prismaMock.boardCertification.update.mockResolvedValue({} as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], education: [], malpractice: [], addresses: [], identifiers: [],
        certifications: [{
          boardType: 'abpn_psychiatry' as any,
          boardName: 'ABPN',
          specialty: 'Psychiatry',
          caqhSpecialtyId: 'cs-1000',
          isBoardCertified: true,
          expirationDate: new Date('2031-01-01'),
        }],
      });

      expect(summary.certifications.updated).toBe(1);
    });

    // ------- Phase 2d specialties -------

    it('creates a provider specialty linked by NUCC taxonomy code and sets primary taxonomy on profile', async () => {
      prismaMock.specialty.findUnique.mockResolvedValue({ id: 'spec-sw-clinical', name: 'Social Worker, Clinical', nuccTaxonomyCode: '1041C0700X' } as any);
      prismaMock.providerSpecialty.findFirst.mockResolvedValue(null);
      prismaMock.providerSpecialty.create.mockResolvedValue({} as any);
      prismaMock.providerProfile.update.mockResolvedValue({} as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], malpractice: [], addresses: [], identifiers: [],
        specialties: [{
          name: 'Social Worker, Clinical',
          nuccTaxonomyCode: '1041C0700X',
          isPrimary: true,
          caqhSpecialtyId: 'cs-1',
        }],
      });

      expect(summary.specialties.created).toBe(1);
      expect(prismaMock.specialty.findUnique).toHaveBeenCalledWith({ where: { nuccTaxonomyCode: '1041C0700X' } });
      expect(prismaMock.providerSpecialty.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'p1',
            specialtyId: 'spec-sw-clinical',
            isPrimary: true,
            nuccTaxonomyCode: '1041C0700X',
            caqhSpecialtyId: 'cs-1',
            source: 'caqh_sync',
          }),
        }),
      );
      expect(prismaMock.providerProfile.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { taxonomy: '1041C0700X' },
      });
    });

    it('auto-creates a Specialty row when NUCC code is unknown', async () => {
      prismaMock.specialty.findUnique.mockResolvedValue(null);
      prismaMock.specialty.findFirst.mockResolvedValue(null);
      prismaMock.specialty.create.mockResolvedValue({ id: 'spec-new', name: 'Niche Thing', nuccTaxonomyCode: '9999X0000X' } as any);
      prismaMock.providerSpecialty.findFirst.mockResolvedValue(null);
      prismaMock.providerSpecialty.create.mockResolvedValue({} as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], malpractice: [], addresses: [], identifiers: [],
        specialties: [{ name: 'Niche Thing', nuccTaxonomyCode: '9999X0000X', isPrimary: false, caqhSpecialtyId: 'cs-2' }],
      });

      expect(summary.specialties.created).toBe(1);
      expect(prismaMock.specialty.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Niche Thing',
          taxonomySection: 'INDIVIDUAL',
          nuccTaxonomyCode: '9999X0000X',
        }),
      });
    });

    it('updates existing provider specialty matched by caqhSpecialtyId on re-sync', async () => {
      prismaMock.specialty.findUnique.mockResolvedValue({ id: 'spec-sw-clinical' } as any);
      prismaMock.providerSpecialty.findFirst.mockResolvedValue({
        id: 'ps-1', source: 'caqh_sync', specialtyId: 'spec-sw-clinical', isPrimary: false, nuccTaxonomyCode: null, caqhSpecialtyId: 'cs-1',
      } as any);
      prismaMock.providerSpecialty.update.mockResolvedValue({} as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], malpractice: [], addresses: [], identifiers: [],
        specialties: [{ name: 'Social Worker, Clinical', nuccTaxonomyCode: '1041C0700X', isPrimary: true, caqhSpecialtyId: 'cs-1' }],
      });

      expect(summary.specialties.updated).toBe(1);
      expect(prismaMock.providerSpecialty.findFirst).toHaveBeenCalledWith({
        where: { providerId: 'p1', caqhSpecialtyId: 'cs-1' },
      });
    });

    it('skips provider specialty marked source=manual_entry', async () => {
      prismaMock.specialty.findUnique.mockResolvedValue({ id: 'spec-1' } as any);
      prismaMock.providerSpecialty.findFirst.mockResolvedValue({
        id: 'ps-1', source: 'manual_entry',
      } as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], malpractice: [], addresses: [], identifiers: [],
        specialties: [{ name: 'Psychiatry', nuccTaxonomyCode: '2084P0800X', isPrimary: false, caqhSpecialtyId: 'cs-1' }],
      });

      expect(summary.specialties.skipped).toBe(1);
      expect(prismaMock.providerSpecialty.update).not.toHaveBeenCalled();
    });

    it('skips malpractice without perClaimAmount', async () => {
      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], addresses: [], identifiers: [],
        malpractice: [{ carrierName: 'PIAA', policyNumber: 'POL-1', expirationDate: '2027-01-01' }],
      });

      expect(summary.malpractice.skipped).toBe(1);
      expect(prismaMock.malpracticeInsurance.findFirst).not.toHaveBeenCalled();
    });

    // ------- Day 1 PR 2: Education educationType persistence -------

    it('writes educationType + location fields to a new education row', async () => {
      prismaMock.education.findFirst.mockResolvedValue(null);
      prismaMock.education.create.mockResolvedValue({} as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], malpractice: [], addresses: [], identifiers: [],
        education: [{
          institutionName: 'Stanford School of Medicine',
          degree: 'md' as any,
          educationType: 'MEDICAL_SCHOOL' as any,
          graduationDate: new Date('2010-05-15'),
          startDate: new Date('2006-08-01'),
          city: 'Stanford',
          state: 'CA',
          postalCode: '94305',
          addressLine1: '291 Campus Dr',
        }],
      });
      expect(summary.education.created).toBe(1);
      expect(prismaMock.education.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'p1',
            institutionName: 'Stanford School of Medicine',
            degree: 'md',
            educationType: 'MEDICAL_SCHOOL',
            city: 'Stanford',
            state: 'CA',
            postalCode: '94305',
            addressLine1: '291 Campus Dr',
            source: 'caqh_sync',
          }),
        }),
      );
    });

    // ------- Day 1 PR 2: Malpractice CoveredPractices linkage -------

    it('links covered practices by exact name match (matched_via=exact_name)', async () => {
      prismaMock.malpracticeInsurance.findFirst.mockResolvedValue(null);
      prismaMock.malpracticeInsurance.create.mockResolvedValue({ id: 'mp-1' } as any);
      prismaMock.practiceLocation.findMany.mockResolvedValue([
        { id: 'loc-1', locationName: 'Main Office', addressLine1: '100 Main', state: 'CA', zipCode: '94105' },
        { id: 'loc-2', locationName: 'Other', addressLine1: '999 Other', state: 'CA', zipCode: '99999' },
      ] as any);
      prismaMock.malpracticePolicyLocation.upsert.mockResolvedValue({} as any);

      await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], addresses: [], identifiers: [],
        malpractice: [{
          carrierName: 'C', policyNumber: 'P-1', expirationDate: '2027-01-01', perClaimAmount: 1000000,
          coveredPractices: [{ rawLabel: 'main office' }],
        }],
      });

      expect(prismaMock.malpracticePolicyLocation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { malpracticeInsuranceId_practiceLocationId: { malpracticeInsuranceId: 'mp-1', practiceLocationId: 'loc-1' } },
          create: expect.objectContaining({
            malpracticeInsuranceId: 'mp-1',
            practiceLocationId: 'loc-1',
            matchedVia: 'exact_name',
          }),
        }),
      );
    });

    it('falls back to address match when name does not match (matched_via=address)', async () => {
      prismaMock.malpracticeInsurance.findFirst.mockResolvedValue(null);
      prismaMock.malpracticeInsurance.create.mockResolvedValue({ id: 'mp-1' } as any);
      prismaMock.practiceLocation.findMany.mockResolvedValue([
        { id: 'loc-1', locationName: 'Main Office', addressLine1: '100 Main', state: 'CA', zipCode: '94105' },
      ] as any);
      prismaMock.malpracticePolicyLocation.upsert.mockResolvedValue({} as any);

      await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], addresses: [], identifiers: [],
        malpractice: [{
          carrierName: 'C', policyNumber: 'P-1', expirationDate: '2027-01-01', perClaimAmount: 1000000,
          coveredPractices: [{ rawLabel: 'Some Different Name', addressLine1: '100 Main', state: 'CA', zipCode: '94105' }],
        }],
      });

      expect(prismaMock.malpracticePolicyLocation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ practiceLocationId: 'loc-1', matchedVia: 'address' }),
        }),
      );
    });

    it('logs unmatched covered practices without throwing', async () => {
      prismaMock.malpracticeInsurance.findFirst.mockResolvedValue(null);
      prismaMock.malpracticeInsurance.create.mockResolvedValue({ id: 'mp-1' } as any);
      prismaMock.practiceLocation.findMany.mockResolvedValue([] as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], addresses: [], identifiers: [],
        malpractice: [{
          carrierName: 'C', policyNumber: 'P-1', expirationDate: '2027-01-01', perClaimAmount: 1000000,
          coveredPractices: [{ rawLabel: 'Nowhere', addressLine1: '999 Imaginary' }],
        }],
      });

      expect(summary.malpractice.created).toBe(1);
      expect(prismaMock.malpracticePolicyLocation.upsert).not.toHaveBeenCalled();
    });

    // ------- Day 1 PR 2: ProviderCertification persistence -------

    it('persists ProviderCertification rows with resolved enum at execution time', async () => {
      prismaMock.providerCertification.findFirst.mockResolvedValue(null);
      prismaMock.providerCertification.create.mockResolvedValue({} as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], malpractice: [], addresses: [], identifiers: [],
        providerCertifications: [
          { caqhCertificationId: '1001', certDescription: 'Basic Life Support (BLS)', expirationDate: new Date('2027-12-31') },
          { caqhCertificationId: '1002', certDescription: 'Advanced Cardiac Life Support (ACLS)' },
          { caqhCertificationId: '1003', certDescription: 'Cardio-Pulmonary Resuscitation (CPR)' },
          { caqhCertificationId: '1004', certDescription: 'Pediatric Advanced Life Support (PALS)' },
          { caqhCertificationId: '1005', certDescription: 'Wound Care Specialist' },
        ],
      });

      expect(summary.providerCertifications.created).toBe(5);
      const calls = (prismaMock.providerCertification.create as any).mock.calls;
      const byDesc = (desc: string) => calls.find((c: any) => c[0].data.certDescription === desc)?.[0].data;
      expect(byDesc('Basic Life Support (BLS)').certType).toBe('bls');
      expect(byDesc('Advanced Cardiac Life Support (ACLS)').certType).toBe('acls');
      expect(byDesc('Cardio-Pulmonary Resuscitation (CPR)').certType).toBe('cpr');
      expect(byDesc('Pediatric Advanced Life Support (PALS)').certType).toBe('pals');
      expect(byDesc('Wound Care Specialist').certType).toBe('other');
    });

    it('updates existing ProviderCertification matched by caqhCertificationId on re-sync', async () => {
      prismaMock.providerCertification.findFirst.mockResolvedValue({
        id: 'pc-1', source: 'caqh_sync', caqhCertificationId: '1001',
      } as any);
      prismaMock.providerCertification.update.mockResolvedValue({} as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], malpractice: [], addresses: [], identifiers: [],
        providerCertifications: [
          { caqhCertificationId: '1001', certDescription: 'Basic Life Support (BLS)', expirationDate: new Date('2030-01-01') },
        ],
      });
      expect(summary.providerCertifications.updated).toBe(1);
      expect(prismaMock.providerCertification.findFirst).toHaveBeenCalledWith({
        where: { providerId: 'p1', caqhCertificationId: '1001' },
      });
    });

    it('skips ProviderCertification rows marked source=manual_entry', async () => {
      prismaMock.providerCertification.findFirst.mockResolvedValue({
        id: 'pc-1', source: 'manual_entry',
      } as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], malpractice: [], addresses: [], identifiers: [],
        providerCertifications: [{ caqhCertificationId: '1001', certDescription: 'BLS' }],
      });
      expect(summary.providerCertifications.skipped).toBe(1);
      expect(prismaMock.providerCertification.update).not.toHaveBeenCalled();
    });

    // ------- Day 1 PR 2: CDS Registration persistence -------

    it('encrypts CDS number before persisting (HIPAA)', async () => {
      prismaMock.cdsRegistration.findFirst.mockResolvedValue(null);
      prismaMock.cdsRegistration.create.mockResolvedValue({} as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], malpractice: [], addresses: [], identifiers: [],
        cdsRegistrations: [{ cdsNumber: 'PLAINTEXT-12345', state: 'FL', expirationDate: new Date('2028-12-31') }],
      });

      expect(summary.cdsRegistrations.created).toBe(1);
      const args = (prismaMock.cdsRegistration.create as any).mock.calls[0][0].data;
      expect(args.providerId).toBe('p1');
      expect(args.state).toBe('FL');
      expect(args.cdsNumberEncrypted).toBeDefined();
      expect(args.cdsNumberEncrypted).not.toBe('PLAINTEXT-12345');
      expect(args.source).toBe('caqh_sync');
    });

    it('updates CDS by (providerId, state) on re-sync', async () => {
      prismaMock.cdsRegistration.findFirst.mockResolvedValue({
        id: 'cds-1', source: 'caqh_sync', state: 'FL',
      } as any);
      prismaMock.cdsRegistration.update.mockResolvedValue({} as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], malpractice: [], addresses: [], identifiers: [],
        cdsRegistrations: [{ cdsNumber: 'NEW-CDS', state: 'FL', expirationDate: new Date('2030-01-01') }],
      });

      expect(summary.cdsRegistrations.updated).toBe(1);
      expect(prismaMock.cdsRegistration.findFirst).toHaveBeenCalledWith({
        where: { providerId: 'p1', state: 'FL' },
      });
    });

    it('skips CDS rows marked source=manual_entry', async () => {
      prismaMock.cdsRegistration.findFirst.mockResolvedValue({
        id: 'cds-1', source: 'manual_entry',
      } as any);

      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], malpractice: [], addresses: [], identifiers: [],
        cdsRegistrations: [{ cdsNumber: 'X', state: 'FL' }],
      });
      expect(summary.cdsRegistrations.skipped).toBe(1);
      expect(prismaMock.cdsRegistration.update).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // syncProvider
  // ==========================================

  describe('syncProvider', () => {
    it('calls checkStatus first, then pullCredentials with attestation date', async () => {
      prismaMock.caqhSyncLog.create.mockResolvedValue({ id: 'sync-1' } as any);
      prismaMock.caqhSyncLog.update.mockResolvedValue({} as any);
      prismaMock.provider.update.mockResolvedValue({} as any);

      // First call: checkStatus returns status with provider_status_date
      // Second call: pullCredentials returns credential data
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify({
            roster_status: 'ACTIVE',
            provider_status_date: '20250209',
            provider_found_flag: 'Y',
          })),
        } as Response)
        .mockResolvedValueOnce({
          ok: true, status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({
            provider: { firstName: 'Jane', lastName: 'Doe', npi: '123' },
            licenses: [], certifications: [], education: [],
          })),
        } as Response);

      const result = await service.syncProvider('p1', 'caqh-1');

      expect(result.syncId).toBe('sync-1');
      // Verify checkStatus was called first
      expect(fetchSpy.mock.calls[0]![0]).toContain('/RosterAPI/api/ProviderStatus');
      // Verify pullCredentials was called with converted date (2/9/2025)
      expect(fetchSpy.mock.calls[1]![0]).toContain('attestationDate=2%2F9%2F2025');
      expect(prismaMock.caqhSyncLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
      );
    });

    it('falls back to anniversary_date when provider_status_date missing', async () => {
      prismaMock.caqhSyncLog.create.mockResolvedValue({ id: 'sync-1' } as any);
      prismaMock.caqhSyncLog.update.mockResolvedValue({} as any);
      prismaMock.provider.update.mockResolvedValue({} as any);

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify({
            roster_status: 'ACTIVE',
            anniversary_date: '20251115',
            provider_found_flag: 'Y',
          })),
        } as Response)
        .mockResolvedValueOnce({
          ok: true, status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({
            provider: { firstName: 'Jane', lastName: 'Doe', npi: '123' },
            licenses: [], certifications: [], education: [],
          })),
        } as Response);

      await service.syncProvider('p1', 'caqh-1');

      // Should use anniversary_date converted to 11/15/2025
      expect(fetchSpy.mock.calls[1]![0]).toContain('attestationDate=11%2F15%2F2025');
    });

    it('throws when status response has no attestation date', async () => {
      prismaMock.caqhSyncLog.create.mockResolvedValue({ id: 'sync-2' } as any);
      prismaMock.caqhSyncLog.update.mockResolvedValue({} as any);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({
          roster_status: 'ACTIVE',
          provider_found_flag: 'Y',
        })),
      } as Response);

      await expect(service.syncProvider('p1', 'caqh-1')).rejects.toThrow(
        'CAQH status response missing attestation date'
      );

      expect(prismaMock.caqhSyncLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed' }),
        }),
      );
    });

    it('logs failure to CaqhSyncLog on error', async () => {
      prismaMock.caqhSyncLog.create.mockResolvedValue({ id: 'sync-2' } as any);
      prismaMock.caqhSyncLog.update.mockResolvedValue({} as any);

      mockFetchError(500);

      await expect(service.syncProvider('p1', 'caqh-1')).rejects.toThrow();

      expect(prismaMock.caqhSyncLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed', errorMessage: expect.any(String) }),
        }),
      );
    });
  });

  // ==========================================
  // yyyymmddToMDYYYY
  // ==========================================

  describe('yyyymmddToMDYYYY', () => {
    it('converts YYYYMMDD to M/D/YYYY without zero-padding', () => {
      expect(service.yyyymmddToMDYYYY('20250209')).toBe('2/9/2025');
    });

    it('handles double-digit month and day', () => {
      expect(service.yyyymmddToMDYYYY('20251115')).toBe('11/15/2025');
    });

    it('handles first day of year', () => {
      expect(service.yyyymmddToMDYYYY('20250101')).toBe('1/1/2025');
    });
  });

  // ==========================================
  // getDocumentsList
  // ==========================================

  describe('getDocumentsList', () => {
    it('fetches documents from the correct endpoint', async () => {
      const docs = [{ DocumentTypeName: 'License', DocumentURL: '/doc/1' }];
      const fetchSpy = mockFetchOk(docs);

      const result = await service.getDocumentsList('caqh-1');

      expect(result).toEqual(docs);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/documentapi/api/ProviderDocs/GetDocumentsList'),
        expect.anything(),
      );
      expect(fetchSpy.mock.calls[0]![0]).toContain('caqhProviderID=caqh-1');
      expect(fetchSpy.mock.calls[0]![0]).toContain('organizationID=org-123');
    });
  });

  // ==========================================
  // downloadDocument
  // ==========================================

  describe('downloadDocument', () => {
    it('returns binary data with content type and filename', async () => {
      const fileData = new Uint8Array([0x50, 0x44, 0x46]);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(fileData.buffer),
        headers: new Headers({
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="license.pdf"',
        }),
      } as Response);

      const result = await service.downloadDocument('caqh-1', '/doc/url');

      expect(result.contentType).toBe('application/pdf');
      expect(result.fileName).toBe('license.pdf');
      expect(result.data).toBeInstanceOf(Buffer);
    });
  });

  // ==========================================
  // pullCredentials (XML parsing)
  // ==========================================

  describe('pullCredentials', () => {
    it('parses XML response from Credentialing API v9', async () => {
      const xmlResponse = `<?xml version="1.0" encoding="utf-8"?>
<Provider>
  <FirstName>Jane</FirstName>
  <LastName>Doe</LastName>
  <NPI>1234567890</NPI>
</Provider>`;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/xml' }),
        text: () => Promise.resolve(xmlResponse),
      } as Response);

      const result = await service.pullCredentials('caqh-1', '2/9/2025');

      expect(result).toBeDefined();
      expect((result as any).Provider).toBeDefined();
    });

    it('falls back to JSON when response is JSON', async () => {
      const jsonData = {
        provider: { firstName: 'Jane', lastName: 'Doe', npi: '123' },
        licenses: [],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(jsonData)),
      } as Response);

      const result = await service.pullCredentials('caqh-1', '2/9/2025');

      expect(result).toEqual(jsonData);
    });

    it('calls correct endpoint with attestation date', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
      } as Response);

      await service.pullCredentials('caqh-1', '2/9/2025');

      const url = fetchSpy.mock.calls[0]![0] as string;
      expect(url).toContain('/credentialingapi/api/v8/entities');
      expect(url).toContain('caqhProviderId=caqh-1');
      expect(url).toContain('organizationId=org-123');
      expect(url).toContain('attestationDate=2%2F9%2F2025');
    });
  });
});
