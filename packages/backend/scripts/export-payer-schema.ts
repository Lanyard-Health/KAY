/**
 * One-off export: pull the Prisma schema for the payer/credentialing tables
 * and reshape it into a human-readable xlsx — one sheet per table, plus
 * an overview, relationships map, and enum reference.
 *
 * Read-only on schema.prisma. No DB queries.
 *
 * Usage:
 *   cd packages/backend && npx tsx scripts/export-payer-schema.ts
 *
 * Output:
 *   /Users/kaysworld/Desktop/payer_knowledge_base_schema_2026-06-04.xlsx
 */

import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SCHEMA_PATH = path.resolve(import.meta.dirname, '../prisma/schema.prisma');
const OUTPUT_PATH = '/Users/kaysworld/Desktop/payer_knowledge_base_schema_2026-06-04.xlsx';
const ERD_PATH = '/Users/kaysworld/Desktop/payer_knowledge_base_erd_2026-06-04.md';

// Tables in scope: the 7 KB tables, the form-fill plumbing, and the operational
// payer wrappers that orbit them.
const PAYER_TABLES = [
  // Reference book (KB)
  'PayerTrack',
  'PayerContact',
  'PayerTimeline',
  'PayerStateRule',
  'PayerForm',
  'PayerRequirement',
  'RequirementUniversal',
  // Form-fill plumbing
  'PayerFormField',
  'PayerFormFieldMapping',
  // Operational payer wrappers
  'Payer',
  'PracticePayer',
  'PayerSubmissionConfig',
  'PortalCredential',
  // Semantic search
  'KnowledgeBaseEmbedding',
];

// Plain-English purpose for each table (so the user can scan).
const TABLE_PURPOSE: Record<string, string> = {
  PayerTrack: 'Master reference book — one row per payer × state × track. The hub the other KB tables hang off.',
  PayerContact: 'Contact info for credentialing/provider services teams (phone, email, fax, hours).',
  PayerTimeline: 'Expected processing durations (initial, recredential, etc.), with per-state overrides.',
  PayerStateRule: 'State-specific exceptions: open enrollment windows, alternate applications, network alliances.',
  PayerForm: 'Enrollment forms required by a payer. Where to find them and how to submit.',
  PayerRequirement: 'Payer-specific credentialing requirements (overrides, additionals, exceptions).',
  RequirementUniversal: 'Cross-payer credentialing requirements that apply everywhere (NPI, TIN, license, etc.).',
  PayerFormField: 'Individual fillable fields on a PayerForm (one row per text box, dropdown, checkbox, etc.).',
  PayerFormFieldMapping: 'Recipe for filling a form field from provider/practice data (with fallback priority).',
  Payer: 'Operational payer record — separate from PayerTrack, used by live enrollments.',
  PracticePayer: 'Per-(practice, payer) relationship: group NPI, tax ID, contract numbers, on-file COI/W-9.',
  PayerSubmissionConfig: 'Adapter configuration for automated form-fill & submission (CAQH, Playwright, Aetna, etc.).',
  PortalCredential: 'Encrypted vault for payer portal logins (per-tenant encryption, GROUP or INDIVIDUAL).',
  KnowledgeBaseEmbedding: 'pgvector embeddings (1536-dim) for semantic search over all KB content.',
};

// ─── Parse schema.prisma ────────────────────────────────────────────────────

interface ParsedField {
  name: string;
  rawType: string; // e.g. "String?", "PayerContact[]", "DateTime"
  baseType: string; // e.g. "String", "PayerContact", "DateTime"
  isList: boolean;
  isOptional: boolean;
  attributes: string[]; // raw @-attributes
  docComment: string; // /// comment immediately above the field
}

interface ParsedModel {
  name: string;
  dbTableName: string; // from @@map
  fields: ParsedField[];
  uniques: string[][]; // @@unique([a, b])
  indexes: string[][]; // @@index([a, b])
  docComment: string; // /// above the model
}

interface ParsedEnum {
  name: string;
  values: string[];
}

interface ParsedSchema {
  models: Map<string, ParsedModel>;
  enums: Map<string, ParsedEnum>;
}

