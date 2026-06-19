import { prisma } from '../utils/prisma.js';
import { Prisma } from '@prisma/client';
import type { LicenseType, BoardType, DegreeType, CoverageType, Gender, IdentifierType, AddressType, CredentialStatus, ProviderType, EducationType, ProviderCertificationType, DisclosureCategory, ClaimStatus, PrivilegeType, AffiliationStatus } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { encryptSafe, decryptSafe } from '../utils/crypto.js';
import { encryptMirrorPayload } from './caqh-mirror.service.js';
import { z } from 'zod';

export interface CaqhRosterResponse {
  caqhProviderId: string;
  status: string;
  /** Per spec Table 38: practitioner lifecycle status (e.g. "New Provider", "Initial Outreach"). */
  providerStatus?: string | null;
  /** Per spec: Y if practitioner has authorized this organization to view their data; N otherwise. */
  authorizationFlag?: 'Y' | 'N' | null;
  /** Non-fatal warnings from `exception_description` — request succeeded but with caveats. */
  warnings?: string[];
}

export interface CaqhStatusResponse {
  organization_id?: string;
  caqh_provider_id?: string;
  roster_status?: 'ACTIVE' | 'NOT ON ROSTER';
  authorization_flag?: 'Y' | 'N';
  provider_status?: string;
  provider_status_date?: string; // YYYYMMDD format
  provider_practice_state?: string;
  anniversary_date?: string; // YYYYMMDD format
  provider_found_flag?: 'Y' | 'N';
}

export interface CaqhDocumentInfo {
  DocumentTypeName: string;
  StateIdName?: string | null;
  ExpirationDate?: string | null;
  DocumentStatusName: 'Approved' | 'Ready for Review' | 'Expired';
  DocumentURL: string;
}

export interface CaqhDownloadResult {
  data: Buffer;
  contentType: string;
  fileName?: string;
}

/**
 * Real CAQH Credentialing API v8 response shape.
 * XML-parsed root `<Provider>` becomes `{ Provider: {...} }` in JSON.
 * All nested field names are PascalCase.
 *
 * Field presence varies per provider — all marked optional for safety.
 * Source: captured payload from POID 6279 / CAQH ID 16174500 (2026-04-21)
 * plus v8-only additions documented in the CAQH API Data Dictionary.
 */
export interface CaqhV8Response {
  Provider?: CaqhV8Provider;
}

export interface CaqhV8Provider {
  // Core identity
  ID?: string | number;
  NPI?: string | number;
  SSN?: string | number;
  ProviderFirstName?: string;
  ProviderLastName?: string;
  ProviderMiddleName?: string;
  ProviderSuffix?: string;
  FirstName?: string; // some payloads omit the `Provider` prefix
  LastName?: string;
  MiddleName?: string;
  ProviderDateOfBirth?: string;
  DateOfBirth?: string;
  BirthDate?: string;
  ProviderGender?: string;
  Gender?: string;
  ProviderEmail?: string;
  Email?: string;
  EmailAddress?: string;
  ProviderPhone?: string;
  Phone?: string;

  // V8 additions
  ProviderAttestID?: string | number;
  PrimaryPracticeState?: string;
  OtherPracticeState?: string;
  EthnicityDescription?: string;
  HospitalBasedFlag?: string | boolean;
  HospitalPrivilegeFlag?: string | boolean;
  FellowshipTrainingFlag?: string | boolean;
  SecondarySpecialtyFlag?: string | boolean;
  ActiveMilitaryFlag?: string | boolean;
  WorkHistoryGapFlag?: string | boolean;
  MedicareProviderFlag?: string | boolean;
  MedicaidProviderFlag?: string | boolean;

  // Nested sections (detail handling deferred to Phases 2+)
  ProviderAddress?: CaqhV8Address | CaqhV8Address[];
  ProviderIdentifier?: CaqhV8Identifier | CaqhV8Identifier[];
  ProviderLicense?: CaqhV8License | CaqhV8License[];
  ProviderCertification?: CaqhV8Certification | CaqhV8Certification[];
  Specialty?: CaqhV8Specialty | CaqhV8Specialty[];
  Education?: CaqhV8Education | CaqhV8Education[];
  Insurance?: CaqhV8Insurance | CaqhV8Insurance[];
  ProviderCDS?: CaqhV8CDS | CaqhV8CDS[];
  // v9 sections wired in Phase 2 (full coverage)
  Hospital?: CaqhV8Hospital | CaqhV8Hospital[];
  WorkHistory?: CaqhV8WorkHistoryEntry | CaqhV8WorkHistoryEntry[];
  TimeGap?: CaqhV8TimeGap | CaqhV8TimeGap[];
  Disclosure?: CaqhV8Disclosure | CaqhV8Disclosure[];
  Practice?: CaqhV8Practice | CaqhV8Practice[];

  // Catch-all for as-yet-unmapped sections; we preserve raw JSON in the mirror
  [key: string]: unknown;
}

/**
 * CAQH v9 Hospital element (top-level, repeated). Represents one
 * hospital affiliation record. AHAHospitalID is the AHA-assigned dedup
 * key; HospitalRecordType distinguishes "Admitting Privilege Record"
 * vs "Admitting Arrangement Record" vs "Non-Admitting Affiliation
 * Record". When the provider relies on someone else to admit
 * patients, WhoAdmitsForyou (note casing — CAQH spelling) plus
 * top-level FirstName/LastName describe the admitter.
 */
export interface CaqhV8Hospital {
  ID?: string | number;
  AHAHospitalID?: string | number;
  HospitalName?: string;
  Address?: string;
  City?: string;
  State?: string;
  ZipCode?: string;
  PhoneNumber?: string;
  FaxNumber?: string;
  UnrestrictedPrivilegesFlag?: string | number | boolean;
  TemporaryPrivilegesFlag?: string | number | boolean;
  PrivilegeDescription?: string;
  AdmissionPercent?: string | number;
  StartDate?: string;
  EndDate?: string;
  StaffCategory?: string;
  HospitalRecordType?: string;
  HospitalAffiliationType?:
    | string
    | { HospitalAffiliationTypeDescription?: string }
    | unknown;
  ReasonForDiscontinuance?: string;
  ExitExplanation?: string;
  Description?: string;
  Country?: string | { CountryName?: string } | unknown;
  Department?: string;
  // Admitting-relationship sub-fields (when not self-admitting)
  WhoAdmitsForyou?: string;
  WhoAdmitsForYou?: string; // tolerate alternate casing
  FirstName?: string;
  LastName?: string;
  AdmittingContactPhoneNumber?: string;
  AdmittingContactEmailAddress?: string;
  IsProviderSpecialtySameAsYourSpecialty?: string | number | boolean;
  [key: string]: unknown;
}

/**
 * CAQH v9 WorkHistory element. Each repeated entry is one employment
 * record. Sample payloads include EmployerName + dates + address +
 * CurrentEmployerFlag at minimum; Position / Department / Phone /
 * SupervisorName are optional and not always present.
 */
export interface CaqhV8WorkHistoryEntry {
  ID?: string | number;
  EmployerName?: string;
  StartDate?: string;
  EndDate?: string;
  Address?: string;
  City?: string;
  State?: string;
  PostalCode?: string | number;
  ZipCode?: string;
  PhoneNumber?: string;
  FaxNumber?: string;
  EmailAddress?: string;
  CurrentEmployerFlag?: string | number | boolean;
  StatusDescription?: string;
  WorkHistoryType?: string | { WorkHistoryTypeDescription?: string } | unknown;
  Country?: string | { CountryName?: string } | unknown;
  Position?: string;
  Department?: string;
  ReasonForLeaving?: string;
  SupervisorName?: string;
  SupervisorPhone?: string;
  [key: string]: unknown;
}

/**
 * CAQH v9 TimeGap element — gap in employment timeline. Distinct
 * top-level repeated section (not nested inside WorkHistory).
 */
export interface CaqhV8TimeGap {
  ID?: string | number;
  StartDate?: string;
  EndDate?: string;
  GapExplanation?: string;
  GapDescription?: string;
  [key: string]: unknown;
}

/**
 * CAQH v9 Disclosure element. Each repeated entry is one yes/no
 * attestation question keyed by `ID` (21000–21220). For ID 21150
 * ("Had any Malpractice Actions"), the body contains a nested
 * Malpractice element with full claim details — the disclosure mapper
 * routes that nested record into the malpractice-claim writer rather
 * than persisting a duplicate ProviderDisclosure row.
 */
export interface CaqhV8Disclosure {
  ID?: string | number;
  DisclosureAnswerFlag?: string | number | boolean;
  DisclosureExplanation?: string;
  DisclosureQuestion?: { DisclosureSummary?: string } | unknown;
  Malpractice?: CaqhV8MalpracticeClaim | CaqhV8MalpracticeClaim[];
  [key: string]: unknown;
}

/**
 * CAQH v9 Malpractice element. Lives nested inside Disclosure ID 21150.
 * NOT to be confused with `Insurance` (PLI coverage) — this is a
 * litigation/claim record. ClaimStatus is itself a nested element that
 * carries the settlement date + amounts.
 */
export interface CaqhV8MalpracticeClaim {
  ID?: string | number;
  InsuranceCarrierName?: string;
  OccurrenceDate?: string;
  ClaimDate?: string;
  Address?: string;
  Address2?: string;
  City?: string;
  State?: string;
  Zip?: string;
  Province?: string;
  PhoneNumber?: string;
  PolicyNumber?: string;
  AllegationDescription?: string;
  PrimaryDefendantFlag?: string | number | boolean;
  NumberOtherCodefendant?: string | number;
  CaseInvolvement?: string;
  PatientInjuryDescription?: string;
  NPDBCaseFlag?: string | number | boolean;
  PatientDiedFlag?: string | number | boolean;
  MalpracticeResolution?:
    | { MalpracticeResolutionMethod?: string }
    | unknown;
  Country?: string | { CountryName?: string } | unknown;
  ClaimStatus?:
    | {
        ClaimStatus?: string;
        ClaimSettlementDate?: string;
        SettlementAmount?: string | number;
        SettlementAmountPaid?: string | number;
      }
    | unknown;
  [key: string]: unknown;
}

/**
 * CAQH v9 Practice element (top-level, repeated). Carries practice
 * location identity plus per-practice supervisor fields. The
 * supervisor block was added in v9.0 — `SupervisorName` is one full
 * string, parsed into first/last at mapping time.
 */
export interface CaqhV8Practice {
  ID?: string | number;
  PracticeName?: string;
  // Top-level supervisor fields (v9.0)
  SupervisorName?: string;
  SupervisorNPI?: string | number;
  SupervisorCAQHId?: string | number;
  // Address (used to auto-link to existing PracticeLocation rows)
  Address?: string;
  AddressLine1?: string;
  City?: string;
  State?: string;
  ZipCode?: string;
  PostalCode?: string | number;
  [key: string]: unknown;
}

export interface CaqhV8Address {
  AddressType?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  Address?: string;  // v8 uses this in place of AddressLine1
  City?: string;
  State?: string;
  ZipCode?: string;
  PostalCode?: string | number;
  EmailAddress?: string;
  Country?: string;
  [key: string]: unknown;
}

export interface CaqhV8Identifier {
  IdentifierType?: string;
  IdentifierValue?: string | number;
  IssuingEntity?: string;
  State?: string;
  EffectiveDate?: string;
  ExpirationDate?: string;
  [key: string]: unknown;
}

/**
 * CAQH v8 ProviderCertification element (life-support / vocational certifications like BLS, ACLS, CPR).
 * NOT to be confused with medical board certifications (those live in the `Specialty` section).
 * Only records with CertificationFlag=1 should be imported.
 */
export interface CaqhV8Certification {
  ID?: string | number;
  CertificationFlag?: string | number | boolean;
  CertificationDescription?: string;
  ExpirationDate?: string;
  IssueDate?: string;
  [key: string]: unknown;
}

/**
 * CAQH v8 Specialty element — one entry per specialty the provider practices.
 * Holds BOTH the specialty reference (NUCC taxonomy) AND medical board
 * certification fields. Only entries with BoardCertifiedFlag=1 yield a
 * board_certifications row; taxonomy mapping is handled in Phase 2d.
 */
export interface CaqhV8Specialty {
  ID?: string | number;
  // Real payloads nest the specialty name as `{ Specialty: { SpecialtyName: "..." } }`.
  // Some payloads may flatten it to `SpecialtyName` at this level — both handled.
  Specialty?: { SpecialtyName?: string | unknown } | unknown;
  SpecialtyName?: string | { SpecialtyNameDescription?: string } | unknown;
  // SpecialtyType uses the coded-lookup pattern `{ SpecialtyTypeDescription: "Primary" }`.
  SpecialtyType?: string | { SpecialtyTypeDescription?: string } | unknown;
  NUCCTaxonomyCode?: string | number;
  BoardCertifiedFlag?: string | number | boolean;
  SpecialtyBoardName?: string | { SpecialtyBoardNameDescription?: string } | unknown;
  CertificationNumber?: string | number;
  CertificationDate?: string;
  RecertificationDate?: string;
  BoardCertificationExpiresFlag?: string | number | boolean;
  BoardCertificationExpirationDate?: string;
  [key: string]: unknown;
}

/**
 * CAQH v8 ProviderLicense element.
 * LicenseType may be absent (observed in real payloads). LicenseNumber can be numeric.
 * LicenseStatus is typically nested: `{LicenseStatusDescription: "Active"}`.
 */
export interface CaqhV8License {
  ID?: string | number;
  LicenseType?: string | { LicenseTypeDescription?: string } | unknown;
  LicenseNumber?: string | number;
  State?: string;
  LicenseState?: string;
  IssueDate?: string;
  ExpirationDate?: string;
  LicenseStatus?: string | { LicenseStatusDescription?: string } | unknown;
  CurrentlyPracticingFlag?: string | number | boolean;
  IsPrimary?: string | number | boolean;
  IssuingAuthority?: string;
  [key: string]: unknown;
}

/**
 * CAQH v8 Education element. Per real payload: 12 fields per record including
 * institution + location + program flag. Field shapes vary; defensive optional.
 */
export interface CaqhV8Education {
  ID?: string | number;
  InstitutionName?: string;
  Institution?: string;
  Degree?: string | { DegreeDescription?: string } | unknown;
  DegreeType?: string | { DegreeTypeDescription?: string } | unknown;
  // Per data dictionary, education programs are typed (e.g., MEDICAL_SCHOOL, RESIDENCY).
  EducationType?: string | { EducationTypeDescription?: string } | unknown;
  ProgramType?: string | { ProgramTypeDescription?: string } | unknown;
  GraduationDate?: string;
  StartDate?: string;
  EndDate?: string;
  // Location
  AddressLine1?: string;
  Address?: string;
  City?: string;
  State?: string;
  Country?: string;
  PostalCode?: string | number;
  ZipCode?: string;
  [key: string]: unknown;
}

/**
 * CAQH v8 ProviderCDS element. State-level Controlled Dangerous Substance number.
 * `CDSNumber` is encrypted at persistence time per HIPAA PII rule #8.
 */
export interface CaqhV8CDS {
  CDSNumber?: string | number;
  Number?: string | number;
  State?: string;
  ExpirationDate?: string;
  IssueDate?: string;
  EffectiveDate?: string;
  [key: string]: unknown;
}

/**
 * CAQH v8 CoveredPractice element. Each entry indicates a practice location
 * covered by the malpractice policy. Auto-matched to PracticeLocation rows
 * by exact name or normalized address (line1+state+zip).
 */
export interface CaqhV8CoveredPractice {
  PracticeName?: string;
  Name?: string;
  PracticeID?: string | number;
  ID?: string | number;
  AddressLine1?: string;
  Address?: string;
  City?: string;
  State?: string;
  ZipCode?: string;
  PostalCode?: string | number;
  [key: string]: unknown;
}

/**
 * CAQH v8 Insurance element (malpractice). 14 fields in real payload — carrier,
 * policy, coverage amounts, self-insured/unlimited flags, and CoveredPractices
 * array linking to PracticeLocation rows.
 */
export interface CaqhV8Insurance {
  ID?: string | number;
  CarrierName?: string;
  PolicyNumber?: string;
  EffectiveDate?: string;
  ExpirationDate?: string;
  CoverageType?: string | { CoverageTypeDescription?: string } | unknown;
  PerClaimAmount?: string | number;
  AggregateAmount?: string | number;
  PerOccurrenceAmount?: string | number;
  IsSelfInsured?: string | boolean | number;
  SelfInsuredFlag?: string | boolean | number;
  HasUnlimitedCoverage?: string | boolean | number;
  UnlimitedCoverageFlag?: string | boolean | number;
  IsIndividualCoverage?: string | boolean | number;
  IndividualCoverageFlag?: string | boolean | number;
  CoveredPractices?: CaqhV8CoveredPractice | CaqhV8CoveredPractice[] | { CoveredPractice?: CaqhV8CoveredPractice | CaqhV8CoveredPractice[] };
  [key: string]: unknown;
}

/** @deprecated — legacy camelCase shape kept for backward compatibility during phased rollout */
export interface CaqhCredentialsResponse {
  provider: {
    firstName: string;
    lastName: string;
    npi: string;
  };
  licenses: Array<{
    type: string;
    number: string;
    state: string;
    expirationDate: string;
  }>;
  certifications: Array<{
    board: string;
    specialty: string;
    expirationDate?: string;
  }>;
  education: Array<{
    institution: string;
    degree: string;
    graduationDate: string;
  }>;
  malpractice?: {
    carrier: string;
    policyNumber: string;
    expirationDate: string;
    coverageAmount: number;
  };
}

export interface MappedProviderCore {
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  // Primary professional degree, from CAQH's top-level <Degree> element.
  degree?: DegreeType;
  npi: string;
  ssn?: string;               // plaintext — caller encrypts before persist
  dateOfBirth?: Date;
  gender?: Gender;
  email?: string;
  phone?: string;
  ethnicity?: string;
  primaryPracticeState?: string;
  otherPracticeState?: string;
  // Phase 0 flags
  hospitalBasedFlag?: boolean;
  hospitalPrivilegeFlag?: boolean;
  fellowshipTrainingFlag?: boolean;
  secondarySpecialtyFlag?: boolean;
  activeMilitaryFlag?: boolean;
  workHistoryGapFlag?: boolean;
  acceptingMedicare?: boolean;
  acceptingMedicaid?: boolean;
}

export interface MappedProviderAddress {
  type: AddressType;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zipCode: string;
  country?: string;
}

export interface MappedProviderIdentifier {
  identifierType: IdentifierType;
  identifierValue: string;
  issuingEntity?: string;
  state?: string;
  effectiveDate?: Date;
  expirationDate?: Date;
  notes?: string;
}

export interface MappedSpecialty {
  name: string;
  nuccTaxonomyCode?: string;
  isPrimary: boolean;
  caqhSpecialtyId?: string;
}

