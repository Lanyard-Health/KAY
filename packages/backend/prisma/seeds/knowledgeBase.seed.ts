/**
 * Knowledge Base Seed Script
 *
 * Reads payer_knowledge_base.xlsx and imports every row into the knowledge base tables.
 * After each record is saved, generates and stores an embedding vector.
 *
 * Idempotent — safe to run multiple times without creating duplicates.
 * Uses upsert on unique keys (PayerTrack: payerName+track+stateRegion).
 * Child records are deleted and re-created on each run for simplicity.
 *
 * Usage:
 *   npx tsx prisma/seeds/knowledgeBase.seed.ts                    # full run with embeddings
 *   npx tsx prisma/seeds/knowledgeBase.seed.ts --dry-run           # parse only, no DB writes
 *   npx tsx prisma/seeds/knowledgeBase.seed.ts --skip-embeddings   # seed data without embeddings
 */

import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const prisma = new PrismaClient();

// Check for spreadsheet in multiple locations:
// 1. Bundled in repo (for Render/CI)
// 2. Local iCloud path (for dev)
const BUNDLED_PATH = path.resolve(import.meta.dirname, '../../data/payer_knowledge_base.xlsx');
const LOCAL_PATH = '/Users/kay/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/payer_knowledge_base.xlsx';
const SPREADSHEET_PATH = fs.existsSync(BUNDLED_PATH) ? BUNDLED_PATH : path.resolve(LOCAL_PATH);

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_EMBEDDINGS = process.argv.includes('--skip-embeddings');

// ─── Helpers ────────────────────────────────────────────────────────────────

const NEEDS_FLAGS = ['NEEDS RESEARCH', 'NEEDS DOMAIN EXPERT'];

/** Returns null if the cell contains a NEEDS flag, otherwise returns the trimmed string. */
function cleanCell(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const str = String(value).trim();
  if (NEEDS_FLAGS.some((flag) => str.toUpperCase().includes(flag))) return null;
  return str;
}

/** Parse a boolean-ish cell ("Yes"/"No"/true/false). */
function parseBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const str = String(value).trim().toLowerCase();
  return str === 'yes' || str === 'true' || str === '1';
}

/** Parse an integer cell, returns null if not a number. */
function parseInt_(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const str = String(value).trim();
  if (NEEDS_FLAGS.some((flag) => str.toUpperCase().includes(flag))) return null;
  const n = parseInt(str, 10);
  return isNaN(n) ? null : n;
}

/** Parse a date cell. XLSX may return a serial number or a string. */
function parseDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const str = String(value).trim();
  if (NEEDS_FLAGS.some((flag) => str.toUpperCase().includes(flag))) return null;
  // XLSX serial number
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    return isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(str);
  return isNaN(date.getTime()) ? null : date;
}

/** Parse a comma-separated string into an array. */
function parseArray(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const str = String(value).trim();
  if (NEEDS_FLAGS.some((flag) => str.toUpperCase().includes(flag))) return [];
  return str.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Build text representation of a record for embedding. */
function buildEmbeddingText(type: string, data: Record<string, unknown>): string {
  const parts = [type + ':'];
  for (const [key, val] of Object.entries(data)) {
    if (val !== null && val !== undefined && val !== '') {
      parts.push(`${key}: ${val}`);
    }
  }
  return parts.join(' ');
}

/** Simple cuid-like ID. */
function cuid(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `c${ts}${rand}`;
}

// ─── Embedding helper ───────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env['OPENAI_API_KEY'];
const EMBEDDING_MODEL = process.env['EMBEDDING_MODEL'] || 'text-embedding-3-small';

async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY || SKIP_EMBEDDINGS) return null;

  const trimmed = text.slice(0, 8000);
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: trimmed,
      model: EMBEDDING_MODEL,
      dimensions: 1536,
    }),
  });

  if (!response.ok) {
    console.warn(`  ⚠ Embedding API error: ${response.status}`);
    return null;
  }

  const result = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return result.data[0]?.embedding ?? null;
}

