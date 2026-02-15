import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma
vi.mock('../../src/utils/prisma.js', async () => {
  const { prismaMock } = await import('../helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  validateFile,
  parseAndValidateRows,
  validateNpiLuhn,
  fuzzyNameMatch,
  executeImport,
  getImportStatus,
  type ValidatedRow,
  type ImportResult,
} from '../../src/services/providerImport.service.js';
import { prismaMock } from '../helpers/mock-prisma.js';
import { logger } from '../../src/utils/logger.js';

// Known valid NPI: 1234567893 (passes Luhn with 80840 prefix)
const VALID_NPI = '1234567893';

function makeCsv(headers: string[], rows: string[][]): string {
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

const REQUIRED_HEADERS = ['firstName', 'lastName', 'npi', 'email', 'providerType'];

function validRow(overrides: Record<string, string> = {}): string[] {
  const defaults: Record<string, string> = {
    firstName: 'Jane',
    lastName: 'Doe',
    npi: VALID_NPI,
    email: 'jane@example.com',
    providerType: 'psychiatrist',
  };
  const merged = { ...defaults, ...overrides };
  return REQUIRED_HEADERS.map(h => merged[h] ?? '');
}

// Helper: mock NPPES to return no match (avoids real HTTP calls)
function mockNppesNotFound() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ result_count: 0, results: [] }), { status: 200 }))
  );
}

// Helper: mock NPPES to return a matching provider
function mockNppesMatch(firstName: string, lastName: string) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({
      result_count: 1,
      results: [{ basic: { first_name: firstName, last_name: lastName } }],
    }), { status: 200 }))
  );
}

// Helper: mock NPPES network error
function mockNppesError() {
  return vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Default: NPPES returns matching name, no duplicates
  mockNppesMatch('Jane', 'Doe');
  prismaMock.provider.findMany.mockResolvedValue([]);
});

// ==========================================
// File-level validation
// ==========================================

describe('validateFile', () => {
  const makeFile = (overrides: Partial<{
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }> = {}) => ({
    originalname: 'providers.csv',
    mimetype: 'text/csv',
    size: 1024,
    buffer: Buffer.from('test'),
    ...overrides,
  });

  it('accepts valid CSV file', () => {
    expect(validateFile(makeFile())).toBeNull();
  });

  it('rejects non-csv extension', () => {
    const result = validateFile(makeFile({ originalname: 'data.xlsx' }));
    expect(result).toEqual({
      code: 'INVALID_FILE_TYPE',
      message: 'File must be a .csv file',
    });
  });

  it('rejects invalid content type', () => {
    const result = validateFile(makeFile({ mimetype: 'application/json' }));
    expect(result).toEqual({
      code: 'INVALID_CONTENT_TYPE',
      message: expect.stringContaining('application/json'),
    });
  });

  it('accepts application/vnd.ms-excel content type', () => {
    expect(validateFile(makeFile({ mimetype: 'application/vnd.ms-excel' }))).toBeNull();
  });

  it('rejects file over 2MB', () => {
    const result = validateFile(makeFile({ size: 3 * 1024 * 1024 }));
    expect(result).toEqual({
      code: 'FILE_TOO_LARGE',
      message: expect.stringContaining('2MB'),
    });
  });

  it('accepts file exactly at 2MB', () => {
    expect(validateFile(makeFile({ size: 2 * 1024 * 1024 }))).toBeNull();
  });

  it('rejects file with zero size', () => {
    const result = validateFile(makeFile({ size: 0, buffer: Buffer.alloc(0) }));
    expect(result).toEqual({
      code: 'EMPTY_FILE',
      message: 'File is empty',
    });
  });
});

// ==========================================
// CSV parsing and header validation
// ==========================================

