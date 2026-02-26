import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', async () => {
  const { prismaMock } = await import('../../tests/helpers/mock-prisma.js');
  return { prisma: prismaMock };
});

// Mock ExcelJS
const mockWorksheet = {
  columns: [] as any[],
  getRow: vi.fn().mockReturnValue({
    font: {},
    fill: {},
    alignment: {},
    height: 0,
  }),
  addRow: vi.fn(),
  eachRow: vi.fn(),
};
const mockWorkbook = {
  creator: '',
  created: null as Date | null,
  addWorksheet: vi.fn().mockReturnValue(mockWorksheet),
  xlsx: {
    writeBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-excel')),
  },
};

vi.mock('exceljs', () => {
  // Must use function() for vitest v4 constructor mock
  function MockWorkbook(this: any) {
    this.creator = mockWorkbook.creator;
    this.created = mockWorkbook.created;
    this.addWorksheet = mockWorkbook.addWorksheet;
    this.xlsx = mockWorkbook.xlsx;
  }
  return {
    default: {
      Workbook: MockWorkbook,
    },
  };
});

vi.mock('../middleware/error.middleware.js', () => ({
  ValidationError: class ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  },
}));

import { prismaMock } from '../../tests/helpers/mock-prisma.js';
import {
  validateColumns,
  buildIncludeClause,
  fetchRosterData,
  fetchAllRosterData,
  formatCellValue,
  flattenToRows,
  generateExcel,
} from './roster.service.js';

beforeEach(() => {
  vi.resetAllMocks();
  // Re-setup ExcelJS mocks after reset
  mockWorkbook.addWorksheet.mockReturnValue(mockWorksheet);
  mockWorksheet.getRow.mockReturnValue({
    font: {},
    fill: {},
    alignment: {},
    height: 0,
  });
  mockWorkbook.xlsx.writeBuffer.mockResolvedValue(Buffer.from('mock-excel'));
});

// ============================================================
// validateColumns
// ============================================================
describe('validateColumns', () => {
  it('should return RosterField objects for valid field keys', () => {
    const columns = [
      { fieldKey: 'provider.firstName', label: 'First Name' },
      { fieldKey: 'provider.lastName', label: 'Last Name' },
    ];
    const fields = validateColumns(columns);
    expect(fields).toHaveLength(2);
    expect(fields[0]!.prismaPath).toBe('firstName');
    expect(fields[1]!.prismaPath).toBe('lastName');
  });

  it('should throw ValidationError for an invalid field key', () => {
    const columns = [{ fieldKey: 'provider.nonExistentField', label: 'Bad' }];
    expect(() => validateColumns(columns)).toThrow('Invalid field key: provider.nonExistentField');
  });

  it('should return empty array for empty columns', () => {
    expect(validateColumns([])).toEqual([]);
  });
});

// ============================================================
// buildIncludeClause
// ============================================================
describe('buildIncludeClause', () => {
  it('should return empty include for top-level provider fields', () => {
    const fields = [
      { key: 'provider.firstName', label: 'First Name', category: 'Provider Info', dataType: 'string' as const, prismaPath: 'firstName' },
    ];
    expect(buildIncludeClause(fields)).toEqual({});
  });

  it('should include a simple relation', () => {
    const fields = [
      { key: 'licenses.licenseNumber', label: 'License Number', category: 'License', dataType: 'string' as const, prismaPath: 'licenses.licenseNumber' },
    ];
    expect(buildIncludeClause(fields)).toEqual({ licenses: true });
  });

  it('should build nested include for payerEnrollments.payer', () => {
    const fields = [
      { key: 'payerEnrollments.payer.name', label: 'Payer Name', category: 'Payer Enrollment', dataType: 'string' as const, prismaPath: 'payerEnrollments.payer.name' },
    ];
    expect(buildIncludeClause(fields)).toEqual({
      payerEnrollments: { include: { payer: true } },
    });
  });

  it('should combine multiple relations', () => {
    const fields = [
      { key: 'licenses.licenseNumber', label: 'License Number', category: 'License', dataType: 'string' as const, prismaPath: 'licenses.licenseNumber' },
      { key: 'educations.institutionName', label: 'Institution', category: 'Education', dataType: 'string' as const, prismaPath: 'educations.institutionName' },
    ];
    const include = buildIncludeClause(fields);
    expect(include).toEqual({ licenses: true, educations: true });
  });
});