function parseSchema(src: string): ParsedSchema {
  const models = new Map<string, ParsedModel>();
  const enums = new Map<string, ParsedEnum>();

  const lines = src.split('\n');
  let i = 0;
  let pendingDoc: string[] = [];

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.startsWith('///')) {
      pendingDoc.push(trimmed.replace(/^\/\/\/\s?/, ''));
      i++;
      continue;
    }

    // Skip plain comments and blank lines, but reset pending docs
    if (trimmed.startsWith('//') || trimmed === '') {
      if (trimmed === '' || trimmed.startsWith('//')) {
        // Blank line clears pending doc only if it's truly blank (not /// run)
        if (trimmed === '') pendingDoc = [];
      }
      i++;
      continue;
    }

    const modelMatch = trimmed.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      const name = modelMatch[1]!;
      const m: ParsedModel = {
        name,
        dbTableName: '',
        fields: [],
        uniques: [],
        indexes: [],
        docComment: pendingDoc.join(' '),
      };
      pendingDoc = [];
      i++;
      let fieldDoc: string[] = [];
      while (i < lines.length) {
        const fl = lines[i]!.trim();
        if (fl === '}') break;
        if (fl === '' || fl.startsWith('//') && !fl.startsWith('///')) {
          if (fl === '') fieldDoc = [];
          i++;
          continue;
        }
        if (fl.startsWith('///')) {
          fieldDoc.push(fl.replace(/^\/\/\/\s?/, ''));
          i++;
          continue;
        }
        // @@-level attrs
        if (fl.startsWith('@@map(')) {
          const mm = fl.match(/@@map\("([^"]+)"\)/);
          if (mm) m.dbTableName = mm[1]!;
          i++;
          continue;
        }
        if (fl.startsWith('@@unique(')) {
          const um = fl.match(/@@unique\(\[([^\]]+)\]/);
          if (um) m.uniques.push(um[1]!.split(',').map((s) => s.trim()));
          i++;
          continue;
        }
        if (fl.startsWith('@@index(')) {
          const im = fl.match(/@@index\(\[([^\]]+)\]/);
          if (im) m.indexes.push(im[1]!.split(',').map((s) => s.trim()));
          i++;
          continue;
        }
        // Field line: name type ...
        const fieldMatch = fl.match(/^(\w+)\s+([^\s]+)(.*)$/);
        if (fieldMatch) {
          const fname = fieldMatch[1]!;
          const ftype = fieldMatch[2]!;
          const rest = fieldMatch[3]!.trim();
          const attrs: string[] = [];
          // Extract @-attributes (may span balanced parens)
          let buf = rest;
          while (buf.length > 0) {
            const at = buf.indexOf('@');
            if (at === -1) break;
            // Find end of attribute: either next whitespace before next @ or balanced parens
            let end = at + 1;
            // Read attribute name
            while (end < buf.length && /[A-Za-z._]/.test(buf[end]!)) end++;
            if (buf[end] === '(') {
              // Find matching paren
              let depth = 1;
              end++;
              while (end < buf.length && depth > 0) {
                if (buf[end] === '(') depth++;
                else if (buf[end] === ')') depth--;
                end++;
              }
            }
            attrs.push(buf.slice(at, end).trim());
            buf = buf.slice(end);
          }
          const isList = ftype.endsWith('[]');
          const isOptional = !isList && ftype.endsWith('?');
          let baseType = ftype;
          if (isList) baseType = baseType.slice(0, -2);
          if (isOptional) baseType = baseType.slice(0, -1);
          m.fields.push({
            name: fname,
            rawType: ftype,
            baseType,
            isList,
            isOptional,
            attributes: attrs,
            docComment: fieldDoc.join(' '),
          });
          fieldDoc = [];
        }
        i++;
      }
      models.set(name, m);
      i++;
      continue;
    }

    const enumMatch = trimmed.match(/^enum\s+(\w+)\s*\{/);
    if (enumMatch) {
      const name = enumMatch[1]!;
      const values: string[] = [];
      i++;
      while (i < lines.length) {
        const el = lines[i]!.trim();
        if (el === '}') break;
        if (el === '' || el.startsWith('//')) {
          i++;
          continue;
        }
        // Enum value: name [@map(...)]
        const ev = el.match(/^(\w+)/);
        if (ev) values.push(ev[1]!);
        i++;
      }
      enums.set(name, { name, values });
      i++;
      pendingDoc = [];
      continue;
    }

    pendingDoc = [];
    i++;
  }

  return { models, enums };
}

// ─── Type classification ────────────────────────────────────────────────────

const PRIMITIVE_TYPES = new Set([
  'String',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
]);