describe('parseAndValidateRows', () => {
  describe('header validation', () => {
    it('rejects CSV with missing required headers', async () => {
      const csv = makeCsv(['firstName', 'lastName'], [['Jane', 'Doe']]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.summary.errors).toBe(1);
      expect(result.rows[0]!.errors[0]!.message).toContain('Missing required headers');
      expect(result.rows[0]!.errors[0]!.message).toContain('npi');
      expect(result.rows[0]!.errors[0]!.message).toContain('email');
      expect(result.rows[0]!.errors[0]!.message).toContain('providerType');
    });

    it('rejects CSV with SSN column', async () => {
      const csv = makeCsv([...REQUIRED_HEADERS, 'SSN'], [
        [...validRow(), '123-45-6789'],
      ]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.summary.errors).toBe(1);
      expect(result.rows[0]!.errors[0]!.message).toContain('SSN column is not allowed');
    });

    it('accepts CSV with only required headers', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [validRow()]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.summary.valid).toBe(1);
      expect(result.summary.errors).toBe(0);
    });

    it('accepts CSV with optional headers', async () => {
      const headers = [...REQUIRED_HEADERS, 'phone', 'licenseNumber'];
      const csv = makeCsv(headers, [
        [...validRow(), '(555) 123-4567', 'MD-12345'],
      ]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.summary.valid).toBe(1);
    });
  });

  describe('row count limits', () => {
    it('rejects CSV with more than 500 rows', async () => {
      const rows = Array.from({ length: 501 }, () => validRow());
      const csv = makeCsv(REQUIRED_HEADERS, rows);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.summary.errors).toBe(1);
      expect(result.rows[0]!.errors[0]!.message).toContain('501');
      expect(result.rows[0]!.errors[0]!.message).toContain('500');
    });

    it('accepts CSV with exactly 500 rows', async () => {
      vi.useFakeTimers();
      const rows = Array.from({ length: 500 }, () => validRow());
      const csv = makeCsv(REQUIRED_HEADERS, rows);
      const promise = parseAndValidateRows(csv, 'practice-1');
      await vi.runAllTimersAsync();
      const result = await promise;
      vi.useRealTimers();

      expect(result.summary.errors).toBe(0);
      expect(result.summary.total).toBe(500);
    });
  });

  describe('Excel CSV quirks', () => {
    it('handles BOM character at start of file', async () => {
      const csv = '\uFEFF' + makeCsv(REQUIRED_HEADERS, [validRow()]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.summary.valid).toBe(1);
    });

    it('handles \\r\\n line endings', async () => {
      const csv = REQUIRED_HEADERS.join(',') + '\r\n' + validRow().join(',') + '\r\n';
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.summary.valid).toBe(1);
    });

    it('handles quoted fields with commas', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [
        ['"Doe, Jr."', 'Jane', VALID_NPI, 'jane@example.com', 'psychiatrist'],
      ]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.data['firstName']).toBe('Doe, Jr.');
    });

    it('skips completely empty rows', async () => {
      const csv = REQUIRED_HEADERS.join(',') + '\n' + validRow().join(',') + '\n\n\n';
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.summary.total).toBe(1);
    });
  });

  describe('empty CSV', () => {
    it('rejects CSV with only headers and no data rows', async () => {
      const csv = REQUIRED_HEADERS.join(',');
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.summary.errors).toBe(1);
      expect(result.rows[0]!.errors[0]!.message).toContain('No data rows found');
    });

    it('rejects completely empty CSV content', async () => {
      const result = await parseAndValidateRows('', 'practice-1');

      expect(result.summary.errors).toBe(1);
      expect(result.rows[0]!.errors[0]!.message).toContain('No data rows found');
    });
  });

  // ==========================================
  // Row-level validation
  // ==========================================

  describe('required field validation', () => {
    it('marks row as error when firstName is empty', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [validRow({ firstName: '' })]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('error');
      expect(result.rows[0]!.errors).toContainEqual({
        field: 'firstName',
        message: 'First name is required',
      });
    });

    it('marks row as error when firstName exceeds 100 chars', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [validRow({ firstName: 'A'.repeat(101) })]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('error');
      expect(result.rows[0]!.errors).toContainEqual({
        field: 'firstName',
        message: 'First name must be 100 characters or less',
      });
    });

    it('marks row as error when lastName is empty', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [validRow({ lastName: '' })]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.errors).toContainEqual({
        field: 'lastName',
        message: 'Last name is required',
      });
    });

    it('marks row as error when email is invalid', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [validRow({ email: 'not-an-email' })]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.errors).toContainEqual({
        field: 'email',
        message: 'Invalid email format',
      });
    });

    it('marks row as error when providerType is invalid', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [validRow({ providerType: 'dentist' })]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.errors).toContainEqual({
        field: 'providerType',
        message: expect.stringContaining('dentist'),
      });
    });

    it('normalizes providerType to lowercase', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [validRow({ providerType: 'Psychiatrist' })]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('valid');
      expect(result.rows[0]!.data['providerType']).toBe('psychiatrist');
    });
  });

  describe('whitespace and extra columns', () => {
    it('trims leading/trailing whitespace from field values', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [
        validRow({ firstName: '  Jane  ', lastName: '  Doe  ', email: '  jane@example.com  ' }),
      ]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('valid');
      expect(result.rows[0]!.data['firstName']).toBe('Jane');
      expect(result.rows[0]!.data['lastName']).toBe('Doe');
      expect(result.rows[0]!.data['email']).toBe('jane@example.com');
    });

    it('ignores extra columns not in known headers', async () => {
      const headers = [...REQUIRED_HEADERS, 'favoriteColor', 'shoeSize'];
      const csv = makeCsv(headers, [
        [...validRow(), 'blue', '10'],
      ]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('valid');
      expect(result.rows[0]!.data).not.toHaveProperty('favoriteColor');
      expect(result.rows[0]!.data).not.toHaveProperty('shoeSize');
      expect(result.rows[0]!.errors).toHaveLength(0);
    });
  });

  describe('NPI validation', () => {
    it('marks row as error for non-10-digit NPI', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [validRow({ npi: '12345' })]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.errors).toContainEqual({
        field: 'npi',
        message: 'NPI must be exactly 10 digits',
      });
    });

    it('marks row as error for NPI with letters', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [validRow({ npi: '123456789A' })]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.errors).toContainEqual({
        field: 'npi',
        message: 'NPI must be exactly 10 digits',
      });
    });

    it('marks row as error for NPI failing Luhn checksum', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [validRow({ npi: '1234567890' })]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.errors).toContainEqual({
        field: 'npi',
        message: 'NPI fails Luhn checksum validation',
      });
    });

    it('accepts valid NPI passing Luhn checksum', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [validRow({ npi: VALID_NPI })]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('valid');
    });
  });

  describe('optional field validation', () => {
    it('marks row as error for invalid phone format', async () => {
      const headers = [...REQUIRED_HEADERS, 'phone'];
      const csv = makeCsv(headers, [[...validRow(), '123']]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.errors).toContainEqual({
        field: 'phone',
        message: 'Invalid phone number format',
      });
    });

    it('accepts valid US phone formats', async () => {
      const headers = [...REQUIRED_HEADERS, 'phone'];
      for (const phone of ['(555) 123-4567', '555-123-4567', '5551234567', '+1 555 123 4567']) {
        mockNppesMatch('Jane', 'Doe'); // reset for each iteration
        prismaMock.provider.findMany.mockResolvedValue([]);
        const csv = makeCsv(headers, [[...validRow(), phone]]);
        const result = await parseAndValidateRows(csv, 'practice-1');
        expect(result.rows[0]!.errors.filter(e => e.field === 'phone')).toHaveLength(0);
      }
    });

    it('marks row as error for invalid dateOfBirth format', async () => {
      const headers = [...REQUIRED_HEADERS, 'dateOfBirth'];
      const csv = makeCsv(headers, [[...validRow(), 'Jan 1 1990']]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.errors).toContainEqual({
        field: 'dateOfBirth',
        message: expect.stringContaining('Invalid date format'),
      });
    });

    it('marks row as error for future dateOfBirth', async () => {
      const headers = [...REQUIRED_HEADERS, 'dateOfBirth'];
      const csv = makeCsv(headers, [[...validRow(), '2099-01-01']]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.errors).toContainEqual({
        field: 'dateOfBirth',
        message: 'Date of birth must be in the past',
      });
    });

    it('accepts dateOfBirth in YYYY-MM-DD format', async () => {
      const headers = [...REQUIRED_HEADERS, 'dateOfBirth'];
      const csv = makeCsv(headers, [[...validRow(), '1985-06-15']]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.data['dateOfBirth']).toBe('1985-06-15');
      expect(result.rows[0]!.errors.filter(e => e.field === 'dateOfBirth')).toHaveLength(0);
    });

    it('accepts and normalizes dateOfBirth in MM/DD/YYYY format', async () => {
      const headers = [...REQUIRED_HEADERS, 'dateOfBirth'];
      const csv = makeCsv(headers, [[...validRow(), '6/15/1985']]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.data['dateOfBirth']).toBe('1985-06-15');
    });
  });

  describe('license expiration warnings', () => {
    it('marks row as warning (not error) for expired license', async () => {
      const headers = [...REQUIRED_HEADERS, 'licenseExpiration'];
      const csv = makeCsv(headers, [[...validRow(), '2020-01-01']]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('warning');
      expect(result.rows[0]!.warnings).toContainEqual({
        field: 'licenseExpiration',
        message: 'License is expired',
      });
      expect(result.rows[0]!.errors).toHaveLength(0);
    });

    it('marks row as error for invalid licenseExpiration format', async () => {
      const headers = [...REQUIRED_HEADERS, 'licenseExpiration'];
      const csv = makeCsv(headers, [[...validRow(), 'not-a-date']]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('error');
      expect(result.rows[0]!.errors).toContainEqual({
        field: 'licenseExpiration',
        message: expect.stringContaining('Invalid date format'),
      });
    });

    it('accepts valid future licenseExpiration without warning', async () => {
      const headers = [...REQUIRED_HEADERS, 'licenseExpiration'];
      const csv = makeCsv(headers, [[...validRow(), '2099-12-31']]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('valid');
      expect(result.rows[0]!.warnings).toHaveLength(0);
    });

    it('normalizes MM/DD/YYYY licenseExpiration to YYYY-MM-DD', async () => {
      const headers = [...REQUIRED_HEADERS, 'licenseExpiration'];
      const csv = makeCsv(headers, [[...validRow(), '12/31/2099']]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.data['licenseExpiration']).toBe('2099-12-31');
    });
  });

  describe('multiple rows and summary', () => {
    it('collects errors across all rows independently', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [
        validRow(),
        validRow({ email: 'bad-email' }),
        validRow({ npi: '0000000000' }),
      ]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.summary.valid).toBe(1);
      expect(result.summary.errors).toBe(2);
      expect(result.summary.total).toBe(3);
    });

    it('assigns correct row numbers (1-indexed, accounts for header)', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [validRow(), validRow()]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.rowNumber).toBe(2);
      expect(result.rows[1]!.rowNumber).toBe(3);
    });

    it('collects multiple errors per row', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [
        validRow({ firstName: '', email: 'bad', npi: '123' }),
      ]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('structured logging', () => {
    it('logs validation started and completed events', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [validRow(), validRow()]);
      await parseAndValidateRows(csv, 'practice-1');

      expect(logger.info).toHaveBeenCalledWith({
        event: 'provider_import_validation_started',
        practiceId: 'practice-1',
        totalRows: 2,
      });

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'provider_import_validation_completed',
          practiceId: 'practice-1',
        })
      );
    });
  });

  // ==========================================
  // NPPES verification
  // ==========================================

  describe('NPPES verification', () => {
    it('adds warning when NPI not found in NPPES', async () => {
      mockNppesNotFound();
      const csv = makeCsv(REQUIRED_HEADERS, [validRow()]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('warning');
      expect(result.rows[0]!.warnings).toContainEqual({
        field: 'npi',
        message: 'NPI not found in national registry',
      });
    });

    it('adds warning when NPPES name does not match CSV', async () => {
      mockNppesMatch('Robert', 'Smith');
      const csv = makeCsv(REQUIRED_HEADERS, [validRow()]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('warning');
      expect(result.rows[0]!.warnings).toContainEqual({
        field: 'npi',
        message: expect.stringContaining('NPI registered to Robert Smith'),
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'provider_import_nppes_mismatch' })
      );
    });

    it('does not warn when NPPES name matches CSV', async () => {
      mockNppesMatch('Jane', 'Doe');
      const csv = makeCsv(REQUIRED_HEADERS, [validRow()]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('valid');
      expect(result.rows[0]!.warnings.filter(w => w.field === 'npi')).toHaveLength(0);
    });

    it('adds warning on NPPES network error without blocking', async () => {
      mockNppesError();
      const csv = makeCsv(REQUIRED_HEADERS, [validRow()]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('warning');
      expect(result.rows[0]!.warnings).toContainEqual({
        field: 'npi',
        message: 'Could not verify NPI against national registry',
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'provider_import_nppes_timeout' })
      );
    });

    it('adds warning when NPPES API returns HTTP 500', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.resolve(new Response('Internal Server Error', { status: 500 }))
      );
      const csv = makeCsv(REQUIRED_HEADERS, [validRow()]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('warning');
      expect(result.rows[0]!.warnings).toContainEqual({
        field: 'npi',
        message: 'Could not verify NPI against national registry',
      });
    });

    it('adds warning when NPPES API times out', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.reject(new DOMException('The operation was aborted', 'AbortError'))
      );
      const csv = makeCsv(REQUIRED_HEADERS, [validRow()]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('warning');
      expect(result.rows[0]!.warnings).toContainEqual({
        field: 'npi',
        message: 'Could not verify NPI against national registry',
      });
    });

    it('skips NPPES verification for rows with errors', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ result_count: 0 }), { status: 200 })
      );
      const csv = makeCsv(REQUIRED_HEADERS, [validRow({ npi: '123' })]);
      await parseAndValidateRows(csv, 'practice-1');

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('calls NPPES API with correct URL', async () => {
      const fetchSpy = mockNppesMatch('Jane', 'Doe');
      const csv = makeCsv(REQUIRED_HEADERS, [validRow()]);
      await parseAndValidateRows(csv, 'practice-1');

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(`number=${VALID_NPI}`),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  // ==========================================
  // Duplicate detection
  // ==========================================

  describe('duplicate detection', () => {
    it('marks row as duplicate when NPI exists in same practice', async () => {
      prismaMock.provider.findMany.mockResolvedValue([
        { npi: VALID_NPI, firstName: 'Jane', lastName: 'Doe' },
      ] as any);

      const csv = makeCsv(REQUIRED_HEADERS, [validRow()]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('duplicate');
      expect(result.rows[0]!.warnings).toContainEqual({
        field: 'npi',
        message: expect.stringContaining('Provider already exists: Dr. Jane Doe'),
      });
      expect(result.summary.duplicates).toBe(1);
    });

    it('does not mark as duplicate when NPI not in practice', async () => {
      prismaMock.provider.findMany.mockResolvedValue([]);

      const csv = makeCsv(REQUIRED_HEADERS, [validRow()]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('valid');
      expect(result.summary.duplicates).toBe(0);
    });

    it('does not mark as duplicate when NPI exists in a different practice', async () => {
      // Provider exists in practice-other, but we're checking practice-1
      prismaMock.provider.findMany.mockResolvedValue([]);

      const csv = makeCsv(REQUIRED_HEADERS, [validRow()]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.rows[0]!.status).toBe('valid');
      expect(result.summary.duplicates).toBe(0);
      // Verify we only queried practice-1, not any other practice
      expect(prismaMock.provider.findMany).toHaveBeenCalledWith({
        where: {
          practiceId: 'practice-1',
          npi: { in: [VALID_NPI] },
        },
        select: { npi: true, firstName: true, lastName: true },
      });
    });

    it('queries only the specific practice for duplicates', async () => {
      const csv = makeCsv(REQUIRED_HEADERS, [validRow()]);
      await parseAndValidateRows(csv, 'practice-42');

      expect(prismaMock.provider.findMany).toHaveBeenCalledWith({
        where: {
          practiceId: 'practice-42',
          npi: { in: [VALID_NPI] },
        },
        select: { npi: true, firstName: true, lastName: true },
      });
    });

    it('skips duplicate check for error rows', async () => {
      prismaMock.provider.findMany.mockResolvedValue([]);

      const csv = makeCsv(REQUIRED_HEADERS, [validRow({ npi: '123' })]);
      await parseAndValidateRows(csv, 'practice-1');

      // Error rows are filtered out before collecting NPIs;
      // with no valid NPIs, detectDuplicates returns early without querying
      expect(prismaMock.provider.findMany).not.toHaveBeenCalled();
    });

    it('handles mix of valid, duplicate, and error rows in summary', async () => {
      // Second NPI also valid
      const VALID_NPI_2 = '1245319599';

      // Mock NPPES to return matching names for each valid row
      vi.spyOn(globalThis, 'fetch')
        .mockImplementationOnce(() =>
          Promise.resolve(new Response(JSON.stringify({
            result_count: 1,
            results: [{ basic: { first_name: 'Jane', last_name: 'Doe' } }],
          }), { status: 200 }))
        )
        .mockImplementationOnce(() =>
          Promise.resolve(new Response(JSON.stringify({
            result_count: 1,
            results: [{ basic: { first_name: 'John', last_name: 'Smith' } }],
          }), { status: 200 }))
        );

      prismaMock.provider.findMany.mockResolvedValue([
        { npi: VALID_NPI, firstName: 'Jane', lastName: 'Doe' },
      ] as any);

      const csv = makeCsv(REQUIRED_HEADERS, [
        validRow(), // duplicate (NPI exists in practice)
        validRow({ npi: VALID_NPI_2, firstName: 'John', lastName: 'Smith', email: 'john@example.com' }), // valid
        validRow({ npi: '123' }), // error (invalid NPI format)
      ]);
      const result = await parseAndValidateRows(csv, 'practice-1');

      expect(result.summary.duplicates).toBe(1);
      expect(result.summary.valid).toBe(1);
      expect(result.summary.errors).toBe(1);
      expect(result.summary.total).toBe(3);
    });
  });
});

// ==========================================
// NPI Luhn checksum (unit)
// ==========================================

describe('validateNpiLuhn', () => {
  it('returns true for known valid NPI 1234567893', () => {
    expect(validateNpiLuhn('1234567893')).toBe(true);
  });

  it('returns true for known valid NPI 1245319599', () => {
    expect(validateNpiLuhn('1245319599')).toBe(true);
  });

  it('returns false for invalid check digit', () => {
    expect(validateNpiLuhn('1234567890')).toBe(false);
  });

  it('returns false for non-10-digit input', () => {
    expect(validateNpiLuhn('12345')).toBe(false);
  });

  it('returns false for non-numeric input', () => {
    expect(validateNpiLuhn('123456789A')).toBe(false);
  });
});

// ==========================================
// Fuzzy name matching (unit)
// ==========================================

describe('fuzzyNameMatch', () => {
  it('matches exact names (case-insensitive)', () => {
    expect(fuzzyNameMatch('Jane', 'Doe', 'JANE', 'DOE')).toBe(true);
  });

  it('matches when first 3 chars of firstName match', () => {
    expect(fuzzyNameMatch('Jonathan', 'Doe', 'Jon', 'Doe')).toBe(true);
  });

  it('matches when one firstName contains the other', () => {
    // "Jon" is a substring of "Jonathan"
    expect(fuzzyNameMatch('Jon', 'Doe', 'Jonathan', 'Doe')).toBe(true);
    // "Beth" is a substring of "Elizabeth"
    expect(fuzzyNameMatch('Beth', 'Doe', 'Elizabeth', 'Doe')).toBe(true);
  });

  it('rejects when lastName differs', () => {
    expect(fuzzyNameMatch('Jane', 'Doe', 'Jane', 'Smith')).toBe(false);
  });

  it('rejects when firstName is completely different', () => {
    expect(fuzzyNameMatch('Jane', 'Doe', 'Robert', 'Doe')).toBe(false);
  });

  it('handles short firstNames (< 3 chars)', () => {
    expect(fuzzyNameMatch('Jo', 'Doe', 'Jo', 'Doe')).toBe(true);
    expect(fuzzyNameMatch('Jo', 'Doe', 'Joseph', 'Doe')).toBe(true); // contains
  });
});

// ==========================================
// executeImport
// ==========================================

describe('executeImport', () => {
  const VALID_NPI_2 = '1245319599';

  function makeRow(overrides: Partial<ValidatedRow> = {}): ValidatedRow {
    return {
      rowNumber: 2,
      status: 'valid',
      data: {
        firstName: 'Jane',
        lastName: 'Doe',
        npi: VALID_NPI,
        email: 'jane@example.com',
        providerType: 'psychiatrist',
      },
      errors: [],
      warnings: [],
      ...overrides,
    };
  }

  const mockImportRecord = {
    id: 'import-1',
    practiceId: 'practice-1',
    status: 'pending',
    totalRows: 1,
    successCount: 0,
    errorCount: 0,
    skippedCount: 0,
    errorDetails: null,
    createdBy: 'user-1',
    createdAt: new Date(),
    completedAt: null,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    (prismaMock.$transaction as any).mockImplementation((fn: any) => fn(prismaMock));
    prismaMock.providerImport.create.mockResolvedValue(mockImportRecord as any);
    prismaMock.providerImport.update.mockResolvedValue({} as any);
    prismaMock.provider.create.mockResolvedValue({ id: 'provider-1' } as any);
    prismaMock.license.create.mockResolvedValue({ id: 'license-1' } as any);
  });

  it('rejects empty rows array', async () => {
    const result = await executeImport('practice-1', 'user-1', []);

    expect(result.successCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.error).toContain('No rows to import');
  });

  it('imports 5 valid rows with correct counts and completed status', async () => {
    const npis = ['1234567893', '1245319599', '1316405555', '1497758544', '1548266730'];
    const rows = npis.map((npi, i) =>
      makeRow({
        rowNumber: i + 2,
        data: {
          firstName: `Provider${i}`,
          lastName: 'Test',
          npi,
          email: `provider${i}@example.com`,
          providerType: 'psychiatrist',
        },
      })
    );

    prismaMock.provider.create
      .mockResolvedValueOnce({ id: 'p-1' } as any)
      .mockResolvedValueOnce({ id: 'p-2' } as any)
      .mockResolvedValueOnce({ id: 'p-3' } as any)
      .mockResolvedValueOnce({ id: 'p-4' } as any)
      .mockResolvedValueOnce({ id: 'p-5' } as any);

    prismaMock.providerImport.create.mockResolvedValue({
      ...mockImportRecord,
      totalRows: 5,
    } as any);

    const result = await executeImport('practice-1', 'user-1', rows);

    expect(result.successCount).toBe(5);
    expect(result.errorCount).toBe(0);
    expect(result.importId).toBe('import-1');
    expect(prismaMock.provider.create).toHaveBeenCalledTimes(5);

    // Verify import record updated to completed with correct counts
    expect(prismaMock.providerImport.update).toHaveBeenCalledWith({
      where: { id: 'import-1' },
      data: expect.objectContaining({
        status: 'completed',
        successCount: 5,
        completedAt: expect.any(Date),
      }),
    });
  });

  it('creates a ProviderImport record with status pending', async () => {
    await executeImport('practice-1', 'user-1', [makeRow()]);

    expect(prismaMock.providerImport.create).toHaveBeenCalledWith({
      data: {
        practiceId: 'practice-1',
        createdBy: 'user-1',
        totalRows: 1,
        status: 'pending',
      },
    });
  });

  it('creates providers with correct field mapping', async () => {
    await executeImport('practice-1', 'user-1', [makeRow()]);

    expect(prismaMock.provider.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        npi: VALID_NPI,
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        providerType: 'psychiatrist',
        phone: '',
        gender: 'prefer_not_to_say',
        specialties: [],
        languages: [],
        status: 'active',
        practiceId: 'practice-1',
        createdById: 'user-1',
      }),
    });
  });

  it('maps optional fields when present', async () => {
    const row = makeRow({
      data: {
        firstName: 'Jane',
        lastName: 'Doe',
        npi: VALID_NPI,
        email: 'jane@example.com',
        providerType: 'psychiatrist',
        phone: '555-123-4567',
        dateOfBirth: '1985-06-15',
        taxonomyCode: '207Q00000X',
        caqhProviderId: 'CAQH-123',
      },
    });

    await executeImport('practice-1', 'user-1', [row]);

    expect(prismaMock.provider.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone: '555-123-4567',
        dateOfBirth: new Date('1985-06-15'),
        taxonomy: '207Q00000X',
        caqhProviderId: 'CAQH-123',
      }),
    });
  });

  it('uses placeholder dateOfBirth when not provided', async () => {
    await executeImport('practice-1', 'user-1', [makeRow()]);

    expect(prismaMock.provider.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dateOfBirth: new Date('1900-01-01'),
      }),
    });
  });

  it('creates License when licenseNumber and licenseState provided', async () => {
    const row = makeRow({
      data: {
        firstName: 'Jane',
        lastName: 'Doe',
        npi: VALID_NPI,
        email: 'jane@example.com',
        providerType: 'lcsw',
        licenseNumber: 'SW-12345',
        licenseState: 'CA',
        licenseExpiration: '2027-12-31',
      },
    });

    await executeImport('practice-1', 'user-1', [row]);

    expect(prismaMock.license.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerId: 'provider-1',
        licenseType: 'state_social_work',
        licenseNumber: 'SW-12345',
        state: 'CA',
        expirationDate: new Date('2027-12-31'),
        status: 'active',
        source: 'portal_import',
        createdById: 'user-1',
      }),
    });
  });

  it('sets license status to expired for past expiration date', async () => {
    const row = makeRow({
      data: {
        firstName: 'Jane',
        lastName: 'Doe',
        npi: VALID_NPI,
        email: 'jane@example.com',
        providerType: 'psychiatrist',
        licenseNumber: 'MD-99999',
        licenseState: 'NY',
        licenseExpiration: '2020-01-01',
      },
    });

    await executeImport('practice-1', 'user-1', [row]);

    expect(prismaMock.license.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'expired',
        expirationDate: new Date('2020-01-01'),
      }),
    });
  });

  it('skips License when licenseNumber missing', async () => {
    const row = makeRow({
      data: {
        firstName: 'Jane',
        lastName: 'Doe',
        npi: VALID_NPI,
        email: 'jane@example.com',
        providerType: 'psychiatrist',
        licenseState: 'CA',
      },
    });

    await executeImport('practice-1', 'user-1', [row]);

    expect(prismaMock.license.create).not.toHaveBeenCalled();
  });

  it('skips License when licenseState missing', async () => {
    const row = makeRow({
      data: {
        firstName: 'Jane',
        lastName: 'Doe',
        npi: VALID_NPI,
        email: 'jane@example.com',
        providerType: 'psychiatrist',
        licenseNumber: 'MD-12345',
      },
    });

    await executeImport('practice-1', 'user-1', [row]);

    expect(prismaMock.license.create).not.toHaveBeenCalled();
  });

  it('maps providerType to correct licenseType', async () => {
    const typeMappings: [string, string][] = [
      ['psychiatrist', 'state_medical'],
      ['psychologist', 'state_psychology'],
      ['lcsw', 'state_social_work'],
      ['lpc', 'state_counseling'],
      ['lmft', 'state_marriage_family'],
      ['pmhnp', 'state_medical'],
      ['other', 'state_medical'],
    ];

    for (const [providerType, expectedLicenseType] of typeMappings) {
      vi.clearAllMocks();
      (prismaMock.$transaction as any).mockImplementation((fn: any) => fn(prismaMock));
      prismaMock.providerImport.create.mockResolvedValue(mockImportRecord as any);
      prismaMock.providerImport.update.mockResolvedValue({} as any);
      prismaMock.provider.create.mockResolvedValue({ id: 'provider-1' } as any);
      prismaMock.license.create.mockResolvedValue({ id: 'license-1' } as any);

      const row = makeRow({
        data: {
          firstName: 'Jane',
          lastName: 'Doe',
          npi: VALID_NPI,
          email: 'jane@example.com',
          providerType,
          licenseNumber: 'LIC-123',
          licenseState: 'CA',
        },
      });

      await executeImport('practice-1', 'user-1', [row]);

      expect(prismaMock.license.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ licenseType: expectedLicenseType }),
      });
    }
  });

  it('creates multiple providers in a single transaction', async () => {
    prismaMock.provider.create
      .mockResolvedValueOnce({ id: 'provider-1' } as any)
      .mockResolvedValueOnce({ id: 'provider-2' } as any);

    prismaMock.providerImport.create.mockResolvedValue({
      ...mockImportRecord,
      totalRows: 2,
    } as any);

    const rows = [
      makeRow(),
      makeRow({
        rowNumber: 3,
        data: {
          firstName: 'John',
          lastName: 'Smith',
          npi: VALID_NPI_2,
          email: 'john@example.com',
          providerType: 'psychologist',
        },
      }),
    ];

    const result = await executeImport('practice-1', 'user-1', rows);

    expect(result.successCount).toBe(2);
    expect(result.errorCount).toBe(0);
    expect(prismaMock.provider.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('updates import record to completed on success', async () => {
    await executeImport('practice-1', 'user-1', [makeRow()]);

    expect(prismaMock.providerImport.update).toHaveBeenCalledWith({
      where: { id: 'import-1' },
      data: expect.objectContaining({
        status: 'completed',
        successCount: 1,
        completedAt: expect.any(Date),
      }),
    });
  });

  it('logs completion event with durationMs', async () => {
    await executeImport('practice-1', 'user-1', [makeRow()]);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'provider_import_completed',
        practiceId: 'practice-1',
        importId: 'import-1',
        successCount: 1,
        durationMs: expect.any(Number),
      })
    );
  });

  it('rolls back entire transaction on failure', async () => {
    (prismaMock.$transaction as any).mockRejectedValue(
      new Error('Unique constraint violation on npi')
    );

    const result = await executeImport('practice-1', 'user-1', [makeRow()]);

    expect(result.successCount).toBe(0);
    expect(result.errorCount).toBe(1);
    expect(result.error).toContain('Unique constraint violation');
  });

  it('updates import record to failed on error', async () => {
    (prismaMock.$transaction as any).mockRejectedValue(new Error('DB error'));

    await executeImport('practice-1', 'user-1', [makeRow()]);

    expect(prismaMock.providerImport.update).toHaveBeenCalledWith({
      where: { id: 'import-1' },
      data: {
        status: 'failed',
        errorCount: 1,
        errorDetails: { message: 'DB error' },
      },
    });
  });

  it('logs error event on failure', async () => {
    (prismaMock.$transaction as any).mockRejectedValue(new Error('DB error'));

    await executeImport('practice-1', 'user-1', [makeRow()]);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'provider_import_failed',
        practiceId: 'practice-1',
        importId: 'import-1',
        error: 'DB error',
      })
    );
  });

  it('returns importId in both success and failure cases', async () => {
    const success = await executeImport('practice-1', 'user-1', [makeRow()]);
    expect(success.importId).toBe('import-1');

    (prismaMock.$transaction as any).mockRejectedValue(new Error('fail'));
    prismaMock.providerImport.create.mockResolvedValue(mockImportRecord as any);
    prismaMock.providerImport.update.mockResolvedValue({} as any);

    const failure = await executeImport('practice-1', 'user-1', [makeRow()]);
    expect(failure.importId).toBe('import-1');
  });
});

// ==========================================
// getImportStatus
// ==========================================

describe('getImportStatus', () => {
  const mockImport = {
    id: 'import-1',
    practiceId: 'practice-1',
    status: 'completed',
    totalRows: 5,
    successCount: 5,
    errorCount: 0,
    skippedCount: 0,
    errorDetails: null,
    createdBy: 'user-1',
    createdAt: new Date(),
    completedAt: new Date(),
  };

  it('returns import record for matching practice', async () => {
    prismaMock.providerImport.findFirst.mockResolvedValue(mockImport as any);

    const result = await getImportStatus('import-1', 'practice-1');

    expect(result).toEqual(mockImport);
    expect(prismaMock.providerImport.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'import-1',
        practiceId: 'practice-1',
      },
    });
  });

  it('returns null for non-matching practice', async () => {
    prismaMock.providerImport.findFirst.mockResolvedValue(null);

    const result = await getImportStatus('import-1', 'wrong-practice');

    expect(result).toBeNull();
  });

  it('returns null for non-existent import', async () => {
    prismaMock.providerImport.findFirst.mockResolvedValue(null);

    const result = await getImportStatus('nonexistent-id', 'practice-1');

    expect(result).toBeNull();
  });
});