// ============================================================
// formatCellValue
// ============================================================
describe('formatCellValue', () => {
  it('should return empty string for null', () => {
    expect(formatCellValue(null, 'string')).toBe('');
  });

  it('should return empty string for undefined', () => {
    expect(formatCellValue(undefined, 'string')).toBe('');
  });

  it('should format Date object to ISO date string', () => {
    const d = new Date('2025-03-15T10:30:00Z');
    expect(formatCellValue(d, 'date')).toBe('2025-03-15');
  });

  it('should format date string to ISO date string', () => {
    expect(formatCellValue('2025-03-15T10:30:00Z', 'date')).toBe('2025-03-15');
  });

  it('should format boolean true as Yes', () => {
    expect(formatCellValue(true, 'boolean')).toBe('Yes');
  });

  it('should format boolean false as No', () => {
    expect(formatCellValue(false, 'boolean')).toBe('No');
  });

  it('should join arrays with semicolons', () => {
    expect(formatCellValue(['Cardiology', 'Internal Medicine'], 'array')).toBe('Cardiology; Internal Medicine');
  });

  it('should title-case enum values with underscores replaced', () => {
    expect(formatCellValue('in_progress', 'enum')).toBe('In Progress');
  });

  it('should convert number to string', () => {
    expect(formatCellValue(42, 'number')).toBe('42');
  });

  it('should return string as-is for default dataType', () => {
    expect(formatCellValue('hello', 'string')).toBe('hello');
  });
});

// ============================================================
// flattenToRows
// ============================================================
describe('flattenToRows', () => {
  it('should produce one row for a provider with no relations', () => {
    const columns = [
      { fieldKey: 'provider.firstName', label: 'First Name' },
      { fieldKey: 'provider.lastName', label: 'Last Name' },
    ];
    const providers = [{ firstName: 'John', lastName: 'Doe' }];
    const rows = flattenToRows(providers, columns);
    expect(rows).toEqual([['John', 'Doe']]);
  });

  it('should expand rows for primary relation with multiple items', () => {
    const columns = [
      { fieldKey: 'provider.firstName', label: 'First Name' },
      { fieldKey: 'licenses.licenseNumber', label: 'License #' },
    ];
    const providers = [
      {
        firstName: 'Jane',
        licenses: [
          { licenseNumber: 'LIC-001' },
          { licenseNumber: 'LIC-002' },
        ],
      },
    ];
    const rows = flattenToRows(providers, columns);
    expect(rows).toEqual([
      ['Jane', 'LIC-001'],
      ['Jane', 'LIC-002'],
    ]);
  });

  it('should join non-primary relations with semicolons', () => {
    const columns = [
      { fieldKey: 'provider.firstName', label: 'First Name' },
      { fieldKey: 'licenses.licenseNumber', label: 'License #' },
      { fieldKey: 'educations.institutionName', label: 'Institution' },
    ];
    // licenses has 2 items (primary), educations has 1 (non-primary, joined)
    const providers = [
      {
        firstName: 'Jane',
        licenses: [
          { licenseNumber: 'LIC-001' },
          { licenseNumber: 'LIC-002' },
        ],
        educations: [
          { institutionName: 'Harvard' },
        ],
      },
    ];
    const rows = flattenToRows(providers, columns);
    expect(rows).toHaveLength(2);
    // Primary (licenses) drives row expansion; educations joined in each row
    expect(rows[0]).toEqual(['Jane', 'LIC-001', 'Harvard']);
    expect(rows[1]).toEqual(['Jane', 'LIC-002', 'Harvard']);
  });

  it('should handle provider with empty relation arrays', () => {
    const columns = [
      { fieldKey: 'provider.firstName', label: 'First Name' },
      { fieldKey: 'licenses.licenseNumber', label: 'License #' },
    ];
    const providers = [{ firstName: 'John', licenses: [] }];
    const rows = flattenToRows(providers, columns);
    expect(rows).toEqual([['John', '']]);
  });
});