function classifyType(
  field: ParsedField,
  schema: ParsedSchema
): { kind: 'primitive' | 'enum' | 'relation' | 'unknown'; display: string; refs?: string } {
  if (PRIMITIVE_TYPES.has(field.baseType)) {
    return { kind: 'primitive', display: field.rawType };
  }
  if (schema.enums.has(field.baseType)) {
    return { kind: 'enum', display: `${field.rawType}  (enum)`, refs: field.baseType };
  }
  if (schema.models.has(field.baseType)) {
    let display = `→ ${field.baseType}`;
    if (field.isList) display += '[] (1:many)';
    else display += ' (relation)';
    return { kind: 'relation', display, refs: field.baseType };
  }
  return { kind: 'unknown', display: field.rawType };
}

function attributeSummary(attrs: string[]): string {
  // Concise human-readable summary of common attributes.
  const out: string[] = [];
  for (const a of attrs) {
    if (a.startsWith('@id')) out.push('primary key');
    else if (a.startsWith('@unique')) out.push('unique');
    else if (a.startsWith('@default(now())')) out.push('default: now()');
    else if (a.startsWith('@default(cuid())')) out.push('default: auto-id');
    else if (a.startsWith('@default(uuid())')) out.push('default: auto-id');
    else if (a.startsWith('@default(')) {
      const m = a.match(/@default\((.*)\)/);
      out.push(`default: ${m ? m[1] : a}`);
    } else if (a.startsWith('@updatedAt')) out.push('auto-updated');
    else if (a.startsWith('@map(')) {
      const m = a.match(/@map\("([^"]+)"\)/);
      if (m) out.push(`db column: ${m[1]}`);
    } else if (a.startsWith('@relation(')) {
      const m = a.match(/fields:\s*\[([^\]]+)\]/);
      const r = a.match(/references:\s*\[([^\]]+)\]/);
      if (m && r) out.push(`FK: ${m[1]} → ${r[1]}`);
      else if (m) out.push(`FK on ${m[1]}`);
      else out.push('relation');
    } else if (a.startsWith('@db.')) {
      out.push(a.slice(1));
    }
  }
  return out.join(' · ');
}

// ─── Main ───────────────────────────────────────────────────────────────────

// ─── DB enrichment ──────────────────────────────────────────────────────────

interface FieldStats {
  totalRows: number;
  populatedCount: number; // non-NULL count
  populatedPct: string;   // e.g. "94.0%"
  distinctValues: string[] | null; // for low-cardinality strings
  jsonSample: string | null;       // for JSON fields
  encrypted: boolean;
}

interface TableStats {
  totalRows: number;
  byField: Record<string, FieldStats>;
}

/** Resolve a Prisma field's actual DB column name (honors @map, falls back to field name). */
function dbColumnFor(field: ParsedField): string {
  for (const a of field.attributes) {
    const m = a.match(/^@map\("([^"]+)"\)/);
    if (m) return m[1]!;
  }
  return field.name;
}

/** Is this field a scalar column (vs a relation)? Relations don't have a DB column. */
function isScalarColumn(field: ParsedField, schema: ParsedSchema): boolean {
  // Lists of model types are relation arrays — no scalar column
  if (field.isList && schema.models.has(field.baseType)) return false;
  // Non-list model-typed fields ARE relation pointers; the actual FK column is a sibling field
  if (schema.models.has(field.baseType)) return false;
  return true;
}

/** Truncate a sample value for readability. */
function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

