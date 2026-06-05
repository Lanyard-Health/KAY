import { parse } from 'csv-parse/sync';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { checkProviderCollision } from './provider.service.js';

// ==========================================
// Types
// ==========================================

export interface ValidatedRow {
  rowNumber: number;
  data: Record<string, string>;
  status: 'valid' | 'warning' | 'error' | 'duplicate';
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
}

export interface ValidationSummary {
  valid: number;
  warnings: number;
  errors: number;
  duplicates: number;
  total: number;
}

export interface ParseAndValidateResult {
  rows: ValidatedRow[];
  summary: ValidationSummary;
}

export interface FileValidationError {
  code: string;
  message: string;
}

// ==========================================
// Constants
// ==========================================

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_ROWS = 500;

const REQUIRED_HEADERS = ['firstName', 'lastName', 'npi', 'email', 'providerType'] as const;

const OPTIONAL_HEADERS = [
  'licenseNumber', 'licenseState', 'licenseExpiration',
  'taxonomyCode', 'caqhProviderId', 'phone', 'dateOfBirth',
] as const;

const ALL_VALID_HEADERS = new Set<string>([...REQUIRED_HEADERS, ...OPTIONAL_HEADERS]);

const VALID_PROVIDER_TYPES = new Set([
  'psychiatrist', 'psychologist', 'lcsw', 'lpc', 'lmft', 'pmhnp', 'other',
]);

const VALID_CSV_CONTENT_TYPES = new Set([
  'text/csv',
  'application/csv',
  'text/comma-separated-values',
  'application/vnd.ms-excel', // Excel sometimes sends CSV as this
]);

const PHONE_REGEX = /^\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NPPES_API_URL = 'https://npiregistry.cms.hhs.gov/api/';
const NPPES_TIMEOUT_MS = 5000;
const NPPES_RATE_DELAY_MS = 500; // 2 requests/sec

// ==========================================
// File-level validation
// ==========================================

export function validateFile(file: {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}): FileValidationError | null {
  // Check empty file
  if (file.size === 0) {
    return { code: 'EMPTY_FILE', message: 'File is empty' };
  }

  // Check extension
  const ext = file.originalname.split('.').pop()?.toLowerCase();
  if (ext !== 'csv') {
    return { code: 'INVALID_FILE_TYPE', message: 'File must be a .csv file' };
  }

  // Check content type
  if (!VALID_CSV_CONTENT_TYPES.has(file.mimetype)) {
    return { code: 'INVALID_CONTENT_TYPE', message: `Invalid content type: ${file.mimetype}. Expected text/csv` };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return { code: 'FILE_TOO_LARGE', message: `File size ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds maximum of 2MB` };
  }

  return null;
}

// ==========================================
// CSV parsing and row validation
// ==========================================