export interface MappedCaqhData {
  provider: MappedProviderCore;
  addresses: MappedProviderAddress[];
  identifiers: MappedProviderIdentifier[];
  licenses: Array<{
    licenseType: LicenseType;
    licenseNumber: string;
    state: string;
    expirationDate: Date;
    issueDate?: Date;
    caqhLicenseId?: string;
    isPrimary?: boolean;
    currentlyPracticing?: boolean;
    status?: CredentialStatus;
    issuingAuthority?: string;
  }>;
  certifications: Array<{
    boardType: BoardType;
    boardName: string;
    specialty: string;
    expirationDate?: Date;
    initialCertificationDate?: Date;
    caqhSpecialtyId?: string;
    certificationNumber?: string;
    nuccTaxonomyCode?: string;
    isBoardCertified?: boolean;
  }>;
  specialties?: MappedSpecialty[];
  education: Array<{
    institutionName: string;
    degree: DegreeType;
    graduationDate?: Date;
    fieldOfStudy?: string;
    country?: string;
    educationType?: EducationType;
    startDate?: Date;
    endDate?: Date;
    city?: string;
    state?: string;
    postalCode?: string;
    addressLine1?: string;
  }>;
  malpractice: Array<{
    carrierName: string;
    policyNumber: string;
    expirationDate: string;
    perClaimAmount?: number;
    aggregateAmount?: number;
    coverageType?: CoverageType;
    effectiveDate?: string;
    isSelfInsured?: boolean;
    hasUnlimitedCoverage?: boolean;
    isIndividualCoverage?: boolean;
    coveredPractices?: Array<{
      rawLabel?: string;
      addressLine1?: string;
      city?: string;
      state?: string;
      zipCode?: string;
    }>;
  }>;
  /**
   * Life-support certs (ACLS, BLS, CPR, PALS) destined for the new
   * `ProviderCertification` table. Same source as the entries in
   * `identifiers` (mapV8LifeSupportCert) — dual-write keeps backwards
   * compatibility while the new table is populated.
   */
  providerCertifications?: Array<{
    caqhCertificationId?: string;
    certDescription: string;
    expirationDate?: Date;
    issueDate?: Date;
  }>;
  /** State-level Controlled Dangerous Substance registrations (CAQH `Provider.ProviderCDS`). */
  cdsRegistrations?: Array<{
    cdsNumber: string;       // plaintext — caller encrypts before persist
    state: string;
    expirationDate?: Date;
    issueDate?: Date;
  }>;
  /**
   * Yes/no attestation disclosures from CAQH `Disclosure` elements
   * (questions 21000–21220). Question 21150 ("Had any Malpractice
   * Actions") is excluded here — the mapper routes its nested
   * Malpractice element into `malpracticeClaims` instead of
   * persisting a duplicate disclosure row.
   */
  disclosures?: Array<{
    caqhQuestionId: string;
    questionText: string;
    answer: boolean;
    explanation?: string;
    category: DisclosureCategory;
  }>;
  /**
   * Malpractice claim history (CAQH `Disclosure[ID=21150].Malpractice`)
   * — distinct from current PLI insurance coverage in `malpractice`.
   */
  malpracticeClaims?: Array<{
    caqhClaimId?: string;
    insuranceCarrier?: string;
    dateOfIncident?: Date;
    dateOfClaim?: Date;
    dateResolved?: Date;
    claimStatus: ClaimStatus;
    description: string;
    settlementAmount?: number;
    settlementAmountPaid?: number;
    policyNumber?: string;
    allegationDescription?: string;
    patientInjuryDescription?: string;
    isLeadDefendant?: boolean;
    numberOtherCodefendants?: number;
    caseInvolvement?: string;
    npdbReported?: boolean;
    patientDied?: boolean;
    resolutionMethod?: string;
    courtAddressLine1?: string;
    courtCity?: string;
    courtState?: string;
    courtZipCode?: string;
    courtPhone?: string;
    courtCountry?: string;
  }>;
  /** Hospital affiliations from CAQH `Hospital` elements. */
  hospitalAffiliations?: Array<{
    caqhAhaId?: string;
    facilityName: string;
    privilegeType: PrivilegeType;
    status: AffiliationStatus;
    addressLine1?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
    phoneNumber?: string;
    faxNumber?: string;
    department?: string;
    startDate?: Date;
    endDate?: Date;
    hasUnrestrictedPrivileges?: boolean;
    hasTemporaryPrivileges?: boolean;
    privilegeDescription?: string;
    admissionPercent?: number;
    staffCategory?: string;
    hospitalRecordType?: string;
    hospitalAffiliationType?: string;
    reasonForDiscontinuance?: string;
    exitExplanation?: string;
    description?: string;
    whoAdmitsForYou?: string;
    admittingProviderFirstName?: string;
    admittingProviderLastName?: string;
    admittingContactPhone?: string;
    admittingContactEmail?: string;
    isAdmitterSameSpecialty?: boolean;
  }>;
  /** Employment history detail rows from CAQH `WorkHistory` elements. */
  workHistory?: Array<{
    caqhWorkHistoryId?: string;
    organizationName: string;
    addressLine1?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
    phone?: string;
    fax?: string;
    email?: string;
    startDate?: Date;
    endDate?: Date;
    isCurrent: boolean;
    currentEmployerFlag?: boolean;
    statusDescription?: string;
    workHistoryType?: string;
    position?: string;
    department?: string;
    reasonForLeaving?: string;
    supervisorName?: string;
    supervisorPhone?: string;
  }>;
  /** Employment-timeline gap rows from CAQH `TimeGap` elements. */
  workHistoryGaps?: Array<{
    caqhGapId?: string;
    startDate: Date;
    endDate: Date;
    gapExplanation?: string;
    gapDescription?: string;
  }>;
  /**
   * Per-practice supervisor identity from CAQH `Practice.Supervisor*`
   * fields (v9.0). At persistence time the writer auto-links
   * `practiceLocationId` to an existing `PracticeLocation` row by name
   * or address; if no match is found the row stays with
   * practiceLocationId=null and the writer logs the unmatched key.
   */
  practiceSupervisors?: Array<{
    supervisorFirstName: string;
    supervisorLastName: string;
    supervisorNpi?: string;
    caqhSupervisorId?: string;
    caqhPracticeId?: string;
    practiceName?: string;
    practiceAddressLine1?: string;
    practiceCity?: string;
    practiceState?: string;
    practiceZipCode?: string;
  }>;
}

/** Coerce various CAQH value shapes to an optional trimmed string. */
function toOptString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // fast-xml-parser emits `{'#text': 'value'}` for elements with attributes.
  // CAQH v8 uses `{XxxDescription: 'value'}` for coded-lookup fields
  //   (AddressType, IdentifierType, etc.).
  // Also handle CAQH `{string: {'#text': 'value'}}` wrappers seen in probes.
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj['#text'] === 'string' || typeof obj['#text'] === 'number') {
      return toOptString(obj['#text']);
    }
    if (obj['string'] != null) {
      return toOptString(obj['string']);
    }
    // CAQH coded-lookup pattern: `{<Field>Description: <value>}`
    const keys = Object.keys(obj);
    const descKey = keys.find(k => k.endsWith('Description'));
    if (descKey) {
      // eslint-disable-next-line security/detect-object-injection -- key is from object's own keys
      return toOptString(obj[descKey]);
    }
    // CAQH also codes some lookups as `{<Field>Abbreviation: <value>}`
    // (DegreeAbbreviation, ProviderTypeAbbreviation, …). Prefer Description above.
    const abbrKey = keys.find(k => k.endsWith('Abbreviation'));
    if (abbrKey) {
      // eslint-disable-next-line security/detect-object-injection -- key is from object's own keys
      return toOptString(obj[abbrKey]);
    }
  }
  return undefined;
}

/**
 * CAQH "Degree (Extract)" code → internal DegreeType. Verified against
 * Domain_Table_Effective_07142025.xlsx (sheet "Degree"). Only codes with a
 * clean DegreeType equivalent are listed; everything else → 'other'. Keyed by
 * UPPERCASE code (mapDegreeType uppercases its input).
 */
const CAQH_DEGREE_CODE_TO_TYPE = new Map<string, DegreeType>([
  ['MD', 'md'],
  ['DO', 'do'],
  ['PHD', 'phd'],
  ['PSYD', 'psyd'],
  ['MSW', 'msw'],
  ['MSSW', 'msw'], // Master of Science in Social Work
  ['SW', 'msw'],   // generic "Social Worker" → master's-level social work
  ['MA', 'ma'],
  ['MS', 'ms'],
  ['MED', 'med'],
  ['MSN', 'msn'],
  ['DNP', 'dnp'],
  ['BS', 'bs'],
  ['BA', 'ba'],
]);

/**
 * Coerce CAQH flag values to boolean.
 * Accepts: true/false, "Y"/"N", "Yes"/"No", "true"/"false", "1"/"0".
 */
function toOptBool(v: unknown): boolean | undefined {
  if (v == null) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = toOptString(v);
  if (!s) return undefined;
  const t = s.toLowerCase();
  if (['y', 'yes', 'true', '1'].includes(t)) return true;
  if (['n', 'no', 'false', '0'].includes(t)) return false;
  return undefined;
}

/**
 * Coerce CAQH amount values to a finite number. Handles numeric values,
 * numeric strings (with `$`, `,`, whitespace stripped), and coded-lookup
 * objects via `toOptString`. Returns undefined for non-finite or empty.
 */
function toOptNumber(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const s = toOptString(v);
  if (!s) return undefined;
  const cleaned = s.replace(/[\s$,]/g, '');
  if (cleaned === '') return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse CAQH date values (YYYYMMDD, YYYY-MM-DD, MM/DD/YYYY, ISO). */
function parseCaqhDate(raw: unknown): Date | undefined {
  const s = toOptString(raw);
  if (!s || s === '0') return undefined;
  // YYYYMMDD
  if (/^\d{8}$/.test(s)) {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(4, 6));
    const d = Number(s.slice(6, 8));
    const dt = new Date(Date.UTC(y, m - 1, d));
    return isNaN(dt.getTime()) ? undefined : dt;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? undefined : dt;
}

// ============================================================================
// Phase E2: Roster Individual API v2.0 support
//
// Wire format per spec section 3.1.1 / Table 3:
//   - Endpoint: POST /ProviewAPI/API/RosterIndividual?product=PV  (capital R)
//   - Request: lowercase snake_case throughout, nested provider envelope
//     { provider: { first_name, last_name, address1, city, state, zip,
//                   practice_state, birthdate, type, npi, ... },
//       organization_id }
//   - Response: lowercase snake_case in JSON. Demo server (POID 6279) returned
//     PascalCase keys on 2026-04-24 — we lowercase keys before parsing as a
//     defensive measure. Spec-correct prod casing is unknown until first prod
//     call.
//   - Birthdate / all dates: YYYYMMDD (8 digits, no separators).
//
// Required Initial Add fields (Table 3): provider.{first_name, last_name,
//   address1, city, state, zip, practice_state, birthdate, type} +
//   top-level organization_id + at least one identifier
//   (npi / dea / upin / license_state+license_number / ssn).
//
// Spec PDFs: ~/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/
//   CAQH Specs 042526/drive-download-20260425T171441Z-3-001/
// Local fixtures: packages/backend/fixtures/caqh/spec-samples/v2.0/
// ============================================================================

/**
 * Maps Lanyard ProviderType enum values to CAQH Roster Individual `provider.type`
 * values. Codes verified against spec Appendix A.1 Table 37 (43 valid codes).
 * `psychiatrist` and `psychologist` use defaults that get logged via
 * `caqh_type_default_applied` so we can audit if CAQH ever rejects them.
 * `other` is intentionally absent — readiness fails until the NUCC taxonomy
 * fallback ships (deferred; see resolveCaqhRosterData).
 */
const PROVIDER_TYPE_TO_CAQH_TYPE: Partial<Record<ProviderType, string>> = {
  psychiatrist: 'MD',  // Table 37: Medical Doctor
  psychologist: 'CP',  // Table 37: Clinical Psychologist (PsyD is not a valid CAQH Type)
  lcsw: 'CSW',         // Table 37: Clinical Social Worker
  lpc: 'PC',           // Table 37: Professional Counselor
  lmft: 'MFT',         // Table 37: Marriage/Family Therapist
  pmhnp: 'NP',         // Table 37: Nurse Practitioner
};

const CAQH_TYPE_DEFAULT_APPLIED: ReadonlySet<ProviderType> = new Set<ProviderType>(['psychiatrist', 'psychologist']);

/**
 * Tier 1 #4 feature flag — when enabled, the RosterIndividual payload
 * carries the full CAQH Roster Individual v2.0 spec field set (27 fields)
 * instead of the original 10. Default off so the first deploy is a no-op
 * and we have a one-flip rollback path if prod CAQH rejects the extended
 * payload. Flip ON in Render env vars only after demo validation per
 * CLAUDE.md's CAQH workflow (demo POID 6279 first, then prod POID 1873).
 */
function isExtendedCaqhPayloadEnabled(): boolean {
  return process.env['CAQH_EXTENDED_PAYLOAD'] === 'true';
}

/**
 * Decrypt a stored ciphertext or return null if the input is null/empty or
 * decryption throws (corrupt ciphertext, missing ENCRYPTION_KEY). Used for
 * optional PHI fields — failure should never block the CAQH submission.
 */
function safeDecrypt(value: string | null): string | null {
  if (!value) return null;
  try {
    const plain = decryptSafe(value);
    return plain || null;
  } catch (err) {
    logger.warn({
      event: 'caqh_field_decrypt_failed',
      error: err instanceof Error ? err.message : String(err),
      reason: 'Skipping field in CAQH payload; submission continues without it',
    });
    return null;
  }
}

/**
 * Maps the internal Gender enum to a single-character CAQH code per spec
 * domain table. "other" and "prefer_not_to_say" both fall through to "U"
 * (unspecified) — CAQH accepts U but treats it as missing for matching.
 */
const GENDER_TO_CAQH_CODE: Record<Gender, string> = {
  male: 'M',
  female: 'F',
  other: 'U',
  prefer_not_to_say: 'U',
};

/**
 * NUCC taxonomy → CAQH Type lookup. **Currently inactive** —
 * `provider_type=other` always fails readiness until the taxonomy fallback
 * ships in a later phase. Values pre-validated against spec Table 37 so the
 * lookup returns valid CAQH Type codes when activated.
 *
 * Match strategy when activated: longest-prefix-wins.
 * Extend ONLY after validating new entries against taxonomy.nucc.org.
 */
const NUCC_TAXONOMY_PREFIX_TO_CAQH_TYPE: ReadonlyArray<{ prefix: string; type: string }> = [
  { prefix: '2084P', type: 'MD' },   // Psychiatry family
  { prefix: '208M',  type: 'HOS' },  // Hospitalist (Table 37: HOS, not MD)
  { prefix: '1041',  type: 'CSW' },  // Social Worker family (Table 37: CSW)
  { prefix: '101Y',  type: 'PC' },   // Counselor (Table 37: PC, not LPC)
];

/**
 * Per spec Table 38 (Roster Status, distinct from Provider Status). The
 * spec lists three lifecycle values for plan-roster membership.
 */
const KNOWN_ROSTER_STATUS: ReadonlySet<string> = new Set(['ACTIVE', 'INACTIVE', 'NOT ON ROSTER']);

/** Regex resolver for the 13 lifecycle Provider Status values in Table 38. */
const KNOWN_PROVIDER_STATUS: ReadonlySet<string> = new Set([
  'Alternate Outreach', 'Expired Attestation', 'First Provider Contact',
  'Initial Outreach', 'Initial Profile Complete', 'New Provider', 'OptOut',
  'Profile Data Submitted', 'Provider Deceased', 'Provider Retired',
  'Re-Attestation', 'Returned mail', 'Undeliverable',
]);

/**
 * Recursively lowercase all object keys. Defensive shim for the casing
 * disagreement between spec (lowercase) and the 2026-04-24 demo server
 * response (PascalCase). Lowercasing is one-way safe: `First_Name` and
 * `first_name` both collapse to `first_name`.
 */
function lowercaseKeysDeep(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(lowercaseKeysDeep);
  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([k, v]) => [k.toLowerCase(), lowercaseKeysDeep(v)]),
    );
  }
  return input;
}

/**
 * Zod schema for /ProviewAPI/API/RosterIndividual response.
 * Lowercase snake_case per spec; preprocess normalizes PascalCase variants.
 * All fields nullable/optional because CAQH nulls everything when the request
 * fails validation — we don't want a schema mismatch to mask the real failure
 * carried by `exception_description`. `passthrough()` because CAQH may add
 * fields without notice.
 */
const StringOrNumberLike = z.union([z.string(), z.number()]).nullable().optional()
  .transform(v => (v == null ? null : String(v)));

const RosterIndividualProviderSchema = z.object({
  first_name: z.string().nullable().optional(),
  middle_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  address1: z.string().nullable().optional(),
  address2: z.string().nullable().optional(),
  // Note request/response asymmetry per spec: request uses {city, state, zip};
  // response uses {address_city, address_state, address_zip}. Yes, really.
  address_city: z.string().nullable().optional(),
  address_state: z.string().nullable().optional(),
  address_zip: z.string().nullable().optional(),
  birthdate: z.string().nullable().optional(),
  license_number: StringOrNumberLike,
  license_state: z.string().nullable().optional(),
  upin: StringOrNumberLike,
  dea: StringOrNumberLike,
  npi: StringOrNumberLike,
  practice_state: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  status_date: z.string().nullable().optional(),
}).passthrough();

const RosterIndividualResponseSchemaLower = z.object({
  provider: RosterIndividualProviderSchema.nullable().optional(),
  caqh_provider_id: StringOrNumberLike,
  po_provider_id: StringOrNumberLike,
  organization_id: StringOrNumberLike,
  roster_status: z.string().nullable().optional(),
  authorization_flag: z.string().nullable().optional(),
  non_responder_flag: z.string().nullable().optional(),
  delegation_flag: z.string().nullable().optional(),
  affiliation_flag: z.string().nullable().optional(),
  anniversary_date: z.string().nullable().optional(),
  exception_description: z.string().nullable().optional(),
}).passthrough();

const RosterIndividualResponseSchema = z.preprocess(
  (raw) => lowercaseKeysDeep(raw),
  RosterIndividualResponseSchemaLower,
);

export type RosterIndividualResponse = z.infer<typeof RosterIndividualResponseSchemaLower>;

/**
 * Zod schema for /RosterAPI/API/Roster (legacy batch enqueue) response.
 * Per spec sample (Roster Response for Add Update Delete Request Sample.txt),
 * the immediate POST response is `{ "batch_id": "<id>" }` — async ack only.
 * Empty/missing batch_id means CAQH rejected the enqueue itself; per-provider
 * outcomes arrive later via GET /RosterAPI/api/ProviderStatus polling.
 */
const RosterBatchEnqueueResponseSchema = z.object({
  batch_id: z.string(),
}).passthrough();

/**
 * Thrown when /RosterAPI/API/Roster (batch) returns a response that doesn't
 * contain a usable batch_id — either malformed shape or empty string.
 * Distinct from CaqhRosterIndividualException because batch enqueue failures
 * have no per-provider exception_description; the only signal is the missing
 * batch_id at the envelope level. See issue #206.
 */
export class CaqhBatchEnqueueException extends Error {
  public readonly reason: 'missing_batch_id' | 'empty_batch_id' | 'invalid_shape';
  public readonly rawResponse: unknown;

  constructor(reason: 'missing_batch_id' | 'empty_batch_id' | 'invalid_shape', rawResponse: unknown) {
    super(`CAQH batch roster enqueue rejected (reason: ${reason})`);
    this.name = 'CaqhBatchEnqueueException';
    this.reason = reason;
    this.rawResponse = rawResponse;
  }
}

export class ProviderNotReadyForCaqhError extends Error {
  constructor(public readonly missingFields: string[]) {
    super(`Provider not ready for CAQH roster. Missing/invalid: ${missingFields.join(', ')}`);
    this.name = 'ProviderNotReadyForCaqhError';
  }
}

// ----------------------------------------------------------------------------
// Exception classifier
//
// Source of truth: spec Table 6 (page 14) — 22 exception strings across 5
// categories. Required/Optional/Conditionally Required/Add Failed are fatal;
// Warning is non-fatal (record was processed despite warning).
//
// Local fixture: fixtures/caqh/spec-samples/v2.0/exception-strings-table-6.json
// ----------------------------------------------------------------------------

export type CaqhExceptionCategory =
  | 'required_missing'
  | 'optional_invalid'
  | 'conditionally_required'
  | 'warning'
  | 'add_failed';

export interface ParsedException {
  raw: string;
  category: CaqhExceptionCategory;
}

/**
 * Prefix-anchored category patterns. Each marks the START of an exception.
 * Per spec Table 6, exceptions are concatenated with `;` separators — but
 * the warning string itself contains a `;` mid-message ("...are invalid;
 * however, record was processed..."), so naive `split(';')` mis-classifies
 * the second half. We instead find every prefix match, use its position to
 * carve up the description, and let the slice up to the next prefix (or
 * end-of-string) be the full exception text.
 */
const PREFIX_PATTERNS: ReadonlyArray<{ category: CaqhExceptionCategory; regex: RegExp }> = [
  { category: 'required_missing',       regex: /Required Field missing\/invalid:/gi },
  { category: 'required_missing',       regex: /Missing Identifiers:/gi },
  { category: 'required_missing',       regex: /Invalid Identifiers:/gi },
  { category: 'conditionally_required', regex: /License Number required when/gi },
  { category: 'conditionally_required', regex: /License [Ss]tate required when/gi },
  { category: 'warning',                regex: /Warning:/gi },
  { category: 'add_failed',             regex: /Add Failed:/gi },
];

/** Optional-invalid strings ("Provider_X is in invalid format" / "is invalid") have no
 *  leading prefix — they appear standalone or `;`-separated from prefixed strings. */
const SUFFIX_OPTIONAL_INVALID = /(?: is in invalid format$| is invalid$)/i;

/**
 * Classify the API's `exception_description` into structured exception
 * segments per spec Table 6. Robust to warnings containing semicolons.
 */
export function parseExceptionDescription(description: string): ParsedException[] {
  const hits: Array<{ start: number; category: CaqhExceptionCategory }> = [];
  for (const { regex, category } of PREFIX_PATTERNS) {
    for (const m of description.matchAll(regex)) {
      if (m.index !== undefined) hits.push({ start: m.index, category });
    }
  }
  hits.sort((a, b) => a.start - b.start);

  const result: ParsedException[] = [];

  // 1. Slice before the first prefix (or whole string if no prefix matched)
  //    is split on `;` and matched against the optional-invalid suffix pattern.
  const orphanEnd = hits.length > 0 ? hits[0]!.start : description.length;
  const orphan = description.slice(0, orphanEnd);
  for (const seg of orphan.split(';').map((s) => s.trim()).filter((s) => s.length > 0)) {
    if (SUFFIX_OPTIONAL_INVALID.test(seg)) {
      result.push({ raw: seg, category: 'optional_invalid' });
    } else {
      // Safety default — better to fail loud than silently treat unknown as warning.
      result.push({ raw: seg, category: 'required_missing' });
    }
  }

  // 2. Each prefix-anchored slice runs from this hit to the next hit
  //    (or end of string). Strip any trailing separator/whitespace.
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i]!.start;
    const end = i + 1 < hits.length ? hits[i + 1]!.start : description.length;
    const raw = description.slice(start, end).replace(/[\s;]+$/, '').trim();
    if (raw.length > 0) {
      result.push({ raw, category: hits[i]!.category });
    }
  }

  return result;
}

export class CaqhRosterIndividualException extends Error {
  public readonly category: CaqhExceptionCategory | 'mixed';
  public readonly parsedExceptions: ParsedException[];

  constructor(
    public readonly exceptionDescription: string,
    public readonly rawResponse: RosterIndividualResponse,
    parsed?: ParsedException[],
  ) {
    super(`CAQH RosterIndividual rejected request: ${exceptionDescription}`);
    this.name = 'CaqhRosterIndividualException';
    this.parsedExceptions = parsed ?? parseExceptionDescription(exceptionDescription);
    const categories = new Set(this.parsedExceptions.map((p) => p.category));
    this.category = categories.size === 1 ? this.parsedExceptions[0]!.category : 'mixed';
  }
}

export class CaqhRequiredFieldException extends CaqhRosterIndividualException {
  constructor(description: string, rawResponse: RosterIndividualResponse, parsed: ParsedException[]) {
    super(description, rawResponse, parsed);
    this.name = 'CaqhRequiredFieldException';
  }
}

export class CaqhInvalidFieldException extends CaqhRosterIndividualException {
  constructor(description: string, rawResponse: RosterIndividualResponse, parsed: ParsedException[]) {
    super(description, rawResponse, parsed);
    this.name = 'CaqhInvalidFieldException';
  }
}