async function upsertEmbedding(
  sourceColumn: string,
  sourceId: string,
  contentText: string
): Promise<void> {
  const embedding = await generateEmbedding(contentText);
  if (!embedding) return;

  const vectorString = `[${embedding.join(',')}]`;

  // Delete existing
  await prisma.$executeRawUnsafe(
    `DELETE FROM knowledge_base_embeddings WHERE "${sourceColumn}" = $1`,
    sourceId
  );

  // Insert new
  await prisma.$executeRawUnsafe(
    `INSERT INTO knowledge_base_embeddings (id, "${sourceColumn}", content_text, embedding, model_used, created_at, updated_at)
     VALUES ($1, $2, $3, $4::vector, $5, NOW(), NOW())`,
    cuid(),
    sourceId,
    contentText,
    vectorString,
    EMBEDDING_MODEL
  );
}

// ─── Sheet readers ──────────────────────────────────────────────────────────

function readSheet<T>(wb: XLSX.WorkBook, name: string): T[] {
  const sheet = wb.Sheets[name];
  if (!sheet) {
    console.warn(`Sheet "${name}" not found, skipping.`);
    return [];
  }
  return XLSX.utils.sheet_to_json<T>(sheet);
}

// ─── Seed functions ─────────────────────────────────────────────────────────

interface PayerTrackRow {
  'Payer Name': string;
  'Parent Org'?: string;
  'Payer Type': string;
  'State / Region': string;
  'Track / Specialty': string;
  'Submission Method': string;
  'Enrollment Link'?: string;
  'Provider Portal URL'?: string;
  'Product Lines'?: string;
  'Notes'?: string;
}

// Map to resolve PayerTrack IDs from (payerName, track, stateRegion)
const payerTrackIdMap = new Map<string, string>();

function payerTrackKey(payerName: string, track: string, stateRegion: string): string {
  return `${payerName}|${track}|${stateRegion}`;
}

async function seedPayerTracks(wb: XLSX.WorkBook): Promise<number> {
  const rows = readSheet<PayerTrackRow>(wb, 'Payers & Tracks');
  console.log(`\n📋 Payers & Tracks: ${rows.length} rows`);

  let count = 0;
  for (const row of rows) {
    const payerName = cleanCell(row['Payer Name']);
    const track = cleanCell(row['Track / Specialty']);
    const stateRegion = cleanCell(row['State / Region']);

    if (!payerName || !track || !stateRegion) {
      console.warn(`  ⚠ Skipping row missing required field: ${JSON.stringify(row).slice(0, 100)}`);
      continue;
    }

    const data = {
      payerName,
      parentOrg: cleanCell(row['Parent Org']),
      payerType: cleanCell(row['Payer Type']) || 'Commercial',
      stateRegion,
      track,
      submissionMethod: cleanCell(row['Submission Method']) || 'manual',
      enrollmentLink: cleanCell(row['Enrollment Link']),
      portalUrl: cleanCell(row['Provider Portal URL']),
      productLines: parseArray(row['Product Lines']),
      notes: cleanCell(row['Notes']),
      isActive: true,
    };

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would upsert PayerTrack: ${payerName} / ${track} / ${stateRegion}`);
      payerTrackIdMap.set(payerTrackKey(payerName, track, stateRegion), `dry-run-${count}`);
      count++;
      continue;
    }

    const record = await prisma.payerTrack.upsert({
      where: {
        payerName_track_stateRegion: { payerName, track, stateRegion },
      },
      update: data,
      create: data,
    });

    payerTrackIdMap.set(payerTrackKey(payerName, track, stateRegion), record.id);

    const embText = buildEmbeddingText('PayerTrack', data);
    await upsertEmbedding('payer_track_id', record.id, embText);

    count++;
  }

  console.log(`  ✓ ${count} PayerTrack records processed`);
  return count;
}

// ─── Contacts ───────────────────────────────────────────────────────────────

interface ContactRow {
  ' ': string; // Payer name (unnamed column header)
  Track: string;
  'Contact Type': string;
  Phone?: string;
  Email?: string;
  Fax?: string;
  'Portal URL'?: string;
  Hours?: string;
  Notes?: string;
}

async function seedContacts(wb: XLSX.WorkBook): Promise<number> {
  const rows = readSheet<ContactRow>(wb, 'Contacts');
  console.log(`\n📞 Contacts: ${rows.length} rows`);

  let count = 0;
  for (const row of rows) {
    const payerName = cleanCell(row[' ']);
    const track = cleanCell(row['Track']);
    const contactType = cleanCell(row['Contact Type']);

    if (!payerName || !contactType) {
      console.warn(`  ⚠ Skipping contact missing payer/type`);
      continue;
    }

    // Resolve PayerTrack ID — contacts reference payer+track but not always state
    // Try to find exact match, then fall back to first match by payer+track
    const payerTrackId = findPayerTrackId(payerName, track);
    if (!payerTrackId) {
      console.warn(`  ⚠ No PayerTrack found for "${payerName}" / "${track}"`);
      continue;
    }

    const data = {
      payerTrackId,
      contactType,
      phone: cleanCell(row['Phone']),
      email: cleanCell(row['Email']),
      fax: cleanCell(row['Fax']),
      portalUrl: cleanCell(row['Portal URL']),
      hours: cleanCell(row['Hours']),
      notes: cleanCell(row['Notes']),
    };

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would create PayerContact: ${payerName} / ${contactType}`);
      count++;
      continue;
    }

    const record = await prisma.payerContact.create({ data });
    const embText = buildEmbeddingText('PayerContact', { payerName, ...data });
    await upsertEmbedding('payer_form_id', record.id, embText);
    // Note: PayerContact doesn't have its own embedding FK, so we skip embedding for contacts
    // (they're discoverable through their parent PayerTrack embedding)
    count++;
  }

  console.log(`  ✓ ${count} PayerContact records processed`);
  return count;
}