export async function parseAndValidateRows(csvContent: string, practiceId: string): Promise<ParseAndValidateResult> {
  // Strip BOM if present
  const cleaned = csvContent.charCodeAt(0) === 0xFEFF ? csvContent.slice(1) : csvContent;

  // Parse CSV
  const records: Record<string, string>[] = parse(cleaned, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  });

  const emptySummary: ValidationSummary = { valid: 0, warnings: 0, errors: 0, duplicates: 0, total: 0 };

  // Validate headers from first record
  if (records.length === 0) {
    return {
      rows: [{
        rowNumber: 0,
        data: {},
        status: 'error',
        errors: [{ field: 'file', message: 'No data rows found. File contains only headers or is empty.' }],
        warnings: [],
      }],
      summary: { ...emptySummary, errors: 1 },
    };
  }

  const headers = Object.keys(records[0]!);
  const headerErrors = validateHeaders(headers);
  if (headerErrors) {
    return {
      rows: [{
        rowNumber: 0,
        data: {},
        status: 'error',
        errors: [{ field: 'headers', message: headerErrors }],
        warnings: [],
      }],
      summary: { ...emptySummary, errors: 1 },
    };
  }

  // Check row count
  if (records.length > MAX_ROWS) {
    return {
      rows: [{
        rowNumber: 0,
        data: {},
        status: 'error',
        errors: [{ field: 'file', message: `CSV contains ${records.length} data rows, maximum is ${MAX_ROWS}` }],
        warnings: [],
      }],
      summary: { ...emptySummary, errors: 1, total: records.length },
    };
  }

  logger.info({
    event: 'provider_import_validation_started',
    practiceId,
    totalRows: records.length,
  });

  // Phase 1: Row-level validation (synchronous)
  const rows: ValidatedRow[] = records.map((record, index) =>
    validateRow(record, index + 2) // +2: 1-indexed + header row
  );

  // Phase 2: NPPES verification (only for rows without errors)
  await verifyNppes(rows);

  // Phase 3: Duplicate detection (only for rows without errors)
  await detectDuplicates(rows, practiceId);

  const summary: ValidationSummary = {
    valid: rows.filter(r => r.status === 'valid').length,
    warnings: rows.filter(r => r.status === 'warning').length,
    errors: rows.filter(r => r.status === 'error').length,
    duplicates: rows.filter(r => r.status === 'duplicate').length,
    total: rows.length,
  };

  logger.info({
    event: 'provider_import_validation_completed',
    practiceId,
    validCount: summary.valid,
    warningCount: summary.warnings,
    errorCount: summary.errors,
    duplicateCount: summary.duplicates,
  });

  return { rows, summary };
}

// ==========================================
// Header validation
// ==========================================

function validateHeaders(headers: string[]): string | null {
  // Check for SSN column (security)
  const ssnHeader = headers.find(h => /^ssn$/i.test(h.trim()));
  if (ssnHeader) {
    return 'SSN column is not allowed for security reasons. Remove the SSN column and retry.';
  }

  const headerSet = new Set(headers);
  const missing = REQUIRED_HEADERS.filter(h => !headerSet.has(h));
  if (missing.length > 0) {
    return `Missing required headers: ${missing.join(', ')}. Required: ${REQUIRED_HEADERS.join(', ')}`;
  }

  return null;
}

// ==========================================
// Row-level validation
// ==========================================

