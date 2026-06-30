import type {
  PrismaClient,
  ProviderProfile,
  Practice,
  PracticePayer,
  PayerSubmissionConfig,
  License,
  Education,
  ProviderType,
} from '@prisma/client';
import { decryptSafe } from '../../utils/crypto.js';
import type {
  AetnaRfpProviderData,
  AetnaLineOfBusiness,
  AetnaJoining,
} from './aetna-rfp-adapter.js';

/**
 * aetna-rfp-resolver — turns our stored Provider/Practice/PracticePayer +
 * payer config records into the `AetnaRfpProviderData` packet the
 * AetnaRfpAdapter consumes.
 *
 * Two hard rules shape this file:
 *  1. FAIL-CLOSED. Aetna's network-check step creates a REAL saved application
 *     (and a Request ID) the moment it passes. So every readiness/mapping check
 *     here throws BEFORE we return a packet — i.e. before the worker ever hands
 *     it to the adapter, long before any Aetna footprint. A half-built packet
 *     must never reach the browser.
 *  2. NO GUESSED LABELS. The maps/crosswalks below translate our internal
 *     values into the exact <select>/multiselect option strings Aetna renders.
 *     Every entry comes from a live walk of the wizard (2026-06-18), never a
 *     guess; an unmapped value hard-fails and names exactly what to add where.
 */

// ─── Aetna label maps & crosswalks ───────────────────────────────────────────
//
// Translate our stored values into the exact Aetna option strings, all verified
// against a live wizard walk 2026-06-18 (see docs/plans/aetna-rfp-dropdown-
// options.md). Per rule #2, entries come from that walk, never a guess; anything
// unmapped fails closed.

/** Academic degree (ProviderProfile.educations[].degree, a DegreeType) -> Aetna
 * "#degreeType" label. `ba`/`other` have no clean Aetna degree and fall through
 * to fail-closed. */
export const AETNA_DEGREE_MAP: Record<string, string> = {
  md: 'MD',
  do: 'DO',
  phd: 'PhD',
  psyd: 'PsyD',
  msw: 'MSW',
  ma: 'MA',
  ms: 'MS',
  med: 'MED',
  dnp: 'DNP',
  msn: 'MSN',
  bs: 'BS',
};

/** Fallback when a provider has no Education on file: ProviderType -> Aetna
 * "#degreeType" label. Coarser than the academic degree (a psychiatrist could be
 * a DO), so used only when educations is empty. */
export const PROVIDER_TYPE_DEGREE_FALLBACK: Record<string, string> = {
  psychiatrist: 'MD',
};

/** NUCC taxonomy code -> Aetna "#specialty" label, longest-prefix-match (mirrors
 * resolveCaqhTypeFromTaxonomy in caqh.service.ts). Covers the behavioral-health
 * families we can map with confidence; a code matching no prefix fails closed —
 * correct, since a non-BH taxonomy has no Aetna BH specialty. Longer (subtype)
 * prefixes win over shorter (family) prefixes. */
export const AETNA_SPECIALTY_CROSSWALK: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: '2084P0802X', label: 'Addiction Psychiatry' },
  { prefix: '2084P0804X', label: 'Child and Adolescent Psychiatry' },
  { prefix: '2084P0805X', label: 'Psychiatry Geriatric' },
  { prefix: '2084F0202X', label: 'Forensic Psychiatry' },
  { prefix: '2084P', label: 'Psychiatry' },
  { prefix: '103T', label: 'Clinical Psychology' },
  { prefix: '1041', label: 'Clinical Social Worker' },
  { prefix: '101YA', label: 'Drug and Alcohol Counselor' },
  { prefix: '101YP1600X', label: 'Pastoral Counselor' },
  { prefix: '101Y', label: 'Licensed Professional Counselor' },
  { prefix: '106H', label: 'Marriage and Family Therapist' },
  { prefix: '103K', label: 'Applied Behavioral Analyst' },
  { prefix: '102L', label: 'Psychoanalyst' },
  { prefix: '363LP0808X', label: 'Psychiatric Nurse' },
  { prefix: '364SP0808X', label: 'Psychiatric Nurse' },
  { prefix: '363A', label: 'Physician Assistant' },
];

