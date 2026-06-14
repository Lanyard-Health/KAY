/**
 * One-off export: pull the seven knowledge-base tables out of Postgres and
 * reshape them into the 9-sheet Payer Knowledge Base template layout.
 *
 * Read-only. Does NOT modify the DB, schema, or any other code.
 *
 * Usage:
 *   cd packages/backend && npx tsx scripts/export-payer-knowledge-base.ts
 *
 * Flags:
 *   --print-counts-only   Print row-count comparison and stop (no extraction).
 *
 * Outputs:
 *   /Users/kaysworld/Desktop/payer_knowledge_base_export_2026-06-04.xlsx
 */

import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const prisma = new PrismaClient();

// ─── Paths ──────────────────────────────────────────────────────────────────

const TEMPLATE_PATH =
  '/Users/kaysworld/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/template_payer_knowledge_base.xlsx';
const OUTPUT_PATH =
  '/Users/kaysworld/Desktop/payer_knowledge_base_export_2026-06-04.xlsx';

const PRINT_COUNTS_ONLY = process.argv.includes('--print-counts-only');

// ─── Status tag constants ───────────────────────────────────────────────────

const YELLOW = 'NEEDS RESEARCH';
const ORANGE = 'NEEDS DOMAIN EXPERT';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** True if a cell value is null, undefined, or empty string. */
function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Get a string value or null. */
function s(v: unknown): string | null {
  if (isBlank(v)) return null;
  return String(v).trim();
}

/** Strip provenance tags from a template cell so we can compare to DB null. */
function stripTag(v: unknown): string | null {
  if (isBlank(v)) return null;
  const str = String(v).trim();
  const upper = str.toUpperCase();
  if (upper.includes(YELLOW)) return null;
  if (upper.includes(ORANGE)) return null;
  return str;
}

/** Classify what the template said for a given cell. */
type TemplateState = 'value' | 'yellow' | 'orange' | 'blank';
function classifyTemplateCell(v: unknown): { state: TemplateState; value: string | null } {
  if (isBlank(v)) return { state: 'blank', value: null };
  const str = String(v).trim();
  const upper = str.toUpperCase();
  if (upper.includes(ORANGE)) return { state: 'orange', value: null };
  if (upper.includes(YELLOW)) return { state: 'yellow', value: null };
  return { state: 'value', value: str };
}

/** Format a Date as YYYY-MM-DD. */
function fmtDate(d: Date | null | undefined): string {
  if (!d) return '';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** "Yes" / "No" for booleans. */
function fmtBool(b: boolean | null | undefined): string {
  if (b === null || b === undefined) return '';
  return b ? 'Yes' : 'No';
}

/** Title-case a snake_case string. */
function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Map DB submission method enum → clean template-style label. */
function fmtSubmissionMethod(m: string | null | undefined): string {
  if (!m) return '';
  const map: Record<string, string> = {
    caqh: 'CAQH',
    portal: 'Portal',
    web_form: 'Web Form',
    email_pdf: 'Email PDF',
    pecos: 'PECOS',
    playwright: 'Portal',
    phone: 'Phone',
  };
  return map[m.toLowerCase()] ?? m;
}

/** Map DB form format enum → clean label. */
function fmtFormat(f: string | null | undefined): string {
  if (!f) return '';
  const u = f.toUpperCase();
  if (u === 'PDF') return 'PDF';
  if (u === 'ONLINE') return 'Online';
  if (u === 'PORTAL') return 'Portal';
  return f;
}

/** Flatten array → comma-separated string. */
function fmtArray(a: string[] | null | undefined): string {
  if (!a || a.length === 0) return '';
  return a.join(', ');
}

/** Flatten { "MD": 15, "OH": 20 } → "MD: 15 biz days | OH: 20 biz days". */
function fmtStateOverrides(j: unknown): string {
  if (!j || typeof j !== 'object') return '';
  const entries = Object.entries(j as Record<string, unknown>);
  if (entries.length === 0) return '';
  return entries
    .map(([state, val]) => {
      if (typeof val === 'number') return `${state}: ${val} biz days`;
      if (typeof val === 'string') return `${state}: ${val}`;
      if (val && typeof val === 'object') {
        // Some overrides may be richer: { min: 15, max: 30 }
        const obj = val as Record<string, unknown>;
        if ('min' in obj || 'max' in obj) {
          const min = obj['min'] ?? '?';
          const max = obj['max'] ?? '?';
          return `${state}: ${min}-${max} biz days`;
        }
        return `${state}: ${JSON.stringify(val)}`;
      }
      return `${state}: ${val}`;
    })
    .join(' | ');
}

// ─── Template lookup ────────────────────────────────────────────────────────

interface TemplateLookup {
  // For each sheet, a Map keyed by a row identity tuple → column-name → cell value
  // We also keep the raw header order and full row arrays for the Sheet 6 copy + gap report.
  sheetRows: Record<string, { headers: string[]; rows: unknown[][] }>;
  // Lookup map per sheet: key (joined identity) → column-name → { state, value }
  lookup: Record<string, Map<string, Record<string, { state: TemplateState; value: string | null }>>>;
}

/** Build the (sheet, key, column) → template-value/state lookup. */
function buildTemplateLookup(): TemplateLookup {
  const wb = XLSX.readFile(TEMPLATE_PATH, { cellDates: true });

  const sheetRows: TemplateLookup['sheetRows'] = {};
  const lookup: TemplateLookup['lookup'] = {};

  // For each sheet we care about, define how to construct the row identity key.
  const keyFns: Record<string, (row: Record<string, unknown>) => string | null> = {
    'Payers & Tracks': (r) =>
      makeKey(r['Payer Name'], r['Track / Specialty'], r['State / Region']),
    Contacts: (r) => makeKey(r['Payer'] ?? r[' '], r['Track'], r['Contact Type']),
    Timelines: (r) => makeKey(r['Payer'], r['Track'], r['Process Type']),
    'State Rules': (r) => makeKey(r['Payer'], r['Track'], r['State'], r['Rule Type']),
    'Forms & Documents': (r) => makeKey(r['Payer'], r['Track'], r['Form Name']),
    'Requirements — Universal': (r) => makeKey(r['Requirement']),
    'Requirements — Payer-Specific': (r) =>
      makeKey(r['Payer / Entity'], r['Track'], r['Requirement']),
  };

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]!;
    // Read as array-of-arrays first to capture headers exactly
    const rows2d = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: false });
    if (rows2d.length === 0) {
      sheetRows[sheetName] = { headers: [], rows: [] };
      continue;
    }
    const headers = (rows2d[0] as unknown[]).map((h) => (h == null ? '' : String(h)));
    // Filter out trailing empty/padded rows: a row counts as empty if every cell is null/blank/whitespace
    const dataRows = (rows2d.slice(1) as unknown[][]).filter((row) =>
      row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')
    );
    sheetRows[sheetName] = { headers, rows: dataRows };

    const keyFn = keyFns[sheetName];
    if (!keyFn) continue;

    const sheetMap = new Map<string, Record<string, { state: TemplateState; value: string | null }>>();
    for (const row of dataRows) {
      const rowObj: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        rowObj[h] = row[i];
      });
      const key = keyFn(rowObj);
      if (!key) continue;
      const colMap: Record<string, { state: TemplateState; value: string | null }> = {};
      for (const h of headers) {
        colMap[h] = classifyTemplateCell(rowObj[h]);
      }
      sheetMap.set(key, colMap);
    }
    lookup[sheetName] = sheetMap;
  }

  return { sheetRows, lookup };
}