function validateRow(record: Record<string, string>, rowNumber: number): ValidatedRow {
  const errors: Array<{ field: string; message: string }> = [];
  const warnings: Array<{ field: string; message: string }> = [];

  // Build clean data object (only known headers)
  const data: Record<string, string> = {};
  for (const key of Object.keys(record)) {
    if (ALL_VALID_HEADERS.has(key)) {
      // eslint-disable-next-line security/detect-object-injection -- key passes allowlist check against hardcoded Set of known CSV headers
      data[key] = record[key]?.trim() ?? '';
    }
  }

  // --- Required fields ---

  // firstName
  if (!data['firstName']) {
    errors.push({ field: 'firstName', message: 'First name is required' });
  } else if (data['firstName'].length > 100) {
    errors.push({ field: 'firstName', message: 'First name must be 100 characters or less' });
  }

  // lastName
  if (!data['lastName']) {
    errors.push({ field: 'lastName', message: 'Last name is required' });
  } else if (data['lastName'].length > 100) {
    errors.push({ field: 'lastName', message: 'Last name must be 100 characters or less' });
  }

  // npi
  if (!data['npi']) {
    errors.push({ field: 'npi', message: 'NPI is required' });
  } else if (!/^\d{10}$/.test(data['npi'])) {
    errors.push({ field: 'npi', message: 'NPI must be exactly 10 digits' });
  } else if (!validateNpiLuhn(data['npi'])) {
    errors.push({ field: 'npi', message: 'NPI fails Luhn checksum validation' });
  }

  // email
  if (!data['email']) {
    errors.push({ field: 'email', message: 'Email is required' });
  } else if (!EMAIL_REGEX.test(data['email'])) {
    errors.push({ field: 'email', message: 'Invalid email format' });
  }

  // providerType
  if (!data['providerType']) {
    errors.push({ field: 'providerType', message: 'Provider type is required' });
  } else if (!VALID_PROVIDER_TYPES.has(data['providerType'].toLowerCase())) {
    errors.push({
      field: 'providerType',
      message: `Invalid provider type "${data['providerType']}". Must be one of: ${[...VALID_PROVIDER_TYPES].join(', ')}`,
    });
  } else {
    // Normalize to lowercase
    data['providerType'] = data['providerType'].toLowerCase();
  }

  // --- Optional fields ---

  // phone
  if (data['phone'] && !PHONE_REGEX.test(data['phone'])) {
    errors.push({ field: 'phone', message: 'Invalid phone number format' });
  }

  // dateOfBirth
  if (data['dateOfBirth']) {
    const dob = parseDate(data['dateOfBirth']);
    if (!dob) {
      errors.push({ field: 'dateOfBirth', message: 'Invalid date format. Use YYYY-MM-DD or MM/DD/YYYY' });
    } else if (dob >= new Date()) {
      errors.push({ field: 'dateOfBirth', message: 'Date of birth must be in the past' });
    } else {
      // Normalize to YYYY-MM-DD
      data['dateOfBirth'] = formatDate(dob);
    }
  }

  // licenseExpiration
  if (data['licenseExpiration']) {
    const expDate = parseDate(data['licenseExpiration']);
    if (!expDate) {
      errors.push({ field: 'licenseExpiration', message: 'Invalid date format. Use YYYY-MM-DD or MM/DD/YYYY' });
    } else {
      // Normalize to YYYY-MM-DD
      data['licenseExpiration'] = formatDate(expDate);
      if (expDate < new Date()) {
        warnings.push({ field: 'licenseExpiration', message: 'License is expired' });
      }
    }
  }

  // Determine status
  let status: 'valid' | 'warning' | 'error';
  if (errors.length > 0) {
    status = 'error';
  } else if (warnings.length > 0) {
    status = 'warning';
  } else {
    status = 'valid';
  }

  return { rowNumber, data, status, errors, warnings };
}

// ==========================================
// NPI Luhn checksum
// ==========================================

/**
 * Validates NPI using the Luhn algorithm.
 * The NPI is prefixed with 80840 (CMS prefix) and the full 15-digit
 * number must pass the Luhn checksum.
 */