async function getTableStats(model: ParsedModel, schema: ParsedSchema): Promise<TableStats> {
  const dbTable = model.dbTableName || model.name;
  const totalRowsRes = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "${dbTable}"`
  );
  const totalRows = Number(totalRowsRes[0]?.count ?? 0);

  const byField: Record<string, FieldStats> = {};

  for (const field of model.fields) {
    const stats: FieldStats = {
      totalRows,
      populatedCount: 0,
      populatedPct: '',
      distinctValues: null,
      jsonSample: null,
      encrypted: /encrypted$/i.test(field.name),
    };

    if (!isScalarColumn(field, schema)) {
      byField[field.name] = stats;
      continue;
    }

    const col = dbColumnFor(field);

    // % populated (non-null count)
    try {
      const nnRes = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
        `SELECT COUNT("${col}")::bigint AS c FROM "${dbTable}"`
      );
      const nn = Number(nnRes[0]?.c ?? 0);
      stats.populatedCount = nn;
      stats.populatedPct = totalRows === 0 ? '—' : `${((nn / totalRows) * 100).toFixed(1)}%`;
    } catch {
      stats.populatedPct = 'n/a';
    }

    // Skip everything else for encrypted fields (we won't read ciphertext)
    if (stats.encrypted) {
      byField[field.name] = stats;
      continue;
    }

    // Distinct sample for String fields with low cardinality
    if (field.baseType === 'String' && !field.isList) {
      try {
        const distRes = await prisma.$queryRawUnsafe<Array<{ v: string | null; c: bigint }>>(
          `SELECT "${col}" AS v, COUNT(*)::bigint AS c
           FROM "${dbTable}"
           WHERE "${col}" IS NOT NULL
           GROUP BY "${col}"
           ORDER BY 2 DESC
           LIMIT 31`
        );
        if (distRes.length <= 30) {
          // Low-cardinality — show all distinct values
          stats.distinctValues = distRes
            .map((r) => `${truncate(String(r.v), 60)} (${r.c})`);
        } else {
          stats.distinctValues = [`>30 distinct values — top 10 shown`].concat(
            distRes.slice(0, 10).map((r) => `${truncate(String(r.v), 60)} (${r.c})`)
          );
        }
      } catch {
        // ignore
      }
    }

    // JSON sample — exclude both SQL NULL and the JSON literal `null`
    if (field.baseType === 'Json') {
      try {
        // Recompute "populated" honestly: must be non-null AND not the literal JSON `null`
        const honestRes = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
          `SELECT COUNT(*)::bigint AS c FROM "${dbTable}"
           WHERE "${col}" IS NOT NULL AND "${col}"::text != 'null'`
        );
        const honestCount = Number(honestRes[0]?.c ?? 0);
        stats.populatedCount = honestCount;
        stats.populatedPct = totalRows === 0 ? '—' : `${((honestCount / totalRows) * 100).toFixed(1)}% (excl. JSON-null)`;

        const sampleRes = await prisma.$queryRawUnsafe<Array<{ v: unknown }>>(
          `SELECT "${col}" AS v FROM "${dbTable}"
           WHERE "${col}" IS NOT NULL AND "${col}"::text != 'null'
           LIMIT 1`
        );
        if (sampleRes[0]?.v !== undefined && sampleRes[0]?.v !== null) {
          const s = JSON.stringify(sampleRes[0].v);
          stats.jsonSample = truncate(s, 240);
        } else {
          stats.jsonSample = '(no non-null samples in DB)';
        }
      } catch {
        // ignore
      }
    }

    // Boolean distribution
    if (field.baseType === 'Boolean' && !field.isList) {
      try {
        const distRes = await prisma.$queryRawUnsafe<Array<{ v: boolean | null; c: bigint }>>(
          `SELECT "${col}" AS v, COUNT(*)::bigint AS c FROM "${dbTable}" GROUP BY "${col}"`
        );
        stats.distinctValues = distRes.map((r) => `${r.v === null ? 'NULL' : r.v} (${r.c})`);
      } catch {
        // ignore
      }
    }

    byField[field.name] = stats;
  }

  return { totalRows, byField };
}

// ─── Mermaid ERD generation ─────────────────────────────────────────────────

function buildMermaidERD(schema: ParsedSchema): string {
  const lines: string[] = [];
  lines.push('# Payer Knowledge Base — ERD');
  lines.push('');
  lines.push('Open this file in:');
  lines.push('- **VS Code** with the "Markdown Preview Mermaid Support" extension installed → Cmd+Shift+V');
  lines.push('- **mermaid.live** → paste the block below into the editor → export to PNG/SVG');
  lines.push('- **GitHub** → render this file in any repo (built-in Mermaid support)');
  lines.push('');
  lines.push('```mermaid');
  lines.push('erDiagram');

  // For each in-scope table, emit a block with the most important fields
  for (const t of PAYER_TABLES) {
    const m = schema.models.get(t)!;
    lines.push(`    ${t} {`);
    for (const f of m.fields) {
      if (schema.models.has(f.baseType)) continue; // skip relation pointers
      // Sanitize type: strip ? [] and replace any non-alphanumeric with safe chars for Mermaid parser
      let type = f.rawType.replace(/[?[\]]/g, '');
      // Mermaid erDiagram only accepts simple identifiers; replace exotic types
      if (/[^A-Za-z0-9_]/.test(type)) {
        if (/^Unsupported/i.test(type)) type = 'vector';
        else type = type.replace(/[^A-Za-z0-9_]/g, '_');
      }
      const isPK = f.attributes.some((a) => a.startsWith('@id'));
      const isUnique = f.attributes.some((a) => a.startsWith('@unique'));
      const flags: string[] = [];
      if (isPK) flags.push('PK');
      else if (isUnique) flags.push('UK');
      // Mermaid syntax: type name [PK/FK]
      lines.push(`        ${type} ${f.name}${flags.length ? ' ' + flags.join(',') : ''}`);
    }
    lines.push('    }');
  }

  // Relationships
  const seen = new Set<string>();
  for (const t of PAYER_TABLES) {
    const m = schema.models.get(t)!;
    for (const f of m.fields) {
      if (!schema.models.has(f.baseType)) continue;
      // Only emit relationships where BOTH sides are in scope; otherwise just note it
      if (!PAYER_TABLES.includes(f.baseType)) continue;
      // Determine cardinality from the *child* side (the one carrying the FK)
      const childHasFK = f.attributes.some((a) => a.match(/fields:\s*\[/));
      if (!childHasFK && !f.isList) continue; // pointer side without FK — emit from the FK side instead
      const fromSide = childHasFK ? t : f.baseType;
      const toSide = childHasFK ? f.baseType : t;
      const key = `${fromSide}|${toSide}`;
      const reverseKey = `${toSide}|${fromSide}`;
      if (seen.has(key) || seen.has(reverseKey)) continue;
      seen.add(key);
      // many-to-one (child → parent)
      lines.push(`    ${fromSide} }o--|| ${toSide} : "belongs to"`);
    }
  }

  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  console.log('Payer Schema Export');
  console.log('Schema:', SCHEMA_PATH);
  console.log('Output:', OUTPUT_PATH);
  console.log('ERD:   ', ERD_PATH);
  console.log('');

  const src = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  const schema = parseSchema(src);

  console.log(`Parsed ${schema.models.size} models, ${schema.enums.size} enums.`);
  console.log('');

  // Validate that every requested table exists
  const missing = PAYER_TABLES.filter((t) => !schema.models.has(t));
  if (missing.length > 0) {
    console.error('Tables NOT FOUND in schema:', missing);
    process.exit(1);
  }

  // ─── Gather DB stats per table ───────────────────────────────────────────
  console.log('Querying DB stats for each table…');
  const statsByTable: Record<string, TableStats> = {};
  for (const t of PAYER_TABLES) {
    const m = schema.models.get(t)!;
    process.stdout.write(`  ${t}… `);
    statsByTable[t] = await getTableStats(m, schema);
    console.log(`${statsByTable[t].totalRows} rows`);
  }
  console.log('');

  // ─── Build workbook ──────────────────────────────────────────────────────

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Overview ────────────────────────────────────────────────────
  const overviewHeaders = ['Table (model)', 'DB table name', 'Row count', 'Purpose (plain English)', '# Fields', '# Relations'];
  const overviewRows: string[][] = [];
  for (const t of PAYER_TABLES) {
    const m = schema.models.get(t)!;
    const relations = m.fields.filter((f) => schema.models.has(f.baseType)).length;
    overviewRows.push([
      t,
      m.dbTableName || '(uses model name)',
      String(statsByTable[t]!.totalRows),
      TABLE_PURPOSE[t] ?? '',
      String(m.fields.length),
      String(relations),
    ]);
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([overviewHeaders, ...overviewRows]),
    'Overview'
  );

  // ── Sheet 2: Relationships map ───────────────────────────────────────────
  // For each in-scope table, list each relation field → which table it joins to.
  const relHeaders = ['From table', 'Field name', 'Relation', 'To table', 'In-scope target?', 'FK details'];
  const relRows: string[][] = [];
  for (const t of PAYER_TABLES) {
    const m = schema.models.get(t)!;
    for (const f of m.fields) {
      if (!schema.models.has(f.baseType)) continue;
      const inScope = PAYER_TABLES.includes(f.baseType) ? 'Yes' : 'No (extends out of scope)';
      const cardinality = f.isList ? '1:many' : f.isOptional ? '0:1' : '1:1';
      // Find @relation FK details if present
      let fkDetails = '';
      const rel = f.attributes.find((a) => a.startsWith('@relation('));
      if (rel) {
        const fm = rel.match(/fields:\s*\[([^\]]+)\]/);
        const rm = rel.match(/references:\s*\[([^\]]+)\]/);
        if (fm && rm) fkDetails = `${fm[1]} → ${f.baseType}.${rm[1]}`;
        else if (fm) fkDetails = `${fm[1]}`;
      }
      relRows.push([t, f.name, cardinality, f.baseType, inScope, fkDetails]);
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([relHeaders, ...relRows]), 'Relationships');

  // ── Sheet 3+: one per table ──────────────────────────────────────────────
  for (const t of PAYER_TABLES) {
    const m = schema.models.get(t)!;
    const rows: unknown[][] = [];

    // Header rows above the field table
    rows.push([`Table: ${t}`, '', '', '']);
    rows.push([`DB table name: ${m.dbTableName || '(uses model name)'}`, '', '', '']);
    rows.push([`Purpose: ${TABLE_PURPOSE[t] ?? ''}`, '', '', '']);
    if (m.docComment) rows.push([`Schema doc: ${m.docComment}`, '', '', '']);
    if (m.uniques.length > 0) {
      rows.push([
        `Composite unique constraints: ${m.uniques.map((u) => `(${u.join(', ')})`).join('; ')}`,
        '',
        '',
        '',
      ]);
    }
    if (m.indexes.length > 0) {
      rows.push([
        `Indexes: ${m.indexes.map((u) => `(${u.join(', ')})`).join('; ')}`,
        '',
        '',
        '',
      ]);
    }
    rows.push([]);

    rows.push(['Field', 'Type', 'Attributes', '% populated', 'Sample values / shape', 'Notes']);

    const tableStats = statsByTable[t]!;
    for (const f of m.fields) {
      const cls = classifyType(f, schema);
      const attrs = attributeSummary(f.attributes);
      const fstats = tableStats.byField[f.name];
      const notes: string[] = [];
      if (fstats?.encrypted) notes.push('[ENCRYPTED] AES-256-GCM ciphertext, per-tenant key. Do not read raw.');
      if (cls.kind === 'relation') notes.push(`Joins to ${cls.refs}`);
      if (cls.kind === 'enum') notes.push(`Enum values: see Enums sheet`);
      if (f.isOptional) notes.push('Optional (nullable)');
      if (f.docComment) notes.push(f.docComment);

      let sampleCell = '';
      if (fstats) {
        if (fstats.encrypted) {
          sampleCell = '(encrypted — not sampled)';
        } else if (fstats.jsonSample) {
          sampleCell = `e.g. ${fstats.jsonSample}`;
        } else if (fstats.distinctValues) {
          sampleCell = fstats.distinctValues.join(' | ');
        }
      }

      const pct = fstats && isScalarColumn(f, schema) ? fstats.populatedPct : '—';
      rows.push([f.name, cls.display, attrs, pct, sampleCell, notes.join(' · ')]);
    }

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), t.slice(0, 31)); // Excel limits sheet names to 31 chars
  }

  // ── Last sheet: Enums (only those referenced by in-scope tables) ─────────
  const referencedEnums = new Set<string>();
  for (const t of PAYER_TABLES) {
    const m = schema.models.get(t)!;
    for (const f of m.fields) {
      if (schema.enums.has(f.baseType)) referencedEnums.add(f.baseType);
    }
  }
  const enumRows: unknown[][] = [];
  enumRows.push(['Enum name', 'Value']);
  for (const enumName of [...referencedEnums].sort()) {
    const e = schema.enums.get(enumName)!;
    for (const v of e.values) {
      enumRows.push([enumName, v]);
    }
    enumRows.push([]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(enumRows), 'Enums');

  // ── Write xlsx ───────────────────────────────────────────────────────────
  const outDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  XLSX.writeFile(wb, OUTPUT_PATH);

  // ── Write Mermaid ERD ─────────────────────────────────────────────────────
  const erd = buildMermaidERD(schema);
  fs.writeFileSync(ERD_PATH, erd, 'utf-8');

  console.log('=== SCHEMA EXPORT SUMMARY ===');
  console.log(`xlsx output:  ${OUTPUT_PATH}`);
  console.log(`ERD output:   ${ERD_PATH}`);
  console.log(`Tables exported:  ${PAYER_TABLES.length}`);
  console.log(`Enums referenced: ${referencedEnums.size}`);
  console.log(`Relationships:    ${relRows.length}`);
  console.log('');
  console.log('Per-table field counts:');
  for (const t of PAYER_TABLES) {
    const m = schema.models.get(t)!;
    const fkCount = m.fields.filter((f) => schema.models.has(f.baseType)).length;
    const rows = statsByTable[t]?.totalRows ?? 0;
    console.log(`  ${t.padEnd(28)} ${String(m.fields.length).padStart(3)} fields  (${fkCount} relations)  ${String(rows).padStart(6)} rows`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