export class CaqhConditionalFieldException extends CaqhRosterIndividualException {
  constructor(description: string, rawResponse: RosterIndividualResponse, parsed: ParsedException[]) {
    super(description, rawResponse, parsed);
    this.name = 'CaqhConditionalFieldException';
  }
}

export class CaqhDuplicateException extends CaqhRosterIndividualException {
  constructor(description: string, rawResponse: RosterIndividualResponse, parsed: ParsedException[]) {
    super(description, rawResponse, parsed);
    this.name = 'CaqhDuplicateException';
  }
}

export class CaqhOptOutException extends CaqhRosterIndividualException {
  constructor(description: string, rawResponse: RosterIndividualResponse, parsed: ParsedException[]) {
    super(description, rawResponse, parsed);
    this.name = 'CaqhOptOutException';
  }
}

export class CaqhInvalidProviderIdException extends CaqhRosterIndividualException {
  constructor(description: string, rawResponse: RosterIndividualResponse, parsed: ParsedException[]) {
    super(description, rawResponse, parsed);
    this.name = 'CaqhInvalidProviderIdException';
  }
}

export class CaqhMultipleMatchException extends CaqhRosterIndividualException {
  constructor(description: string, rawResponse: RosterIndividualResponse, parsed: ParsedException[]) {
    super(description, rawResponse, parsed);
    this.name = 'CaqhMultipleMatchException';
  }
}

/**
 * Choose the most-specific exception subclass given a parsed list. Selection
 * priority (most fatal first): add_failed > required > conditional > optional.
 * Warnings alone never throw — handled by caller via the parsed list.
 */
function buildExceptionFromParsed(
  description: string,
  rawResponse: RosterIndividualResponse,
  parsed: ParsedException[],
): CaqhRosterIndividualException {
  const addFailed = parsed.find((p) => p.category === 'add_failed');
  if (addFailed) {
    const raw = addFailed.raw;
    if (/Provider already on Roster/i.test(raw)) return new CaqhDuplicateException(description, rawResponse, parsed);
    if (/Opt Out/i.test(raw))                    return new CaqhOptOutException(description, rawResponse, parsed);
    if (/CAQH Provider ID not found/i.test(raw)) return new CaqhInvalidProviderIdException(description, rawResponse, parsed);
    if (/More than one provider matches/i.test(raw)) return new CaqhMultipleMatchException(description, rawResponse, parsed);
    return new CaqhRosterIndividualException(description, rawResponse, parsed);
  }
  if (parsed.some((p) => p.category === 'required_missing')) {
    return new CaqhRequiredFieldException(description, rawResponse, parsed);
  }
  if (parsed.some((p) => p.category === 'conditionally_required')) {
    return new CaqhConditionalFieldException(description, rawResponse, parsed);
  }
  if (parsed.some((p) => p.category === 'optional_invalid')) {
    return new CaqhInvalidFieldException(description, rawResponse, parsed);
  }
  return new CaqhRosterIndividualException(description, rawResponse, parsed);
}

export interface ResolvedRosterData {
  providerId: string;
  npi: string;
  firstName: string;
  lastName: string;
  birthdate: string;     // YYYY-MM-DD ISO date — call-site formats per endpoint (RosterIndividual = YYYYMMDD; legacy batch = YYYY-MM-DD)
  caqhType: string;
  practiceState: string;
  address1: string;
  city: string;
  state: string;
  zip: string;

  // Extended spec fields (Tier 1 #4). All optional — populated when the
  // CAQH_EXTENDED_PAYLOAD feature flag is enabled. Each represents a field
  // from CAQH Roster Individual v2.0 sample payload that the original
  // 10-field payload omitted.
  middleName?: string;
  nameSuffix?: string;
  gender?: string;           // CAQH single-letter code
  address2?: string;
  zipExtn?: string;          // derived from 9-digit zip "12345-6789" → "6789"
  phone?: string;
  fax?: string;
  email?: string;
  ssn?: string;              // decrypted; PHI — never log
  shortSsn?: string;         // last 4 of ssn
  dea?: string;              // decrypted; PHI — never log
  upin?: string;
  taxId?: string;            // decrypted; PHI — never log
  licenseState?: string;
  licenseNumber?: string;
  // Roster envelope (sibling fields, not inside `provider`):
  caqhProviderId?: string;
  poProviderId?: string;
  lastRecredentialDate?: string;  // YYYYMMDD
  nextRecredentialDate?: string;
  delegationFlag?: string;
  applicationType?: string;
  affiliationFlag?: string;
  regionId?: string;
}

/**
 * Longest-prefix-wins NUCC taxonomy → CAQH Type lookup. Currently unused —
 * `provider_type=other` always fails readiness until the fallback ships in
 * a later phase. Kept here so the activation diff is small.
 */
function resolveCaqhTypeFromTaxonomy(taxonomy: string): string | null {
  let best: { prefix: string; type: string } | null = null;
  for (const entry of NUCC_TAXONOMY_PREFIX_TO_CAQH_TYPE) {
    if (taxonomy.startsWith(entry.prefix) && (!best || entry.prefix.length > best.prefix.length)) {
      best = entry;
    }
  }
  return best?.type ?? null;
}
// Suppress "unused" diagnostics until the deferred phase calls this.
void resolveCaqhTypeFromTaxonomy;

export class CaqhService {
  private baseUrl: string;
  private orgId: string;
  private username: string;
  private password: string;
  private product: string;

  constructor() {
    this.baseUrl = process.env['CAQH_API_URL'] || '';
    this.orgId = process.env['CAQH_ORG_ID'] || '';
    this.username = process.env['CAQH_USERNAME'] || '';
    this.password = process.env['CAQH_PASSWORD'] || '';
    this.product = process.env['CAQH_PRODUCT'] || 'PV';
  }

  private getAuthHeader(): string {
    const token = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    return `Basic ${token}`;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryable = true
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const maxRetries = retryable ? 3 : 1;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.getAuthHeader(),
            ...options.headers,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();

          // Don't retry 4xx client errors
          if (response.status >= 400 && response.status < 500) {
            logger.error(`CAQH API client error: ${response.status} - ${errorText}`);
            throw new Error(`CAQH API error: ${response.status}`);
          }

          // Retry 5xx server errors
          logger.warn({
            event: 'caqh_api_retry',
            attempt,
            maxRetries,
            status: response.status,
            endpoint,
          });
          lastError = new Error(`CAQH API error: ${response.status}`);
          if (attempt < maxRetries) {
            await this.sleep(1000 * Math.pow(2, attempt - 1));
            continue;
          }
          throw lastError;
        }