export function validateNpiLuhn(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;

  // Prefix with 80840, giving a 15-digit number
  const prefixed = '80840' + npi;

  // Standard Luhn algorithm
  let sum = 0;
  for (let i = prefixed.length - 1; i >= 0; i--) {
    // eslint-disable-next-line security/detect-object-injection -- i is a bounded integer loop index for string character access
    let digit = parseInt(prefixed[i]!, 10);
    // Double every second digit from the right (0-indexed: even positions from right)
    if ((prefixed.length - 1 - i) % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }

  return sum % 10 === 0;
}

// ==========================================
// NPPES verification
// ==========================================

async function verifyNppes(rows: ValidatedRow[]): Promise<void> {
  for (const row of rows) {
    // Only verify rows that passed basic validation and have a valid NPI
    if (row.status === 'error' || !row.data['npi']) continue;

    const nppesResult = await fetchNppes(row.data['npi']);

    if (nppesResult.error) {
      logger.warn({
        event: 'provider_import_nppes_timeout',
        row: row.rowNumber,
        npi: row.data['npi'],
      });
      row.warnings.push({ field: 'npi', message: 'Could not verify NPI against national registry' });
      if (row.status === 'valid') row.status = 'warning';
    } else if (!nppesResult.found) {
      row.warnings.push({ field: 'npi', message: 'NPI not found in national registry' });
      if (row.status === 'valid') row.status = 'warning';
    } else if (nppesResult.nppesName) {
      const csvFirst = row.data['firstName'] || '';
      const csvLast = row.data['lastName'] || '';
      const csvName = `${csvFirst} ${csvLast}`;

      if (!fuzzyNameMatch(csvFirst, csvLast, nppesResult.nppesFirstName || '', nppesResult.nppesLastName || '')) {
        logger.warn({
          event: 'provider_import_nppes_mismatch',
          row: row.rowNumber,
          npi: row.data['npi'],
          csvName,
          nppesName: nppesResult.nppesName,
        });
        row.warnings.push({
          field: 'npi',
          message: `NPI registered to ${nppesResult.nppesName}, expected ${csvName}`,
        });
        if (row.status === 'valid') row.status = 'warning';
      }
    }

    // Rate limit: 500ms between requests (2 req/sec)
    await sleep(NPPES_RATE_DELAY_MS);
  }
}

interface NppesResult {
  found: boolean;
  nppesName?: string;
  nppesFirstName?: string;
  nppesLastName?: string;
  error?: boolean;
}

async function fetchNppes(npi: string): Promise<NppesResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NPPES_TIMEOUT_MS);

    const url = `${NPPES_API_URL}?number=${encodeURIComponent(npi)}&version=2.1`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return { found: false, error: true };
    }

    const data = await response.json() as {
      result_count?: number;
      results?: Array<{
        basic?: {
          first_name?: string;
          last_name?: string;
        };
      }>;
    };

    if (!data.result_count || data.result_count === 0 || !data.results?.length) {
      return { found: false };
    }

    const result = data.results[0]!;
    const firstName = result.basic?.first_name || '';
    const lastName = result.basic?.last_name || '';

    return {
      found: true,
      nppesName: `${firstName} ${lastName}`.trim(),
      nppesFirstName: firstName,
      nppesLastName: lastName,
    };
  } catch {
    return { found: false, error: true };
  }
}

/**
 * Simple fuzzy name matching:
 * - Case-insensitive comparison
 * - Check if first 3 chars of firstName match
 * - Or if one name contains the other (handles "John" vs "Jonathan")
 * - Last name must match exactly (case-insensitive)
 */
export function fuzzyNameMatch(
  csvFirst: string,
  csvLast: string,
  nppesFirst: string,
  nppesLast: string,
): boolean {
  const cFirst = csvFirst.toLowerCase().trim();
  const cLast = csvLast.toLowerCase().trim();
  const nFirst = nppesFirst.toLowerCase().trim();
  const nLast = nppesLast.toLowerCase().trim();

  // Last name must match
  if (cLast !== nLast) return false;

  // Exact first name match
  if (cFirst === nFirst) return true;

  // First 3 chars match
  if (cFirst.length >= 3 && nFirst.length >= 3 && cFirst.slice(0, 3) === nFirst.slice(0, 3)) {
    return true;
  }

  // One contains the other
  if (cFirst.includes(nFirst) || nFirst.includes(cFirst)) {
    return true;
  }

  return false;
}

// ==========================================
// Duplicate detection
// ==========================================

async function detectDuplicates(rows: ValidatedRow[], practiceId: string): Promise<void> {
  // Collect NPIs from non-error rows
  const npisToCheck = rows
    .filter(r => r.status !== 'error' && r.data['npi'])
    .map(r => r.data['npi']!);

  if (npisToCheck.length === 0) return;

  // Single query: find all existing providers in this practice matching any of these NPIs
  const existingProviders = await prisma.providerProfile.findMany({
    where: {
      practiceId,
      npi: { in: npisToCheck },
    },
    select: { npi: true, firstName: true, lastName: true },
  });

  // Build NPI → provider lookup
  const existingByNpi = new Map(existingProviders.map(p => [p.npi, p]));

  // Mark duplicates
  for (const row of rows) {
    if (row.status === 'error' || !row.data['npi']) continue;

    const existing = existingByNpi.get(row.data['npi']);
    if (existing) {
      row.status = 'duplicate';
      row.warnings.push({
        field: 'npi',
        message: `Provider already exists: Dr. ${existing.firstName} ${existing.lastName} (NPI: ${existing.npi})`,
      });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==========================================
// Date parsing helpers
// ==========================================

/**
 * Parses dates in YYYY-MM-DD or MM/DD/YYYY format.
 * Returns null if invalid.
 */
function parseDate(value: string): Date | null {
  // YYYY-MM-DD
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1]!, 10);
    const m = parseInt(isoMatch[2]!, 10);
    const d = parseInt(isoMatch[3]!, 10);
    const date = new Date(y, m - 1, d);
    if (isValidDate(date, y, m, d)) {
      return date;
    }
    return null;
  }

  // MM/DD/YYYY
  const usMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const month = parseInt(usMatch[1]!, 10);
    const day = parseInt(usMatch[2]!, 10);
    const year = parseInt(usMatch[3]!, 10);
    const date = new Date(year, month - 1, day);
    if (isValidDate(date, year, month, day)) {
      return date;
    }
    return null;
  }

  return null;
}

