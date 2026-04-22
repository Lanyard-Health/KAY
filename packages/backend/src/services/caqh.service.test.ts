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

import { CaqhService } from './caqh.service.js';
import type { CaqhCredentialsResponse, CaqhStatusResponse } from './caqh.service.js';
import { prismaMock } from '../../tests/helpers/mock-prisma.js';

let service: CaqhService;

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  service = new CaqhService();
  // Speed up retry tests by mocking the private sleep method
  vi.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
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
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('err') } as Response);

      await expect(service.addToRoster({
        id: 'p1', npi: '1234567890', firstName: 'Jane', lastName: 'Doe', dateOfBirth: new Date('1985-01-01'),
      })).rejects.toThrow('CAQH API error: 500');
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

  describe('addToRoster', () => {
    it('POSTs correct payload with formatted date', async () => {
      const fetchSpy = mockFetchOk({ caqhProviderId: 'caqh-new', status: 'added' });

      const result = await service.addToRoster({
        id: 'p1', npi: '1234567890', firstName: 'Jane', lastName: 'Doe',
        dateOfBirth: new Date('1985-06-15'),
      });

      expect(result).toEqual({ caqhProviderId: 'caqh-new', status: 'added' });
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://caqh.test.com/RosterAPI/API/Roster?product=PV',
        expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.date_of_birth).toBe('1985-06-15');
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

    it('skips malpractice without perClaimAmount', async () => {
      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [], addresses: [], identifiers: [],
        malpractice: [{ carrierName: 'PIAA', policyNumber: 'POL-1', expirationDate: '2027-01-01' }],
      });

      expect(summary.malpractice.skipped).toBe(1);
      expect(prismaMock.malpracticeInsurance.findFirst).not.toHaveBeenCalled();
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