// ─── Timelines ──────────────────────────────────────────────────────────────

interface TimelineRow {
  Payer: string;
  Track: string;
  'Process Type': string;
  'Min Days'?: string | number;
  'Max Days'?: string | number;
  'State Overrides'?: string;
  Notes?: string;
}

async function seedTimelines(wb: XLSX.WorkBook): Promise<number> {
  const rows = readSheet<TimelineRow>(wb, 'Timelines');
  console.log(`\n⏱  Timelines: ${rows.length} rows`);

  let count = 0;
  for (const row of rows) {
    const payerName = cleanCell(row['Payer']);
    const track = cleanCell(row['Track']);
    const processType = cleanCell(row['Process Type']);

    if (!payerName || !processType) continue;

    const payerTrackId = findPayerTrackId(payerName, track);
    if (!payerTrackId) {
      console.warn(`  ⚠ No PayerTrack for "${payerName}" / "${track}"`);
      continue;
    }

    // Parse state overrides as JSON if present
    const stateOverridesStr = cleanCell(row['State Overrides']);
    let stateOverrides: Record<string, unknown> | null = null;
    if (stateOverridesStr) {
      try {
        stateOverrides = JSON.parse(stateOverridesStr);
      } catch {
        // Not JSON — store as descriptive note
        stateOverrides = { raw: stateOverridesStr };
      }
    }

    const data = {
      payerTrackId,
      processType,
      minDays: parseInt_(row['Min Days']),
      maxDays: parseInt_(row['Max Days']),
      stateOverrides: stateOverrides as any,
      notes: cleanCell(row['Notes']),
    };

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would create PayerTimeline: ${payerName} / ${processType}`);
      count++;
      continue;
    }

    const record = await prisma.payerTimeline.create({ data });
    const embText = buildEmbeddingText('PayerTimeline', { payerName, track, ...data });
    await upsertEmbedding('payer_timeline_id', record.id, embText);
    count++;
  }

  console.log(`  ✓ ${count} PayerTimeline records processed`);
  return count;
}

// ─── State Rules ────────────────────────────────────────────────────────────

interface StateRuleRow {
  Payer: string;
  Track: string;
  State: string;
  'Rule Type': string;
  Description: string;
  'Effective Date'?: string | number;
  'Expiration Date'?: string | number;
}

async function seedStateRules(wb: XLSX.WorkBook): Promise<number> {
  const rows = readSheet<StateRuleRow>(wb, 'State Rules');
  console.log(`\n📜 State Rules: ${rows.length} rows`);

  let count = 0;
  for (const row of rows) {
    const payerName = cleanCell(row['Payer']);
    const track = cleanCell(row['Track']);
    const state = cleanCell(row['State']);
    const ruleType = cleanCell(row['Rule Type']);
    const description = cleanCell(row['Description']);

    if (!payerName || !state || !ruleType || !description) continue;

    const payerTrackId = findPayerTrackId(payerName, track);
    if (!payerTrackId) {
      console.warn(`  ⚠ No PayerTrack for "${payerName}" / "${track}"`);
      continue;
    }

    const data = {
      payerTrackId,
      state,
      ruleType,
      description,
      effectiveDate: parseDate(row['Effective Date']),
      expirationDate: parseDate(row['Expiration Date']),
    };

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would create PayerStateRule: ${payerName} / ${state} / ${ruleType}`);
      count++;
      continue;
    }

    const record = await prisma.payerStateRule.create({ data });
    const embText = buildEmbeddingText('PayerStateRule', { payerName, track, ...data });
    await upsertEmbedding('payer_state_rule_id', record.id, embText);
    count++;
  }

  console.log(`  ✓ ${count} PayerStateRule records processed`);
  return count;
}