        const text = await response.text();
        if (!text) return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          logger.error({ event: 'caqh_json_parse_error', endpoint, responseText: text.substring(0, 200) });
          throw new Error('CAQH API returned invalid JSON');
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          lastError = new Error('CAQH API request timed out');
        } else if (error instanceof Error && error.message.startsWith('CAQH API')) {
          lastError = error;
        } else {
          lastError = error instanceof Error ? error : new Error('Unknown CAQH error');
        }

        if (attempt < maxRetries && retryable) {
          logger.warn({
            event: 'caqh_api_retry',
            attempt,
            maxRetries,
            error: lastError.message,
            endpoint,
          });
          await this.sleep(1000 * Math.pow(2, attempt - 1));
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || new Error('CAQH API request failed');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Convert YYYYMMDD date string (e.g. "20250209") to M/D/YYYY (e.g. "2/9/2025").
   * No zero-padding on month/day — matches CAQH API expected format.
   */
  yyyymmddToMDYYYY(dateStr: string): string {
    const year = dateStr.substring(0, 4);
    const month = parseInt(dateStr.substring(4, 6), 10);
    const day = parseInt(dateStr.substring(6, 8), 10);
    return `${month}/${day}/${year}`;
  }

  private async parseXmlToJson(xml: string): Promise<Record<string, any>> {
    const fxp: any = await import('fast-xml-parser');
    const XMLParser = fxp?.XMLParser ?? fxp?.default?.XMLParser;

    if (XMLParser) {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        trimValues: true,
      });
      return parser.parse(xml);
    }

    throw new Error('No usable XML parser found (fast-xml-parser)');
  }

  /**
   * Add a provider to the CAQH roster. Dispatches between the rosterIndividual endpoint
   * (default) and the legacy batch endpoint based on `CAQH_ROSTER_MODE`. Set
   * `CAQH_ROSTER_MODE=batch` to roll back to the legacy path.
   *
   * Throws `ProviderNotReadyForCaqhError` if required fields can't be resolved.
   * Throws `CaqhRosterIndividualException` if CAQH rejects the request via
   * `Exception_Description` envelope (rosterIndividual mode only — see issue #206).
   */
  async addToRoster(providerId: string): Promise<CaqhRosterResponse> {
    const resolved = await this.resolveCaqhRosterData(providerId);
    const mode = process.env['CAQH_ROSTER_MODE'] === 'batch' ? 'batch' : 'individual';

    logger.info({
      event: 'caqh_add_to_roster_start',
      providerId,
      npi: resolved.npi,
      mode,
    });

    // Persist every roster attempt — success and failure — to caqh_sync_logs
    // so the audit trail of "we tried to roster X" survives even when CAQH
    // rejects. Direction is 'push' (vs 'pull' used by syncProvider).
    // Issue #206: previously failures returned 200 silently with no DB record.
    const startTime = Date.now();
    const syncLog = await prisma.caqhSyncLog.create({
      data: {
        providerId,
        direction: 'push',
        status: 'in_progress',
      },
    });

    try {
      const result = mode === 'individual'
        ? await this.addToRosterIndividual(resolved)
        : await this.addToRosterBatch(resolved);

      await prisma.caqhSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          // No raw payload — providerId+npi are sufficient to trace; payload
          // would contain PII (DOB, address) and violate HIPAA rule #8.
          changesApplied: {
            mode,
            caqhProviderId: result.caqhProviderId ?? null,
            rosterStatus: result.status ?? null,
            warnings: result.warnings ?? [],
          } as never,
        },
      });

      return result;
    } catch (err) {
      await prisma.caqhSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
          errorMessage: this.formatRosterFailureMessage(err, mode, resolved.npi),
        },
      });

      logger.error({
        event: 'caqh_add_to_roster_failed',
        providerId,
        npi: resolved.npi,
        mode,
        errorName: err instanceof Error ? err.name : 'Unknown',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      });

      throw err;
    }
  }

  /**
   * Format the failure message persisted to caqh_sync_logs.errorMessage.
   * Carries the typed exception name + provider NPI reference for traceability.
   * Truncated to 500 chars; no raw CAQH payload (PII protection per HIPAA rule #8).
   */
  private formatRosterFailureMessage(err: unknown, mode: string, npi: string): string {
    const name = err instanceof Error ? err.name : 'UnknownError';
    const message = err instanceof Error ? err.message : 'Unknown error';
    const reason = err instanceof CaqhBatchEnqueueException ? ` reason=${err.reason}` : '';
    return `[${mode}] ${name}: ${message} (npi=${npi}${reason})`.substring(0, 500);
  }

  /**
   * Non-throwing readiness check used by adapters/UI. Mirrors `addToRoster`'s
   * resolver but returns missingFields instead of throwing.
   */
  async checkRosterReadiness(providerId: string): Promise<{
    ready: boolean;
    missingFields: string[];
    caqhType?: string;
    practiceState?: string;
  }> {
    try {
      const data = await this.resolveCaqhRosterData(providerId);
      return {
        ready: true,
        missingFields: [],
        caqhType: data.caqhType,
        practiceState: data.practiceState,
      };
    } catch (e) {
      if (e instanceof ProviderNotReadyForCaqhError) {
        return { ready: false, missingFields: e.missingFields };
      }
      throw e;
    }
  }

  /**
   * Legacy batch endpoint. The immediate POST response is async — only acks
   * "queued" via `{ batch_id: "<id>" }`. Per-provider success/failure arrives
   * later via GET /RosterAPI/api/ProviderStatus polling (NOT YET IMPLEMENTED —
   * see #206 residual gap). This method only detects enqueue rejection
   * (missing/empty batch_id or invalid response shape).
   */
  private async addToRosterBatch(resolved: ResolvedRosterData): Promise<CaqhRosterResponse> {
    const raw = await this.request<unknown>(
      `/RosterAPI/API/Roster?product=${encodeURIComponent(this.product)}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider_id: resolved.npi,
          first_name: resolved.firstName,
          last_name: resolved.lastName,
          date_of_birth: resolved.birthdate,
        }),
      },
      false
    );

    const parsed = RosterBatchEnqueueResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error({
        event: 'caqh_batch_enqueue_invalid_shape',
        providerId: resolved.providerId,
        npi: resolved.npi,
        rawKeys: raw && typeof raw === 'object' ? Object.keys(raw as object) : [],
        zodError: parsed.error.flatten(),
      });
      throw new CaqhBatchEnqueueException('invalid_shape', raw);
    }

    if (parsed.data.batch_id.trim().length === 0) {
      logger.error({
        event: 'caqh_batch_enqueue_rejected',
        providerId: resolved.providerId,
        npi: resolved.npi,
        reason: 'empty_batch_id',
      });
      throw new CaqhBatchEnqueueException('empty_batch_id', raw);
    }

    logger.info({
      event: 'caqh_batch_enqueue_accepted',
      providerId: resolved.providerId,
      npi: resolved.npi,
      batchId: parsed.data.batch_id,
      reason: 'Batch enqueued — actual roster outcome requires GET /RosterAPI/api/ProviderStatus poll (not yet implemented, #206 residual gap)',
    });

    // Preserve existing behavior for the success path: cast and return raw.
    // Callers should not assume caqhProviderId is present in batch mode.
    return raw as CaqhRosterResponse;
  }

  /**
   * Roster Individual API v2.0 endpoint. Sends lowercase snake_case nested
   * envelope per spec section 3.1.1 / Table 3. Treats non-empty
   * `exception_description` as failure (HTTP 200 != success per Table 6 —
   * the discovery-call misread that prompted the Phase 2 rewrite). Warning
   * exceptions return success with the warning surfaced on the response.
   *
   * Spec PDF: ~/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/
   *   CAQH Specs 042526/drive-download-20260425T171441Z-3-001/
   *   CAQH Credentialing and Directory Management Roster Individual API
   *   Specification v2.0.pdf
   */
  private async addToRosterIndividual(resolved: ResolvedRosterData): Promise<CaqhRosterResponse> {
    // Base payload (the 10 spec-required fields plus organization_id). The
    // CAQH_EXTENDED_PAYLOAD flag controls whether the additional spec fields
    // (Roster Individual v2.0 sample includes 27) are also sent. Default off
    // so production behavior is unchanged on first deploy; flip ON via Render
    // env var after demo validation per CLAUDE.md CAQH workflow.
    const providerEnvelope: Record<string, string> = {
      first_name: resolved.firstName,
      last_name: resolved.lastName,
      address1: resolved.address1,
      // Request uses {city, state, zip}; response uses {address_city, address_state, address_zip} per spec.
      city: resolved.city,
      state: resolved.state,
      zip: resolved.zip,
      practice_state: resolved.practiceState,
      // Spec section 3.1.1: dates are YYYYMMDD (no separators).
      birthdate: resolved.birthdate.replace(/-/g, ''),
      type: resolved.caqhType,
      npi: resolved.npi,
    };

    const envelope: Record<string, unknown> = {
      provider: providerEnvelope,
      organization_id: this.orgId,
    };

    if (isExtendedCaqhPayloadEnabled()) {
      // Only include keys with present values — empty strings sometimes trip
      // CAQH validators that are stricter than the spec sample suggests.
      if (resolved.middleName) providerEnvelope['middle_name'] = resolved.middleName;
      if (resolved.nameSuffix) providerEnvelope['name_suffix'] = resolved.nameSuffix;
      if (resolved.gender) providerEnvelope['gender'] = resolved.gender;
      if (resolved.address2) providerEnvelope['address2'] = resolved.address2;
      if (resolved.zipExtn) providerEnvelope['zip_extn'] = resolved.zipExtn;
      if (resolved.phone) providerEnvelope['phone'] = resolved.phone;
      if (resolved.fax) providerEnvelope['fax'] = resolved.fax;
      if (resolved.email) providerEnvelope['email'] = resolved.email;
      if (resolved.ssn) providerEnvelope['ssn'] = resolved.ssn;
      if (resolved.shortSsn) providerEnvelope['short_ssn'] = resolved.shortSsn;
      if (resolved.dea) providerEnvelope['dea'] = resolved.dea;
      if (resolved.upin) providerEnvelope['upin'] = resolved.upin;
      if (resolved.taxId) providerEnvelope['tax_id'] = resolved.taxId;
      if (resolved.licenseState) providerEnvelope['license_state'] = resolved.licenseState;
      if (resolved.licenseNumber) providerEnvelope['license_number'] = resolved.licenseNumber;

      // Sibling-level fields outside `provider` (per spec sample envelope).
      if (resolved.caqhProviderId) envelope['caqh_provider_id'] = resolved.caqhProviderId;
      if (resolved.poProviderId) envelope['po_provider_id'] = resolved.poProviderId;
      if (resolved.lastRecredentialDate) envelope['last_recredential_date'] = resolved.lastRecredentialDate;
      if (resolved.nextRecredentialDate) envelope['next_recredential_date'] = resolved.nextRecredentialDate;
      if (resolved.delegationFlag) envelope['delegation_flag'] = resolved.delegationFlag;
      if (resolved.applicationType) envelope['application_type'] = resolved.applicationType;
      if (resolved.affiliationFlag) envelope['affiliation_flag'] = resolved.affiliationFlag;
      if (resolved.regionId) envelope['region_id'] = resolved.regionId;
    }

    const payload = envelope;

    const raw = await this.request<unknown>(
      // Capital R — spec endpoint is `/RosterIndividual`, not lowercase r.
      `/ProviewAPI/API/RosterIndividual?product=${encodeURIComponent(this.product)}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      // retryable=false: per spec Table 24 (Add to Roster Individual exceptions),
      // the API is not idempotent — duplicate calls return
      // "Add Failed: Provider already on Roster (exact duplicate)" instead of
      // returning the original caqh_provider_id. Auto-retry would surface the
      // duplicate exception as a false-failure on the retry, masking the
      // original success. Manual retry is only safe after server-side
      // investigation confirms the original add did not land.
      false,
    );

    const parsed = RosterIndividualResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error({
        event: 'caqh_roster_individual_response_schema_invalid',
        providerId: resolved.providerId,
        zodError: parsed.error.flatten(),
        rawKeys: raw && typeof raw === 'object' ? Object.keys(raw as object) : [],
      });
      throw new Error('CAQH RosterIndividual returned an unrecognized response shape');
    }
    const body = parsed.data;

    // exception_description envelope: classify segments per spec Table 6.
    // Warnings are non-fatal (record was processed); everything else is fatal.
    const exception = body.exception_description?.trim() ?? '';
    let warnings: string[] = [];
    if (exception.length > 0) {
      const parsedExceptions = parseExceptionDescription(exception);
      const fatal = parsedExceptions.filter((p) => p.category !== 'warning');
      warnings = parsedExceptions.filter((p) => p.category === 'warning').map((p) => p.raw);

      if (fatal.length > 0) {
        logger.warn({
          event: 'caqh_roster_individual_exception',
          providerId: resolved.providerId,
          exceptionDescription: exception,
          categories: [...new Set(parsedExceptions.map((p) => p.category))],
          rosterStatus: body.roster_status ?? null,
        });
        throw buildExceptionFromParsed(exception, body, parsedExceptions);
      }

      // Warnings only — log and continue to success path.
      logger.warn({
        event: 'caqh_roster_individual_warning',
        providerId: resolved.providerId,
        warnings,
        rosterStatus: body.roster_status ?? null,
        reason: 'Non-fatal warning per spec Table 6 — record processed',
      });
    }

    // Defensive roster_status handling: log unknown enum values and treat as non-success.
    const rosterStatus = body.roster_status;
    if (rosterStatus != null && !KNOWN_ROSTER_STATUS.has(rosterStatus)) {
      logger.warn({
        event: 'caqh_roster_status_unknown',
        providerId: resolved.providerId,
        rawRosterStatus: rosterStatus,
        reason: 'Unknown enum value — treating as non-success (extend KNOWN_ROSTER_STATUS once confirmed against spec Table 38)',
      });
      throw new Error(`CAQH RosterIndividual returned unrecognized roster_status: ${rosterStatus}`);
    }

    const caqhProviderId = body.caqh_provider_id;
    if (!caqhProviderId) {
      logger.error({
        event: 'caqh_roster_individual_no_id',
        providerId: resolved.providerId,
        rosterStatus: rosterStatus ?? null,
        hint: 'CAQH returned 200 with no exception_description but also no caqh_provider_id',
      });
      throw new Error('CAQH RosterIndividual returned no caqh_provider_id');
    }

    // Surface authorization_flag and provider_status (Table 38) as separate fields.
    const authorizationFlag = (body.authorization_flag ?? null) as 'Y' | 'N' | null;
    const providerStatus = body.provider?.status ?? null;
    if (providerStatus != null && !KNOWN_PROVIDER_STATUS.has(providerStatus)) {
      logger.warn({
        event: 'caqh_provider_status_unknown',
        providerId: resolved.providerId,
        rawProviderStatus: providerStatus,
        reason: 'Unknown lifecycle status — extend KNOWN_PROVIDER_STATUS after validating against spec Table 38',
      });
    }

    logger.info({
      event: 'caqh_roster_individual_success',
      providerId: resolved.providerId,
      caqhProviderId,
      rosterStatus: rosterStatus ?? null,
      authorizationFlag,
      providerStatus,
      warningCount: warnings.length,
    });

    return {
      caqhProviderId,
      status: rosterStatus ?? 'unknown',
      authorizationFlag,
      providerStatus,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Resolve all RosterIndividual payload fields for a provider. Collects ALL
   * missing-field reasons before throwing — so callers (readiness check, UI)
   * see every blocker in one pass instead of fixing them one at a time.
   *
   * Field sources:
   * - `npi`, `firstName`, `lastName`, `dateOfBirth` ← providerProfile
   * - `caqhType` ← PROVIDER_TYPE_TO_CAQH_TYPE direct map. providerType=other
   *   currently fails readiness with `provider_type_other_deferred` —
   *   NUCC taxonomy fallback is parked for a future phase.
   * - `practiceState`, `address1`, `city`, `state`, `zip` ← canonical
   *   `practice_locations` table (primary first, fall back to first if no
   *   primary is flagged). `primaryPracticeState` is the safety net for
   *   `practiceState` only.
   * - `birthdate` ← `dateOfBirth` reformatted YYYY-MM-DD → YYYYMMDD per spec.
   */
  private async resolveCaqhRosterData(providerId: string): Promise<ResolvedRosterData> {
    const extended = isExtendedCaqhPayloadEnabled();

    const provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        npi: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        providerType: true,
        taxonomy: true,
        primaryPracticeState: true,
        // Extended payload fields — selected unconditionally (cheap) so the
        // resolver always has them in scope; only emitted when flag is on.
        middleName: true,
        suffix: true,
        gender: true,
        email: true,
        phone: true,
        fax: true,
        ssnEncrypted: true,
        caqhProviderId: true,
        caqhLastSync: true,
        practiceLocations: {
          select: {
            addressLine1: true,
            addressLine2: true,
            city: true,
            state: true,
            zipCode: true,
            isPrimary: true,
            createdAt: true,
            taxIdEncrypted: true,
          },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
        },
        // Extended payload relations
        licenses: extended
          ? {
              where: { status: 'active' },
              select: { state: true, licenseNumber: true, isPrimary: true, expirationDate: true },
              orderBy: [{ isPrimary: 'desc' }, { expirationDate: 'desc' }],
            }
          : false,
        deaRegistrations: extended
          ? {
              where: { status: 'active' },
              select: { deaNumberEncrypted: true, expirationDate: true },
              orderBy: { expirationDate: 'desc' },
            }
          : false,
        providerIdentifiers: extended
          ? {
              where: { identifierType: 'UPIN', status: 'active' },
              select: { identifierValue: true },
              take: 1,
            }
          : false,
      },
    });

    if (!provider) {
      throw new ProviderNotReadyForCaqhError(['provider_not_found']);
    }

    const missing: string[] = [];
    if (!provider.npi) missing.push('npi');
    if (!provider.firstName) missing.push('firstName');
    if (!provider.lastName) missing.push('lastName');
    if (!provider.dateOfBirth) missing.push('dateOfBirth');

    // Resolve CAQH Type
    let caqhType: string | null = PROVIDER_TYPE_TO_CAQH_TYPE[provider.providerType] ?? null;
    if (caqhType && CAQH_TYPE_DEFAULT_APPLIED.has(provider.providerType)) {
      logger.warn({
        event: 'caqh_type_default_applied',
        providerId,
        providerType: provider.providerType,
        defaultedTo: caqhType,
        reason: 'No DO/PhD disambiguation rule yet — default chosen for psychiatrist/psychologist',
      });
    }
    if (!caqhType) {
      // providerType=other: NUCC taxonomy fallback is deferred. Always fail
      // readiness with a clear reason so the UI can surface this. The lookup
      // function is kept for future activation; corrected entries in
      // NUCC_TAXONOMY_PREFIX_TO_CAQH_TYPE will produce valid Type codes once
      // the deferred phase ships.
      missing.push('provider_type_other_deferred (NUCC taxonomy fallback not yet shipped)');
    }

    // Resolve practice location fields — practiceLocations is canonical
    // (verified 2026-04-25; provider_addresses is inbound-only from CAQH v8 sync).
    // primaryPracticeState is the practice_state safety net only.
    const primaryLoc = provider.practiceLocations.find((loc) => loc.isPrimary)
      ?? provider.practiceLocations[0]
      ?? null;

    let practiceState: string | null = null;
    let address1: string | null = null;
    let city: string | null = null;
    let state: string | null = null;
    let zip: string | null = null;

    if (primaryLoc) {
      address1 = primaryLoc.addressLine1?.trim() || null;
      city = primaryLoc.city?.trim() || null;
      state = primaryLoc.state?.trim() || null;
      zip = primaryLoc.zipCode?.trim() || null;
      practiceState = state;
      if (!address1) missing.push('address1');
      if (!city) missing.push('city');
      if (!state) missing.push('state');
      if (!zip) missing.push('zip');
    } else {
      missing.push('practice_location_missing');
      // Even with no location, fall back to primaryPracticeState for practice_state
      // so the user sees one concise blocker (the missing location) rather than
      // a stack of cascading "missing X" entries.
      if (provider.primaryPracticeState) {
        practiceState = provider.primaryPracticeState;
        logger.info({
          event: 'caqh_practice_state_fallback',
          providerId,
          reason: 'No practiceLocations — falling back to primaryPracticeState (address fields still missing)',
        });
      }
    }
    if (!practiceState) missing.push('practiceState');

    if (missing.length > 0) {
      throw new ProviderNotReadyForCaqhError(missing);
    }

    const base: ResolvedRosterData = {
      providerId,
      npi: provider.npi!,
      firstName: provider.firstName!,
      lastName: provider.lastName!,
      birthdate: provider.dateOfBirth!.toISOString().split('T')[0]!,
      caqhType: caqhType!,
      practiceState: practiceState!,
      address1: address1!,
      city: city!,
      state: state!,
      zip: zip!,
    };

    if (!extended) {
      return base;
    }

    // Extended-payload mode: enrich the base resolution with optional fields.
    // Each field is best-effort — a missing/un-decryptable field becomes
    // undefined and is simply omitted from the request payload.

    const ssnPlain = safeDecrypt(provider.ssnEncrypted ?? null);
    const taxIdPlain = primaryLoc ? safeDecrypt(primaryLoc.taxIdEncrypted ?? null) : null;
    const deaRecord = (provider as { deaRegistrations?: Array<{ deaNumberEncrypted: string | null }> })
      .deaRegistrations?.[0] ?? null;
    const deaPlain = deaRecord ? safeDecrypt(deaRecord.deaNumberEncrypted ?? null) : null;

    const primaryLicense = (provider as { licenses?: Array<{ state: string | null; licenseNumber: string | null }> })
      .licenses?.[0] ?? null;
    const upinRecord = (provider as { providerIdentifiers?: Array<{ identifierValue: string | null }> })
      .providerIdentifiers?.[0] ?? null;

    // zip "12345-6789" → ("12345", "6789"); plain "12345" → ("12345", undefined).
    const zipBase = base.zip;
    const zipParts = zipBase.includes('-') ? zipBase.split('-') : [zipBase];
    base.zip = zipParts[0]!;
    const zipExtnRaw = zipParts[1];

    return {
      ...base,
      middleName: provider.middleName ?? undefined,
      nameSuffix: provider.suffix ?? undefined,
      gender: GENDER_TO_CAQH_CODE[provider.gender as Gender],
      address2: primaryLoc?.addressLine2 ?? undefined,
      zipExtn: zipExtnRaw,
      phone: provider.phone ?? undefined,
      fax: provider.fax ?? undefined,
      email: provider.email ?? undefined,
      ssn: ssnPlain ?? undefined,
      shortSsn: ssnPlain ? ssnPlain.replace(/\D/g, '').slice(-4) : undefined,
      dea: deaPlain ?? undefined,
      upin: upinRecord?.identifierValue ?? undefined,
      taxId: taxIdPlain ?? undefined,
      licenseState: primaryLicense?.state ?? undefined,
      licenseNumber: primaryLicense?.licenseNumber ?? undefined,
      caqhProviderId: provider.caqhProviderId ?? undefined,
      poProviderId: provider.id,  // Lanyard's internal provider UUID
      lastRecredentialDate: provider.caqhLastSync
        ? provider.caqhLastSync.toISOString().slice(0, 10).replace(/-/g, '')
        : undefined,
      // No DB column for next_recredential_date — omitted intentionally.
      delegationFlag: 'N',
      applicationType: 'I',
      affiliationFlag: 'N',
      // region_id intentionally omitted; CAQH falls back to organization_id
      // mapping when absent per spec section 3.1.2.
    };
  }

  async removeFromRoster(caqhProviderId: string): Promise<void> {
    logger.info(`Removing provider ${caqhProviderId} from CAQH roster`);

    await this.request(
      `/RosterAPI/API/Roster?product=${encodeURIComponent(this.product)}&caqhProviderId=${encodeURIComponent(caqhProviderId)}&organizationId=${encodeURIComponent(this.orgId)}`,
      { method: 'DELETE' },
      false
    );
  }

  async checkStatus(caqhProviderId: string): Promise<CaqhStatusResponse> {
    logger.info(`Checking CAQH status for provider ${caqhProviderId}`);

    const response = await this.request<CaqhStatusResponse>(
      `/RosterAPI/api/ProviderStatus?Product=${encodeURIComponent(this.product)}&Caqh_Provider_Id=${encodeURIComponent(caqhProviderId)}&Organization_Id=${encodeURIComponent(this.orgId)}`
    );

    return response;
  }

  async pullCredentials(caqhProviderId: string, attestationDate: string): Promise<CaqhCredentialsResponse> {
    logger.info(`Pulling credentials from CAQH for provider ${caqhProviderId} (attestation: ${attestationDate})`);

    const url = `/credentialingapi/api/v8/entities?caqhProviderId=${encodeURIComponent(caqhProviderId)}&organizationId=${encodeURIComponent(this.orgId)}&attestationDate=${encodeURIComponent(attestationDate)}`;

    const fullUrl = `${this.baseUrl}${url}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(fullUrl, {
        signal: controller.signal,
        headers: {
          'Authorization': this.getAuthHeader(),
          'Accept': 'application/xml, text/xml;q=0.9, application/json;q=0.1',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`CAQH Credentialing API error: ${response.status} - ${errorText}`);
        throw new Error(`CAQH API error: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();

      // CAQH Credentialing API v9 returns XML
      if (/xml/i.test(contentType) || text.trim().startsWith('<')) {
        try {
          const parsed = await this.parseXmlToJson(text);
          return parsed as Record<string, any> as CaqhCredentialsResponse;
        } catch (err) {
          logger.error('Failed to parse CAQH credentialing XML response', {
            error: err instanceof Error ? err.message : 'unknown',
          });
          throw new Error('Failed to parse CAQH credentialing response');
        }
      }

      // Fallback to JSON if service returns it
      try {
        return JSON.parse(text) as CaqhCredentialsResponse;
      } catch {
        throw new Error('Unexpected CAQH credentialing response format');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('CAQH API request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getDocumentsList(caqhProviderId: string): Promise<CaqhDocumentInfo[]> {
    logger.info(`Fetching CAQH documents list for provider ${caqhProviderId}`);

    const response = await this.request<CaqhDocumentInfo[]>(
      `/documentapi/api/ProviderDocs/GetDocumentsList?caqhProviderID=${encodeURIComponent(caqhProviderId)}&organizationID=${encodeURIComponent(this.orgId)}`,
      { headers: { 'Accept': 'application/json' } }
    );

    return response;
  }

  async downloadDocument(caqhProviderId: string, docUrl: string): Promise<CaqhDownloadResult> {
    logger.info(`Downloading CAQH document for provider ${caqhProviderId}`);

    const url = `${this.baseUrl}/DocumentAPI/api/providerdocs/download?caqhProviderID=${encodeURIComponent(caqhProviderId)}&organizationID=${encodeURIComponent(this.orgId)}&docURL=${encodeURIComponent(docUrl)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Authorization': this.getAuthHeader(),
        },
      });

      if (!response.ok) {
        throw new Error(`CAQH API error: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const disposition = response.headers.get('content-disposition') || '';

      let fileName: string | undefined;
      const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
      if (match) {
        fileName = decodeURIComponent((match[1] ?? match[2]) as string);
      }

      return {
        data: Buffer.from(arrayBuffer),
        contentType,
        fileName,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('CAQH API request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Map CAQH data to our internal format.
   *
   * Accepts two shapes:
   *   1. v8 PascalCase — `{ Provider: {...} }` root wrapper (real CAQH API response)
   *   2. Legacy camelCase — `{ provider, licenses, ... }` (older test fixtures, backward compat)
   *
   * Defensive against partial payloads: missing sections produce empty arrays
   * rather than crashing, so `rawJson` is always preserved for debugging.
   *
   * Phase 1 scope: provider core (name, NPI, SSN, DOB, gender, practice state, flags)
   * + addresses + identifiers. Licenses/certs/education/malpractice still use
   * legacy camelCase path only — Phases 2+ will extend to v8 PascalCase for those.
   */
  mapCaqhToInternal(caqhData: unknown, providerId?: string): MappedCaqhData {
    // Detect v8 PascalCase shape by presence of `Provider` root wrapper
    const v8Root = (caqhData as CaqhV8Response | undefined)?.Provider;
    if (v8Root && typeof v8Root === 'object') {
      return this.mapV8(v8Root, providerId);
    }
    // Fall back to legacy camelCase shape
    return this.mapLegacy(caqhData as CaqhCredentialsResponse | undefined, providerId);
  }

  private mapV8(p: CaqhV8Provider, providerId?: string): MappedCaqhData {
    const addrList = this.asArray(p.ProviderAddress);
    const idList = this.asArray(p.ProviderIdentifier);
    const certEntries = this.asArray(p.ProviderCertification);
    const lifeSupportCerts = certEntries
      .map(c => this.mapV8LifeSupportCert(c, providerId))
      .filter((c): c is MappedProviderIdentifier => c !== null);
    const providerCertifications = certEntries
      .map(c => this.mapV8ProviderCertification(c, providerId))
      .filter((c): c is NonNullable<MappedCaqhData['providerCertifications']>[number] => c !== null);
    const education = this.asArray(p.Education)
      .map(e => this.mapV8Education(e, providerId))
      .filter((e): e is MappedCaqhData['education'][number] => e !== null);
    const malpractice = this.asArray(p.Insurance)
      .map(i => this.mapV8Malpractice(i, providerId))
      .filter((m): m is MappedCaqhData['malpractice'][number] => m !== null);
    const cdsRegistrations = this.asArray(p.ProviderCDS)
      .map(c => this.mapV8CDS(c, providerId))
      .filter((c): c is NonNullable<MappedCaqhData['cdsRegistrations']>[number] => c !== null);

    // ── v9 sections (Phase 2) ────────────────────────────────────────────
    const disclosureEntries = this.asArray(p.Disclosure);
    const disclosures = disclosureEntries
      .map(d => this.mapV8Disclosure(d, providerId))
      .filter((d): d is NonNullable<MappedCaqhData['disclosures']>[number] => d !== null);
    // CAQH question 21150 carries malpractice claims nested inside the disclosure.
    // Pull every nested Malpractice element across all 21150 disclosures.
    const malpracticeClaims = disclosureEntries
      .filter(d => toOptString(d.ID) === '21150' && toOptBool(d.DisclosureAnswerFlag) === true)
      .flatMap(d => this.asArray(d.Malpractice))
      .map(m => this.mapV8MalpracticeClaim(m, providerId))
      .filter((m): m is NonNullable<MappedCaqhData['malpracticeClaims']>[number] => m !== null);

    const hospitalAffiliations = this.asArray(p.Hospital)
      .map(h => this.mapV8Hospital(h, providerId))
      .filter((h): h is NonNullable<MappedCaqhData['hospitalAffiliations']>[number] => h !== null);

    const workHistory = this.asArray(p.WorkHistory)
      .map(w => this.mapV8WorkHistoryEntry(w, providerId))
      .filter((w): w is NonNullable<MappedCaqhData['workHistory']>[number] => w !== null);

    const workHistoryGaps = this.asArray(p.TimeGap)
      .map(g => this.mapV8TimeGap(g, providerId))
      .filter((g): g is NonNullable<MappedCaqhData['workHistoryGaps']>[number] => g !== null);

    const practiceSupervisors = this.asArray(p.Practice)
      .map(pr => this.mapV8PracticeSupervisor(pr, providerId))
      .filter((s): s is NonNullable<MappedCaqhData['practiceSupervisors']>[number] => s !== null);

    const npiStr = toOptString(p.NPI);
    const ssnStr = toOptString(p.SSN);
    // Top-level <Degree> = provider's primary credential. Shape:
    // `{ ID, Degree: { DegreeAbbreviation } }`; take the first if multiple.
    const topDegreeEl = this.asArray(p['Degree'])[0] as { Degree?: unknown } | undefined;
    const topDegreeRaw = toOptString(topDegreeEl?.Degree);
    const providerDegree = topDegreeRaw ? this.mapDegreeType(topDegreeRaw, providerId) : undefined;
    return {
      provider: {
        firstName: toOptString(p.ProviderFirstName ?? p.FirstName) ?? '',
        lastName: toOptString(p.ProviderLastName ?? p.LastName) ?? '',
        middleName: toOptString(p.ProviderMiddleName ?? p.MiddleName),
        suffix: toOptString(p.ProviderSuffix),
        degree: providerDegree,
        npi: npiStr ?? '',
        ssn: ssnStr ? this.normalizeSsn(ssnStr) : undefined,
        dateOfBirth: parseCaqhDate(p.ProviderDateOfBirth ?? p.DateOfBirth ?? p.BirthDate),
        gender: this.mapGender(p.ProviderGender ?? p.Gender, providerId),
        email: toOptString(p.ProviderEmail ?? p.Email ?? p.EmailAddress),
        phone: toOptString(p.ProviderPhone ?? p.Phone),
        ethnicity: toOptString(p.EthnicityDescription),
        primaryPracticeState: toOptString(p.PrimaryPracticeState),
        otherPracticeState: toOptString(p.OtherPracticeState),
        hospitalBasedFlag: toOptBool(p.HospitalBasedFlag),
        hospitalPrivilegeFlag: toOptBool(p.HospitalPrivilegeFlag),
        fellowshipTrainingFlag: toOptBool(p.FellowshipTrainingFlag),
        secondarySpecialtyFlag: toOptBool(p.SecondarySpecialtyFlag),
        activeMilitaryFlag: toOptBool(p.ActiveMilitaryFlag),
        workHistoryGapFlag: toOptBool(p.WorkHistoryGapFlag),
        acceptingMedicare: toOptBool(p.MedicareProviderFlag),
        acceptingMedicaid: toOptBool(p.MedicaidProviderFlag),
      },
      addresses: addrList
        .map(a => this.mapV8Address(a, providerId))
        .filter((a): a is MappedProviderAddress => a !== null),
      identifiers: [
        ...idList
          .map(i => this.mapV8Identifier(i, providerId))
          .filter((i): i is MappedProviderIdentifier => i !== null),
        ...lifeSupportCerts,
      ],
      licenses: this.asArray(p.ProviderLicense)
        .map(l => this.mapV8License(l, providerId))
        .filter((l): l is MappedCaqhData['licenses'][number] => l !== null),
      certifications: this.asArray(p.Specialty)
        .map(s => this.mapV8BoardCert(s, providerId))
        .filter((c): c is MappedCaqhData['certifications'][number] => c !== null),
      specialties: this.asArray(p.Specialty)
        .map(s => this.mapV8Specialty(s, providerId))
        .filter((s): s is MappedSpecialty => s !== null),
      education,
      malpractice,
      providerCertifications,
      cdsRegistrations,
      disclosures,
      malpracticeClaims,
      hospitalAffiliations,
      workHistory,
      workHistoryGaps,
      practiceSupervisors,
    };
  }

  private mapLegacy(caqhData: CaqhCredentialsResponse | undefined, providerId?: string): MappedCaqhData {
    const provider = caqhData?.provider ?? ({} as CaqhCredentialsResponse['provider']);
    const licenses = Array.isArray(caqhData?.licenses) ? caqhData.licenses : [];
    const certifications = Array.isArray(caqhData?.certifications) ? caqhData.certifications : [];
    const education = Array.isArray(caqhData?.education) ? caqhData.education : [];

    return {
      provider: {
        firstName: provider.firstName ?? '',
        lastName: provider.lastName ?? '',
        npi: provider.npi ?? '',
      },
      addresses: [],
      identifiers: [],
      licenses: licenses.map(license => ({
        licenseType: this.mapLicenseType(license.type, providerId),
        licenseNumber: license.number,
        state: license.state,
        expirationDate: new Date(license.expirationDate),
      })),
      certifications: certifications.map(cert => ({
        boardType: this.mapBoardType(cert.board, providerId),
        boardName: cert.board,
        specialty: cert.specialty,
        expirationDate: cert.expirationDate
          ? new Date(cert.expirationDate)
          : undefined,
      })),
      specialties: [],
      education: education.map(edu => ({
        institutionName: edu.institution,
        degree: this.mapDegreeType(edu.degree, providerId),
        graduationDate: new Date(edu.graduationDate),
      })),
      malpractice: caqhData?.malpractice
        ? [{
            carrierName: caqhData.malpractice.carrier,
            policyNumber: caqhData.malpractice.policyNumber,
            expirationDate: caqhData.malpractice.expirationDate,
            perClaimAmount: caqhData.malpractice.coverageAmount,
          }]
        : [],
    };
  }

  private asArray<T>(v: T | T[] | undefined): T[] {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
  }

  private normalizeSsn(raw: string): string {
    // Strip non-digits; CAQH sometimes returns with dashes or as numeric.
    const digits = raw.replace(/\D/g, '');
    return digits;
  }

  private mapGender(raw: unknown, providerId?: string): Gender | undefined {
    const str = toOptString(raw);
    if (!str) return undefined;
    const v = str.toLowerCase();
    if (v === 'm' || v === 'male') return 'male';
    if (v === 'f' || v === 'female') return 'female';
    if (v === 'o' || v === 'other') return 'other';
    logger.warn({
      event: 'caqh_unknown_mapping',
      field: 'gender',
      rawValue: raw,
      providerId,
    });
    return undefined;
  }

  private mapV8Address(a: CaqhV8Address, providerId?: string): MappedProviderAddress | null {
    const line1 = toOptString(a.AddressLine1 ?? a.Address);
    const city = toOptString(a.City);
    const state = toOptString(a.State);
    const zip = toOptString(a.ZipCode ?? a.PostalCode);
    if (!line1 || !city || !state || !zip) {
      logger.warn({
        event: 'caqh_skip_address_incomplete',
        providerId,
        have: { line1: !!line1, city: !!city, state: !!state, zip: !!zip },
      });
      return null;
    }
    return {
      type: this.mapAddressType(a.AddressType),
      addressLine1: line1,
      addressLine2: toOptString(a.AddressLine2),
      city,
      state,
      zipCode: zip,
      country: toOptString(a.Country) ?? 'US',
    };
  }

  private mapAddressType(raw: unknown): AddressType {
    const str = toOptString(raw);
    if (!str) return 'home';
    const v = str.toLowerCase();
    if (v.includes('practice')) return 'practice';
    if (v.includes('mail')) return 'mailing';
    if (v.includes('bill')) return 'billing';
    return 'home';
  }

  private mapV8Identifier(i: CaqhV8Identifier, providerId?: string): MappedProviderIdentifier | null {
    const value = toOptString(i.IdentifierValue);
    if (!value) return null;
    const type = this.mapIdentifierType(i.IdentifierType, providerId);
    // Preserve CAQH's descriptive label so unknown-type identifiers don't lose meaning
    const description = toOptString(i.IdentifierType);
    return {
      identifierType: type,
      identifierValue: value,
      issuingEntity: toOptString(i.IssuingEntity),
      state: toOptString(i.State),
      effectiveDate: parseCaqhDate(i.EffectiveDate),
      expirationDate: parseCaqhDate(i.ExpirationDate),
      notes: type === 'OTHER' && description ? description : undefined,
    };
  }

  /**
   * Map CAQH `ProviderCertification` entries (life-support certs like BLS/ACLS/CPR) to
   * ProviderIdentifier rows. Only active certs (CertificationFlag=1) are imported.
   * The description is matched against the IdentifierType enum; unknown descriptions
   * default to OTHER with the full label preserved in `notes`.
   */
  private mapV8LifeSupportCert(c: CaqhV8Certification, providerId?: string): MappedProviderIdentifier | null {
    const active = toOptBool(c.CertificationFlag);
    if (active !== true) return null;
    const description = toOptString(c.CertificationDescription);
    if (!description) return null;
    const type = this.mapLifeSupportCertType(description);
    return {
      identifierType: type,
      identifierValue: toOptString(c.ID) ?? description,
      expirationDate: parseCaqhDate(c.ExpirationDate),
      effectiveDate: parseCaqhDate(c.IssueDate),
      notes: type === 'OTHER' ? description : undefined,
    };
  }

  /**
   * Map CAQH `ProviderCertification` (life-support cert) entries to the new
   * `provider_certifications` table. Output is a description-only payload —
   * the `ProviderCertificationType` enum value is resolved at execution time
   * during persistence (see `applyCaqhDataToProvider`). Only active certs
   * (CertificationFlag=1) are imported, matching `mapV8LifeSupportCert`.
   *
   * This runs alongside `mapV8LifeSupportCert` (dual-write) — the same source
   * entries produce both ProviderIdentifier rows (legacy) and
   * ProviderCertification rows (canonical going forward).
   */
  private mapV8ProviderCertification(
    c: CaqhV8Certification,
    _providerId?: string,
  ): NonNullable<MappedCaqhData['providerCertifications']>[number] | null {
    const active = toOptBool(c.CertificationFlag);
    if (active !== true) return null;
    const description = toOptString(c.CertificationDescription);
    if (!description) return null;
    return {
      caqhCertificationId: toOptString(c.ID),
      certDescription: description,
      expirationDate: parseCaqhDate(c.ExpirationDate),
      issueDate: parseCaqhDate(c.IssueDate),
    };
  }

  /**
   * Map a CAQH `Education` entry to the internal education shape, including
   * the `educationType` enum (UNDERGRADUATE / MEDICAL_SCHOOL / RESIDENCY /
   * FELLOWSHIP / etc.) parsed from `EducationType` or `ProgramType`.
   * Requires institutionName + degree to be present.
   */
  private mapV8Education(
    e: CaqhV8Education,
    providerId?: string,
  ): MappedCaqhData['education'][number] | null {
    const institutionName = toOptString(e.InstitutionName ?? e.Institution);
    const degreeRaw = toOptString(e.Degree ?? e.DegreeType);
    if (!institutionName) {
      logger.warn({
        event: 'caqh_skip_education_incomplete',
        providerId,
        have: { institutionName: false },
      });
      return null;
    }
    const educationType = this.mapEducationType(e.EducationType ?? e.ProgramType);
    return {
      institutionName,
      degree: this.mapDegreeType(degreeRaw ?? '', providerId),
      graduationDate: parseCaqhDate(e.GraduationDate),
      startDate: parseCaqhDate(e.StartDate),
      endDate: parseCaqhDate(e.EndDate),
      country: toOptString(e.Country) ?? 'US',
      city: toOptString(e.City),
      state: toOptString(e.State),
      postalCode: toOptString(e.PostalCode ?? e.ZipCode),
      addressLine1: toOptString(e.AddressLine1 ?? e.Address),
      educationType,
    };
  }

  /**
   * Match CAQH education type description to the internal `EducationType`
   * enum. Tokenized matching with synonyms; returns undefined when the value
   * doesn't fit any known bucket so the field is simply omitted (column is
   * nullable).
   */
  private mapEducationType(raw: unknown): EducationType | undefined {
    const s = toOptString(raw)?.toUpperCase();
    if (!s) return undefined;
    // Order matters: more-specific patterns first to avoid substring collisions
    // (e.g., "Continuing Medical Education" must not match MEDICAL_SCHOOL).
    if (s.includes('CONTINU')) return 'CONTINUING_EDUCATION';
    if (s.includes('POST') && (s.includes('DOC') || s.includes('GRAD'))) return 'POST_DOCTORAL';
    if (s.includes('FELLOW')) return 'FELLOWSHIP';
    if (s.includes('RESIDEN')) return 'RESIDENCY';
    if (s.includes('INTERN')) return 'INTERNSHIP';
    if (s.includes('UNDERGRAD')) return 'UNDERGRADUATE';
    if (s.includes('MEDICAL') || s.includes('MED SCHOOL')) return 'MEDICAL_SCHOOL';
    if (s.includes('GRADUATE')) return 'GRADUATE_SCHOOL';
    return 'OTHER';
  }

  /**
   * Map a CAQH `Insurance` (malpractice) entry to the internal malpractice
   * shape, including extended flags (self-insured, unlimited, individual)
   * and a normalized `coveredPractices` hint array. Auto-matching of
   * coveredPractices to `PracticeLocation` happens at persistence time
   * (`applyCaqhDataToProvider`) by exact name then by address.
   *
   * Requires policyNumber + expirationDate to be present.
   */
  private mapV8Malpractice(
    i: CaqhV8Insurance,
    providerId?: string,
  ): MappedCaqhData['malpractice'][number] | null {
    const policyNumber = toOptString(i.PolicyNumber);
    const expirationDate = toOptString(i.ExpirationDate);
    const carrierName = toOptString(i.CarrierName);
    if (!policyNumber || !expirationDate || !carrierName) {
      logger.warn({
        event: 'caqh_skip_malpractice_incomplete',
        providerId,
        have: { policyNumber: !!policyNumber, expirationDate: !!expirationDate, carrierName: !!carrierName },
      });
      return null;
    }
    const perClaim = toOptNumber(i.PerClaimAmount ?? i.PerOccurrenceAmount);
    const aggregate = toOptNumber(i.AggregateAmount);
    const coverageType = this.mapCoverageType(i.CoverageType);
    // CoveredPractices may arrive as object/array/wrapped — normalize to array
    const cpRaw = i.CoveredPractices;
    let cpList: CaqhV8CoveredPractice[] = [];
    if (cpRaw != null) {
      if (Array.isArray(cpRaw)) {
        cpList = cpRaw;
      } else if (typeof cpRaw === 'object') {
        // Handle `{CoveredPractice: [...] | {...}}` wrapper
        const wrapper = cpRaw as { CoveredPractice?: CaqhV8CoveredPractice | CaqhV8CoveredPractice[] };
        if (wrapper.CoveredPractice != null) {
          cpList = this.asArray(wrapper.CoveredPractice);
        } else {
          cpList = [cpRaw as CaqhV8CoveredPractice];
        }
      }
    }
    const coveredPractices = cpList
      .map(cp => this.mapCoveredPractice(cp))
      .filter((c): c is NonNullable<MappedCaqhData['malpractice'][number]['coveredPractices']>[number] => c !== null);

    return {
      carrierName,
      policyNumber,
      expirationDate,
      effectiveDate: toOptString(i.EffectiveDate),
      perClaimAmount: perClaim,
      aggregateAmount: aggregate,
      coverageType,
      isSelfInsured: toOptBool(i.IsSelfInsured ?? i.SelfInsuredFlag),
      hasUnlimitedCoverage: toOptBool(i.HasUnlimitedCoverage ?? i.UnlimitedCoverageFlag),
      isIndividualCoverage: toOptBool(i.IsIndividualCoverage ?? i.IndividualCoverageFlag),
      coveredPractices: coveredPractices.length > 0 ? coveredPractices : undefined,
    };
  }

  private mapCoverageType(raw: unknown): CoverageType | undefined {
    const s = toOptString(raw)?.toLowerCase();
    if (!s) return undefined;
    if (s.includes('claim')) return 'claims_made';
    if (s.includes('occurrence')) return 'occurrence';
    return undefined;
  }

  private mapCoveredPractice(
    cp: CaqhV8CoveredPractice,
  ): NonNullable<MappedCaqhData['malpractice'][number]['coveredPractices']>[number] | null {
    const rawLabel = toOptString(cp.PracticeName ?? cp.Name);
    const addressLine1 = toOptString(cp.AddressLine1 ?? cp.Address);
    const city = toOptString(cp.City);
    const state = toOptString(cp.State);
    const zipCode = toOptString(cp.ZipCode ?? cp.PostalCode);
    if (!rawLabel && !addressLine1) return null;
    return { rawLabel, addressLine1, city, state, zipCode };
  }

  /**
   * Map a CAQH `ProviderCDS` entry to the internal CDS registration shape.
   * `cdsNumber` is returned as plaintext — the persistence layer encrypts
   * via `encryptSafe()` before writing to `cds_registrations.cds_number_encrypted`.
   * Requires CDSNumber + State to be present.
   */
  private mapV8CDS(
    c: CaqhV8CDS,
    providerId?: string,
  ): NonNullable<MappedCaqhData['cdsRegistrations']>[number] | null {
    const cdsNumber = toOptString(c.CDSNumber ?? c.Number);
    const state = toOptString(c.State);
    if (!cdsNumber || !state) {
      logger.warn({
        event: 'caqh_skip_cds_incomplete',
        providerId,
        have: { cdsNumber: !!cdsNumber, state: !!state },
      });
      return null;
    }
    return {
      cdsNumber,
      state,
      expirationDate: parseCaqhDate(c.ExpirationDate),
      issueDate: parseCaqhDate(c.IssueDate ?? c.EffectiveDate),
    };
  }

  // ======================================================================
  // Phase 2 — v9 full-coverage mappers
  // (Disclosures, Malpractice Claims, Hospital Affiliations,
  //  Work History detail, Time Gaps, Practice Supervisors)
  // ======================================================================

  /**
   * Map a CAQH `Disclosure` element to a ProviderDisclosure shape.
   * Question 21150 ("Had any Malpractice Actions") is intentionally
   * dropped here — the dispatcher routes its nested Malpractice payload
   * into `malpracticeClaims` so we don't double-store the same fact.
   */
  private mapV8Disclosure(
    d: CaqhV8Disclosure,
    providerId?: string,
  ): NonNullable<MappedCaqhData['disclosures']>[number] | null {
    const id = toOptString(d.ID);
    if (!id) return null;
    if (id === '21150') return null; // routed to MalpracticeClaim instead
    const summary = toOptString(
      (d.DisclosureQuestion as { DisclosureSummary?: unknown } | undefined)?.DisclosureSummary,
    );
    if (!summary) {
      logger.warn({ event: 'caqh_skip_disclosure_no_summary', providerId, id });
      return null;
    }
    const answer = toOptBool(d.DisclosureAnswerFlag) ?? false;
    return {
      caqhQuestionId: id,
      questionText: summary,
      answer,
      explanation: toOptString(d.DisclosureExplanation),
      category: this.mapDisclosureCategory(id, summary),
    };
  }

  /**
   * Derive a ProviderDisclosure category from the CAQH question ID
   * (preferred) and falling back to the question summary text. The
   * mapping is closed over the 23 question IDs in the v9 spec
   * (21000–21220). Unknown IDs fall through to OTHER.
   */
  private mapDisclosureCategory(id: string, summary: string): DisclosureCategory {
    switch (id) {
      case '21000': // Suspended License or License Problems
      case '21130': // Sanctions from Regulatory Agency
        return 'LICENSE_ACTION';
      case '21010': // State Licensing Board Reprimand or Fine
      case '21080': // Adverse Board Action (variant)
        return 'BOARD_ACTION';
      case '21020': // Suspended Clinical Privileges
      case '21030': // Voluntarily limited privileges
      case '21040': // Privilege denial / non-renewal
      case '21050':
      case '21060':
        return 'HOSPITAL_PRIVILEGES';
      case '21100': // Medicare/Medicaid discipline
      case '21110': // Medicare exclusion
        return 'MEDICARE_MEDICAID';
      case '21120': // NPDB report
        return 'OTHER';
      case '21160': // Convicted of Felony
      case '21170': // Convicted of Sexual Offense
        return 'FELONY_CONVICTION';
      case '21180': // Court-martialed (military criminal action)
        return 'MISDEMEANOR_CONVICTION';
      case '21190': // Use Illegal Drugs
      case '21200': // Use Chemical Substances
        return 'SUBSTANCE_ABUSE';
      case '21210': // A Risk to Safety of Patients
      case '21220': // Unable to perform without Accommodations
        return 'ABILITY_TO_PERFORM';
      default: {
        // Fall back to summary-text matching for any IDs the v9 spec
        // adds beyond the 23 we know about today.
        const s = summary.toLowerCase();
        if (s.includes('felony')) return 'FELONY_CONVICTION';
        if (s.includes('misdemeanor') || s.includes('court-martial')) return 'MISDEMEANOR_CONVICTION';
        if (s.includes('drug') || s.includes('substance') || s.includes('chemical')) return 'SUBSTANCE_ABUSE';
        if (s.includes('privilege')) return 'HOSPITAL_PRIVILEGES';
        if (s.includes('medicare') || s.includes('medicaid')) return 'MEDICARE_MEDICAID';
        if (s.includes('insurance denial')) return 'INSURANCE_DENIAL';
        if (s.includes('safety') || s.includes('perform') || s.includes('accommodation')) return 'ABILITY_TO_PERFORM';
        if (s.includes('license') || s.includes('sanction')) return 'LICENSE_ACTION';
        if (s.includes('board')) return 'BOARD_ACTION';
        if (s.includes('malpractice')) return 'MALPRACTICE';
        return 'OTHER';
      }
    }
  }

  /**
   * Map a CAQH `Malpractice` element (nested under Disclosure 21150) to
   * a MalpracticeClaim shape. Settlement amounts and the resolution
   * date live inside a nested `ClaimStatus` envelope; the claim status
   * string ("Closed", "Open") and resolution-method string both feed
   * the `ClaimStatus` enum derivation.
   */
  private mapV8MalpracticeClaim(
    m: CaqhV8MalpracticeClaim,
    providerId?: string,
  ): NonNullable<MappedCaqhData['malpracticeClaims']>[number] | null {
    const carrier = toOptString(m.InsuranceCarrierName);
    const allegation = toOptString(m.AllegationDescription);
    const injury = toOptString(m.PatientInjuryDescription);
    // We need *something* to anchor the claim — at minimum an allegation, injury, or carrier.
    const description = allegation ?? injury ?? carrier;
    if (!description) {
      logger.warn({ event: 'caqh_skip_malpractice_claim_empty', providerId });
      return null;
    }
    const claimStatusRaw =
      typeof m.ClaimStatus === 'object' && m.ClaimStatus !== null
        ? (m.ClaimStatus as Record<string, unknown>)
        : undefined;
    const resolution =
      typeof m.MalpracticeResolution === 'object' && m.MalpracticeResolution !== null
        ? (m.MalpracticeResolution as { MalpracticeResolutionMethod?: unknown })
        : undefined;
    const resolutionMethod = toOptString(resolution?.MalpracticeResolutionMethod);
    return {
      caqhClaimId: toOptString(m.ID),
      insuranceCarrier: carrier,
      dateOfIncident: parseCaqhDate(m.OccurrenceDate),
      dateOfClaim: parseCaqhDate(m.ClaimDate),
      dateResolved: parseCaqhDate(claimStatusRaw?.['ClaimSettlementDate']),
      claimStatus: this.mapClaimStatus(toOptString(claimStatusRaw?.['ClaimStatus']), resolutionMethod),
      description,
      settlementAmount: toOptNumber(claimStatusRaw?.['SettlementAmount']),
      settlementAmountPaid: toOptNumber(claimStatusRaw?.['SettlementAmountPaid']),
      policyNumber: toOptString(m.PolicyNumber),
      allegationDescription: allegation,
      patientInjuryDescription: injury,
      isLeadDefendant: toOptBool(m.PrimaryDefendantFlag),
      numberOtherCodefendants: toOptNumber(m.NumberOtherCodefendant),
      caseInvolvement: toOptString(m.CaseInvolvement),
      npdbReported: toOptBool(m.NPDBCaseFlag),
      patientDied: toOptBool(m.PatientDiedFlag),
      resolutionMethod,
      courtAddressLine1: toOptString(m.Address),
      courtCity: toOptString(m.City),
      courtState: toOptString(m.State),
      courtZipCode: toOptString(m.Zip),
      courtPhone: toOptString(m.PhoneNumber),
      courtCountry: toOptString(
        typeof m.Country === 'object' && m.Country !== null
          ? (m.Country as { CountryName?: unknown }).CountryName
          : m.Country,
      ),
    };
  }

  /**
   * Translate CAQH ClaimStatus + MalpracticeResolutionMethod strings
   * into the internal `ClaimStatus` enum. Resolution wins over status
   * because it's more specific (e.g. "Judgment for Defendant" trumps
   * the generic "Closed").
   */
  private mapClaimStatus(rawStatus: string | undefined, rawResolution: string | undefined): ClaimStatus {
    const r = (rawResolution ?? '').toLowerCase();
    if (r.includes('judgment for defendant')) return 'JUDGMENT_FOR_PROVIDER';
    if (r.includes('judgment for plaintiff') || r.includes('judgment against')) return 'JUDGMENT_AGAINST_PROVIDER';
    if (r.includes('settle')) return 'SETTLED';
    if (r.includes('dismiss')) return 'DISMISSED';
    if (r.includes('withdraw')) return 'WITHDRAWN';
    const s = (rawStatus ?? '').toLowerCase();
    if (s.includes('open')) return 'OPEN';
    if (s.includes('closed')) return 'SETTLED'; // best generic guess for closed-without-resolution-detail
    return 'OPEN';
  }

  /**
   * Map a CAQH `Hospital` element to a HospitalAffiliation shape.
   * Privilege type and status enums are derived from the
   * HospitalAffiliationType description and StaffCategory respectively.
   * `facilityType` defaults to "hospital" — it's a NOT NULL column on
   * the table that CAQH doesn't directly populate.
   */
  private mapV8Hospital(
    h: CaqhV8Hospital,
    providerId?: string,
  ): NonNullable<MappedCaqhData['hospitalAffiliations']>[number] | null {
    const facilityName = toOptString(h.HospitalName);
    if (!facilityName) {
      logger.warn({ event: 'caqh_skip_hospital_no_name', providerId, id: toOptString(h.ID) });
      return null;
    }
    const affTypeDesc = toOptString(h.HospitalAffiliationType);
    const staffCategory = toOptString(h.StaffCategory);
    return {
      caqhAhaId: toOptString(h.AHAHospitalID),
      facilityName,
      privilegeType: this.mapPrivilegeType(affTypeDesc, toOptString(h.HospitalRecordType)),
      status: this.mapAffiliationStatus(staffCategory),
      addressLine1: toOptString(h.Address),
      city: toOptString(h.City),
      state: toOptString(h.State),
      zipCode: toOptString(h.ZipCode),
      country: toOptString(
        typeof h.Country === 'object' && h.Country !== null
          ? (h.Country as { CountryName?: unknown }).CountryName
          : h.Country,
      ),
      phoneNumber: toOptString(h.PhoneNumber),
      faxNumber: toOptString(h.FaxNumber),
      department: toOptString(h.Department),
      startDate: parseCaqhDate(h.StartDate),
      endDate: parseCaqhDate(h.EndDate),
      hasUnrestrictedPrivileges: toOptBool(h.UnrestrictedPrivilegesFlag),
      hasTemporaryPrivileges: toOptBool(h.TemporaryPrivilegesFlag),
      privilegeDescription: toOptString(h.PrivilegeDescription),
      admissionPercent: toOptNumber(h.AdmissionPercent),
      staffCategory,
      hospitalRecordType: toOptString(h.HospitalRecordType),
      hospitalAffiliationType: affTypeDesc,
      reasonForDiscontinuance: toOptString(h.ReasonForDiscontinuance),
      exitExplanation: toOptString(h.ExitExplanation),
      description: toOptString(h.Description),
      whoAdmitsForYou: toOptString(h.WhoAdmitsForyou ?? h.WhoAdmitsForYou),
      admittingProviderFirstName: toOptString(h.FirstName),
      admittingProviderLastName: toOptString(h.LastName),
      admittingContactPhone: toOptString(h.AdmittingContactPhoneNumber),
      admittingContactEmail: toOptString(h.AdmittingContactEmailAddress),
      isAdmitterSameSpecialty: toOptBool(h.IsProviderSpecialtySameAsYourSpecialty),
    };
  }

  /**
   * Map CAQH HospitalAffiliationType ("Primary" / "Courtesy" /
   * "Consulting" / "Other") + HospitalRecordType to PrivilegeType
   * enum. Defaults to `active` when the spec value doesn't match.
   */
  private mapPrivilegeType(affType: string | undefined, recordType: string | undefined): PrivilegeType {
    const s = (affType ?? '').toLowerCase();
    if (s.includes('primary')) return 'admitting';
    if (s.includes('courtesy')) return 'courtesy';
    if (s.includes('consulting')) return 'consulting';
    if (s.includes('teaching')) return 'teaching';
    if (s.includes('locum')) return 'locum_tenens';
    if (s.includes('temporary')) return 'temporary';
    if (s.includes('provisional')) return 'provisional';
    if (s.includes('affiliate')) return 'affiliate';
    const r = (recordType ?? '').toLowerCase();
    if (r.includes('admitting privilege')) return 'admitting';
    if (r.includes('non-admitting')) return 'affiliate';
    return 'active';
  }

  /**
   * Map CAQH StaffCategory ("Active" / "Inactive") to AffiliationStatus enum.
   */
  private mapAffiliationStatus(staffCategory: string | undefined): AffiliationStatus {
    const s = (staffCategory ?? '').toLowerCase();
    if (s.includes('inactive') || s.includes('resigned') || s.includes('terminat')) return 'inactive';
    if (s.includes('pending')) return 'pending';
    if (s.includes('denied')) return 'denied';
    return 'active';
  }

  /**
   * Map a CAQH `WorkHistory` element to a WorkHistory entry shape.
   * `isCurrent` is derived from CurrentEmployerFlag (preferred) or
   * StatusDescription. Address fields tolerate either ZipCode or
   * PostalCode naming.
   */
  private mapV8WorkHistoryEntry(
    w: CaqhV8WorkHistoryEntry,
    providerId?: string,
  ): NonNullable<MappedCaqhData['workHistory']>[number] | null {
    const organizationName = toOptString(w.EmployerName);
    if (!organizationName) {
      logger.warn({ event: 'caqh_skip_workhistory_no_employer', providerId, id: toOptString(w.ID) });
      return null;
    }
    const currentEmployerFlag = toOptBool(w.CurrentEmployerFlag);
    const status = toOptString(w.StatusDescription);
    const isCurrent =
      currentEmployerFlag ?? (status ? status.toLowerCase() === 'present' : false);
    const workHistoryType = toOptString(w.WorkHistoryType);
    return {
      caqhWorkHistoryId: toOptString(w.ID),
      organizationName,
      addressLine1: toOptString(w.Address),
      city: toOptString(w.City),
      state: toOptString(w.State),
      zipCode: toOptString(w.PostalCode ?? w.ZipCode),
      country: toOptString(
        typeof w.Country === 'object' && w.Country !== null
          ? (w.Country as { CountryName?: unknown }).CountryName
          : w.Country,
      ),
      phone: toOptString(w.PhoneNumber),
      fax: toOptString(w.FaxNumber),
      email: toOptString(w.EmailAddress),
      startDate: parseCaqhDate(w.StartDate),
      endDate: parseCaqhDate(w.EndDate),
      isCurrent,
      currentEmployerFlag,
      statusDescription: status,
      workHistoryType,
      position: toOptString(w.Position),
      department: toOptString(w.Department),
      reasonForLeaving: toOptString(w.ReasonForLeaving),
      supervisorName: toOptString(w.SupervisorName),
      supervisorPhone: toOptString(w.SupervisorPhone),
    };
  }

  /**
   * Map a CAQH `TimeGap` element. Both startDate and endDate are
   * required by the WorkHistoryGap table; rows missing either are
   * skipped.
   */
  private mapV8TimeGap(
    g: CaqhV8TimeGap,
    providerId?: string,
  ): NonNullable<MappedCaqhData['workHistoryGaps']>[number] | null {
    const startDate = parseCaqhDate(g.StartDate);
    const endDate = parseCaqhDate(g.EndDate);
    if (!startDate || !endDate) {
      logger.warn({
        event: 'caqh_skip_timegap_incomplete',
        providerId,
        id: toOptString(g.ID),
        have: { startDate: !!startDate, endDate: !!endDate },
      });
      return null;
    }
    return {
      caqhGapId: toOptString(g.ID),
      startDate,
      endDate,
      gapExplanation: toOptString(g.GapExplanation),
      gapDescription: toOptString(g.GapDescription),
    };
  }

  /**
   * Map a CAQH `Practice` element to a per-practice supervisor entry.
   * CAQH carries the supervisor as a single `SupervisorName` string; we
   * split on the first space into firstName + lastName so the row
   * matches the SupervisingPhysician schema. Practice metadata is
   * captured for the writer to auto-link the row to an existing
   * `PracticeLocation` by name or address.
   */
  private mapV8PracticeSupervisor(
    p: CaqhV8Practice,
    providerId?: string,
  ): NonNullable<MappedCaqhData['practiceSupervisors']>[number] | null {
    const fullName = toOptString(p.SupervisorName);
    if (!fullName) return null; // not every practice has a supervisor
    const parts = fullName.split(/\s+/);
    if (parts.length < 2) {
      logger.warn({
        event: 'caqh_skip_supervisor_unparseable_name',
        providerId,
        practiceId: toOptString(p.ID),
        fullName,
      });
      return null;
    }
    const supervisorFirstName = parts[0]!;
    const supervisorLastName = parts.slice(1).join(' ');
    return {
      supervisorFirstName,
      supervisorLastName,
      supervisorNpi: toOptString(p.SupervisorNPI),
      caqhSupervisorId: toOptString(p.SupervisorCAQHId),
      caqhPracticeId: toOptString(p.ID),
      practiceName: toOptString(p.PracticeName),
      practiceAddressLine1: toOptString(p.AddressLine1 ?? p.Address),
      practiceCity: toOptString(p.City),
      practiceState: toOptString(p.State),
      practiceZipCode: toOptString(p.PostalCode ?? p.ZipCode),
    };
  }

  /**
   * Match common life-support cert names to the IdentifierType enum.
   * Descriptions seen in real CAQH: "Cardio-Pulmonary Resuscitation (CPR)",
   * "Basic Life Support (BLS)", "Advanced Cardiac Life Support (ACLS)",
   * "Pediatric Advanced Life Support (PALS)", etc.
   */
  private mapLifeSupportCertType(description: string): IdentifierType {
    const s = description.toUpperCase();
    if (s.includes('PALS') || s.includes('PEDIATRIC ADVANCED')) return 'PALS';
    if (s.includes('ACLS') || s.includes('ADVANCED CARDIAC')) return 'ACLS';
    if (s.includes('BLS') || s.includes('BASIC LIFE')) return 'BLS';
    if (s.includes('CPR') || s.includes('CARDIO-PULMONARY') || s.includes('CARDIOPULMONARY')) return 'CPR';
    return 'OTHER';
  }

  /**
   * Extract the specialty name from a CAQH `Specialty` entry.
   * Real payloads nest as `{ Specialty: { SpecialtyName: "..." } }`; some
   * payloads flatten to `SpecialtyName` at the top level.
   */
  private extractSpecialtyName(s: CaqhV8Specialty): string | undefined {
    const nested = s.Specialty as { SpecialtyName?: unknown } | undefined;
    return toOptString(nested?.SpecialtyName) ?? toOptString(s.SpecialtyName);
  }

  /**
   * Map CAQH `Specialty` entry to a medical board certification row.
   * Only imports when BoardCertifiedFlag=1. Requires boardName + specialty to
   * be present. ExpirationDate is only set when BoardCertificationExpiresFlag=1.
   */
  private mapV8BoardCert(s: CaqhV8Specialty, providerId?: string): MappedCaqhData['certifications'][number] | null {
    const isCertified = toOptBool(s.BoardCertifiedFlag);
    if (isCertified !== true) return null;
    const boardName = toOptString(s.SpecialtyBoardName);
    const specialty = this.extractSpecialtyName(s);
    if (!boardName || !specialty) {
      logger.warn({
        event: 'caqh_skip_board_cert_incomplete',
        providerId,
        have: { boardName: !!boardName, specialty: !!specialty },
      });
      return null;
    }
    const hasExpiry = toOptBool(s.BoardCertificationExpiresFlag);
    return {
      boardType: this.mapBoardType(boardName, providerId),
      boardName,
      specialty,
      initialCertificationDate: parseCaqhDate(s.CertificationDate),
      expirationDate: hasExpiry ? parseCaqhDate(s.BoardCertificationExpirationDate) : undefined,
      caqhSpecialtyId: toOptString(s.ID),
      certificationNumber: toOptString(s.CertificationNumber),
      nuccTaxonomyCode: toOptString(s.NUCCTaxonomyCode),
      isBoardCertified: true,
    };
  }

  /**
   * Map CAQH `Specialty` entry to a specialty link record (unlike board cert,
   * this is NOT gated on BoardCertifiedFlag — every specialty the provider
   * lists is stored). `isPrimary` is set when SpecialtyType description is
   * "Primary" (case-insensitive).
   */
  private mapV8Specialty(s: CaqhV8Specialty, providerId?: string): MappedSpecialty | null {
    const name = this.extractSpecialtyName(s);
    if (!name) {
      logger.warn({
        event: 'caqh_skip_specialty_incomplete',
        providerId,
        have: { name: false },
      });
      return null;
    }
    const typeStr = toOptString(s.SpecialtyType)?.toLowerCase() ?? '';
    const isPrimary = typeStr === 'primary' || typeStr.includes('primary');
    return {
      name,
      nuccTaxonomyCode: toOptString(s.NUCCTaxonomyCode),
      isPrimary,
      caqhSpecialtyId: toOptString(s.ID),
    };
  }

  private mapV8License(l: CaqhV8License, providerId?: string): MappedCaqhData['licenses'][number] | null {
    const licenseNumber = toOptString(l.LicenseNumber);
    const state = toOptString(l.State ?? l.LicenseState);
    const expirationDate = parseCaqhDate(l.ExpirationDate);
    if (!licenseNumber || !state || !expirationDate) {
      logger.warn({
        event: 'caqh_skip_license_incomplete',
        providerId,
        have: { licenseNumber: !!licenseNumber, state: !!state, expirationDate: !!expirationDate },
      });
      return null;
    }
    return {
      licenseType: this.mapLicenseType(toOptString(l.LicenseType) ?? '', providerId),
      licenseNumber,
      state,
      expirationDate,
      issueDate: parseCaqhDate(l.IssueDate),
      caqhLicenseId: toOptString(l.ID),
      currentlyPracticing: toOptBool(l.CurrentlyPracticingFlag),
      isPrimary: toOptBool(l.IsPrimary),
      status: this.mapLicenseStatus(toOptString(l.LicenseStatus)),
      issuingAuthority: toOptString(l.IssuingAuthority),
    };
  }

  private mapLicenseStatus(raw: string | undefined): CredentialStatus | undefined {
    if (!raw) return undefined;
    const v = raw.toLowerCase();
    if (v.includes('active') || v.includes('current')) return 'active';
    if (v.includes('expir')) return 'expired';
    if (v.includes('revok') || v.includes('suspend')) return 'revoked';
    if (v.includes('pend')) return 'pending';
    return undefined;
  }

  private mapIdentifierType(raw: unknown, providerId?: string): IdentifierType {
    const str = toOptString(raw);
    if (!str) return 'OTHER';
    const v = str.toUpperCase().replace(/[\s-]+/g, '_');
    const direct: Record<string, IdentifierType> = {
      MEDICARE_PTAN: 'MEDICARE_PTAN',
      PTAN: 'MEDICARE_PTAN',
      MEDICARE_PECOS_ID: 'MEDICARE_PECOS_ID',
      PECOS: 'MEDICARE_PECOS_ID',
      MEDICARE_PECOS: 'MEDICARE_PECOS_ID',
      MEDICAID: 'MEDICAID_ID',
      MEDICAID_ID: 'MEDICAID_ID',
      TRICARE: 'TRICARE_ID',
      TRICARE_ID: 'TRICARE_ID',
      RAILROAD_MEDICARE: 'RAILROAD_MEDICARE_ID',
      RAILROAD_MEDICARE_ID: 'RAILROAD_MEDICARE_ID',
      STATE_LICENSE: 'STATE_LICENSE_ID',
      STATE_LICENSE_ID: 'STATE_LICENSE_ID',
      PAYER: 'PAYER_SPECIFIC_ID',
      PAYER_SPECIFIC_ID: 'PAYER_SPECIFIC_ID',
      UPIN: 'UPIN',
      CDS: 'CDS',
      ACLS: 'ACLS',
      BLS: 'BLS',
      PALS: 'PALS',
      CPR: 'CPR',
    };
    // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn; `v` is derived from CAQH API payload
    const match = Object.hasOwn(direct, v) ? direct[v] : undefined;
    if (match) return match;
    logger.warn({
      event: 'caqh_unknown_mapping',
      field: 'identifierType',
      rawValue: raw,
      defaultedTo: 'OTHER',
      providerId,
    });
    return 'OTHER';
  }

  private mapLicenseType(caqhType: string, providerId?: string): LicenseType {
    const mapping: Record<string, LicenseType> = {
      'MD': 'state_medical',
      'DO': 'state_medical',
      'PSY': 'state_psychology',
      'SW': 'state_social_work',
      'LPC': 'state_counseling',
      'MFT': 'state_marriage_family',
      'DEA': 'dea',
      'CDS': 'controlled_substance',
    };
    // eslint-disable-next-line security/detect-object-injection -- guarded by Object.hasOwn; caqhType is from CAQH API, not user HTTP input
    const result = Object.hasOwn(mapping, caqhType) ? mapping[caqhType] : undefined;
    if (!result) {
      logger.warn({
        event: 'caqh_unknown_mapping',
        field: 'licenseType',
        rawValue: caqhType,
        defaultedTo: 'state_medical',
        providerId,
      });
      return 'state_medical';
    }
    return result;
  }

  private mapBoardType(caqhBoard: string, providerId?: string): BoardType {
    const boardLower = caqhBoard.toLowerCase();

    if (boardLower.includes('psychiatry')) return 'abpn_psychiatry';
    if (boardLower.includes('psychology')) return 'abpp_clinical';
    if (boardLower.includes('social work')) return 'abecsw';
    if (boardLower.includes('counselor')) return 'nbcc';
    if (boardLower.includes('marriage') || boardLower.includes('family')) return 'aamft';
    if (boardLower.includes('nurse')) return 'ancc_pmhnp';

    logger.warn({
      event: 'caqh_unknown_mapping',
      field: 'boardType',
      rawValue: caqhBoard,
      defaultedTo: 'other',
      providerId,
    });
    return 'other';
  }

  private mapDegreeType(caqhDegree: string, providerId?: string): DegreeType {
    // Exact match on the CAQH "Degree (Extract)" code, verified against
    // Domain_Table_Effective_07142025.xlsx. Substring matching is wrong here
    // (e.g. optometry "OD" must not match osteopathic "DO"). Unmapped codes →
    // 'other' (fail-closed; payer adapters then require human confirmation).
    // SW = generic "Social Worker" → master's-level MSW, what a credentialed
    // clinical SW holds (flagged assumption).
    const code = caqhDegree.trim().toUpperCase();
    const mapped = CAQH_DEGREE_CODE_TO_TYPE.get(code);
    if (mapped) return mapped;

    if (code) {
      logger.warn({
        event: 'caqh_unknown_mapping',
        field: 'degreeType',
        rawValue: caqhDegree,
        defaultedTo: 'other',
        providerId,
      });
    }
    return 'other';
  }

  /**
   * Full sync flow for a single provider: pull → map → apply → log.
   * Used by both the manual pull route and the nightly scheduler.
   */
  async syncProvider(providerId: string, caqhProviderId: string): Promise<{
    syncId: string;
    changes: CaqhSyncSummary;
  }> {
    const startTime = Date.now();

    const syncLog = await prisma.caqhSyncLog.create({
      data: {
        providerId,
        direction: 'pull',
        status: 'in_progress',
      },
    });

    try {
      // Step 1: Get provider status to extract attestation date
      const status = await this.checkStatus(caqhProviderId);
      const rawDate = status.provider_status_date || status.anniversary_date;

      if (!rawDate) {
        throw new Error('CAQH status response missing attestation date (provider_status_date and anniversary_date both empty)');
      }

      const attestationDate = this.yyyymmddToMDYYYY(rawDate);

      // Step 2: Pull credentials using the attestation date
      const rawCaqhData = await this.pullCredentials(caqhProviderId, attestationDate);

      // Persist raw response immediately — survives downstream mapper errors
      // so failed syncs can still be debugged against the actual CAQH payload.
      // Stored encrypted only; updates also clear any legacy plaintext so every
      // sync scrubs the old column even before the backfill runs.
      const rawJsonEncrypted = encryptMirrorPayload(rawCaqhData);
      await prisma.providerCaqhMirror.upsert({
        where: { providerProfileId: providerId },
        create: {
          providerProfileId: providerId,
          rawJsonEncrypted,
          rawJson: Prisma.DbNull,
          lastPulledAt: new Date(),
          syncStatus: 'pending',
        },
        update: {
          rawJsonEncrypted,
          rawJson: Prisma.DbNull,
          lastPulledAt: new Date(),
          syncStatus: 'pending',
        },
      });

      let caqhData: MappedCaqhData;
      try {
        caqhData = this.mapCaqhToInternal(rawCaqhData, providerId);
      } catch (mapError) {
        logger.error({
          event: 'caqh_map_error',
          providerId,
          caqhProviderId,
          error: mapError instanceof Error ? mapError.message : 'Unknown map error',
          rawKeys: rawCaqhData && typeof rawCaqhData === 'object' ? Object.keys(rawCaqhData) : [],
        });
        await prisma.providerCaqhMirror.update({
          where: { providerProfileId: providerId },
          data: { syncStatus: 'failed' },
        });
        throw mapError;
      }
      await this.applyProviderCore(providerId, caqhData);
      const changes = await this.applyCaqhDataToProvider(providerId, caqhData);

      const durationMs = Date.now() - startTime;

      await prisma.caqhSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          changesApplied: changes as any,
          durationMs,
        },
      });

      logger.info({
        event: 'caqh_sync_complete',
        providerId,
        durationMs,
        changes,
      });

      await prisma.providerProfile.update({
        where: { id: providerId },
        data: { caqhLastSync: new Date() },
      });

      await prisma.providerCaqhMirror.update({
        where: { providerProfileId: providerId },
        data: { syncStatus: 'success' },
      });

      return { syncId: syncLog.id, changes };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      await prisma.caqhSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          durationMs,
        },
      });
      throw error;
    }
  }

  /**
   * Phase 1: persist CAQH provider-core demographics, addresses, and identifiers.
   * Fields already present on the ProviderProfile row are NOT overwritten if the
   * incoming CAQH value is blank/undefined — CAQH is additive, not authoritative,
   * for existing records.
   */
  async applyProviderCore(providerId: string, caqhData: MappedCaqhData): Promise<void> {
    const core = caqhData.provider;
    if (!core) return;

    const updateData: Record<string, unknown> = {};
    if (core.firstName) updateData['firstName'] = core.firstName;
    if (core.lastName) updateData['lastName'] = core.lastName;
    if (core.middleName !== undefined) updateData['middleName'] = core.middleName;
    if (core.suffix !== undefined) updateData['suffix'] = core.suffix;
    if (core.degree !== undefined) updateData['degree'] = core.degree;
    if (core.dateOfBirth) updateData['dateOfBirth'] = core.dateOfBirth;
    if (core.gender) updateData['gender'] = core.gender;
    if (core.ssn) updateData['ssnEncrypted'] = encryptSafe(core.ssn);
    if (core.primaryPracticeState) updateData['primaryPracticeState'] = core.primaryPracticeState;
    if (core.otherPracticeState) updateData['otherPracticeState'] = core.otherPracticeState;
    if (core.hospitalBasedFlag !== undefined) updateData['hospitalBasedFlag'] = core.hospitalBasedFlag;
    if (core.hospitalPrivilegeFlag !== undefined) updateData['hospitalPrivilegeFlag'] = core.hospitalPrivilegeFlag;
    if (core.fellowshipTrainingFlag !== undefined) updateData['fellowshipTrainingFlag'] = core.fellowshipTrainingFlag;
    if (core.secondarySpecialtyFlag !== undefined) updateData['secondarySpecialtyFlag'] = core.secondarySpecialtyFlag;
    if (core.activeMilitaryFlag !== undefined) updateData['activeMilitaryFlag'] = core.activeMilitaryFlag;
    if (core.workHistoryGapFlag !== undefined) updateData['workHistoryGapFlag'] = core.workHistoryGapFlag;
    if (core.acceptingMedicare !== undefined) updateData['acceptingMedicare'] = core.acceptingMedicare;
    if (core.acceptingMedicaid !== undefined) updateData['acceptingMedicaid'] = core.acceptingMedicaid;

    if (Object.keys(updateData).length > 0) {
      await prisma.providerProfile.update({
        where: { id: providerId },
        data: updateData,
      });
    }

    // Ethnicity → demographics table (upsert, single row per provider)
    if (core.ethnicity) {
      await prisma.providerDemographics.upsert({
        where: { providerId },
        create: { providerId, ethnicity: core.ethnicity },
        update: { ethnicity: core.ethnicity },
      });
    }

    // Addresses — match on type+line1+zip (CAQH is source of truth for non-manual)
    for (const addr of caqhData.addresses) {
      const existing = await prisma.providerAddress.findFirst({
        where: {
          providerId,
          type: addr.type,
          addressLine1: addr.addressLine1,
          zipCode: addr.zipCode,
        },
      });
      if (existing) {
        await prisma.providerAddress.update({
          where: { id: existing.id },
          data: {
            addressLine2: addr.addressLine2 ?? existing.addressLine2,
            city: addr.city,
            state: addr.state,
            country: addr.country ?? existing.country,
          },
        });
      } else {
        await prisma.providerAddress.create({
          data: {
            providerId,
            type: addr.type,
            addressLine1: addr.addressLine1,
            addressLine2: addr.addressLine2,
            city: addr.city,
            state: addr.state,
            zipCode: addr.zipCode,
            country: addr.country ?? 'US',
          },
        });
      }
    }

    // Identifiers — match on type + value
    for (const ident of caqhData.identifiers) {
      const existing = await prisma.providerIdentifier.findFirst({
        where: {
          providerId,
          identifierType: ident.identifierType,
          identifierValue: ident.identifierValue,
        },
      });
      if (existing) {
        await prisma.providerIdentifier.update({
          where: { id: existing.id },
          data: {
            issuingEntity: ident.issuingEntity ?? existing.issuingEntity,
            state: ident.state ?? existing.state,
            effectiveDate: ident.effectiveDate ?? existing.effectiveDate,
            expirationDate: ident.expirationDate ?? existing.expirationDate,
            notes: ident.notes ?? existing.notes,
          },
        });
      } else {
        await prisma.providerIdentifier.create({
          data: {
            providerId,
            identifierType: ident.identifierType,
            identifierValue: ident.identifierValue,
            issuingEntity: ident.issuingEntity,
            state: ident.state,
            effectiveDate: ident.effectiveDate,
            expirationDate: ident.expirationDate,
            notes: ident.notes,
          },
        });
      }
    }
  }

  /**
   * Apply mapped CAQH data to provider records.
   * Skips records marked as source='manual_entry'.
   */
  async applyCaqhDataToProvider(
    providerId: string,
    caqhData: MappedCaqhData
  ): Promise<CaqhSyncSummary> {
    const summary: CaqhSyncSummary = {
      licenses: { created: 0, updated: 0, skipped: 0, failed: 0 },
      certifications: { created: 0, updated: 0, skipped: 0, failed: 0 },
      specialties: { created: 0, updated: 0, skipped: 0, failed: 0 },
      education: { created: 0, updated: 0, skipped: 0, failed: 0 },
      malpractice: { created: 0, updated: 0, skipped: 0, failed: 0 },
      providerCertifications: { created: 0, updated: 0, skipped: 0, failed: 0 },
      cdsRegistrations: { created: 0, updated: 0, skipped: 0, failed: 0 },
      disclosures: { created: 0, updated: 0, skipped: 0, failed: 0 },
      malpracticeClaims: { created: 0, updated: 0, skipped: 0, failed: 0 },
      hospitalAffiliations: { created: 0, updated: 0, skipped: 0, failed: 0 },
      workHistory: { created: 0, updated: 0, skipped: 0, failed: 0 },
      workHistoryGaps: { created: 0, updated: 0, skipped: 0, failed: 0 },
      practiceSupervisors: { created: 0, updated: 0, skipped: 0, failed: 0 },
      failedRecords: [],
    };

    // --- Licenses ---
    if (caqhData.licenses?.length > 0) {
      for (const lic of caqhData.licenses) {
        try {
          // Prefer stable CAQH record ID for dedupe; fall back to (providerId, licenseNumber, state)
          const existing = lic.caqhLicenseId
            ? await prisma.license.findFirst({ where: { providerId, caqhLicenseId: lic.caqhLicenseId } })
            : await prisma.license.findFirst({ where: { providerId, licenseNumber: lic.licenseNumber, state: lic.state } });

          if (existing) {
            if (existing.source === 'manual_entry') {
              summary.licenses.skipped++;
              continue;
            }
            await prisma.license.update({
              where: { id: existing.id },
              data: {
                licenseType: lic.licenseType ?? existing.licenseType,
                state: lic.state ?? existing.state,
                issueDate: lic.issueDate ?? existing.issueDate,
                expirationDate: lic.expirationDate,
                status: lic.status ?? existing.status,
                caqhLicenseId: lic.caqhLicenseId ?? existing.caqhLicenseId,
                isPrimary: lic.isPrimary ?? existing.isPrimary,
                currentlyPracticing: lic.currentlyPracticing ?? existing.currentlyPracticing,
                verificationSource: lic.issuingAuthority ?? existing.verificationSource,
                source: 'caqh_sync',
              },
            });
            summary.licenses.updated++;
          } else {
            await prisma.license.create({
              data: {
                providerId,
                licenseType: lic.licenseType,
                licenseNumber: lic.licenseNumber,
                state: lic.state,
                issueDate: lic.issueDate,
                expirationDate: lic.expirationDate,
                status: lic.status ?? 'active',
                caqhLicenseId: lic.caqhLicenseId,
                isPrimary: lic.isPrimary,
                currentlyPracticing: lic.currentlyPracticing,
                verificationSource: lic.issuingAuthority,
                source: 'caqh_sync',
              },
            });
            summary.licenses.created++;
          }
        } catch (error) {
          summary.licenses.failed++;
          summary.failedRecords.push({
            category: 'license',
            identifier: lic.licenseNumber,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- Board Certifications ---
    if (caqhData.certifications?.length > 0) {
      for (const cert of caqhData.certifications) {
        try {
          // Prefer stable CAQH Specialty ID for dedupe; fall back to (boardName, specialty)
          const existing = cert.caqhSpecialtyId
            ? await prisma.boardCertification.findFirst({ where: { providerId, caqhSpecialtyId: cert.caqhSpecialtyId } })
            : await prisma.boardCertification.findFirst({ where: { providerId, boardName: cert.boardName, specialty: cert.specialty } });

          if (existing) {
            if (existing.source === 'manual_entry') {
              summary.certifications.skipped++;
              continue;
            }
            await prisma.boardCertification.update({
              where: { id: existing.id },
              data: {
                boardType: cert.boardType ?? existing.boardType,
                boardName: cert.boardName ?? existing.boardName,
                specialty: cert.specialty ?? existing.specialty,
                certificationNumber: cert.certificationNumber ?? existing.certificationNumber,
                nuccTaxonomyCode: cert.nuccTaxonomyCode ?? existing.nuccTaxonomyCode,
                isBoardCertified: cert.isBoardCertified ?? existing.isBoardCertified,
                initialCertificationDate: cert.initialCertificationDate
                  ? new Date(cert.initialCertificationDate)
                  : existing.initialCertificationDate,
                expirationDate: cert.expirationDate ? new Date(cert.expirationDate) : existing.expirationDate,
                caqhSpecialtyId: cert.caqhSpecialtyId ?? existing.caqhSpecialtyId,
                source: 'caqh_sync',
              },
            });
            summary.certifications.updated++;
          } else {
            await prisma.boardCertification.create({
              data: {
                providerId,
                boardType: cert.boardType ?? 'other',
                boardName: cert.boardName,
                specialty: cert.specialty,
                certificationNumber: cert.certificationNumber,
                nuccTaxonomyCode: cert.nuccTaxonomyCode,
                isBoardCertified: cert.isBoardCertified ?? true,
                initialCertificationDate: cert.initialCertificationDate
                  ? new Date(cert.initialCertificationDate)
                  : null,
                expirationDate: cert.expirationDate ? new Date(cert.expirationDate) : undefined,
                caqhSpecialtyId: cert.caqhSpecialtyId,
                source: 'caqh_sync',
              },
            });
            summary.certifications.created++;
          }
        } catch (error) {
          summary.certifications.failed++;
          summary.failedRecords.push({
            category: 'certification',
            identifier: `${cert.boardName}/${cert.specialty}`,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- Specialties + NUCC Taxonomy (Phase 2d) ---
    const specList = caqhData.specialties ?? [];
    if (specList.length > 0) {
      let primaryTaxonomy: string | undefined;
      for (const spec of specList) {
        try {
          const specialtyRow = await this.upsertSpecialtyRow(spec);

          // Dedupe link on (providerId, specialtyId); caqhSpecialtyId preferred when present
          const existing = spec.caqhSpecialtyId
            ? await prisma.providerSpecialty.findFirst({
                where: { providerId, caqhSpecialtyId: spec.caqhSpecialtyId },
              })
            : await prisma.providerSpecialty.findFirst({
                where: { providerId, specialtyId: specialtyRow.id },
              });

          if (existing) {
            if (existing.source === 'manual_entry') {
              summary.specialties.skipped++;
              continue;
            }
            await prisma.providerSpecialty.update({
              where: { id: existing.id },
              data: {
                specialtyId: specialtyRow.id,
                isPrimary: spec.isPrimary,
                nuccTaxonomyCode: spec.nuccTaxonomyCode ?? existing.nuccTaxonomyCode,
                caqhSpecialtyId: spec.caqhSpecialtyId ?? existing.caqhSpecialtyId,
                source: 'caqh_sync',
              },
            });
            summary.specialties.updated++;
          } else {
            await prisma.providerSpecialty.create({
              data: {
                providerId,
                specialtyId: specialtyRow.id,
                isPrimary: spec.isPrimary,
                nuccTaxonomyCode: spec.nuccTaxonomyCode,
                caqhSpecialtyId: spec.caqhSpecialtyId,
                source: 'caqh_sync',
              },
            });
            summary.specialties.created++;
          }

          if (spec.isPrimary && spec.nuccTaxonomyCode) {
            primaryTaxonomy = spec.nuccTaxonomyCode;
          }
        } catch (error) {
          summary.specialties.failed++;
          summary.failedRecords.push({
            category: 'specialty',
            identifier: spec.name,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Copy primary NUCC code to ProviderProfile.taxonomy for convenience
      if (primaryTaxonomy) {
        try {
          await prisma.providerProfile.update({
            where: { id: providerId },
            data: { taxonomy: primaryTaxonomy },
          });
        } catch (error) {
          logger.warn({
            event: 'caqh_primary_taxonomy_update_failed',
            providerId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- Education ---
    if (caqhData.education?.length > 0) {
      for (const edu of caqhData.education) {
        try {
          // Dedup on (provider, institution) only — NOT degree. Keying on degree
          // meant a corrected degree (was the 'other' bug) created a duplicate row
          // instead of updating the existing one.
          const existing = await prisma.education.findFirst({
            where: { providerId, institutionName: edu.institutionName },
          });

          if (existing) {
            await prisma.education.update({
              where: { id: existing.id },
              data: {
                degree: edu.degree,
                graduationDate: edu.graduationDate ?? existing.graduationDate,
                startDate: edu.startDate ?? existing.startDate,
                endDate: edu.endDate ?? existing.endDate,
                educationType: edu.educationType ?? existing.educationType,
                city: edu.city ?? existing.city,
                state: edu.state ?? existing.state,
                postalCode: edu.postalCode ?? existing.postalCode,
                addressLine1: edu.addressLine1 ?? existing.addressLine1,
                source: 'caqh_sync',
              },
            });
            summary.education.updated++;
          } else {
            await prisma.education.create({
              data: {
                providerId,
                institutionName: edu.institutionName,
                degree: edu.degree,
                fieldOfStudy: edu.fieldOfStudy ?? 'Not specified',
                country: edu.country ?? 'US',
                startDate: edu.startDate ?? edu.graduationDate ?? new Date(),
                endDate: edu.endDate,
                graduationDate: edu.graduationDate,
                educationType: edu.educationType,
                city: edu.city,
                state: edu.state,
                postalCode: edu.postalCode,
                addressLine1: edu.addressLine1,
                source: 'caqh_sync',
              },
            });
            summary.education.created++;
          }
        } catch (error) {
          summary.education.failed++;
          summary.failedRecords.push({
            category: 'education',
            identifier: `${edu.institutionName}/${edu.degree}`,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- Malpractice Insurance ---
    const malpracticeList = Array.isArray(caqhData.malpractice)
      ? caqhData.malpractice
      : caqhData.malpractice ? [caqhData.malpractice] : [];
    if (malpracticeList.length > 0) {
      for (const mal of malpracticeList) {
        try {
          if (!mal.perClaimAmount) {
            logger.warn({
              event: 'caqh_malpractice_incomplete',
              providerId,
              policyNumber: mal.policyNumber,
              reason: 'Missing perClaimAmount',
            });
            summary.malpractice.skipped++;
            continue;
          }

          const existing = await prisma.malpracticeInsurance.findFirst({
            where: { providerId, policyNumber: mal.policyNumber },
          });

          let policyId: string;
          if (existing) {
            await prisma.malpracticeInsurance.update({
              where: { id: existing.id },
              data: {
                carrierName: mal.carrierName ?? existing.carrierName,
                expirationDate: mal.expirationDate ? new Date(mal.expirationDate) : existing.expirationDate,
                perClaimAmount: mal.perClaimAmount ?? existing.perClaimAmount,
                aggregateAmount: mal.aggregateAmount ?? existing.aggregateAmount,
                coverageType: mal.coverageType ?? existing.coverageType,
                effectiveDate: mal.effectiveDate ? new Date(mal.effectiveDate) : existing.effectiveDate,
                isSelfInsured: mal.isSelfInsured ?? existing.isSelfInsured,
                hasUnlimitedCoverage: mal.hasUnlimitedCoverage ?? existing.hasUnlimitedCoverage,
                isIndividualCoverage: mal.isIndividualCoverage ?? existing.isIndividualCoverage,
                source: 'caqh_sync',
              },
            });
            policyId = existing.id;
            summary.malpractice.updated++;
          } else {
            const created = await prisma.malpracticeInsurance.create({
              data: {
                providerId,
                carrierName: mal.carrierName,
                policyNumber: mal.policyNumber,
                coverageType: mal.coverageType ?? 'occurrence',
                perClaimAmount: mal.perClaimAmount,
                aggregateAmount: mal.aggregateAmount ?? mal.perClaimAmount,
                effectiveDate: mal.effectiveDate ? new Date(mal.effectiveDate) : new Date(),
                expirationDate: new Date(mal.expirationDate),
                isSelfInsured: mal.isSelfInsured,
                hasUnlimitedCoverage: mal.hasUnlimitedCoverage,
                isIndividualCoverage: mal.isIndividualCoverage,
                source: 'caqh_sync',
              },
            });
            policyId = created.id;
            summary.malpractice.created++;
          }

          // Auto-link covered practices to PracticeLocation rows.
          // Match by exact location name (case-insensitive) first, then by
          // (addressLine1, state, zipCode). Idempotent — unique constraint
          // on (malpracticeInsuranceId, practiceLocationId).
          if (mal.coveredPractices?.length) {
            await this.linkCoveredPractices(providerId, policyId, mal.coveredPractices);
          }
        } catch (error) {
          summary.malpractice.failed++;
          summary.failedRecords.push({
            category: 'malpractice',
            identifier: mal.policyNumber,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- Provider Certifications (life-support certs to dedicated table) ---
    if (caqhData.providerCertifications?.length) {
      for (const cert of caqhData.providerCertifications) {
        try {
          // Dedupe by (providerId, caqhCertificationId) when present, else by description+expiration
          const existing = cert.caqhCertificationId
            ? await prisma.providerCertification.findFirst({
                where: { providerId, caqhCertificationId: cert.caqhCertificationId },
              })
            : await prisma.providerCertification.findFirst({
                where: { providerId, certDescription: cert.certDescription },
              });

          const certType = this.resolveProviderCertificationType(cert.certDescription);
          if (existing) {
            if (existing.source === 'manual_entry') {
              summary.providerCertifications.skipped++;
              continue;
            }
            await prisma.providerCertification.update({
              where: { id: existing.id },
              data: {
                certType,
                certDescription: cert.certDescription,
                caqhCertificationId: cert.caqhCertificationId ?? existing.caqhCertificationId,
                issueDate: cert.issueDate ?? existing.issueDate,
                expirationDate: cert.expirationDate ?? existing.expirationDate,
                source: 'caqh_sync',
              },
            });
            summary.providerCertifications.updated++;
          } else {
            await prisma.providerCertification.create({
              data: {
                providerId,
                certType,
                certDescription: cert.certDescription,
                caqhCertificationId: cert.caqhCertificationId,
                issueDate: cert.issueDate,
                expirationDate: cert.expirationDate,
                source: 'caqh_sync',
              },
            });
            summary.providerCertifications.created++;
          }
        } catch (error) {
          summary.providerCertifications.failed++;
          summary.failedRecords.push({
            category: 'providerCertification',
            identifier: cert.certDescription,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- CDS Registrations (encrypted state-level Controlled Substance numbers) ---
    if (caqhData.cdsRegistrations?.length) {
      for (const cds of caqhData.cdsRegistrations) {
        try {
          // Unique constraint on (providerId, state); upsert by state.
          const existing = await prisma.cdsRegistration.findFirst({
            where: { providerId, state: cds.state },
          });

          const cdsNumberEncrypted = encryptSafe(cds.cdsNumber);

          if (existing) {
            if (existing.source === 'manual_entry') {
              summary.cdsRegistrations.skipped++;
              continue;
            }
            await prisma.cdsRegistration.update({
              where: { id: existing.id },
              data: {
                cdsNumberEncrypted,
                issueDate: cds.issueDate ?? existing.issueDate,
                expirationDate: cds.expirationDate ?? existing.expirationDate,
                source: 'caqh_sync',
              },
            });
            summary.cdsRegistrations.updated++;
          } else {
            await prisma.cdsRegistration.create({
              data: {
                providerId,
                cdsNumberEncrypted,
                state: cds.state,
                issueDate: cds.issueDate,
                expirationDate: cds.expirationDate,
                source: 'caqh_sync',
              },
            });
            summary.cdsRegistrations.created++;
          }
        } catch (error) {
          summary.cdsRegistrations.failed++;
          summary.failedRecords.push({
            category: 'cdsRegistration',
            identifier: cds.state,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- Disclosures (Phase 2) ---
    if (caqhData.disclosures && caqhData.disclosures.length > 0) {
      for (const disc of caqhData.disclosures) {
        try {
          // Dedup by (providerId, caqhQuestionId) — every CAQH question has a stable ID.
          const existing = await prisma.providerDisclosure.findFirst({
            where: { providerId, caqhQuestionId: disc.caqhQuestionId },
          });
          if (existing) {
            if (existing.source === 'manual_entry') {
              summary.disclosures.skipped++;
              continue;
            }
            await prisma.providerDisclosure.update({
              where: { id: existing.id },
              data: {
                category: disc.category,
                questionText: disc.questionText,
                answer: disc.answer,
                explanation: disc.explanation ?? existing.explanation,
                source: 'caqh_sync',
              },
            });
            summary.disclosures.updated++;
          } else {
            await prisma.providerDisclosure.create({
              data: {
                providerId,
                category: disc.category,
                questionText: disc.questionText,
                answer: disc.answer,
                explanation: disc.explanation,
                caqhQuestionId: disc.caqhQuestionId,
                source: 'caqh_sync',
              },
            });
            summary.disclosures.created++;
          }
        } catch (error) {
          summary.disclosures.failed++;
          summary.failedRecords.push({
            category: 'disclosure',
            identifier: disc.caqhQuestionId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- Malpractice Claims (Phase 2) ---
    if (caqhData.malpracticeClaims && caqhData.malpracticeClaims.length > 0) {
      for (const claim of caqhData.malpracticeClaims) {
        try {
          // Prefer caqhClaimId for dedup; fall back to (insuranceCarrier, dateOfClaim, policyNumber).
          const existing = claim.caqhClaimId
            ? await prisma.malpracticeClaim.findFirst({
                where: { providerId, caqhClaimId: claim.caqhClaimId },
              })
            : await prisma.malpracticeClaim.findFirst({
                where: {
                  providerId,
                  insuranceCarrier: claim.insuranceCarrier,
                  dateOfClaim: claim.dateOfClaim,
                  policyNumber: claim.policyNumber,
                },
              });
          if (existing) {
            if (existing.source === 'manual_entry') {
              summary.malpracticeClaims.skipped++;
              continue;
            }
            await prisma.malpracticeClaim.update({
              where: { id: existing.id },
              data: {
                claimStatus: claim.claimStatus,
                description: claim.description,
                dateOfIncident: claim.dateOfIncident ?? existing.dateOfIncident,
                dateOfClaim: claim.dateOfClaim ?? existing.dateOfClaim,
                dateResolved: claim.dateResolved ?? existing.dateResolved,
                insuranceCarrier: claim.insuranceCarrier ?? existing.insuranceCarrier,
                policyNumber: claim.policyNumber ?? existing.policyNumber,
                settlementAmount: claim.settlementAmount ?? existing.settlementAmount,
                settlementAmountPaid: claim.settlementAmountPaid ?? existing.settlementAmountPaid,
                allegationDescription: claim.allegationDescription ?? existing.allegationDescription,
                patientInjuryDescription: claim.patientInjuryDescription ?? existing.patientInjuryDescription,
                isLeadDefendant: claim.isLeadDefendant ?? existing.isLeadDefendant,
                numberOtherCodefendants: claim.numberOtherCodefendants ?? existing.numberOtherCodefendants,
                caseInvolvement: claim.caseInvolvement ?? existing.caseInvolvement,
                npdbReported: claim.npdbReported ?? existing.npdbReported,
                patientDied: claim.patientDied ?? existing.patientDied,
                resolutionMethod: claim.resolutionMethod ?? existing.resolutionMethod,
                courtAddressLine1: claim.courtAddressLine1 ?? existing.courtAddressLine1,
                courtCity: claim.courtCity ?? existing.courtCity,
                courtState: claim.courtState ?? existing.courtState,
                courtZipCode: claim.courtZipCode ?? existing.courtZipCode,
                courtPhone: claim.courtPhone ?? existing.courtPhone,
                courtCountry: claim.courtCountry ?? existing.courtCountry,
                caqhClaimId: claim.caqhClaimId ?? existing.caqhClaimId,
                source: 'caqh_sync',
              },
            });
            summary.malpracticeClaims.updated++;
          } else {
            await prisma.malpracticeClaim.create({
              data: {
                providerId,
                claimStatus: claim.claimStatus,
                description: claim.description,
                dateOfIncident: claim.dateOfIncident,
                dateOfClaim: claim.dateOfClaim,
                dateResolved: claim.dateResolved,
                insuranceCarrier: claim.insuranceCarrier,
                policyNumber: claim.policyNumber,
                settlementAmount: claim.settlementAmount,
                settlementAmountPaid: claim.settlementAmountPaid,
                allegationDescription: claim.allegationDescription,
                patientInjuryDescription: claim.patientInjuryDescription,
                isLeadDefendant: claim.isLeadDefendant,
                numberOtherCodefendants: claim.numberOtherCodefendants,
                caseInvolvement: claim.caseInvolvement,
                npdbReported: claim.npdbReported,
                patientDied: claim.patientDied,
                resolutionMethod: claim.resolutionMethod,
                courtAddressLine1: claim.courtAddressLine1,
                courtCity: claim.courtCity,
                courtState: claim.courtState,
                courtZipCode: claim.courtZipCode,
                courtPhone: claim.courtPhone,
                courtCountry: claim.courtCountry,
                caqhClaimId: claim.caqhClaimId,
                source: 'caqh_sync',
              },
            });
            summary.malpracticeClaims.created++;
          }
        } catch (error) {
          summary.malpracticeClaims.failed++;
          summary.failedRecords.push({
            category: 'malpracticeClaim',
            identifier: claim.caqhClaimId ?? claim.policyNumber ?? claim.description.slice(0, 40),
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- Hospital Affiliations (Phase 2) ---
    if (caqhData.hospitalAffiliations && caqhData.hospitalAffiliations.length > 0) {
      for (const hosp of caqhData.hospitalAffiliations) {
        try {
          // Prefer caqhAhaId for dedup; fall back to (facilityName, state).
          const existing = hosp.caqhAhaId
            ? await prisma.hospitalAffiliation.findFirst({
                where: { providerId, caqhAhaId: hosp.caqhAhaId },
              })
            : await prisma.hospitalAffiliation.findFirst({
                where: { providerId, facilityName: hosp.facilityName, state: hosp.state },
              });
          if (existing) {
            if (existing.source === 'manual_entry') {
              summary.hospitalAffiliations.skipped++;
              continue;
            }
            await prisma.hospitalAffiliation.update({
              where: { id: existing.id },
              data: {
                facilityName: hosp.facilityName,
                privilegeType: hosp.privilegeType,
                status: hosp.status,
                addressLine1: hosp.addressLine1 ?? existing.addressLine1,
                city: hosp.city ?? existing.city,
                state: hosp.state ?? existing.state,
                zipCode: hosp.zipCode ?? existing.zipCode,
                country: hosp.country ?? existing.country,
                phoneNumber: hosp.phoneNumber ?? existing.phoneNumber,
                faxNumber: hosp.faxNumber ?? existing.faxNumber,
                department: hosp.department ?? existing.department,
                startDate: hosp.startDate ?? existing.startDate,
                endDate: hosp.endDate ?? existing.endDate,
                hasUnrestrictedPrivileges: hosp.hasUnrestrictedPrivileges ?? existing.hasUnrestrictedPrivileges,
                hasTemporaryPrivileges: hosp.hasTemporaryPrivileges ?? existing.hasTemporaryPrivileges,
                privilegeDescription: hosp.privilegeDescription ?? existing.privilegeDescription,
                admissionPercent: hosp.admissionPercent ?? existing.admissionPercent,
                staffCategory: hosp.staffCategory ?? existing.staffCategory,
                hospitalRecordType: hosp.hospitalRecordType ?? existing.hospitalRecordType,
                hospitalAffiliationType: hosp.hospitalAffiliationType ?? existing.hospitalAffiliationType,
                reasonForDiscontinuance: hosp.reasonForDiscontinuance ?? existing.reasonForDiscontinuance,
                exitExplanation: hosp.exitExplanation ?? existing.exitExplanation,
                description: hosp.description ?? existing.description,
                whoAdmitsForYou: hosp.whoAdmitsForYou ?? existing.whoAdmitsForYou,
                admittingProviderFirstName:
                  hosp.admittingProviderFirstName ?? existing.admittingProviderFirstName,
                admittingProviderLastName:
                  hosp.admittingProviderLastName ?? existing.admittingProviderLastName,
                admittingContactPhone: hosp.admittingContactPhone ?? existing.admittingContactPhone,
                admittingContactEmail: hosp.admittingContactEmail ?? existing.admittingContactEmail,
                isAdmitterSameSpecialty:
                  hosp.isAdmitterSameSpecialty ?? existing.isAdmitterSameSpecialty,
                caqhAhaId: hosp.caqhAhaId ?? existing.caqhAhaId,
                source: 'caqh_sync',
              },
            });
            summary.hospitalAffiliations.updated++;
          } else {
            await prisma.hospitalAffiliation.create({
              data: {
                providerId,
                facilityName: hosp.facilityName,
                facilityType: 'hospital',
                privilegeType: hosp.privilegeType,
                status: hosp.status,
                addressLine1: hosp.addressLine1,
                city: hosp.city,
                state: hosp.state,
                zipCode: hosp.zipCode,
                country: hosp.country,
                phoneNumber: hosp.phoneNumber,
                faxNumber: hosp.faxNumber,
                department: hosp.department,
                startDate: hosp.startDate,
                endDate: hosp.endDate,
                hasUnrestrictedPrivileges: hosp.hasUnrestrictedPrivileges,
                hasTemporaryPrivileges: hosp.hasTemporaryPrivileges,
                privilegeDescription: hosp.privilegeDescription,
                admissionPercent: hosp.admissionPercent,
                staffCategory: hosp.staffCategory,
                hospitalRecordType: hosp.hospitalRecordType,
                hospitalAffiliationType: hosp.hospitalAffiliationType,
                reasonForDiscontinuance: hosp.reasonForDiscontinuance,
                exitExplanation: hosp.exitExplanation,
                description: hosp.description,
                whoAdmitsForYou: hosp.whoAdmitsForYou,
                admittingProviderFirstName: hosp.admittingProviderFirstName,
                admittingProviderLastName: hosp.admittingProviderLastName,
                admittingContactPhone: hosp.admittingContactPhone,
                admittingContactEmail: hosp.admittingContactEmail,
                isAdmitterSameSpecialty: hosp.isAdmitterSameSpecialty,
                caqhAhaId: hosp.caqhAhaId,
                source: 'caqh_sync',
              },
            });
            summary.hospitalAffiliations.created++;
          }
        } catch (error) {
          summary.hospitalAffiliations.failed++;
          summary.failedRecords.push({
            category: 'hospitalAffiliation',
            identifier: hosp.caqhAhaId ?? hosp.facilityName,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- Work History (Phase 2) ---
    if (caqhData.workHistory && caqhData.workHistory.length > 0) {
      for (const wh of caqhData.workHistory) {
        try {
          // Prefer caqhWorkHistoryId for dedup; fall back to (organizationName, startDate).
          const existing = wh.caqhWorkHistoryId
            ? await prisma.workHistory.findFirst({
                where: { providerId, caqhWorkHistoryId: wh.caqhWorkHistoryId },
              })
            : await prisma.workHistory.findFirst({
                where: {
                  providerId,
                  organizationName: wh.organizationName,
                  startDate: wh.startDate,
                },
              });
          if (existing) {
            if (existing.source === 'manual_entry') {
              summary.workHistory.skipped++;
              continue;
            }
            await prisma.workHistory.update({
              where: { id: existing.id },
              data: {
                organizationName: wh.organizationName,
                addressLine1: wh.addressLine1 ?? existing.addressLine1,
                city: wh.city ?? existing.city,
                state: wh.state ?? existing.state,
                zipCode: wh.zipCode ?? existing.zipCode,
                country: wh.country ?? existing.country,
                phone: wh.phone ?? existing.phone,
                fax: wh.fax ?? existing.fax,
                email: wh.email ?? existing.email,
                startDate: wh.startDate ?? existing.startDate,
                endDate: wh.endDate ?? existing.endDate,
                isCurrent: wh.isCurrent,
                currentEmployerFlag: wh.currentEmployerFlag ?? existing.currentEmployerFlag,
                statusDescription: wh.statusDescription ?? existing.statusDescription,
                workHistoryType: wh.workHistoryType ?? existing.workHistoryType,
                position: wh.position ?? existing.position,
                department: wh.department ?? existing.department,
                reasonForLeaving: wh.reasonForLeaving ?? existing.reasonForLeaving,
                supervisorName: wh.supervisorName ?? existing.supervisorName,
                supervisorPhone: wh.supervisorPhone ?? existing.supervisorPhone,
                caqhWorkHistoryId: wh.caqhWorkHistoryId ?? existing.caqhWorkHistoryId,
                source: 'caqh_sync',
              },
            });
            summary.workHistory.updated++;
          } else {
            await prisma.workHistory.create({
              data: {
                providerId,
                organizationName: wh.organizationName,
                addressLine1: wh.addressLine1,
                city: wh.city,
                state: wh.state,
                zipCode: wh.zipCode,
                country: wh.country,
                phone: wh.phone,
                fax: wh.fax,
                email: wh.email,
                startDate: wh.startDate,
                endDate: wh.endDate,
                isCurrent: wh.isCurrent,
                currentEmployerFlag: wh.currentEmployerFlag,
                statusDescription: wh.statusDescription,
                workHistoryType: wh.workHistoryType,
                position: wh.position ?? '',
                department: wh.department,
                reasonForLeaving: wh.reasonForLeaving,
                supervisorName: wh.supervisorName,
                supervisorPhone: wh.supervisorPhone,
                caqhWorkHistoryId: wh.caqhWorkHistoryId,
                source: 'caqh_sync',
              },
            });
            summary.workHistory.created++;
          }
        } catch (error) {
          summary.workHistory.failed++;
          summary.failedRecords.push({
            category: 'workHistory',
            identifier: wh.caqhWorkHistoryId ?? wh.organizationName,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- Work History Gaps (Phase 2) ---
    if (caqhData.workHistoryGaps && caqhData.workHistoryGaps.length > 0) {
      for (const gap of caqhData.workHistoryGaps) {
        try {
          // Prefer caqhGapId for dedup; fall back to (startDate, endDate).
          const existing = gap.caqhGapId
            ? await prisma.workHistoryGap.findFirst({
                where: { providerId, caqhGapId: gap.caqhGapId },
              })
            : await prisma.workHistoryGap.findFirst({
                where: { providerId, startDate: gap.startDate, endDate: gap.endDate },
              });
          if (existing) {
            if (existing.source === 'manual_entry') {
              summary.workHistoryGaps.skipped++;
              continue;
            }
            await prisma.workHistoryGap.update({
              where: { id: existing.id },
              data: {
                startDate: gap.startDate,
                endDate: gap.endDate,
                gapExplanation: gap.gapExplanation ?? existing.gapExplanation,
                gapDescription: gap.gapDescription ?? existing.gapDescription,
                caqhGapId: gap.caqhGapId ?? existing.caqhGapId,
                source: 'caqh_sync',
              },
            });
            summary.workHistoryGaps.updated++;
          } else {
            await prisma.workHistoryGap.create({
              data: {
                providerId,
                startDate: gap.startDate,
                endDate: gap.endDate,
                gapExplanation: gap.gapExplanation,
                gapDescription: gap.gapDescription,
                caqhGapId: gap.caqhGapId,
                source: 'caqh_sync',
              },
            });
            summary.workHistoryGaps.created++;
          }
        } catch (error) {
          summary.workHistoryGaps.failed++;
          summary.failedRecords.push({
            category: 'workHistoryGap',
            identifier: gap.caqhGapId ?? `${gap.startDate.toISOString()}..${gap.endDate.toISOString()}`,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // --- Practice Supervisors (Phase 2) ---
    if (caqhData.practiceSupervisors && caqhData.practiceSupervisors.length > 0) {
      // Pre-load practice locations once so we can name/address-match without an N+1 query.
      const practiceLocations = await prisma.practiceLocation.findMany({ where: { providerId } });
      const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
      for (const sup of caqhData.practiceSupervisors) {
        try {
          // Auto-link to PracticeLocation by name first, then by addressLine1 + state.
          let practiceLocationId: string | null = null;
          if (sup.practiceName) {
            const byName = practiceLocations.find(l => norm(l.locationName) === norm(sup.practiceName));
            if (byName) practiceLocationId = byName.id;
          }
          if (!practiceLocationId && sup.practiceAddressLine1) {
            const byAddr = practiceLocations.find(
              l =>
                norm(l.addressLine1) === norm(sup.practiceAddressLine1) &&
                (!sup.practiceState || norm(l.state) === norm(sup.practiceState)),
            );
            if (byAddr) practiceLocationId = byAddr.id;
          }
          if (!practiceLocationId) {
            logger.info({
              event: 'caqh_supervisor_unmatched_practice',
              providerId,
              caqhPracticeId: sup.caqhPracticeId,
              practiceName: sup.practiceName,
            });
          }

          // Dedup by (providerId, caqhSupervisorId) when present;
          // fall back to (providerId, supervisorNpi, practiceLocationId).
          const existing = sup.caqhSupervisorId
            ? await prisma.supervisingPhysician.findFirst({
                where: { providerId, caqhSupervisorId: sup.caqhSupervisorId },
              })
            : sup.supervisorNpi
              ? await prisma.supervisingPhysician.findFirst({
                  where: {
                    providerId,
                    supervisorNpi: sup.supervisorNpi,
                    practiceLocationId,
                  },
                })
              : null;

          if (existing) {
            if (existing.source === 'manual_entry') {
              summary.practiceSupervisors.skipped++;
              continue;
            }
            await prisma.supervisingPhysician.update({
              where: { id: existing.id },
              data: {
                supervisorFirstName: sup.supervisorFirstName,
                supervisorLastName: sup.supervisorLastName,
                supervisorNpi: sup.supervisorNpi ?? existing.supervisorNpi,
                caqhSupervisorId: sup.caqhSupervisorId ?? existing.caqhSupervisorId,
                practiceLocationId: practiceLocationId ?? existing.practiceLocationId,
                source: 'caqh_sync',
              },
            });
            summary.practiceSupervisors.updated++;
          } else {
            await prisma.supervisingPhysician.create({
              data: {
                providerId,
                supervisorFirstName: sup.supervisorFirstName,
                supervisorLastName: sup.supervisorLastName,
                supervisorNpi: sup.supervisorNpi,
                caqhSupervisorId: sup.caqhSupervisorId,
                practiceLocationId,
                supervisionType: 'COLLABORATIVE', // CAQH doesn't carry the legal type — closest default
                agreementStartDate: new Date(),
                source: 'caqh_sync',
              },
            });
            summary.practiceSupervisors.created++;
          }
        } catch (error) {
          summary.practiceSupervisors.failed++;
          summary.failedRecords.push({
            category: 'practiceSupervisor',
            identifier:
              sup.caqhSupervisorId ?? `${sup.supervisorFirstName} ${sup.supervisorLastName}`,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    return summary;
  }

  /**
   * Resolve a free-form cert description (e.g., "Basic Life Support (BLS)")
   * to the `ProviderCertificationType` enum. Mirrors the `IdentifierType`
   * mapping in `mapLifeSupportCertType` but emits the lowercase enum used
   * by the new `provider_certifications` table.
   */
  private resolveProviderCertificationType(description: string): ProviderCertificationType {
    const s = description.toUpperCase();
    if (s.includes('PALS') || s.includes('PEDIATRIC ADVANCED')) return 'pals';
    if (s.includes('ACLS') || s.includes('ADVANCED CARDIAC')) return 'acls';
    if (s.includes('BLS') || s.includes('BASIC LIFE')) return 'bls';
    if (s.includes('CPR') || s.includes('CARDIO-PULMONARY') || s.includes('CARDIOPULMONARY')) return 'cpr';
    return 'other';
  }

  /**
   * Auto-link a malpractice policy to PracticeLocation rows for the same
   * provider, based on covered-practice hints from CAQH.
   *
   * Matching priority (D3):
   *   1. exact_name — PracticeLocation.locationName matches PracticeName (case-insensitive trim)
   *   2. address — addressLine1 + state + zipCode all match (case-insensitive)
   *
   * Idempotent: uses upsert via the unique (malpracticeInsuranceId, practiceLocationId)
   * constraint. Records the match path in `matched_via` and the original
   * CAQH label in `caqh_raw_label` for audit.
   */
  private async linkCoveredPractices(
    providerId: string,
    malpracticeInsuranceId: string,
    coveredPractices: NonNullable<MappedCaqhData['malpractice'][number]['coveredPractices']>,
  ): Promise<void> {
    const locations = await prisma.practiceLocation.findMany({
      where: { providerId },
    });
    if (locations.length === 0) return;

    const norm = (s?: string) => (s ?? '').trim().toLowerCase();

    for (const cp of coveredPractices) {
      let matchedId: string | null = null;
      let matchedVia: 'exact_name' | 'address' | null = null;

      if (cp.rawLabel) {
        const target = norm(cp.rawLabel);
        const byName = locations.find(l => norm(l.locationName) === target);
        if (byName) {
          matchedId = byName.id;
          matchedVia = 'exact_name';
        }
      }
      if (!matchedId && cp.addressLine1) {
        const targetAddr = norm(cp.addressLine1);
        const targetState = norm(cp.state);
        const targetZip = norm(cp.zipCode);
        const byAddr = locations.find(l =>
          norm(l.addressLine1) === targetAddr &&
          (!targetState || norm(l.state) === targetState) &&
          (!targetZip || norm(l.zipCode) === targetZip)
        );
        if (byAddr) {
          matchedId = byAddr.id;
          matchedVia = 'address';
        }
      }
      if (!matchedId || !matchedVia) {
        logger.info({
          event: 'caqh_covered_practice_unmatched',
          providerId,
          rawLabel: cp.rawLabel,
          addressLine1: cp.addressLine1,
        });
        continue;
      }

      try {
        await prisma.malpracticePolicyLocation.upsert({
          where: {
            malpracticeInsuranceId_practiceLocationId: {
              malpracticeInsuranceId,
              practiceLocationId: matchedId,
            },
          },
          create: {
            malpracticeInsuranceId,
            practiceLocationId: matchedId,
            caqhRawLabel: cp.rawLabel,
            matchedVia,
          },
          update: {
            caqhRawLabel: cp.rawLabel,
            matchedVia,
          },
        });
      } catch (error) {
        logger.warn({
          event: 'caqh_covered_practice_link_failed',
          providerId,
          malpracticeInsuranceId,
          matchedId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  /**
   * Look up or create a Specialty row based on NUCC taxonomy code or name.
   * Preferred match is on `nuccTaxonomyCode` (globally unique). Falls back to
   * `(name, taxonomySection)` unique. Creates an INDIVIDUAL specialty with the
   * CAQH-provided values when no match exists. NUCC code is back-filled when
   * an existing name-matched row lacks one.
   */
  private async upsertSpecialtyRow(spec: MappedSpecialty): Promise<{ id: string }> {
    if (spec.nuccTaxonomyCode) {
      const byCode = await prisma.specialty.findUnique({
        where: { nuccTaxonomyCode: spec.nuccTaxonomyCode },
      });
      if (byCode) return { id: byCode.id };
    }

    const byName = await prisma.specialty.findFirst({
      where: { name: spec.name, taxonomySection: 'INDIVIDUAL' },
    });
    if (byName) {
      // Back-fill NUCC code if we have one and the existing row is missing it
      if (spec.nuccTaxonomyCode && !byName.nuccTaxonomyCode) {
        await prisma.specialty.update({
          where: { id: byName.id },
          data: { nuccTaxonomyCode: spec.nuccTaxonomyCode },
        });
      }
      return { id: byName.id };
    }

    const created = await prisma.specialty.create({
      data: {
        name: spec.name,
        taxonomySection: 'INDIVIDUAL',
        nuccTaxonomyCode: spec.nuccTaxonomyCode,
        isActive: true,
      },
    });
    return { id: created.id };
  }

  /**
   * Check if the CAQH API is configured.
   */
  isConfigured(): boolean {
    return !!(this.baseUrl && this.orgId && this.username && this.password);
  }
}

export interface CaqhSyncSummary {
  licenses: { created: number; updated: number; skipped: number; failed: number };
  certifications: { created: number; updated: number; skipped: number; failed: number };
  specialties: { created: number; updated: number; skipped: number; failed: number };
  education: { created: number; updated: number; skipped: number; failed: number };
  malpractice: { created: number; updated: number; skipped: number; failed: number };
  providerCertifications: { created: number; updated: number; skipped: number; failed: number };
  cdsRegistrations: { created: number; updated: number; skipped: number; failed: number };
  // Phase 2: full v9 coverage
  disclosures: { created: number; updated: number; skipped: number; failed: number };
  malpracticeClaims: { created: number; updated: number; skipped: number; failed: number };
  hospitalAffiliations: { created: number; updated: number; skipped: number; failed: number };
  workHistory: { created: number; updated: number; skipped: number; failed: number };
  workHistoryGaps: { created: number; updated: number; skipped: number; failed: number };
  practiceSupervisors: { created: number; updated: number; skipped: number; failed: number };
  failedRecords: Array<{ category: string; identifier: string; error: string }>;
}
