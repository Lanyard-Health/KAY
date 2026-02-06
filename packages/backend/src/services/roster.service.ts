import ExcelJS from 'exceljs';
import { ROSTER_FIELD_MAP, ROSTER_RELATIONS } from '@credential-management/shared';
import type { RosterField } from '@credential-management/shared';
import { prisma } from '../utils/prisma.js';
import { ValidationError } from '../middleware/error.middleware.js';

export interface RosterColumn {
  fieldKey: string;
  label: string;
  width?: number;
}

/**
 * Validate that all requested field keys exist in the registry (whitelist).
 */
export function validateColumns(columns: RosterColumn[]): RosterField[] {
  const fields: RosterField[] = [];
  for (const col of columns) {
    const field = ROSTER_FIELD_MAP.get(col.fieldKey);
    if (!field) {
      throw new ValidationError(`Invalid field key: ${col.fieldKey}`);
    }
    fields.push(field);
  }
  return fields;
}

/**
 * Build the Prisma `include` clause based on which relations the selected columns need.
 */
export function buildIncludeClause(fields: RosterField[]): Record<string, any> {
  const include: Record<string, any> = {};

  for (const field of fields) {
    const parts = field.prismaPath.split('.');
    if (parts.length < 2) continue; // top-level provider field, no include needed

    const relation = parts[0]!;
    if (ROSTER_RELATIONS.includes(relation as any)) {
      // For payerEnrollments.payer.name, we need { payerEnrollments: { include: { payer: true } } }
      if (relation === 'payerEnrollments' && parts[1] === 'payer') {
        include[relation] = { include: { payer: true } };
      } else if (!include[relation]) {
        include[relation] = true;
      }
    }
  }

  return include;
}

/**
 * Fetch provider data with only the needed relations.
 */
export async function fetchRosterData(
  columns: RosterColumn[],
  page: number = 1,
  pageSize: number = 25
) {
  const fields = validateColumns(columns);
  const include = buildIncludeClause(fields);

  const [providers, total] = await Promise.all([
    prisma.provider.findMany({
      include: Object.keys(include).length > 0 ? include : undefined,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.provider.count(),
  ]);

  return { providers, total, page, pageSize };
}

/**
 * Fetch ALL provider data (no pagination) for export.
 */
export async function fetchAllRosterData(columns: RosterColumn[]) {
  const fields = validateColumns(columns);
  const include = buildIncludeClause(fields);

  const providers = await prisma.provider.findMany({
    include: Object.keys(include).length > 0 ? include : undefined,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  return providers;
}

/**
 * Get a nested value from an object by dot-notation path.
 * Uses reduce with safe property access to avoid prototype pollution.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function safeGet(target: any, key: string): any {
  if (target == null || DANGEROUS_KEYS.has(key)) return null;
  const desc = Object.getOwnPropertyDescriptor(target, key);
  return desc !== undefined ? desc.value : null;
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, part) => safeGet(current, part), obj);
}

/**
 * Format a cell value based on data type.
 */
export function formatCellValue(value: any, dataType: string): string {
  if (value == null) return '';

  switch (dataType) {
    case 'date':
      if (value instanceof Date) {
        return value.toISOString().split('T')[0]!;
      }
      if (typeof value === 'string') {
        return value.split('T')[0]!;
      }
      return String(value);

    case 'boolean':
      return value ? 'Yes' : 'No';

    case 'array':
      if (Array.isArray(value)) return value.join('; ');
      return String(value);

    case 'number':
      return String(value);

    case 'enum':
      // Replace underscores with spaces and title-case
      return String(value).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    default:
      return String(value);
  }
}

/**
 * Flatten providers with one-to-many relations into rows.
 *
 * Strategy: Find the "primary" relation (the one with the most entries among selected fields).
 * That relation drives row expansion. Other relations are semicolon-joined.
 */
export function flattenToRows(
  providers: any[],
  columns: RosterColumn[]
): string[][] {
  const fields = columns.map(col => ROSTER_FIELD_MAP.get(col.fieldKey)!);

  // Determine which relations are used and find the "primary" one for row expansion
  const usedRelations = new Set<string>();
  for (const field of fields) {
    const parts = field.prismaPath.split('.');
    if (parts.length >= 2 && ROSTER_RELATIONS.includes(parts[0] as any)) {
      usedRelations.add(parts[0]!);
    }
  }

  const rows: string[][] = [];

  for (const provider of providers) {
    // Determine which relation drives rows (the one with the most items)
    let primaryRelation: string | null = null;
    let maxItems = 0;

    for (const rel of usedRelations) {
      const items = provider[rel];
      if (Array.isArray(items) && items.length > maxItems) {
        maxItems = items.length;
        primaryRelation = rel;
      }
    }

    // If no relation data or all empty, produce one row
    const rowCount = Math.max(1, maxItems);

    for (let i = 0; i < rowCount; i++) {
      const row: string[] = [];

      for (const field of fields) {
        const parts = field.prismaPath.split('.');

        if (parts.length === 1) {
          // Top-level provider field
          row.push(formatCellValue(provider[parts[0]!], field.dataType));
        } else {
          const relation = parts[0]!;
          const fieldPath = parts.slice(1).join('.');

          if (relation === primaryRelation) {
            // Primary relation: one item per row
            const item = provider[relation]?.[i];
            row.push(formatCellValue(item ? getNestedValue(item, fieldPath) : null, field.dataType));
          } else {
            // Non-primary relations: join all values
            const items = provider[relation];
            if (Array.isArray(items) && items.length > 0) {
              const values = items
                .map((item: any) => formatCellValue(getNestedValue(item, fieldPath), field.dataType))
                .filter((v: string) => v !== '');
              row.push(values.join('; '));
            } else {
              row.push('');
            }
          }
        }
      }

      rows.push(row);
    }
  }

  return rows;
}

/**
 * Generate an Excel workbook buffer.
 */
export async function generateExcel(
  columns: RosterColumn[],
  rows: string[][],
  reportName: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CredManager';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(reportName || 'Roster Report');

  // Set up columns
  worksheet.columns = columns.map((col, idx) => ({
    header: col.label,
    key: `col_${idx}`,
    width: col.width || Math.max(col.label.length + 4, 15),
  }));

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;

  // Add data rows
  for (const rowData of rows) {
    const rowObj: Record<string, string> = {};
    rowData.forEach((val, idx) => {
      rowObj[`col_${idx}`] = val;
    });
    worksheet.addRow(rowObj);
  }

  // Auto-fit column widths based on content (up to max 50)
  worksheet.columns.forEach((col) => {
    let maxLen = col.header ? col.header.length : 10;
    if (col.eachCell) {
      col.eachCell({ includeEmpty: false }, (cell) => {
        const cellLen = cell.value ? String(cell.value).length : 0;
        if (cellLen > maxLen) maxLen = cellLen;
      });
    }
    col.width = Math.min(maxLen + 3, 50);
  });

  // Add borders
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
        right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      };
      // Alternate row shading
      if (rowNumber > 1 && rowNumber % 2 === 0) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' },
        };
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