// ─── Forms & Documents ──────────────────────────────────────────────────────

interface FormRow {
  Payer: string;
  Track: string;
  'Form Name': string;
  Format: string;
  'URL / Destination'?: string;
  Notes?: string;
}

async function seedForms(wb: XLSX.WorkBook): Promise<number> {
  const rows = readSheet<FormRow>(wb, 'Forms & Documents');
  console.log(`\n📄 Forms & Documents: ${rows.length} rows`);

  let count = 0;
  for (const row of rows) {
    const payerName = cleanCell(row['Payer']);
    const track = cleanCell(row['Track']);
    const formName = cleanCell(row['Form Name']);
    const format = cleanCell(row['Format']);

    if (!payerName || !formName || !format) continue;

    const payerTrackId = findPayerTrackId(payerName, track);
    if (!payerTrackId) {
      console.warn(`  ⚠ No PayerTrack for "${payerName}" / "${track}"`);
      continue;
    }

    // URL / Destination could be a URL or a fax/email destination
    const urlOrDest = cleanCell(row['URL / Destination']);
    const isUrl = urlOrDest?.startsWith('http');

    const data = {
      payerTrackId,
      formName,
      format,
      url: isUrl ? urlOrDest : null,
      destination: !isUrl ? urlOrDest : null,
      isRequired: true,
      notes: cleanCell(row['Notes']),
    };

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would create PayerForm: ${payerName} / ${formName}`);
      count++;
      continue;
    }

    const record = await prisma.payerForm.create({ data });
    const embText = buildEmbeddingText('PayerForm', { payerName, track, ...data });
    await upsertEmbedding('payer_form_id', record.id, embText);
    count++;
  }

  console.log(`  ✓ ${count} PayerForm records processed`);
  return count;
}

// ─── Requirements — Universal ───────────────────────────────────────────────

interface UniversalReqRow {
  Requirement: string;
  Description: string;
  'Applies To': string;
  'Is Blocking': string;
  'Standard Minimum / Rule'?: string;
  Notes?: string;
}

async function seedUniversalRequirements(wb: XLSX.WorkBook): Promise<number> {
  const rows = readSheet<UniversalReqRow>(wb, 'Requirements — Universal');
  console.log(`\n🌐 Requirements — Universal: ${rows.length} rows`);

  let count = 0;
  for (const row of rows) {
    const name = cleanCell(row['Requirement']);
    const description = cleanCell(row['Description']);
    const appliesTo = cleanCell(row['Applies To']);

    if (!name || !description || !appliesTo) continue;

    const data = {
      name,
      description,
      appliesTo,
      isBlocking: parseBool(row['Is Blocking']),
      standardMinimum: cleanCell(row['Standard Minimum / Rule']),
      notes: cleanCell(row['Notes']),
    };

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would upsert RequirementUniversal: ${name}`);
      count++;
      continue;
    }

    // Upsert by name (unique enough for universal requirements)
    const existing = await prisma.requirementUniversal.findFirst({
      where: { name },
    });

    let record;
    if (existing) {
      record = await prisma.requirementUniversal.update({
        where: { id: existing.id },
        data,
      });
    } else {
      record = await prisma.requirementUniversal.create({ data });
    }

    const embText = buildEmbeddingText('RequirementUniversal', data);
    await upsertEmbedding('requirement_universal_id', record.id, embText);
    count++;
  }

  console.log(`  ✓ ${count} RequirementUniversal records processed`);
  return count;
}

// ─── Requirements — Payer-Specific ──────────────────────────────────────────