/** Valid (Aetna degree -> allowed Aetna specialties) from the live walk's degree
 * filter. The form only offers certain specialties per degree; an out-of-set
 * pair means the provider's degree and taxonomy disagree -> fail closed. Only
 * the degrees AETNA_DEGREE_MAP can produce are listed. */
export const AETNA_VALID_PAIRS: Record<string, ReadonlySet<string>> = {
  MD: new Set(['Addiction Psychiatry', 'Art Therapist', 'Child and Adolescent Psychiatry', 'Child Psychiatry', 'Forensic Psychiatry', 'Psychiatry', 'Psychiatry Geriatric']),
  DO: new Set(['Addiction Psychiatry', 'Child and Adolescent Psychiatry', 'Child Psychiatry', 'Forensic Psychiatry', 'Marriage and Family Therapist', 'Pastoral Counselor', 'Psychiatry', 'Psychiatry Geriatric']),
  PhD: new Set(['Applied Behavioral Analyst', 'Art Therapist', 'Clinical Psychology', 'Clinical Social Worker', 'Drug and Alcohol Counselor', 'Licensed Professional Counselor', 'Marriage and Family Therapist', 'Pastoral Counselor', 'Psychiatric Nurse', 'Physician Assistant']),
  PsyD: new Set(['Applied Behavioral Analyst', 'Art Therapist', 'Clinical Psychology', 'Clinical Social Worker', 'Licensed Professional Counselor', 'Marriage and Family Therapist', 'Pastoral Counselor', 'Psychoanalyst']),
  MSW: new Set(['Applied Behavioral Analyst', 'Art Therapist', 'Clinical Social Worker', 'Drug and Alcohol Counselor', 'Licensed Professional Counselor', 'Marriage and Family Therapist']),
  MA: new Set(['Applied Behavioral Analyst', 'Art Therapist', 'Clinical Psychology', 'Clinical Social Worker', 'Drug and Alcohol Counselor', 'Licensed Professional Counselor', 'Marriage and Family Therapist', 'Pastoral Counselor', 'Psychiatric Nurse', 'Psychological Examiner', 'Nurse Practitioner']),
  MS: new Set(['Applied Behavioral Analyst', 'Art Therapist', 'Clinical Psychology', 'Clinical Social Worker', 'Drug and Alcohol Counselor', 'Licensed Professional Counselor', 'Marriage and Family Therapist', 'Pastoral Counselor', 'Psychiatric Nurse', 'Psychological Examiner', 'Nurse Practitioner', 'Physician Assistant']),
  MED: new Set(['Applied Behavioral Analyst', 'Art Therapist', 'Clinical Psychology', 'Clinical Social Worker', 'Drug and Alcohol Counselor', 'Licensed Professional Counselor', 'Marriage and Family Therapist', 'Psychological Examiner']),
  MSN: new Set(['Psychiatric Nurse', 'Nurse Practitioner']),
  DNP: new Set(['Drug and Alcohol Counselor', 'Psychiatric Nurse', 'Nurse Practitioner']),
  BS: new Set(['Physician Assistant']),
};

/** ProviderProfile.ageGroup[] element -> Aetna "ageGroupsDropdown" option. */
export const AETNA_AGE_GROUP_MAP: Record<string, string> = {
  // e.g. adults: 'Adults (Ages 18-64)',
};

/** ProviderProfile.practiceFocus[] element -> Aetna "practiceFocusDropdown" option. */
export const AETNA_PRACTICE_FOCUS_MAP: Record<string, string> = {
  // e.g. anxiety: 'Anxiety Disorders',
};

/**
 * Look a value up in one of the Aetna label maps, or throw a precise,
 * actionable error. The error names the map and the offending value so the
 * fix is "add this one key" — no spelunking.
 */
export function mapOrThrow(
  map: Record<string, string>,
  value: string | null | undefined,
  mapName: string
): string {
  const key = (value ?? '').toString();
  const mapped = key ? map[key] : undefined;
  if (!mapped) {
    throw new Error(
      `unmapped ${mapName} value '${value ?? ''}' — add to ${mapName} in aetna-rfp-resolver.ts`
    );
  }
  return mapped;
}

