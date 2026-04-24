import { describe, it, expect } from 'vitest';
import { scrubPii, buildCsv, buildPdf, slugifyForFilename } from './caqh-export.js';

describe('scrubPii', () => {
  it('redacts SSN, BirthDate, DOB (case-insensitive) and preserves other fields', () => {
    const input = {
      Provider: {
        FirstName: 'Jane',
        LastName: 'Doe',
        SSN: '123-45-6789',
        BirthDate: '1985-06-15',
        BirthCountry: 'USA', // similar-looking key must NOT be redacted
      },
    };

    const out = scrubPii(input);

    expect(out.Provider.FirstName).toBe('Jane');
    expect(out.Provider.SSN).toBe('[REDACTED]');
    expect(out.Provider.BirthDate).toBe('[REDACTED]');
    expect(out.Provider.BirthCountry).toBe('USA');
  });

  it('recurses into arrays and nested objects', () => {
    const input = {
      Practice: [
        { PracticeName: 'Acme', DOB: '1985-06-15' },
        { PracticeName: 'Beta', dob: '1990-01-01' },
      ],
      Reference: { ssn: 'x', name: 'keep' },
    };

    const out: any = scrubPii(input);

    expect(out.Practice[0].DOB).toBe('[REDACTED]');
    expect(out.Practice[1].dob).toBe('[REDACTED]');
    expect(out.Practice[0].PracticeName).toBe('Acme');
    expect(out.Reference.ssn).toBe('[REDACTED]');
    expect(out.Reference.name).toBe('keep');
  });

  it('handles null, undefined, and primitives safely', () => {
    expect(scrubPii(null)).toBeNull();
    expect(scrubPii(undefined)).toBeUndefined();
    expect(scrubPii('string')).toBe('string');
    expect(scrubPii(42)).toBe(42);
  });
});

describe('buildCsv', () => {
  const ctx = {
    providerName: 'Jane A. Doe',
    npi: '1234567890',
    practiceName: 'Acme Clinic',
    licenses: [
      { state: 'CA', licenseNumber: 'A123456', expirationDate: new Date('2026-03-01') },
      { state: 'NY', licenseNumber: 'B789012', expirationDate: new Date('2025-11-15') },
    ],
    boardCertifications: [
      { boardName: 'ABPN', specialty: 'Psychiatry', expirationDate: new Date('2027-01-01') },
    ],
    lastSyncedAt: new Date('2026-04-22T10:00:00Z'),
  };

  it('produces a header row + exactly one data row', () => {
    const csv = buildCsv(ctx);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('providerName,npi,dob,licenses,boardCertifications,lastSync');
  });

  it('redacts DOB column and joins multiple licenses with semicolons', () => {
    const csv = buildCsv(ctx);
    expect(csv).toContain('[REDACTED]');
    // Semicolons are not CSV-special when delimiter is comma, so no quoting needed.
    expect(csv).toContain('CA #A123456 (exp 2026-03-01); NY #B789012 (exp 2025-11-15)');
  });

  it('quotes cells containing commas', () => {
    const csv = buildCsv({ ...ctx, providerName: 'Doe, Jane' });
    expect(csv).toContain('"Doe, Jane"');
  });

  it('handles empty licenses and board certs', () => {
    const csv = buildCsv({ ...ctx, licenses: [], boardCertifications: [] });
    const row = csv.trim().split('\n')[1]!;
    // Two empty cells in the middle: licenses and boardCertifications
    expect(row).toContain(',,');
  });
});

describe('buildPdf', () => {
  it('returns a valid PDF byte array starting with %PDF', async () => {
    const bytes = await buildPdf({
      providerName: 'Jane Doe',
      npi: '1234567890',
      practiceName: null,
      licenses: [],
      boardCertifications: [],
      lastSyncedAt: new Date(),
    });
    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(Buffer.from(bytes).slice(0, 4).toString()).toBe('%PDF');
  });
});

describe('slugifyForFilename', () => {
  it('lowercases, replaces non-alphanumerics with hyphens, trims', () => {
    expect(slugifyForFilename("O'Brien")).toBe('o-brien');
    expect(slugifyForFilename('  Doe  ')).toBe('doe');
    expect(slugifyForFilename('!!!')).toBe('provider');
  });
});