interface PayerReqRow {
  'Payer / Entity': string;
  Track: string;
  Requirement: string;
  'Override Type': string;
  'Payer-Specific Rule': string;
  'Applies To (State / Provider Type)'?: string;
  'Is Blocking': string;
  Source?: string;
}

async function seedPayerRequirements(wb: XLSX.WorkBook): Promise<number> {
  const rows = readSheet<PayerReqRow>(wb, 'Requirements — Payer-Specific');
  console.log(`\n🔒 Requirements — Payer-Specific: ${rows.length} rows`);

  let count = 0;
  for (const row of rows) {
    const payerName = cleanCell(row['Payer / Entity']);
    const track = cleanCell(row['Track']);
    const name = cleanCell(row['Requirement']);
    const overrideType = cleanCell(row['Override Type']);
    const rule = cleanCell(row['Payer-Specific Rule']);

    if (!payerName || !name || !overrideType || !rule) continue;

    const payerTrackId = findPayerTrackId(payerName, track);
    if (!payerTrackId) {
      console.warn(`  ⚠ No PayerTrack for "${payerName}" / "${track}"`);
      continue;
    }

    const data = {
      payerTrackId,
      name,
      overrideType,
      rule,
      appliesTo: cleanCell(row['Applies To (State / Provider Type)']),
      isBlocking: parseBool(row['Is Blocking']),
      source: cleanCell(row['Source']),
    };

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would create PayerRequirement: ${payerName} / ${name}`);
      count++;
      continue;
    }

    const record = await prisma.payerRequirement.create({ data });
    const embText = buildEmbeddingText('PayerRequirement', { payerName, track, ...data });
    await upsertEmbedding('payer_requirement_id', record.id, embText);
    count++;
  }

  console.log(`  ✓ ${count} PayerRequirement records processed`);
  return count;
}

// ─── PayerTrack ID resolver ─────────────────────────────────────────────────

// Common abbreviations used in child sheets vs. full names in Payers & Tracks
const NAME_ALIASES: Record<string, string[]> = {
  'Evernorth Behavioral Health': ['Evernorth BH'],
  'Optum Behavioral Health': ['Optum BH'],
  'Anthem Blue Cross California': ['Anthem Blue Cross'],
};

// Build reverse map: alias → canonical name
const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(NAME_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL.set(alias.toLowerCase(), canonical);
  }
}

/** Normalize a payer name using known aliases. */
function normalizeName(name: string): string {
  return ALIAS_TO_CANONICAL.get(name.toLowerCase()) || name;
}

/**
 * Check if a child track string matches a PayerTrack's track.
 * Handles: "BH — Individual" matches "Behavioral Health — Individual",
 * "Medical + Dental" matches "Medical" or "Dental",
 * "Medical / BH" matches "Medical / Primary Care" or "Behavioral Health",
 * "All tracks" matches anything.
 */
function tracksMatch(childTrack: string, payerTrack: string): boolean {
  const c = childTrack.toLowerCase();
  const p = payerTrack.toLowerCase();

  // Exact match
  if (c === p) return true;

  // "All tracks" matches everything
  if (c.includes('all tracks') || c.includes('all states')) return true;

  // Expand "BH" → "Behavioral Health"
  const cExpanded = c.replace(/\bbh\b/gi, 'behavioral health');
  if (cExpanded === p || p.includes(cExpanded) || cExpanded.includes(p)) return true;

  // "Medical + Dental" or "Medical + BH" — match if any part matches
  const childParts = c.split(/\s*[+&,/]\s*/).map((s) => s.trim().replace(/\bbh\b/gi, 'behavioral health'));
  for (const part of childParts) {
    if (part && p.includes(part)) return true;
  }

  // Check if payer track contains child track keyword
  if (p.includes(c.replace(/\bbh\b/gi, 'behavioral health'))) return true;

  return false;
}

/**
 * Find a PayerTrack ID by payer name and track.
 * Strategy:
 * 1. Exact name + exact track
 * 2. Normalized name (aliases) + exact track
 * 3. Exact/normalized name + fuzzy track matching
 * 4. First match by name only (fallback)
 */
function findPayerTrackId(payerName: string | null, track: string | null): string | null {
  if (!payerName) return null;

  const normalized = normalizeName(payerName);
  const candidates: Array<{ key: string; id: string; name: string; track: string }> = [];

  for (const [key, id] of payerTrackIdMap) {
    const [name, t] = key.split('|');
    candidates.push({ key, id, name: name!, track: t! });
  }

  // 1. Exact name + exact track
  if (track) {
    const exact = candidates.find((c) => c.name === payerName && c.track === track);
    if (exact) return exact.id;
  }

  // 2. Normalized name + exact track
  if (track) {
    const normExact = candidates.find((c) => c.name === normalized && c.track === track);
    if (normExact) return normExact.id;
  }

  // 3. Name match (exact or normalized) + fuzzy track
  if (track) {
    const nameMatches = candidates.filter(
      (c) => c.name === payerName || c.name === normalized
    );
    const fuzzy = nameMatches.find((c) => tracksMatch(track, c.track));
    if (fuzzy) return fuzzy.id;
  }

  // 4. Substring name match + fuzzy track
  if (track) {
    const substr = candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(payerName.toLowerCase()) ||
        payerName.toLowerCase().includes(c.name.toLowerCase())
    );
    const fuzzy = substr.find((c) => tracksMatch(track, c.track));
    if (fuzzy) return fuzzy.id;
  }

  // 5. Name-only fallback (first match)
  const nameOnly = candidates.find(
    (c) =>
      c.name === payerName ||
      c.name === normalized ||
      c.name.toLowerCase().includes(payerName.toLowerCase())
  );
  if (nameOnly) return nameOnly.id;

  return null;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  LANYARD HEALTH — Knowledge Base Seed Script');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Spreadsheet: ${SPREADSHEET_PATH}`);
  console.log(`  Dry run: ${DRY_RUN}`);
  console.log(`  Skip embeddings: ${SKIP_EMBEDDINGS}`);
  console.log(`  Embedding API configured: ${!!OPENAI_API_KEY}`);
  console.log('');

  const wb = XLSX.readFile(SPREADSHEET_PATH);
  console.log(`Sheets found: ${wb.SheetNames.join(', ')}`);

  if (!DRY_RUN) {
    // Clean child records before re-seeding (PayerTracks are upserted, children are recreated)
    console.log('\n🧹 Cleaning existing child records...');
    await prisma.payerRequirement.deleteMany({});
    await prisma.payerForm.deleteMany({});
    await prisma.payerStateRule.deleteMany({});
    await prisma.payerTimeline.deleteMany({});
    await prisma.payerContact.deleteMany({});
    // Don't delete PayerTracks — they're upserted
    // Don't delete RequirementUniversal — they're upserted by name
    // Clean embeddings for child types (PayerTrack embeddings are handled by upsert)
    await prisma.$executeRawUnsafe(`DELETE FROM knowledge_base_embeddings WHERE payer_requirement_id IS NOT NULL`);
    await prisma.$executeRawUnsafe(`DELETE FROM knowledge_base_embeddings WHERE payer_form_id IS NOT NULL`);
    await prisma.$executeRawUnsafe(`DELETE FROM knowledge_base_embeddings WHERE payer_state_rule_id IS NOT NULL`);
    await prisma.$executeRawUnsafe(`DELETE FROM knowledge_base_embeddings WHERE payer_timeline_id IS NOT NULL`);
    console.log('  ✓ Cleaned');
  }

  // Seed in dependency order
  const payerTrackCount = await seedPayerTracks(wb);
  const contactCount = await seedContacts(wb);
  const timelineCount = await seedTimelines(wb);
  const stateRuleCount = await seedStateRules(wb);
  const formCount = await seedForms(wb);
  const universalReqCount = await seedUniversalRequirements(wb);
  const payerReqCount = await seedPayerRequirements(wb);

  console.log('\n═══════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════');
  console.log(`  PayerTracks:            ${payerTrackCount}`);
  console.log(`  PayerContacts:          ${contactCount}`);
  console.log(`  PayerTimelines:         ${timelineCount}`);
  console.log(`  PayerStateRules:        ${stateRuleCount}`);
  console.log(`  PayerForms:             ${formCount}`);
  console.log(`  RequirementUniversals:  ${universalReqCount}`);
  console.log(`  PayerRequirements:      ${payerReqCount}`);
  console.log(`  TOTAL:                  ${payerTrackCount + contactCount + timelineCount + stateRuleCount + formCount + universalReqCount + payerReqCount}`);
  console.log('═══════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