// Rank for picking the most relevant Education when a provider has several —
// terminal clinical degree wins over a prior bachelors.
const DEGREE_RANK: Record<string, number> = {
  md: 5, do: 5, phd: 5, psyd: 5, dnp: 5,
  msn: 4,
  msw: 3, ma: 3, ms: 3, med: 3,
  bs: 1, ba: 1, other: 0,
};

/** Aetna "#degreeType" label. Prefers the provider's authoritative CAQH degree
 * (`ProviderProfile.degree`, present even when per-school Education rows are
 * absent); else the highest-ranked Education; else a coarse ProviderType map. */
export function resolveDegree(
  providerDegree: string | null | undefined,
  educations: ReadonlyArray<{ degree: string }> | undefined,
  providerType: string
): string {
  const fromProvider = providerDegree ? AETNA_DEGREE_MAP[providerDegree] : undefined;
  if (fromProvider) return fromProvider;
  const top = [...(educations ?? [])].sort(
    (a, b) => (DEGREE_RANK[b.degree] ?? 0) - (DEGREE_RANK[a.degree] ?? 0)
  )[0];
  if (top) return mapOrThrow(AETNA_DEGREE_MAP, top.degree, 'AETNA_DEGREE_MAP');
  return mapOrThrow(PROVIDER_TYPE_DEGREE_FALLBACK, providerType, 'PROVIDER_TYPE_DEGREE_FALLBACK');
}

/** Aetna "#specialty" label from a NUCC taxonomy code via longest-prefix-match. */
export function resolveSpecialty(nuccCode: string | null | undefined): string {
  const code = (nuccCode ?? '').toString();
  let best: { prefix: string; label: string } | null = null;
  if (code) {
    for (const entry of AETNA_SPECIALTY_CROSSWALK) {
      if (code.startsWith(entry.prefix) && (!best || entry.prefix.length > best.prefix.length)) {
        best = entry;
      }
    }
  }
  if (!best) {
    throw new Error(
      `Aetna RFP: no specialty crosswalk for taxonomy '${code || '(missing)'}' — add its NUCC ` +
        `prefix to AETNA_SPECIALTY_CROSSWALK (or this provider isn't behavioral-health).`
    );
  }
  return best.label;
}

/** Reject a (degree, specialty) pair Aetna's form wouldn't allow — catches
 * provider data where the academic degree and the taxonomy disagree. */
export function assertValidPair(degree: string, specialty: string): void {
  if (!AETNA_VALID_PAIRS[degree]?.has(specialty)) {
    throw new Error(
      `Aetna RFP: degree '${degree}' + specialty '${specialty}' is not a valid Aetna ` +
        `combination — check the provider's degree and taxonomy.`
    );
  }
}

// ─── Behavioral-health provider types (all current ProviderType values) ───────
const BH_PROVIDER_TYPES: ReadonlySet<ProviderType> = new Set<ProviderType>([
  'psychiatrist',
  'psychologist',
  'lcsw',
  'lpc',
  'lmft',
  'pmhnp',
]);

// TODO: confirm the exact stored string(s) for sign language in
// ProviderProfile.languages. Until then this best-effort match defaults to
// false (the original hardcoded behavior), so it can only ever turn ASL ON for
// an obvious match — never silently off something that was set.
const SIGN_LANGUAGE_RE = /\b(american sign language|sign language|asl)\b/i;

// ─── US state/territory code -> full official name ────────────────────────────
//
// Practice.state is stored as a 2-letter code (verified on staging: 'CA','OR'),
// but the Aetna RFP wizard selects state by full name ("Kansas"). Deterministic
// reference data — 50 states + DC + the five territories that issue professional
// licenses (PR, VI, GU, AS, MP). Unlike the AETNA_*_MAP tables this is complete
// and not something to extend at runtime, so it is not exported/mutable.
const US_STATE_CODE_TO_NAME: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
  PR: 'Puerto Rico',
  VI: 'U.S. Virgin Islands',
  GU: 'Guam',
  AS: 'American Samoa',
  MP: 'Northern Mariana Islands',
};

