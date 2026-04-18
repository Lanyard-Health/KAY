import type { CredentialingPacket } from '../credentialing-packet.service.js';

/**
 * Recipe Resolver — pure function layer between the database recipe and
 * the channel adapters. Given a recipe (PayerFormField[] with their
 * mappings) and a CredentialingPacket, it resolves every field into a
 * concrete string value and reports anything a required field couldn't
 * be sourced from.
 *
 * No I/O. No browser. No PDF. Adapters consume the output.
 *
 * Design note: mappings have a priority — higher wins when multiple
 * mappings resolve to non-empty values. This supports "use the
 * PracticePayer contract number if set; else fall back to the payer's
 * default" without adapter branching.
 */

// ── Types ────────────────────────────────────────────────────────────────

export type SourceKind =
  | 'provider'
  | 'practice'
  | 'practicePayer'
  | 'license'
  | 'education'
  | 'boardCertification'
  | 'identifier'
  | 'banking'
  | 'demographics'
  | 'constant'
  | 'computed';

export interface RecipeFieldMapping {
  sourceKind: SourceKind;
  /** Dotted / bracketed accessor, e.g. "npi" or "licenses[0].expirationDate". */
  sourcePath: string;
  /** Optional JSON DSL: { fn: "date", format: "MM/DD/YYYY" } */
  transform?: TransformSpec | null;
  fallbackValue?: string | null;
  priority?: number;
}

export interface RecipeField {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: string;
  required: boolean;
  validationRegex?: string | null;
  mappings: RecipeFieldMapping[];
}

export interface ResolvedField {
  fieldKey: string;
  fieldLabel: string;
  fieldType: string;
  value: string | null;
  /** True when the value came from a constant / fallback, not packet data. */
  fromFallback: boolean;
  /** Populated when required=true and value stayed null. */
  missing: boolean;
  validationError: string | null;
}

export interface ResolveResult {
  fields: ResolvedField[];
  /** fieldKey → value. Convenience view for adapters. */
  values: Record<string, string>;
  /** Required fields whose mappings all resolved to null/empty. */
  missingRequired: ResolvedField[];
  /** Optional fields that were blank — informational. */
  missingOptional: ResolvedField[];
  /** Fields whose value failed validationRegex. */
  invalid: ResolvedField[];
}

// ── Transform DSL ────────────────────────────────────────────────────────

export type TransformSpec =
  | { fn: 'date'; format: string } // MM/DD/YYYY, YYYY-MM-DD, etc.
  | { fn: 'upper' }
  | { fn: 'lower' }
  | { fn: 'trim' }
  | { fn: 'digits' } // strip non-digits (SSN, phone, NPI, etc.)
  | { fn: 'mask'; keep: 'last4' | 'last2' | 'first4' } // e.g. "****1234"
  | { fn: 'ssnFormat' } // 123-45-6789
  | { fn: 'phoneFormat' } // (555) 123-4567
  | { fn: 'concat'; with: string; separator?: string }; // rarely needed; composes with sourcePath output

const DATE_TOKENS: Array<[RegExp, (d: Date) => string]> = [
  [/YYYY/g, (d) => String(d.getUTCFullYear())],
  [/MM/g, (d) => String(d.getUTCMonth() + 1).padStart(2, '0')],
  [/DD/g, (d) => String(d.getUTCDate()).padStart(2, '0')],
  [/HH/g, (d) => String(d.getUTCHours()).padStart(2, '0')],
  [/mm/g, (d) => String(d.getUTCMinutes()).padStart(2, '0')],
];

function formatDate(d: Date, format: string): string {
  let out = format;
  for (const [token, fn] of DATE_TOKENS) {
    out = out.replace(token, fn(d));
  }
  return out;
}

function applyTransform(raw: string, spec: TransformSpec): string {
  switch (spec.fn) {
    case 'date': {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return raw;
      return formatDate(d, spec.format);
    }
    case 'upper':
      return raw.toUpperCase();
    case 'lower':
      return raw.toLowerCase();
    case 'trim':
      return raw.trim();
    case 'digits':
      return raw.replace(/\D+/g, '');
    case 'mask': {
      const d = raw.replace(/\D+/g, '');
      if (!d) return '';
      if (spec.keep === 'last4') return d.length <= 4 ? d : '*'.repeat(d.length - 4) + d.slice(-4);
      if (spec.keep === 'last2') return d.length <= 2 ? d : '*'.repeat(d.length - 2) + d.slice(-2);
      if (spec.keep === 'first4') return d.length <= 4 ? d : d.slice(0, 4) + '*'.repeat(d.length - 4);
      return d;
    }
    case 'ssnFormat': {
      const d = raw.replace(/\D+/g, '');
      if (d.length !== 9) return raw;
      return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
    }
    case 'phoneFormat': {
      const d = raw.replace(/\D+/g, '');
      if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
      if (d.length === 11 && d.startsWith('1')) {
        return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
      }
      return raw;
    }
    case 'concat':
      return `${raw}${spec.separator ?? ''}${spec.with}`;
  }
}