function isValidDate(date: Date, year: number, month: number, day: number): boolean {
  return !isNaN(date.getTime()) &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ==========================================
// Import execution
// ==========================================

export interface ImportConflict {
  rowIndex: number;
  npi: string | null;
  caqhProviderId: string | null;
  conflictType: 'archived_in_scope' | 'active_in_scope' | 'out_of_scope';
  field: 'npi' | 'caqhProviderId';
  // Present only when the colliding record is in the caller's scope (active or archived) —
  // intentionally omitted for out_of_scope to avoid leaking other practices' provider IDs.
  existingProviderId?: string;
  existingProviderName?: string;
}

export interface ImportResult {
  importId: string;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  // Per-row collisions surfaced for review. Each row that collides with an existing NPI
  // or CAQH ID (active OR soft-deleted, in-scope OR out-of-scope) is skipped, NOT failed.
  // The batch continues so a single duplicate doesn't lose the rest of the import.
  conflicts: ImportConflict[];
  error?: string;
}

/**
 * Creates providers from validated CSV rows in a single transaction.
 * All-or-nothing: if any row fails, the entire import rolls back.
 *
 * DB-required fields not in CSV use defaults:
 *   - gender → 'prefer_not_to_say'
 *   - phone → '' (empty string if not provided)
 *   - dateOfBirth → 1900-01-01 placeholder if not provided
 */
export async function executeImport(
  practiceId: string,
  createdBy: string,
  rows: ValidatedRow[],
): Promise<ImportResult> {
  if (rows.length === 0) {
    return {
      importId: '',
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      conflicts: [],
      error: 'No rows to import',
    };
  }

  const startTime = Date.now();

  // Create import tracking record
  const importRecord = await prisma.providerImport.create({
    data: {
      practiceId,
      createdBy,
      totalRows: rows.length,
      status: 'pending',
    },
  });

  const importId = importRecord.id;

  // Per-row collision pre-check (must run BEFORE the transaction so a single duplicate
  // doesn't fail the whole batch — see plan amendment, providerImport rule 1).
  // The check uses the bypass client (via provider.service) so it catches soft-deleted rows.
  const conflicts: ImportConflict[] = [];
  const safeRows: ValidatedRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const npi = row.data['npi'] ?? null;
    const caqhProviderId = row.data['caqhProviderId'] ?? null;
    const collision = await checkProviderCollision({
      npi,
      caqhProviderId,
      // Import is always scoped to the target practice — never escalate to super-admin here
      // even if the caller is one. Out-of-scope duplicates surface as such, no detail leak.
      isSuperAdmin: false,
      practiceIds: [practiceId],
    });
    if (collision.kind === 'none') {
      safeRows.push(row);
      continue;
    }
    const conflictType = collision.kind === 'archived_in_scope'
      ? 'archived_in_scope'
      : collision.kind === 'active_in_scope'
        ? 'active_in_scope'
        : 'out_of_scope';
    const conflict: ImportConflict = {
      rowIndex: i,
      npi,
      caqhProviderId,
      conflictType,
      field: collision.field,
    };
    if (collision.kind === 'archived_in_scope' || collision.kind === 'active_in_scope') {
      conflict.existingProviderId = collision.providerId;
      conflict.existingProviderName = collision.providerName;
    }
    conflicts.push(conflict);
  }

  try {
    // Single transaction with 2-minute timeout for up to 500 rows
    await prisma.$transaction(async (tx) => {
      for (const row of safeRows) {
        const provider = await tx.providerProfile.create({
          data: {
            npi: row.data['npi']!,
            firstName: row.data['firstName']!,
            lastName: row.data['lastName']!,
            email: row.data['email']!,
            providerType: row.data['providerType']! as any,
            phone: row.data['phone'] || '',
            dateOfBirth: row.data['dateOfBirth']
              ? new Date(row.data['dateOfBirth'])
              : new Date('1900-01-01'),
            gender: 'prefer_not_to_say',
            specialties: [],
            languages: [],
            status: 'active',
            practiceId,
            createdById: createdBy,
            ...(row.data['taxonomyCode'] && { taxonomy: row.data['taxonomyCode'] }),
            ...(row.data['caqhProviderId'] && { caqhProviderId: row.data['caqhProviderId'] }),
          },
        });

        // Create License if both licenseNumber and licenseState are provided
        if (row.data['licenseNumber'] && row.data['licenseState']) {
          const expirationDate = row.data['licenseExpiration']
            ? new Date(row.data['licenseExpiration'])
            : null;

          await tx.license.create({
            data: {
              providerId: provider.id,
              licenseType: mapProviderTypeToLicenseType(row.data['providerType']!) as any,
              licenseNumber: row.data['licenseNumber'],
              state: row.data['licenseState'],
              issueDate: new Date(),
              expirationDate: expirationDate || new Date('2099-12-31'),
              status: expirationDate && expirationDate < new Date() ? 'expired' : 'active',
              source: 'portal_import',
              createdById: createdBy,
            },
          });
        }
      }
    }, { timeout: 120_000 });

    const durationMs = Date.now() - startTime;

    // Update import record: completed
    await prisma.providerImport.update({
      where: { id: importId },
      data: {
        status: 'completed',
        successCount: safeRows.length,
        completedAt: new Date(),
      },
    });

    logger.info({
      event: 'provider_import_completed',
      practiceId,
      importId,
      successCount: safeRows.length,
      skippedCount: conflicts.length,
      conflictBreakdown: {
        archived: conflicts.filter((c) => c.conflictType === 'archived_in_scope').length,
        active: conflicts.filter((c) => c.conflictType === 'active_in_scope').length,
        outOfScope: conflicts.filter((c) => c.conflictType === 'out_of_scope').length,
      },
      durationMs,
    });

    return {
      importId,
      successCount: safeRows.length,
      errorCount: 0,
      skippedCount: conflicts.length,
      conflicts,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown import error';

    // Update import record: failed
    await prisma.providerImport.update({
      where: { id: importId },
      data: {
        status: 'failed',
        errorCount: rows.length,
        errorDetails: { message: error },
      },
    });

    logger.error({
      event: 'provider_import_failed',
      practiceId,
      importId,
      error,
    });

    return {
      importId,
      successCount: 0,
      errorCount: rows.length,
      skippedCount: conflicts.length,
      conflicts,
      error,
    };
  }
}

function mapProviderTypeToLicenseType(providerType: string): string {
  switch (providerType) {
    case 'psychiatrist': return 'state_medical';
    case 'psychologist': return 'state_psychology';
    case 'lcsw': return 'state_social_work';
    case 'lpc': return 'state_counseling';
    case 'lmft': return 'state_marriage_family';
    case 'pmhnp': return 'state_medical';
    default: return 'state_medical';
  }
}

// ==========================================
// Import status
// ==========================================

export async function getImportStatus(importId: string, practiceId: string) {
  return prisma.providerImport.findFirst({
    where: {
      id: importId,
      practiceId,
    },
  });
}