/**
 * Convert a stored 2-letter state code to the full name the Aetna form expects.
 * Fail-closed, mirroring mapOrThrow's "throw, never pass through unmapped" rule
 * — but with state-specific messages (a missing state and a malformed code are
 * distinct failures, so this doesn't reuse mapOrThrow directly).
 */
function toFullStateName(code: string | null | undefined): string {
  const trimmed = (code ?? '').trim();
  if (trimmed.length === 0) {
    throw new Error('Practice state missing — required for Aetna RFP');
  }
  const name = US_STATE_CODE_TO_NAME[trimmed.toUpperCase()];
  if (!name) {
    throw new Error(`unrecognized state code '${trimmed}' — not in US_STATE_CODE_TO_NAME`);
  }
  return name;
}

// ─── Loaded-records bundle (passed to the completeness accessors) ─────────────
interface LoadedRecords {
  provider: ProviderProfile & { licenses: License[] };
  practice: Practice;
  practicePayer: PracticePayer;
  config: PayerSubmissionConfig;
  primaryLicense: License | null;
}

/**
 * The shape we expect inside PayerSubmissionConfig.config (Json). Everything is
 * optional here; the resolver enforces what it needs (submitter) explicitly.
 */
interface AetnaRfpConfig {
  submitter?: {
    lastName?: string;
    firstName?: string;
    role?: string;
    email?: string;
    phone?: string;
  };
  aetnaEapParticipation?: boolean;
  payer?: 'Aetna' | 'First Health';
  placeOfService?: 'Office based' | 'Hospital / facility based';
  adaAccessible?: boolean;
}

/**
 * Source-value accessors for the completeness gate, keyed by the dotted names a
 * payer's `requiredFields` may declare. A required field whose key is NOT here
 * is treated as un-verifiable (and therefore reported missing) — fail-closed.
 */