// ============================================================
// fetchRosterData
// ============================================================
describe('fetchRosterData', () => {
  it('should call prisma with correct pagination and return structured result', async () => {
    const mockProviders = [{ id: '1', firstName: 'John', lastName: 'Doe' }];
    prismaMock.provider.findMany.mockResolvedValue(mockProviders as any);
    prismaMock.provider.count.mockResolvedValue(1);

    const columns = [{ fieldKey: 'provider.firstName', label: 'First Name' }];
    const result = await fetchRosterData(columns, 2, 10);

    expect(prismaMock.provider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      })
    );
    expect(result).toEqual({
      providers: mockProviders,
      total: 1,
      page: 2,
      pageSize: 10,
    });
  });

  it('should pass where clause and include for relation columns', async () => {
    prismaMock.provider.findMany.mockResolvedValue([]);
    prismaMock.provider.count.mockResolvedValue(0);

    const columns = [{ fieldKey: 'licenses.licenseNumber', label: 'License #' }];
    const where = { practiceId: 'p1' };
    await fetchRosterData(columns, 1, 25, where);

    expect(prismaMock.provider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        include: { licenses: true },
      })
    );
    expect(prismaMock.provider.count).toHaveBeenCalledWith({ where });
  });

  it('should throw ValidationError for invalid columns', async () => {
    const columns = [{ fieldKey: 'bad.field', label: 'Bad' }];
    await expect(fetchRosterData(columns)).rejects.toThrow('Invalid field key: bad.field');
  });
});

// ============================================================
// fetchAllRosterData
// ============================================================
describe('fetchAllRosterData', () => {
  it('should fetch all providers without pagination', async () => {
    const mockProviders = [{ id: '1' }, { id: '2' }];
    prismaMock.provider.findMany.mockResolvedValue(mockProviders as any);

    const columns = [{ fieldKey: 'provider.firstName', label: 'First Name' }];
    const result = await fetchAllRosterData(columns);

    expect(result).toEqual(mockProviders);
    expect(prismaMock.provider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      })
    );
    // Should NOT have skip/take
    const callArgs = prismaMock.provider.findMany.mock.calls[0]![0] as any;
    expect(callArgs.skip).toBeUndefined();
    expect(callArgs.take).toBeUndefined();
  });

  it('should pass where clause to findMany', async () => {
    prismaMock.provider.findMany.mockResolvedValue([]);

    const columns = [{ fieldKey: 'provider.npi', label: 'NPI' }];
    const where = { status: 'active' };
    await fetchAllRosterData(columns, where);

    expect(prismaMock.provider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where })
    );
  });
});

// ============================================================
// generateExcel
// ============================================================
describe('generateExcel', () => {
  it('should create a workbook and return a buffer', async () => {
    const columns = [
      { fieldKey: 'provider.firstName', label: 'First Name' },
      { fieldKey: 'provider.lastName', label: 'Last Name' },
    ];
    const rows = [['John', 'Doe']];

    const buffer = await generateExcel(columns, rows, 'Test Report');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(mockWorkbook.addWorksheet).toHaveBeenCalledWith('Test Report');
  });

  it('should add data rows to the worksheet', async () => {
    const columns = [{ fieldKey: 'provider.firstName', label: 'First Name' }];
    const rows = [['John'], ['Jane']];

    await generateExcel(columns, rows, 'Report');

    expect(mockWorksheet.addRow).toHaveBeenCalledTimes(2);
    expect(mockWorksheet.addRow).toHaveBeenCalledWith({ col_0: 'John' });
    expect(mockWorksheet.addRow).toHaveBeenCalledWith({ col_0: 'Jane' });
  });

  it('should style the header row', async () => {
    const columns = [{ fieldKey: 'provider.firstName', label: 'First Name' }];
    await generateExcel(columns, [], 'Report');

    expect(mockWorksheet.getRow).toHaveBeenCalledWith(1);
  });
});