function makeKey(...parts: unknown[]): string | null {
  const norm = parts.map((p) =>
    p == null ? '' : String(p).trim().toLowerCase().replace(/\s+/g, ' ')
  );
  if (norm.every((s) => s === '')) return null;
  return norm.join('||');
}

// ─── Reconciliation helper ──────────────────────────────────────────────────

interface DriftRecord {
  sheet: string;
  payer: string;
  track: string;
  column: string;
  templateValue: string;
  dbValue: string;
}

/**
 * For a DB cell that is null/empty:
 *   - If template said NEEDS DOMAIN EXPERT → return ORANGE.
 *   - If template said NEEDS RESEARCH      → return YELLOW.
 *   - If template was blank                → return ''.
 *   - If template had a real value         → return YELLOW (safe default) AND record drift.
 * For a DB cell with a value: return as-is.
 */
function reconcile(
  dbValue: string,
  sheet: string,
  rowKey: string | null,
  column: string,
  payer: string,
  track: string,
  lookup: TemplateLookup,
  drifts: DriftRecord[]
): string {
  if (dbValue !== '') return dbValue;
  const sheetMap = lookup.lookup[sheet];
  if (!sheetMap || !rowKey) return ''; // No template row → genuinely blank
  const colMap = sheetMap.get(rowKey);
  if (!colMap) return ''; // Template doesn't have this row → leave blank
  const tcell = colMap[column];
  if (!tcell) return '';
  if (tcell.state === 'orange') return ORANGE;
  if (tcell.state === 'yellow') return YELLOW;
  if (tcell.state === 'blank') return '';
  // tcell.state === 'value' but DB is null → drift
  drifts.push({
    sheet,
    payer,
    track,
    column,
    templateValue: tcell.value ?? '',
    dbValue: '',
  });
  return YELLOW;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Payer Knowledge Base Export');
  console.log('Template:', TEMPLATE_PATH);
  console.log('Output:  ', OUTPUT_PATH);
  console.log('');

  // ─── Step 1: Row counts first ──────────────────────────────────────────────

  console.log('Reading template…');
  const tpl = buildTemplateLookup();

  console.log('Counting rows…');
  const [
    payerTrackCount,
    contactCount,
    timelineCount,
    stateRuleCount,
    formCount,
    reqUniversalCount,
    reqPayerCount,
  ] = await Promise.all([
    prisma.payerTrack.count(),
    prisma.payerContact.count(),
    prisma.payerTimeline.count(),
    prisma.payerStateRule.count(),
    prisma.payerForm.count(),
    prisma.requirementUniversal.count(),
    prisma.payerRequirement.count(),
  ]);

  // Template counts exclude the header row
  const tplCount = (name: string) => Math.max(0, tpl.sheetRows[name]?.rows.length ?? 0);

  const countRows = [
    ['Sheet', 'Template', 'DB', 'Delta'],
    ['Payers & Tracks', tplCount('Payers & Tracks'), payerTrackCount, payerTrackCount - tplCount('Payers & Tracks')],
    ['Contacts', tplCount('Contacts'), contactCount, contactCount - tplCount('Contacts')],
    ['Timelines', tplCount('Timelines'), timelineCount, timelineCount - tplCount('Timelines')],
    ['State Rules', tplCount('State Rules'), stateRuleCount, stateRuleCount - tplCount('State Rules')],
    ['Forms & Documents', tplCount('Forms & Documents'), formCount, formCount - tplCount('Forms & Documents')],
    ['Requirements — Universal', tplCount('Requirements — Universal'), reqUniversalCount, reqUniversalCount - tplCount('Requirements — Universal')],
    ['Requirements — Payer-Specific', tplCount('Requirements — Payer-Specific'), reqPayerCount, reqPayerCount - tplCount('Requirements — Payer-Specific')],
  ];

  console.log('');
  console.log('=== ROW COUNTS: TEMPLATE vs DB ===');
  for (const row of countRows) {
    console.log(
      String(row[0]).padEnd(32) +
        String(row[1]).padStart(10) +
        String(row[2]).padStart(8) +
        String(row[3]).padStart(8)
    );
  }
  console.log('');

  if (PRINT_COUNTS_ONLY) {
    console.log('--print-counts-only flag set — stopping before reshape.');
    await prisma.$disconnect();
    return;
  }

  // ─── Step 2: Extract data ──────────────────────────────────────────────────

  console.log('Pulling rows from KB tables…');

  const payerTracks = await prisma.payerTrack.findMany({
    include: {
      contacts: true,
      timelines: true,
      stateRules: true,
      forms: true,
      requirements: true,
    },
    orderBy: [{ payerName: 'asc' }, { track: 'asc' }, { stateRegion: 'asc' }],
  });

  const universalReqs = await prisma.requirementUniversal.findMany({
    orderBy: { name: 'asc' },
  });

  // Track of payer→track index for sheet-key generation (the children join through payerTrackId)
  const trackById = new Map<string, { payerName: string; track: string; stateRegion: string }>();
  for (const pt of payerTracks) {
    trackById.set(pt.id, { payerName: pt.payerName, track: pt.track, stateRegion: pt.stateRegion });
  }

  const drifts: DriftRecord[] = [];

  // ─── Sheet 1: Payers & Tracks ─────────────────────────────────────────────

  const sheet1Headers = [
    'Payer Name',
    'Parent Org',
    'Payer Type',
    'State / Region',
    'Track / Specialty',
    'Submission Method',
    'Enrollment Link',
    'Provider Portal URL',
    'Product Lines',
    'EDI / EFT',
    'ERA',
    'Notes',
  ];
  const sheet1Rows: string[][] = [];
  for (const pt of payerTracks) {
    const rowKey = makeKey(pt.payerName, pt.track, pt.stateRegion);
    const r = {
      'Payer Name': pt.payerName,
      'Parent Org': s(pt.parentOrg) ?? '',
      'Payer Type': s(pt.payerType) ?? '',
      'State / Region': pt.stateRegion,
      'Track / Specialty': pt.track,
      'Submission Method': fmtSubmissionMethod(pt.submissionMethod),
      'Enrollment Link': s(pt.enrollmentLink) ?? '',
      'Provider Portal URL': s(pt.portalUrl) ?? '',
      'Product Lines': fmtArray(pt.productLines),
      'EDI / EFT': '', // stays blank per correction #3
      ERA: '',         // stays blank per correction #3
      Notes: s(pt.notes) ?? '',
    } as Record<string, string>;
    const reconciled = sheet1Headers.map((h) => {
      if (h === 'EDI / EFT' || h === 'ERA') return ''; // never reconcile, always blank
      return reconcile(r[h] ?? '', 'Payers & Tracks', rowKey, h, pt.payerName, pt.track, tpl, drifts);
    });
    sheet1Rows.push(reconciled);
  }

  // ─── Sheet 2: Contacts (with dedup + conflict flagging per correction #4) ──

  const sheet2Headers = [
    'Payer',
    'Track',
    'Contact Type',
    'Phone',
    'Email',
    'Fax',
    'Portal URL',
    'Hours',
    'Notes',
  ];
  interface ContactConflict {
    payer: string;
    track: string;
    contactType: string;
    kept: { phone: string; email: string; fax: string; portalUrl: string };
    discarded: { phone: string; email: string; fax: string; portalUrl: string };
  }
  const contactConflicts: ContactConflict[] = [];

  // Group contacts by (payer, track, contactType)
  const contactGroups = new Map<string, Array<{
    contact: typeof payerTracks[0]['contacts'][0];
    payerName: string;
    track: string;
  }>>();
  for (const pt of payerTracks) {
    for (const c of pt.contacts) {
      const key = `${pt.payerName.toLowerCase()}||${pt.track.toLowerCase()}||${(c.contactType ?? '').toLowerCase()}`;
      if (!contactGroups.has(key)) contactGroups.set(key, []);
      contactGroups.get(key)!.push({ contact: c, payerName: pt.payerName, track: pt.track });
    }
  }

  const sheet2Rows: string[][] = [];
  for (const group of contactGroups.values()) {
    if (group.length === 0) continue;
    // Dedup: keep one, but flag any with materially different (phone, email, fax, portalUrl)
    const first = group[0]!;
    const firstFingerprint = JSON.stringify({
      phone: first.contact.phone ?? '',
      email: first.contact.email ?? '',
      fax: first.contact.fax ?? '',
      portalUrl: first.contact.portalUrl ?? '',
    });
    for (let i = 1; i < group.length; i++) {
      const x = group[i]!;
      const fp = JSON.stringify({
        phone: x.contact.phone ?? '',
        email: x.contact.email ?? '',
        fax: x.contact.fax ?? '',
        portalUrl: x.contact.portalUrl ?? '',
      });
      if (fp !== firstFingerprint) {
        contactConflicts.push({
          payer: x.payerName,
          track: x.track,
          contactType: x.contact.contactType ?? '',
          kept: {
            phone: first.contact.phone ?? '',
            email: first.contact.email ?? '',
            fax: first.contact.fax ?? '',
            portalUrl: first.contact.portalUrl ?? '',
          },
          discarded: {
            phone: x.contact.phone ?? '',
            email: x.contact.email ?? '',
            fax: x.contact.fax ?? '',
            portalUrl: x.contact.portalUrl ?? '',
          },
        });
      }
      // Either identical → silent dedup, or different → already flagged; in both cases we drop x.
    }

    const c = first.contact;
    const payer = first.payerName;
    const track = first.track;
    const rowKey = makeKey(payer, track, c.contactType);
    const r: Record<string, string> = {
      Payer: payer,
      Track: track,
      'Contact Type': s(c.contactType) ?? '',
      Phone: s(c.phone) ?? '',
      Email: s(c.email) ?? '',
      Fax: s(c.fax) ?? '',
      'Portal URL': s(c.portalUrl) ?? '',
      Hours: s(c.hours) ?? '',
      Notes: s(c.notes) ?? '',
    };
    const reconciled = sheet2Headers.map((h) =>
      reconcile(r[h] ?? '', 'Contacts', rowKey, h, payer, track, tpl, drifts)
    );
    sheet2Rows.push(reconciled);
  }

  // ─── Sheet 3: Timelines ────────────────────────────────────────────────────

  const sheet3Headers = ['Payer', 'Track', 'Process Type', 'Min Days', 'Max Days', 'State Overrides', 'Notes'];
  const sheet3Rows: string[][] = [];
  for (const pt of payerTracks) {
    for (const t of pt.timelines) {
      const rowKey = makeKey(pt.payerName, pt.track, t.processType);
      const r: Record<string, string> = {
        Payer: pt.payerName,
        Track: pt.track,
        'Process Type': s(t.processType) ?? '',
        'Min Days': t.minDays == null ? '' : String(t.minDays),
        'Max Days': t.maxDays == null ? '' : String(t.maxDays),
        'State Overrides': fmtStateOverrides(t.stateOverrides),
        Notes: s(t.notes) ?? '',
      };
      const reconciled = sheet3Headers.map((h) =>
        reconcile(r[h] ?? '', 'Timelines', rowKey, h, pt.payerName, pt.track, tpl, drifts)
      );
      sheet3Rows.push(reconciled);
    }
  }

  // ─── Sheet 4: State Rules ──────────────────────────────────────────────────

  const sheet4Headers = ['Payer', 'Track', 'State', 'Rule Type', 'Description', 'Effective Date', 'Expiration Date'];
  const sheet4Rows: string[][] = [];
  for (const pt of payerTracks) {
    for (const sr of pt.stateRules) {
      const ruleTypeDisplay = titleCase(sr.ruleType);
      const rowKey = makeKey(pt.payerName, pt.track, sr.state, ruleTypeDisplay);
      const r: Record<string, string> = {
        Payer: pt.payerName,
        Track: pt.track,
        State: s(sr.state) ?? '',
        'Rule Type': ruleTypeDisplay,
        Description: s(sr.description) ?? '',
        'Effective Date': fmtDate(sr.effectiveDate),
        'Expiration Date': fmtDate(sr.expirationDate),
      };
      const reconciled = sheet4Headers.map((h) =>
        reconcile(r[h] ?? '', 'State Rules', rowKey, h, pt.payerName, pt.track, tpl, drifts)
      );
      sheet4Rows.push(reconciled);
    }
  }

  // ─── Sheet 5: Forms & Documents ────────────────────────────────────────────

  const sheet5Headers = ['Payer', 'Track', 'Form Name', 'Format', 'URL / Destination', 'Notes'];
  const sheet5Rows: string[][] = [];
  for (const pt of payerTracks) {
    for (const f of pt.forms) {
      const rowKey = makeKey(pt.payerName, pt.track, f.formName);
      const urlOrDest = s(f.url) ?? s(f.destination) ?? s(f.assetUrl) ?? '';
      const r: Record<string, string> = {
        Payer: pt.payerName,
        Track: pt.track,
        'Form Name': s(f.formName) ?? '',
        Format: fmtFormat(f.format),
        'URL / Destination': urlOrDest,
        Notes: s(f.notes) ?? '',
      };
      const reconciled = sheet5Headers.map((h) =>
        reconcile(r[h] ?? '', 'Forms & Documents', rowKey, h, pt.payerName, pt.track, tpl, drifts)
      );
      sheet5Rows.push(reconciled);
    }
  }

  // ─── Sheet 6: Domain Expert Gaps (copy verbatim from template) ─────────────

  const sheet6 = tpl.sheetRows['Domain Expert Gaps'] ?? { headers: [], rows: [] };
  const sheet6Headers = sheet6.headers;
  const sheet6Rows: unknown[][] = sheet6.rows;

  // ─── Sheet 7: Requirements — Universal ─────────────────────────────────────

  const sheet7Headers = ['Requirement', 'Description', 'Applies To', 'Is Blocking', 'Standard Minimum / Rule', 'Notes'];
  const sheet7Rows: string[][] = [];
  for (const u of universalReqs) {
    const rowKey = makeKey(u.name);
    const r: Record<string, string> = {
      Requirement: s(u.name) ?? '',
      Description: s(u.description) ?? '',
      'Applies To': s(u.appliesTo) ?? '',
      'Is Blocking': fmtBool(u.isBlocking),
      'Standard Minimum / Rule': s(u.standardMinimum) ?? '',
      Notes: s(u.notes) ?? '',
    };
    const reconciled = sheet7Headers.map((h) =>
      reconcile(r[h] ?? '', 'Requirements — Universal', rowKey, h, u.name, '', tpl, drifts)
    );
    sheet7Rows.push(reconciled);
  }

  // ─── Sheet 8: Requirements — Payer-Specific ────────────────────────────────

  const sheet8Headers = [
    'Payer / Entity',
    'Track',
    'Requirement',
    'Override Type',
    'Payer-Specific Rule',
    'Applies To (State / Provider Type)',
    'Is Blocking',
    'Source',
  ];
  const sheet8Rows: string[][] = [];
  for (const pt of payerTracks) {
    for (const req of pt.requirements) {
      const rowKey = makeKey(pt.payerName, pt.track, req.name);
      const r: Record<string, string> = {
        'Payer / Entity': pt.payerName,
        Track: pt.track,
        Requirement: s(req.name) ?? '',
        'Override Type': s(req.overrideType) ?? '',
        'Payer-Specific Rule': s(req.rule) ?? '',
        'Applies To (State / Provider Type)': s(req.appliesTo) ?? '',
        'Is Blocking': fmtBool(req.isBlocking),
        Source: s(req.source) ?? '',
      };
      const reconciled = sheet8Headers.map((h) =>
        reconcile(r[h] ?? '', 'Requirements — Payer-Specific', rowKey, h, pt.payerName, pt.track, tpl, drifts)
      );
      sheet8Rows.push(reconciled);
    }
  }

  // ─── Gap report computation ────────────────────────────────────────────────

  console.log('Computing gap report…');

  // Helper: build DB key sets per sheet for row-level diffs
  function buildDbKeysFor(sheetName: string): Set<string> {
    const set = new Set<string>();
    switch (sheetName) {
      case 'Payers & Tracks':
        for (const pt of payerTracks) {
          const k = makeKey(pt.payerName, pt.track, pt.stateRegion);
          if (k) set.add(k);
        }
        break;
      case 'Contacts':
        for (const pt of payerTracks)
          for (const c of pt.contacts) {
            const k = makeKey(pt.payerName, pt.track, c.contactType);
            if (k) set.add(k);
          }
        break;
      case 'Timelines':
        for (const pt of payerTracks)
          for (const t of pt.timelines) {
            const k = makeKey(pt.payerName, pt.track, t.processType);
            if (k) set.add(k);
          }
        break;
      case 'State Rules':
        for (const pt of payerTracks)
          for (const sr of pt.stateRules) {
            const k = makeKey(pt.payerName, pt.track, sr.state, titleCase(sr.ruleType));
            if (k) set.add(k);
          }
        break;
      case 'Forms & Documents':
        for (const pt of payerTracks)
          for (const f of pt.forms) {
            const k = makeKey(pt.payerName, pt.track, f.formName);
            if (k) set.add(k);
          }
        break;
      case 'Requirements — Universal':
        for (const u of universalReqs) {
          const k = makeKey(u.name);
          if (k) set.add(k);
        }
        break;
      case 'Requirements — Payer-Specific':
        for (const pt of payerTracks)
          for (const req of pt.requirements) {
            const k = makeKey(pt.payerName, pt.track, req.name);
            if (k) set.add(k);
          }
        break;
    }
    return set;
  }

  // (a) Payers/tracks in template but not in DB (Payers & Tracks sheet)
  const tplPayerKeys = new Set(tpl.lookup['Payers & Tracks']?.keys() ?? []);
  const dbPayerKeys = buildDbKeysFor('Payers & Tracks');
  const inTplNotDb: string[] = [];
  const inDbNotTpl: string[] = [];
  for (const k of tplPayerKeys) if (!dbPayerKeys.has(k)) inTplNotDb.push(k);
  for (const k of dbPayerKeys) if (!tplPayerKeys.has(k)) inDbNotTpl.push(k);

  // (a2) Per-sheet row-level diffs (for child tables)
  interface RowGap { sheet: string; key: string; tplCols: string[] }
  const rowGaps: RowGap[] = [];
  const childSheets = [
    'Contacts',
    'Timelines',
    'State Rules',
    'Forms & Documents',
    'Requirements — Universal',
    'Requirements — Payer-Specific',
  ];
  for (const sheetName of childSheets) {
    const tplKeys = new Set(tpl.lookup[sheetName]?.keys() ?? []);
    const dbKeys = buildDbKeysFor(sheetName);
    for (const k of tplKeys) {
      if (!dbKeys.has(k)) {
        const tplRow = tpl.lookup[sheetName]?.get(k);
        const tplCols: string[] = [];
        if (tplRow) {
          for (const [colName, cell] of Object.entries(tplRow)) {
            if (cell.state === 'value') tplCols.push(`${colName}=${cell.value}`);
            else if (cell.state === 'yellow') tplCols.push(`${colName}=YELLOW`);
            else if (cell.state === 'orange') tplCols.push(`${colName}=ORANGE`);
          }
        }
        rowGaps.push({ sheet: sheetName, key: k, tplCols });
      }
    }
  }

  // (b) Submission Method label drift: template compound vs DB single
  const labelDrift: { payer: string; track: string; state: string; template: string; export: string }[] = [];
  const tplPayerSheet = tpl.lookup['Payers & Tracks'];
  if (tplPayerSheet) {
    for (const pt of payerTracks) {
      const key = makeKey(pt.payerName, pt.track, pt.stateRegion);
      if (!key) continue;
      const tRow = tplPayerSheet.get(key);
      if (!tRow) continue;
      const tplCell = tRow['Submission Method'];
      if (!tplCell || tplCell.state !== 'value' || !tplCell.value) continue;
      const dbLabel = fmtSubmissionMethod(pt.submissionMethod);
      if (tplCell.value.toLowerCase() !== dbLabel.toLowerCase()) {
        labelDrift.push({
          payer: pt.payerName,
          track: pt.track,
          state: pt.stateRegion,
          template: tplCell.value,
          export: dbLabel,
        });
      }
    }
  }

  // ─── Build Crosswalk sheet ─────────────────────────────────────────────────

  const crosswalkHeaders = ['Template Sheet', 'Template Column', 'Mapped DB Field(s)', 'Match Type', 'Notes'];
  const crosswalkRows: string[][] = [
    ['Payers & Tracks', 'Payer Name', 'PayerTrack.payerName', 'DIRECT', ''],
    ['Payers & Tracks', 'Parent Org', 'PayerTrack.parentOrg', 'DIRECT', ''],
    ['Payers & Tracks', 'Payer Type', 'PayerTrack.payerType', 'DIRECT', ''],
    ['Payers & Tracks', 'State / Region', 'PayerTrack.stateRegion', 'DIRECT', ''],
    ['Payers & Tracks', 'Track / Specialty', 'PayerTrack.track', 'DIRECT', ''],
    ['Payers & Tracks', 'Submission Method', 'PayerTrack.submissionMethod', 'TRANSFORM', 'Lowercase enum → Title-case label (CAQH, Portal, …)'],
    ['Payers & Tracks', 'Enrollment Link', 'PayerTrack.enrollmentLink', 'DIRECT', ''],
    ['Payers & Tracks', 'Provider Portal URL', 'PayerTrack.portalUrl', 'DIRECT', ''],
    ['Payers & Tracks', 'Product Lines', 'PayerTrack.productLines (Array)', 'TRANSFORM', 'Array → comma-joined string'],
    ['Payers & Tracks', 'EDI / EFT', '—', 'MISSING_IN_DB', 'No DB field; left blank to match template'],
    ['Payers & Tracks', 'ERA', '—', 'MISSING_IN_DB', 'No DB field; left blank to match template'],
    ['Payers & Tracks', 'Notes', 'PayerTrack.notes', 'DIRECT', ''],

    ['Contacts', 'Payer', 'PayerTrack.payerName (via PayerContact.payerTrackId)', 'TRANSFORM', 'Joined'],
    ['Contacts', 'Track', 'PayerTrack.track', 'TRANSFORM', 'Joined'],
    ['Contacts', 'Contact Type', 'PayerContact.contactType', 'DIRECT', ''],
    ['Contacts', 'Phone', 'PayerContact.phone', 'DIRECT', ''],
    ['Contacts', 'Email', 'PayerContact.email', 'DIRECT', ''],
    ['Contacts', 'Fax', 'PayerContact.fax', 'DIRECT', ''],
    ['Contacts', 'Portal URL', 'PayerContact.portalUrl', 'DIRECT', ''],
    ['Contacts', 'Hours', 'PayerContact.hours', 'DIRECT', ''],
    ['Contacts', 'Notes', 'PayerContact.notes', 'DIRECT', ''],

    ['Timelines', 'Payer', 'PayerTrack.payerName (via PayerTimeline.payerTrackId)', 'TRANSFORM', 'Joined'],
    ['Timelines', 'Track', 'PayerTrack.track', 'TRANSFORM', 'Joined'],
    ['Timelines', 'Process Type', 'PayerTimeline.processType', 'DIRECT', ''],
    ['Timelines', 'Min Days', 'PayerTimeline.minDays', 'DIRECT', ''],
    ['Timelines', 'Max Days', 'PayerTimeline.maxDays', 'DIRECT', ''],
    ['Timelines', 'State Overrides', 'PayerTimeline.stateOverrides (JSON)', 'TRANSFORM', 'JSON → pipe-delimited string'],
    ['Timelines', 'Notes', 'PayerTimeline.notes', 'DIRECT', ''],

    ['State Rules', 'Payer', 'PayerTrack.payerName (via PayerStateRule.payerTrackId)', 'TRANSFORM', 'Joined'],
    ['State Rules', 'Track', 'PayerTrack.track', 'TRANSFORM', 'Joined'],
    ['State Rules', 'State', 'PayerStateRule.state', 'DIRECT', ''],
    ['State Rules', 'Rule Type', 'PayerStateRule.ruleType', 'TRANSFORM', 'snake_case → Title Case'],
    ['State Rules', 'Description', 'PayerStateRule.description', 'DIRECT', ''],
    ['State Rules', 'Effective Date', 'PayerStateRule.effectiveDate', 'TRANSFORM', 'DateTime → YYYY-MM-DD'],
    ['State Rules', 'Expiration Date', 'PayerStateRule.expirationDate', 'TRANSFORM', 'DateTime → YYYY-MM-DD'],

    ['Forms & Documents', 'Payer', 'PayerTrack.payerName (via PayerForm.payerTrackId)', 'TRANSFORM', 'Joined'],
    ['Forms & Documents', 'Track', 'PayerTrack.track', 'TRANSFORM', 'Joined'],
    ['Forms & Documents', 'Form Name', 'PayerForm.formName', 'DIRECT', ''],
    ['Forms & Documents', 'Format', 'PayerForm.format', 'TRANSFORM', 'Enum → Title-case label'],
    ['Forms & Documents', 'URL / Destination', 'PayerForm.url ?? PayerForm.destination ?? PayerForm.assetUrl', 'DERIVED', 'First non-null'],
    ['Forms & Documents', 'Notes', 'PayerForm.notes', 'DIRECT', ''],

    ['Domain Expert Gaps', '(all columns)', '—', 'N/A', 'Copied verbatim from template'],

    ['Requirements — Universal', 'Requirement', 'RequirementUniversal.name', 'DIRECT', ''],
    ['Requirements — Universal', 'Description', 'RequirementUniversal.description', 'DIRECT', ''],
    ['Requirements — Universal', 'Applies To', 'RequirementUniversal.appliesTo', 'DIRECT', ''],
    ['Requirements — Universal', 'Is Blocking', 'RequirementUniversal.isBlocking', 'TRANSFORM', 'true→Yes / false→No'],
    ['Requirements — Universal', 'Standard Minimum / Rule', 'RequirementUniversal.standardMinimum', 'DIRECT', ''],
    ['Requirements — Universal', 'Notes', 'RequirementUniversal.notes', 'DIRECT', ''],

    ['Requirements — Payer-Specific', 'Payer / Entity', 'PayerTrack.payerName (via PayerRequirement.payerTrackId)', 'TRANSFORM', 'Joined'],
    ['Requirements — Payer-Specific', 'Track', 'PayerTrack.track', 'TRANSFORM', 'Joined'],
    ['Requirements — Payer-Specific', 'Requirement', 'PayerRequirement.name', 'DIRECT', ''],
    ['Requirements — Payer-Specific', 'Override Type', 'PayerRequirement.overrideType', 'DIRECT', 'DB stores exact template vocabulary'],
    ['Requirements — Payer-Specific', 'Payer-Specific Rule', 'PayerRequirement.rule', 'DIRECT', ''],
    ['Requirements — Payer-Specific', 'Applies To (State / Provider Type)', 'PayerRequirement.appliesTo', 'DIRECT', ''],
    ['Requirements — Payer-Specific', 'Is Blocking', 'PayerRequirement.isBlocking', 'TRANSFORM', 'true→Yes / false→No'],
    ['Requirements — Payer-Specific', 'Source', 'PayerRequirement.source', 'DIRECT', ''],
  ];

  // ─── Build Gap Report sheet ────────────────────────────────────────────────

  const gapReport: unknown[][] = [];
  gapReport.push(['Gap Report — Payer Knowledge Base Export', '', '', '']);
  gapReport.push([`Generated: 2026-06-04`, '', '', '']);
  gapReport.push([]);
  gapReport.push(['Section 1: Row counts (Template vs DB)']);
  for (const row of countRows) gapReport.push(row);
  gapReport.push([]);
  gapReport.push(['Section 2: Payers/tracks in TEMPLATE but NOT in DB (' + inTplNotDb.length + ')']);
  gapReport.push(['Payer Name', 'Track / Specialty', 'State / Region']);
  for (const k of inTplNotDb.sort()) {
    const parts = k.split('||');
    gapReport.push([parts[0] ?? '', parts[1] ?? '', parts[2] ?? '']);
  }
  gapReport.push([]);
  gapReport.push(['Section 3: Payers/tracks in DB but NOT in TEMPLATE (' + inDbNotTpl.length + ')']);
  gapReport.push(['Payer Name', 'Track / Specialty', 'State / Region']);
  for (const k of inDbNotTpl.sort()) {
    const parts = k.split('||');
    gapReport.push([parts[0] ?? '', parts[1] ?? '', parts[2] ?? '']);
  }
  gapReport.push([]);
  gapReport.push(['Section 3b: Rows in TEMPLATE but NOT in DB (child sheets) — ' + rowGaps.length + ' total']);
  gapReport.push(['Sheet', 'Identity key (lowercased)', 'Template column values']);
  for (const g of rowGaps) {
    gapReport.push([g.sheet, g.key, g.tplCols.join(' | ')]);
  }
  gapReport.push([]);
  gapReport.push(['Section 4: Drift — template had a value but DB is NULL (' + drifts.length + ')']);
  gapReport.push(['Sheet', 'Payer', 'Track', 'Column', 'Template Value', 'DB Value']);
  for (const d of drifts) {
    gapReport.push([d.sheet, d.payer, d.track, d.column, d.templateValue, d.dbValue]);
  }
  gapReport.push([]);
  gapReport.push(['Section 5: Submission Method label drift (' + labelDrift.length + ')']);
  gapReport.push(['Payer', 'Track', 'State', 'Template label', 'Export label (DB)']);
  for (const d of labelDrift) {
    gapReport.push([d.payer, d.track, d.state, d.template, d.export]);
  }
  gapReport.push([]);
  gapReport.push(['Section 6: Contacts — conflicting rows kept ONE, dropped others (' + contactConflicts.length + ')']);
  gapReport.push([
    'Payer', 'Track', 'Contact Type',
    'Kept phone', 'Kept email', 'Kept fax', 'Kept portal',
    'Dropped phone', 'Dropped email', 'Dropped fax', 'Dropped portal',
  ]);
  for (const c of contactConflicts) {
    gapReport.push([
      c.payer, c.track, c.contactType,
      c.kept.phone, c.kept.email, c.kept.fax, c.kept.portalUrl,
      c.discarded.phone, c.discarded.email, c.discarded.fax, c.discarded.portalUrl,
    ]);
  }

  // ─── Build Legend & Overview sheet ─────────────────────────────────────────

  const legend: unknown[][] = [
    ['PAYER KNOWLEDGE BASE — EXPORT FROM LANYARD DB'],
    ['Generated: 2026-06-04'],
    [],
    ['Status Legend'],
    ['GREEN — Confirmed (value present in DB)'],
    [`YELLOW — ${YELLOW} (DB is null, template said yellow or value missing on import)`],
    [`ORANGE — ${ORANGE} (DB cannot store; carried over from template)`],
    ['BLANK — intentionally empty (template was blank for this cell)'],
    [],
    ['Sheet row counts (export)'],
    ['Sheet', 'Rows'],
    ['Payers & Tracks', sheet1Rows.length],
    ['Contacts', sheet2Rows.length],
    ['Timelines', sheet3Rows.length],
    ['State Rules', sheet4Rows.length],
    ['Forms & Documents', sheet5Rows.length],
    ['Domain Expert Gaps', sheet6Rows.length],
    ['Requirements — Universal', sheet7Rows.length],
    ['Requirements — Payer-Specific', sheet8Rows.length],
  ];

  // ─── Assemble workbook ─────────────────────────────────────────────────────

  console.log('Writing workbook…');
  const out = XLSX.utils.book_new();

  function aoaSheet(name: string, headers: unknown[], rows: unknown[][]) {
    const data = headers.length ? [headers, ...rows] : rows;
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(out, ws, name);
  }

  aoaSheet('Legend & Overview', [], legend);
  aoaSheet('Payers & Tracks', sheet1Headers, sheet1Rows);
  aoaSheet('Contacts', sheet2Headers, sheet2Rows);
  aoaSheet('Timelines', sheet3Headers, sheet3Rows);
  aoaSheet('State Rules', sheet4Headers, sheet4Rows);
  aoaSheet('Forms & Documents', sheet5Headers, sheet5Rows);
  aoaSheet('Domain Expert Gaps', sheet6Headers, sheet6Rows);
  aoaSheet('Requirements — Universal', sheet7Headers, sheet7Rows);
  aoaSheet('Requirements — Payer-Specific', sheet8Headers, sheet8Rows);
  aoaSheet('Gap Report', [], gapReport);
  aoaSheet('Crosswalk', crosswalkHeaders, crosswalkRows);

  // Ensure the Desktop dir exists
  const outDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  XLSX.writeFile(out, OUTPUT_PATH);

  console.log('');
  console.log('=== EXPORT SUMMARY ===');
  console.log(`Output:                     ${OUTPUT_PATH}`);
  console.log(`Payers & Tracks:            ${sheet1Rows.length} rows`);
  console.log(`Contacts:                   ${sheet2Rows.length} rows (${contactConflicts.length} conflicts flagged)`);
  console.log(`Timelines:                  ${sheet3Rows.length} rows`);
  console.log(`State Rules:                ${sheet4Rows.length} rows`);
  console.log(`Forms & Documents:          ${sheet5Rows.length} rows`);
  console.log(`Domain Expert Gaps:         ${sheet6Rows.length} rows (copied from template)`);
  console.log(`Requirements — Universal:   ${sheet7Rows.length} rows`);
  console.log(`Requirements — Payer-Spec:  ${sheet8Rows.length} rows`);
  console.log('');
  console.log('Gap report:');
  console.log(`  Payer-tracks in template, NOT in DB:   ${inTplNotDb.length}`);
  console.log(`  Payer-tracks in DB, NOT in template:   ${inDbNotTpl.length}`);
  console.log(`  Child rows in template, NOT in DB:     ${rowGaps.length}`);
  console.log(`  Drift (tpl value, DB null):            ${drifts.length}`);
  console.log(`  Submission method drift:               ${labelDrift.length}`);
  console.log(`  Contact conflicts:                     ${contactConflicts.length}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('FATAL:', err);
  prisma.$disconnect();
  process.exit(1);
});
