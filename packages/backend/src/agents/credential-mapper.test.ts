import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { mapToCredential } from './credential-mapper.js';

describe('credential-mapper', () => {
  describe('license mapping', () => {
    it('maps extracted fields to License schema', () => {
      const result = mapToCredential('license', {
        licenseNumber: { value: 'MD12345', confidence: 0.95 },
        state: { value: 'California', confidence: 0.98 },
        issueDate: { value: '2020-01-15', confidence: 0.90 },
        expirationDate: { value: '2026-01-15', confidence: 0.92 },
      });

      expect(result.mapped).toEqual(expect.objectContaining({
        licenseNumber: 'MD12345',
        state: 'CA',
        issueDate: expect.any(Date),
        expirationDate: expect.any(Date),
      }));
      expect(result.unmappedFields).toHaveLength(0);
    });

    it('normalizes state names to abbreviations', () => {
      const result = mapToCredential('license', {
        state: { value: 'New York', confidence: 0.95 },
        licenseNumber: { value: 'NY999', confidence: 0.95 },
        issueDate: { value: '2020-01-01', confidence: 0.95 },
        expirationDate: { value: '2026-01-01', confidence: 0.95 },
      });

      expect(result.mapped['state']).toBe('NY');
    });

    it('tracks unmapped fields', () => {
      const result = mapToCredential('license', {
        licenseNumber: { value: 'MD12345', confidence: 0.95 },
        unknownField: { value: 'something', confidence: 0.80 },
        issueDate: { value: '2020-01-01', confidence: 0.95 },
        expirationDate: { value: '2026-01-01', confidence: 0.95 },
      });

      expect(result.unmappedFields).toContain('unknownField');
    });
  });

  describe('board_certification mapping', () => {
    it('maps extracted fields to BoardCertification schema', () => {
      const result = mapToCredential('board_certification', {
        certificationNumber: { value: 'CERT-789', confidence: 0.93 },
        boardName: { value: 'American Board of Psychiatry', confidence: 0.97 },
        specialty: { value: 'Psychiatry', confidence: 0.96 },
        initialCertificationDate: { value: '2018-06-01', confidence: 0.91 },
        expirationDate: { value: '2028-06-01', confidence: 0.90 },
      });

      expect(result.mapped).toEqual(expect.objectContaining({
        certificationNumber: 'CERT-789',
        boardName: 'American Board of Psychiatry',
        specialty: 'Psychiatry',
      }));
    });
  });

  describe('malpractice_certificate mapping', () => {
    it('maps insurance fields correctly', () => {
      const result = mapToCredential('malpractice_certificate', {
        carrierName: { value: 'ACME Insurance', confidence: 0.95 },
        policyNumber: { value: 'POL-456', confidence: 0.97 },
        perClaimAmount: { value: '1000000', confidence: 0.90 },
        aggregateAmount: { value: '3000000', confidence: 0.90 },
        effectiveDate: { value: '2025-01-01', confidence: 0.92 },
        expirationDate: { value: '2026-01-01', confidence: 0.93 },
      });

      expect(result.mapped).toEqual(expect.objectContaining({
        carrierName: 'ACME Insurance',
        policyNumber: 'POL-456',
        perClaimAmount: 1000000,
        aggregateAmount: 3000000,
      }));
    });
  });

  it('returns empty mapped for unsupported document types', () => {
    const result = mapToCredential('photo', {
      something: { value: 'data', confidence: 0.95 },
    });

    expect(result.mapped).toEqual({});
    expect(result.unmappedFields).toContain('something');
  });
});