// ── Path resolution ──────────────────────────────────────────────────────

/**
 * Walk a packet scope with a path like "licenses[0].expirationDate".
 * Returns null if any segment is missing (so callers can decide between
 * fallback / missing).
 */
function walk(root: unknown, path: string): unknown {
  if (!path) return null;
  const tokens = path.split(/[.\[\]]/).filter(Boolean);
  let cur: any = root;
  for (const tok of tokens) {
    if (cur === null || cur === undefined) return null;
    const asNum = Number(tok);
    if (Number.isInteger(asNum) && Array.isArray(cur)) {
      cur = cur[asNum];
    } else {
      cur = cur[tok];
    }
  }
  return cur ?? null;
}

function scopeForKind(kind: SourceKind, packet: CredentialingPacket): unknown {
  switch (kind) {
    case 'provider':
      return packet.provider;
    case 'practice':
      return packet.practice;
    case 'practicePayer':
      return packet.practicePayer;
    case 'license':
      return packet.provider?.licenses ?? [];
    case 'education':
      return packet.provider?.educations ?? [];
    case 'boardCertification':
      return packet.provider?.boardCertifications ?? [];
    case 'identifier':
      return packet.provider?.providerIdentifiers ?? [];
    case 'banking':
      return packet.provider?.banking ?? [];
    case 'demographics':
      return packet.provider?.demographics ?? null;
    case 'constant':
      // sourcePath is the literal value; no scope walk needed
      return null;
    case 'computed':
      // reserved for future server-side helpers (fullName, mailingLabel...)
      return null;
  }
}

// ── Value coercion ───────────────────────────────────────────────────────

function coerceToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  // Arrays / objects are intentionally stringified — unusual but explicit
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

// ── Mapping → value ──────────────────────────────────────────────────────

interface MappingResolution {
  raw: string | null;
  fromFallback: boolean;
}

function resolveMapping(
  mapping: RecipeFieldMapping,
  packet: CredentialingPacket
): MappingResolution {
  let raw: string | null = null;

  if (mapping.sourceKind === 'constant') {
    raw = mapping.sourcePath || null;
  } else {
    const scope = scopeForKind(mapping.sourceKind, packet);
    raw = coerceToString(walk(scope, mapping.sourcePath));
  }

  let fromFallback = false;
  if (raw === null && mapping.fallbackValue) {
    raw = mapping.fallbackValue;
    fromFallback = true;
  }

  if (raw !== null && mapping.transform) {
    try {
      raw = applyTransform(raw, mapping.transform as TransformSpec);
    } catch {
      // Transform failures leave the raw value as-is; adapter surfaces
      // the mismatch downstream if needed.
    }
  }

  if (raw === '') raw = null;
  return { raw, fromFallback };
}

// ── Field resolver ───────────────────────────────────────────────────────

function resolveField(
  field: RecipeField,
  packet: CredentialingPacket
): ResolvedField {
  // Sort mappings by priority (higher first); first non-null value wins.
  const sorted = [...field.mappings].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
  );

  let picked: MappingResolution | null = null;
  for (const m of sorted) {
    const result = resolveMapping(m, packet);
    if (result.raw !== null) {
      picked = result;
      break;
    }
  }

  const value = picked?.raw ?? null;
  const missing = field.required && value === null;

  let validationError: string | null = null;
  if (value !== null && field.validationRegex) {
    try {
      const rx = new RegExp(field.validationRegex);
      if (!rx.test(value)) {
        validationError = `Value does not match pattern ${field.validationRegex}`;
      }
    } catch {
      validationError = 'Invalid validationRegex';
    }
  }

  return {
    fieldKey: field.fieldKey,
    fieldLabel: field.fieldLabel,
    fieldType: field.fieldType,
    value,
    fromFallback: picked?.fromFallback ?? false,
    missing,
    validationError,
  };
}

// ── Public API ───────────────────────────────────────────────────────────

export function resolveRecipe(
  fields: RecipeField[],
  packet: CredentialingPacket
): ResolveResult {
  const resolved = fields.map((f) => resolveField(f, packet));

  const values: Record<string, string> = {};
  for (const f of resolved) {
    if (f.value !== null) values[f.fieldKey] = f.value;
  }

  return {
    fields: resolved,
    values,
    missingRequired: resolved.filter((f) => f.missing),
    missingOptional: resolved.filter((f) => !f.missing && f.value === null),
    invalid: resolved.filter((f) => f.validationError !== null),
  };
}
