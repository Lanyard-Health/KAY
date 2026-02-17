import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env['CAQH_API_URL'] = 'https://caqh.test.com';
  process.env['CAQH_ORG_ID'] = 'org-123';
  process.env['CAQH_API_KEY'] = 'key-abc';
});

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { CaqhService } from './caqh.service.js';
import type { CaqhCredentialsResponse } from './caqh.service.js';
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
      const orig = process.env['CAQH_API_URL'];
      process.env['CAQH_API_URL'] = '';
      const s = new CaqhService();
      expect(s.isConfigured()).toBe(false);
      process.env['CAQH_API_URL'] = orig;
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

    it('includes auth headers on every request', async () => {
      const fetchSpy = mockFetchOk({ caqhProviderId: 'caqh-1', status: 'active' });

      await service.checkStatus('caqh-1');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://caqh.test.com/status/caqh-1',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer key-abc',
            'Organization-Id': 'org-123',
          }),
        }),
      );
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
        'https://caqh.test.com/roster/add',
        expect.objectContaining({ method: 'POST' }),
      );
      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.date_of_birth).toBe('1985-06-15');
    });
  });

  describe('removeFromRoster', () => {
    it('sends DELETE request', async () => {
      const fetchSpy = mockFetchOk({});
      await service.removeFromRoster('caqh-99');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://caqh.test.com/roster/caqh-99',
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
        certifications: [], education: [], malpractice: [],
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
        certifications: [], education: [], malpractice: [],
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
        certifications: [], education: [], malpractice: [],
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
        certifications: [], education: [], malpractice: [],
      });

      expect(summary.licenses.failed).toBe(1);
      expect(summary.failedRecords).toEqual([
        expect.objectContaining({ category: 'license', identifier: 'MD-1', error: 'DB constraint' }),
      ]);
    });

    it('skips malpractice without perClaimAmount', async () => {
      const summary = await service.applyCaqhDataToProvider('p1', {
        provider: { firstName: 'J', lastName: 'D', npi: '123' },
        licenses: [], certifications: [], education: [],
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
    it('orchestrates pull → map → apply → log on success', async () => {
      prismaMock.caqhSyncLog.create.mockResolvedValue({ id: 'sync-1' } as any);
      prismaMock.caqhSyncLog.update.mockResolvedValue({} as any);
      prismaMock.provider.update.mockResolvedValue({} as any);

      mockFetchOk({
        provider: { firstName: 'Jane', lastName: 'Doe', npi: '123' },
        licenses: [], certifications: [], education: [],
      });

      const result = await service.syncProvider('p1', 'caqh-1');

      expect(result.syncId).toBe('sync-1');
      expect(prismaMock.caqhSyncLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'in_progress' }) }),
      );
      expect(prismaMock.caqhSyncLog.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
      );
      expect(prismaMock.provider.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1' }, data: expect.objectContaining({ caqhLastSync: expect.any(Date) }) }),
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
});