const REQUIRED_FIELD_ACCESSORS: Record<string, (r: LoadedRecords) => unknown> = {
  'provider.firstName': (r) => r.provider.firstName,
  'provider.lastName': (r) => r.provider.lastName,
  'provider.npi': (r) => r.provider.npi,
  'provider.dateOfBirth': (r) => r.provider.dateOfBirth,
  'provider.caqhProviderId': (r) => r.provider.caqhProviderId,
  'provider.providerType': (r) => r.provider.providerType,
  'provider.entityType': (r) => r.provider.entityType,
  'provider.taxonomy': (r) => r.provider.taxonomy,
  'provider.languages': (r) => r.provider.languages,
  'provider.ageGroup': (r) => r.provider.ageGroup,
  'provider.practiceFocus': (r) => r.provider.practiceFocus,
  'license.licenseNumber': (r) => r.primaryLicense?.licenseNumber,
  'license.expirationDate': (r) => r.primaryLicense?.expirationDate,
  'practice.taxIdEncrypted': (r) => r.practice.taxIdEncrypted,
  'practice.legalName': (r) => r.practice.legalName,
  'practice.addressLine1': (r) => r.practice.addressLine1,
  'practice.city': (r) => r.practice.city,
  'practice.state': (r) => r.practice.state,
  'practice.zipCode': (r) => r.practice.zipCode,
  'practice.phone': (r) => r.practice.phone,
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** Format a Date as MM/DD/YYYY (UTC) — the format every Aetna date field wants.
 *  Returns '' for a missing date (e.g. a provider imported without a DOB); the
 *  form's own required-field check handles whether that blank is acceptable. */
function formatMMDDYYYY(d: Date | null | undefined): string {
  if (!d) return '';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/** requiredFields Json -> a flat list of required field keys. */
function normalizeRequiredFields(rf: unknown): string[] {
  if (Array.isArray(rf)) return rf.filter((x): x is string => typeof x === 'string');
  if (rf && typeof rf === 'object') {
    return Object.entries(rf as Record<string, unknown>)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k);
  }
  return [];
}

function deriveLineOfBusiness(p: ProviderProfile): AetnaLineOfBusiness {
  if (BH_PROVIDER_TYPES.has(p.providerType)) return 'BEHAVIORAL_HEALTH';
  // TODO: Medical / Dental / Facility / Pharmacy lines aren't derivable from a
  // providerType of 'other'. Those adapter branches aren't built yet anyway, so
  // fail-closed here rather than guess a line of business.
  throw new Error(
    `Aetna RFP: cannot derive lineOfBusiness from providerType '${p.providerType}' (only behavioral-health provider types are mapped)`
  );
}

function deriveJoining(p: ProviderProfile): AetnaJoining {
  const e = (p.entityType ?? '').toLowerCase();
  if (e === 'individual') return 'INDIVIDUAL_NEW';
  if (e === 'group') return 'GROUP_NEW';
  // EXISTING (already participating with Aetna) is not derivable from our data.
  throw new Error(
    `Aetna RFP: cannot derive joining from entityType '${p.entityType ?? ''}' (expected 'individual' or 'group')`
  );
}

/** Primary license = explicit isPrimary, else first active, else first on file. */
function pickPrimaryLicense(licenses: License[]): License | null {
  return (
    licenses.find((l) => l.isPrimary === true) ??
    licenses.find((l) => l.status === 'active') ??
    licenses[0] ??
    null
  );
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function buildAetnaRfpProviderData(
  ids: { providerId: string; practiceId: string; payerId: string },
  prisma: PrismaClient
): Promise<AetnaRfpProviderData> {
  const { providerId, practiceId, payerId } = ids;

  // 1) LOAD — fetch all four records (+ the provider's licenses). Each missing
  //    record throws an error naming exactly which one.
  const provider = (await prisma.providerProfile.findUnique({
    where: { id: providerId },
    include: { licenses: true, educations: true },
  })) as (ProviderProfile & { licenses: License[]; educations: Education[] }) | null;
  if (!provider) {
    throw new Error(`Aetna RFP: ProviderProfile not found for providerId '${providerId}'`);
  }

  const practice = (await prisma.practice.findUnique({
    where: { id: practiceId },
  })) as Practice | null;
  if (!practice) {
    throw new Error(`Aetna RFP: Practice not found for practiceId '${practiceId}'`);
  }

  const practicePayer = (await prisma.practicePayer.findFirst({
    where: { practiceId, payerId },
  })) as PracticePayer | null;
  if (!practicePayer) {
    throw new Error(
      `Aetna RFP: PracticePayer not found for practiceId '${practiceId}' + payerId '${payerId}'`
    );
  }

  const config = (await prisma.payerSubmissionConfig.findUnique({
    where: { payerId },
  })) as PayerSubmissionConfig | null;
  if (!config) {
    throw new Error(`Aetna RFP: PayerSubmissionConfig not found for payerId '${payerId}'`);
  }

  const primaryLicense = pickPrimaryLicense(provider.licenses ?? []);
  const records: LoadedRecords = { provider, practice, practicePayer, config, primaryLicense };

  // 2) COMPLETENESS GATE (fail-closed) — runs BEFORE any packet construction.

  // 2a) requiredFields must be configured at all.
  const required = normalizeRequiredFields(config.requiredFields);
  if (required.length === 0) {
    throw new Error(
      'Aetna requiredFields not configured — refusing to build packet (fail-closed).'
    );
  }

  // 2b) submitter is required and lives entirely in payer config.
  const cfg = (config.config ?? {}) as AetnaRfpConfig;
  const sub = cfg.submitter;
  const submitterMissing =
    !sub ||
    !isPresent(sub.lastName) ||
    !isPresent(sub.firstName) ||
    !isPresent(sub.role) ||
    !isPresent(sub.email) ||
    !isPresent(sub.phone);
  if (submitterMissing) {
    throw new Error(
      'Aetna RFP submitter not configured in PayerSubmissionConfig.config.submitter (fail-closed).'
    );
  }

  // 2c) every declared required field must be present — report ALL at once.
  const missing: string[] = [];
  for (const key of required) {
    const accessor = REQUIRED_FIELD_ACCESSORS[key];
    if (!accessor) {
      missing.push(`${key} (unrecognized required field)`);
      continue;
    }
    if (!isPresent(accessor(records))) missing.push(key);
  }
  if (missing.length > 0) {
    throw new Error(`Provider not ready for Aetna RFP — missing: [${missing.join(', ')}]`);
  }

  // 3) BUILD — direct mappings. (Past the gate, everything below is present.)

  const lineOfBusiness = deriveLineOfBusiness(provider);
  const joining = deriveJoining(provider);

  // EIN path: Practice tax ID is AES-256-GCM encrypted; decryptSafe is the
  // established helper used everywhere else for this column.
  if (!isPresent(practice.taxIdEncrypted)) {
    throw new Error('Aetna RFP: practice has no tax ID on file (taxIdEncrypted is empty).');
  }
  const taxId = decryptSafe(practice.taxIdEncrypted as string);

  if (!primaryLicense) {
    throw new Error('Aetna RFP: provider has no license on file.');
  }

  // State is stored as a 2-letter code; the adapter selects by full name.
  // Fail-closed here (before packet construction) on missing/malformed codes.
  const stateFullName = toFullStateName(practice.state);

  const aslOffered = (provider.languages ?? []).some((l) => SIGN_LANGUAGE_RE.test(l));

  // Degree and specialty come from independent sources (Education vs the NPI
  // taxonomy CAQH mirrors onto ProviderProfile.taxonomy), so derive both and
  // reject any pair Aetna's form wouldn't allow — fail-closed before footprint.
  const degree = resolveDegree(provider.degree, provider.educations, provider.providerType);
  const primarySpecialty = resolveSpecialty(provider.taxonomy);
  assertValidPair(degree, primarySpecialty);

  // Behavioral-health step — only when the line of business is BH. Every array
  // element goes through mapOrThrow (so ANY unmapped value hard-fails here,
  // before footprint), and ALL mapped values are carried through — the adapter
  // selects each one in the multiselect.
  let behavioralHealth: AetnaRfpProviderData['behavioralHealth'];
  if (lineOfBusiness === 'BEHAVIORAL_HEALTH') {
    behavioralHealth = {
      ageGroup: (provider.ageGroup ?? []).map((v) =>
        mapOrThrow(AETNA_AGE_GROUP_MAP, v, 'AETNA_AGE_GROUP_MAP')
      ),
      practiceFocus: (provider.practiceFocus ?? []).map((v) =>
        mapOrThrow(AETNA_PRACTICE_FOCUS_MAP, v, 'AETNA_PRACTICE_FOCUS_MAP')
      ),
    };
  }

  const packet: AetnaRfpProviderData = {
    // payer is 'Aetna' for this resolver; First Health would be config-driven.
    // TODO: derive 'First Health' from a payer signal if/when we enroll it here.
    payer: cfg.payer ?? 'Aetna',
    lineOfBusiness,
    joining,

    submitter: {
      lastName: sub!.lastName!,
      firstName: sub!.firstName!,
      role: sub!.role!,
      email: sub!.email!,
      phone: sub!.phone!,
    },

    provider: {
      lastName: provider.lastName,
      firstName: provider.firstName,
      npi: provider.npi,
      taxIdType: 'E',
      taxIdName: practice.legalName ?? practice.name,
      taxId,
      caqhId: provider.caqhProviderId ?? '',
      dob: formatMMDDYYYY(provider.dateOfBirth),
      licenseNumber: primaryLicense.licenseNumber,
      licenseExp: formatMMDDYYYY(primaryLicense.expirationDate),
      degree,
      primarySpecialty,
    },

    location: {
      state: stateFullName, // 2-letter code -> full name (toFullStateName above)
      zip: practice.zipCode ?? '',
      street: practice.addressLine1 ?? '',
      city: practice.city ?? '',
      phone: practice.phone ?? '',
      fax: '', // No fax source on Practice.
      // TODO: no per-provider source for these; safe defaults until sourced.
      placeOfService: cfg.placeOfService ?? 'Office based',
      adaAccessible: cfg.adaAccessible ?? false,
    },

    behavioralHealth,

    medicareCertified: provider.acceptingMedicare,
    medicaidCertified: provider.acceptingMedicaid,
    hospitalist: provider.hospitalist,
    aslOffered,
    ePrescribing: provider.ePrescribing,
    aetnaEapParticipation: cfg.aetnaEapParticipation ?? false,

    // telehealth=Yes reveals an unbuilt conditional branch in the adapter, so
    // hardcode false until that path is walked live.
    telehealth: false,
  };

  return packet;
}
