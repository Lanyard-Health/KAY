import type {
  PrismaClient,
  ProviderProfile,
  Practice,
  PracticePayer,
  PayerSubmissionConfig,
  PayerSubmissionDetail,
  Document,
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

// ─── Readiness checklist ──────────────────────────────────────────────────────

export interface AetnaReadinessItem {
  key: string;
  label: string;
  ok: boolean;
  message?: string;
}

export interface AetnaReadiness {
  ready: boolean;
  checklist: AetnaReadinessItem[];
}

type DetailWithW9 = PayerSubmissionDetail & { w9Document: Document | null };

/**
 * Pre-flight readiness check: evaluates a provider against everything the
 * Aetna RFP wizard requires and returns a per-field checklist instead of
 * throwing. `buildAetnaRfpProviderData` remains the fail-closed gate the
 * worker uses; this shares its rules so the UI can show green/missing BEFORE
 * a run is launched (Aetna's network check creates a real footprint).
 */
export async function evaluateAetnaReadiness(
  ids: { providerId: string; practiceId: string; payerId: string },
  prisma: PrismaClient
): Promise<AetnaReadiness> {
  const checklist: AetnaReadinessItem[] = [];
  const push = (key: string, label: string, ok: boolean, message?: string) => {
    checklist.push({ key, label, ok, ...(message ? { message } : {}) });
  };

  const provider = (await prisma.providerProfile.findUnique({
    where: { id: ids.providerId },
    include: { licenses: true, educations: true, payerSubmissionDetail: { include: { w9Document: true } } },
  })) as
    | (ProviderProfile & {
        licenses: License[];
        educations: Education[];
        payerSubmissionDetail: DetailWithW9 | null;
      })
    | null;
  const practice = await prisma.practice.findUnique({ where: { id: ids.practiceId } });
  const practicePayer = await prisma.practicePayer.findFirst({
    where: { practiceId: ids.practiceId, payerId: ids.payerId },
  });
  const config = await prisma.payerSubmissionConfig.findUnique({ where: { payerId: ids.payerId } });

  push('records.provider', 'Provider profile on file', Boolean(provider));
  push('records.practice', 'Practice on file', Boolean(practice));
  push('records.practicePayer', 'Practice is linked to this payer', Boolean(practicePayer));
  push('records.config', 'Payer submission config (AETNA_RFP)', Boolean(config));
  if (!provider || !practice || !practicePayer || !config) {
    return { ready: false, checklist };
  }

  // Line of business — only Behavioral Health is implemented.
  try {
    deriveLineOfBusiness(provider);
    push('lineOfBusiness', 'Line of business supported (Behavioral Health)', true);
  } catch (err) {
    push('lineOfBusiness', 'Line of business supported (Behavioral Health)', false,
      err instanceof Error ? err.message : 'unsupported');
  }
  try {
    deriveJoining(provider);
    push('joining', 'Joining type derivable (individual/group)', true);
  } catch (err) {
    push('joining', 'Joining type derivable (individual/group)', false,
      err instanceof Error ? err.message : 'unknown');
  }

  const primaryLicense = pickPrimaryLicense(provider.licenses ?? []);
  const records: LoadedRecords = { provider, practice, practicePayer, config, primaryLicense };

  // Declared required fields.
  const required = normalizeRequiredFields(config.requiredFields);
  push('config.requiredFields', 'Required-fields list configured', required.length > 0,
    required.length === 0 ? 'Aetna requiredFields not configured on PayerSubmissionConfig' : undefined);
  for (const key of required) {
    const accessor = REQUIRED_FIELD_ACCESSORS[key];
    if (!accessor) {
      push(key, key, false, 'unrecognized required field');
      continue;
    }
    push(key, key, isPresent(accessor(records)));
  }

  // Submitter — payer-submission details override, else payer config.
  const detail = provider.payerSubmissionDetail;
  const cfg = (config.config ?? {}) as AetnaRfpConfig;
  const submitter = resolveSubmitter(detail, cfg);
  push('submitter', 'Submitter contact (name, role, email, phone)', Boolean(submitter),
    submitter ? undefined : 'Fill the submitter fields in Payer Submission Details (or payer config)');

  // Degree/specialty pair.
  try {
    const degree = resolveDegree(provider.degree, provider.educations, provider.providerType);
    const specialty = resolveSpecialty(provider.taxonomy);
    assertValidPair(degree, specialty);
    push('degreeSpecialty', `Degree + specialty valid for Aetna`, true);
  } catch (err) {
    push('degreeSpecialty', 'Degree + specialty valid for Aetna', false,
      err instanceof Error ? err.message : 'invalid');
  }

  // State code.
  try {
    toFullStateName(practice.state);
    push('practice.stateMappable', 'Practice state recognized', true);
  } catch (err) {
    push('practice.stateMappable', 'Practice state recognized', false,
      err instanceof Error ? err.message : 'invalid');
  }

  push('license', 'Active license on file', Boolean(primaryLicense));

  // BH multiselects — exact Aetna labels from details, else mapped values.
  try {
    resolveBhLists(provider, detail);
    push('behavioralHealth', 'Age groups + practice focus (Aetna labels)', true);
  } catch (err) {
    push('behavioralHealth', 'Age groups + practice focus (Aetna labels)', false,
      err instanceof Error ? err.message : 'unmapped');
  }

  // Payer submission details block.
  push('payerSubmissionDetail', 'Payer Submission Details filled in', Boolean(detail),
    detail ? undefined : "Open the provider's Payer Submission Details section and complete it");
  if (detail) {
    if (detail.telehealth) {
      const t = resolveTelehealth(detail);
      push('telehealth', 'Telehealth branch complete (services, methods, types, HIPAA attested)',
        t.ok, t.ok ? undefined : t.message);
    } else {
      push('telehealth', 'Telehealth: not participating (branch not required)', true);
    }
    push('w9', 'W9 document attached', Boolean(detail.w9Document),
      detail.w9Document ? undefined : 'Upload a W9 document and select it in Payer Submission Details');
  }

  return { ready: checklist.every((c) => c.ok), checklist };
}

function resolveSubmitter(
  detail: PayerSubmissionDetail | null | undefined,
  cfg: AetnaRfpConfig
): { lastName: string; firstName: string; role: string; email: string; phone: string } | null {
  if (
    detail &&
    isPresent(detail.submitterFirstName) &&
    isPresent(detail.submitterLastName) &&
    isPresent(detail.submitterRole) &&
    isPresent(detail.submitterEmail) &&
    isPresent(detail.submitterPhone)
  ) {
    return {
      firstName: detail.submitterFirstName!,
      lastName: detail.submitterLastName!,
      role: detail.submitterRole!,
      email: detail.submitterEmail!,
      phone: detail.submitterPhone!,
    };
  }
  const sub = cfg.submitter;
  if (
    sub &&
    isPresent(sub.lastName) &&
    isPresent(sub.firstName) &&
    isPresent(sub.role) &&
    isPresent(sub.email) &&
    isPresent(sub.phone)
  ) {
    return {
      lastName: sub.lastName!,
      firstName: sub.firstName!,
      role: sub.role!,
      email: sub.email!,
      phone: sub.phone!,
    };
  }
  return null;
}

/** Telehealth branch completeness — the adapter needs all four pieces. */
function resolveTelehealth(detail: PayerSubmissionDetail): { ok: boolean; message?: string } {
  const missing: string[] = [];
  if (!isPresent(detail.telehealthServices)) missing.push('services provided (e.g. "Hybrid services")');
  if ((detail.telehealthMethods ?? []).length === 0) missing.push('service methods');
  if ((detail.telehealthTypes ?? []).length === 0) missing.push('service types');
  if (!detail.telehealthHipaaAttested) missing.push('HIPAA-compliant-platform attestation');
  return missing.length === 0
    ? { ok: true }
    : { ok: false, message: `telehealth=Yes but missing: ${missing.join(', ')}` };
}

/** BH age-group/practice-focus lists: PayerSubmissionDetail stores the exact
 * Aetna option labels; when absent fall back to mapping the clinical-profile
 * values through the (fail-closed) label maps. */
function resolveBhLists(
  provider: ProviderProfile,
  detail: PayerSubmissionDetail | null | undefined
): { ageGroup: string[]; practiceFocus: string[] } {
  const ageGroup =
    detail && (detail.bhAgeGroups ?? []).length > 0
      ? detail.bhAgeGroups
      : (provider.ageGroup ?? []).map((v) => mapOrThrow(AETNA_AGE_GROUP_MAP, v, 'AETNA_AGE_GROUP_MAP'));
  const practiceFocus =
    detail && (detail.bhPracticeFocus ?? []).length > 0
      ? detail.bhPracticeFocus
      : (provider.practiceFocus ?? []).map((v) =>
          mapOrThrow(AETNA_PRACTICE_FOCUS_MAP, v, 'AETNA_PRACTICE_FOCUS_MAP')
        );
  return { ageGroup, practiceFocus };
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
    include: {
      licenses: true,
      educations: true,
      payerSubmissionDetail: { include: { w9Document: true } },
    },
  })) as
    | (ProviderProfile & {
        licenses: License[];
        educations: Education[];
        payerSubmissionDetail?: DetailWithW9 | null;
      })
    | null;
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

  // 2b) submitter is required — from PayerSubmissionDetail, else payer config.
  const cfg = (config.config ?? {}) as AetnaRfpConfig;
  const detail = provider.payerSubmissionDetail ?? null;
  const submitter = resolveSubmitter(detail, cfg);
  if (!submitter) {
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
    behavioralHealth = resolveBhLists(provider, detail);
  }

  // Telehealth — from PayerSubmissionDetail; fail-closed on an incomplete
  // branch (the adapter would otherwise break mid-run AFTER the footprint).
  const telehealth = detail?.telehealth ?? false;
  let telehealthDetail: AetnaRfpProviderData['telehealthDetail'];
  if (telehealth) {
    const t = resolveTelehealth(detail!);
    if (!t.ok) throw new Error(`Aetna RFP: ${t.message}`);
    telehealthDetail = {
      services: detail!.telehealthServices!,
      methods: detail!.telehealthMethods,
      types: detail!.telehealthTypes,
      hipaaAttested: detail!.telehealthHipaaAttested,
    };
  }

  const packet: AetnaRfpProviderData = {
    // payer is 'Aetna' for this resolver; First Health would be config-driven.
    // TODO: derive 'First Health' from a payer signal if/when we enroll it here.
    payer: cfg.payer ?? 'Aetna',
    lineOfBusiness,
    joining,

    submitter,

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
      fax: detail?.fax ?? provider.fax ?? '',
      placeOfService:
        (detail?.placeOfService as 'Office based' | 'Hospital / facility based' | null) ??
        cfg.placeOfService ??
        'Office based',
      adaAccessible: detail ? detail.adaAccessible : cfg.adaAccessible ?? false,
      ...(detail?.accessAccommodations ? { accessAccommodations: detail.accessAccommodations } : {}),
      ...(detail && detail.staffLanguages.length > 0 ? { staffLanguages: detail.staffLanguages } : {}),
      ...(detail && detail.interpreterLanguages.length > 0
        ? { interpreterLanguages: detail.interpreterLanguages }
        : {}),
      ...(detail ? { facilityFee: detail.facilityFee } : {}),
    },

    behavioralHealth,

    medicareCertified: detail?.medicareCertified ?? provider.acceptingMedicare,
    medicaidCertified: detail?.medicaidCertified ?? provider.acceptingMedicaid,
    hospitalist: provider.hospitalist,
    aslOffered: aslOffered || (detail?.aslOffered ?? false),
    ePrescribing: provider.ePrescribing,
    aetnaEapParticipation: detail?.eapParticipation ?? cfg.aetnaEapParticipation ?? false,

    telehealth,
    ...(telehealthDetail ? { telehealthDetail } : {}),
    ...(detail?.medicarePtan ? { medicarePtan: detail.medicarePtan } : {}),
    ...(detail?.w9Document
      ? { w9: { s3Key: detail.w9Document.s3Key, fileName: detail.w9Document.fileName } }
      : {}),
    ...(detail
      ? {
          hospitalAdmittingPrivileges: detail.hospitalAdmittingPrivileges,
          facilityAdmittingPrivileges: detail.facilityAdmittingPrivileges,
        }
      : {}),
    ...(detail && detail.providerLanguages.length > 0
      ? { providerLanguages: detail.providerLanguages }
      : provider.languages && provider.languages.length > 0
        ? { providerLanguages: provider.languages }
        : {}),
  };

  return packet;
}
