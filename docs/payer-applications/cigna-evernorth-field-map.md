# Cigna / Evernorth — Field Map

## 1. Source

- **PDF:** `~/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/Applications/Cigna:Evernorth/Evernorth+Application.pdf`
- **Form name:** Evernorth Behavioral Provider Information Form (Independent Licensed)
- **Form origin:** Salesforce-hosted web form at `cignathn.my.salesforce-sites.com/cbus/independentlicensed`
- **Date pulled:** 2026-05-16
- **Submission shape:** Independent licensed behavioral health professional (Cigna Behavioral / Evernorth network)
- **PII handling:** Per folder README, this file documents the *field structure* of the Evernorth application. The PDF reviewed is the blank form template — no provider PII present to redact.
- **Companion form on file:** `Evernorth+ABA+Application.pdf` sits in the same iCloud folder for ABA-specific submissions (mapped separately when needed).

---

## 2. Fields extracted from the PDF

Evernorth's behavioral provider form has **17 sections** and **~150 distinct fields**. Service Locations 1–4 share an identical 16-field shape (repeated 4×).

### Section 1 — Applicant Information
- Recruitment Code
- Date of Birth
- First Name
- Gender
- Middle Name
- Social Security Number
- Last Name
- NPI Type 1
- Medicare Identification Number
- Medicaid Identification Number
- Select your primary degree type (dropdown)
- Professional license or Certification (dropdown)
- Supervising Physician
- CAQH ID

### Section 2 — Professional Contact Information
- Contracting/Credentialing Email
- Appointment Availability Email
- General Communication Email
- Billing Issues Email
- Supervisor's Phone
- Supervisor's Email

### Section 3 — Mailing Address
- Mailing Address Street / PO Box
- Mailing Address Suite
- Mailing Address City
- Mailing Address State
- Mailing Address Zip code

### Section 4 — Co-located with Cigna Contracted Physician / Evernorth Psychiatrist
- Medical Physician Name (checkbox + name)
- Psychiatrist Name (checkbox + name)
- Referring Physician's Name
- Office Name

### Section 5 — Hospital Affiliations
- Facility Name
- Facility Street Address 1
- Facility Street Address 2
- Facility City
- Facility State
- Facility Zip
- Facility Tax ID

### Section 6 — Form W-9 Taxpayer Information
- Tax Identification Number
- Business Name
- Tax Payer Name
- Tax Payer Street Address
- Tax Payer Street Address 2
- Tax Payer City
- Tax Payer State
- Tax Payer Zip code

### Section 7 — Pay To Information
- Last Name / Business Name
- First Name
- NPI Type 2
- Billing Street Address 1
- Billing Street Address 2
- Pay to City
- Pay to State
- Billing Zip Code
- Billing Phone
- Does the info belong to a group practice (Y/N)

### Section 8 — Behavioral Telehealth (gate)
- Do you provide telehealth services? (Y/N)

### Section 9 — Service Location (Primary + up to 3 Additional, identical shape)
- Non-Office Service Area (dropdown)
- Service Location Street
- Service Location Suite
- Service Location City
- Service Location State
- Is office in your home? (Y/N)
- Is service location handicap accessible? (Y/N)
- Service Location Apps/Intake Phone
- Service Location Fax
- Service Location Zip code
- Service Location Crisis Phone
- Office Email (Displayed in Directory)
- Service Location Other Phone / Pager
- Office Website
- Self-Service Appt Scheduling Available (checkbox)
- Qualified Medical Interpreter Language (multi-select from full language list)

### Section 10 — Practice Information
- **What are your areas of clinical practice** (multi-select: ADHD/ADD, Adoption issues, AIDS/HIV, …)
- **Appointment availability** (multi-select: Crisis stabilization 24/7, Crisis stabilization non-24/7, Intermediate care urgent, Meet and Greet)
- **After hours availability** (multi-select: Evening appointments, Weekend appointments)
- **Languages** (multi-select from full language list)

### Section 11 — Specialty Networks
- **Disorders and treatment modalities** (multi-select: Alcohol/substance use, Autism — ABA, Autism — social skills group, Dialectical Behavior Therapy (DBT)-Adherent, …)

### Section 12 — Specialty Patient Populations (at least one required)
- Child (ages 1–5)
- Child (ages 6–12)
- Adolescent (ages 13–17)
- Adult (ages 18+)
- Geriatric (ages 65+)

### Section 13 — Fast Access Network
- Enroll in Evernorth Fast Access Network (opt-in checkbox)
- Attestations (5 separate criteria the provider agrees to by opting in)

### Section 14 — EAP Specialty Services
- Employee Assistance Professional (CEAP) (checkbox)
- Critical Incident Response (CIR) service (checkbox)
- Employee educational seminars (checkbox)
- Provide general EAP Management referrals (checkbox)
- EAP Supervisory Training Sessions (checkbox)
- Substance abuse professional (SAP) cert (checkbox)
- Substance Abuse Expert (checkbox)

### Section 15 — EAP Assessment and Referral
- Opt out of EAP Assessment and Referral (default opt-in; checkbox to opt out)

### Section 16 — Provider Attestation
- "I will treat all Evernorth participants equally / will not charge out-of-network rates / information is true and accurate" attestation block
- Provider signature
- Behavioral Telehealth attestation ("I meet all state requirements …", "I will provide telehealth only in licensed states", "I follow HIPAA")
- Home Office attestation ("If office in home, my home office meets federal/state/licensing requirements")
- Application Submission Date

### Section 17 — Sub-attestations within sections (criteria gates)
- Crisis Stabilization 24/7 attestation
- Crisis Stabilization Non-24/7 attestation
- Intermediate Care (Urgent) attestation
- Meet and Greet attestation
- DBT-Adherent attestation
- Office Email use attestation
- Specialty Patient Population (non-adult) attestation
- EAP General Management Referrals attestation
- CEAP attestation
- CIR attestation
- Employee Educational Seminars attestation
- SAP attestation
- SAE attestation
- EAP Supervisory Training attestation

---

## 3. Schema mapping

Status reflects design decisions made with founder on 2026-05-17. Several fields originally marked ❌ were intentionally dropped (not tracked) or resolved by reusing existing columns.

### Section 1 — Applicant Information

| Evernorth field | Schema field | Status |
|---|---|---|
| Recruitment Code | _no field — leave blank_ | ✅ Cigna-only quirk; not stored |
| Date of Birth | `ProviderProfile.dateOfBirth` | ✅ |
| First Name | `ProviderProfile.firstName` | ✅ |
| Gender | `ProviderProfile.gender` (Gender enum) | ✅ |
| Middle Name | `ProviderProfile.middleName` | ✅ |
| Social Security Number | `ProviderProfile.ssnEncrypted` | ✅ |
| Last Name | `ProviderProfile.lastName` | ✅ |
| NPI Type 1 | `ProviderProfile.npi` | ✅ |
| Medicare Identification Number | `ProviderIdentifier` w/ `IdentifierType.MEDICARE_PECOS_ID` or `MEDICARE_PTAN` | ✅ — confirm which value Cigna expects |
| Medicaid Identification Number | `ProviderIdentifier` w/ `IdentifierType.MEDICAID_ID` | ✅ |
| Primary Degree Type | `Education.educationType` (EducationType enum) | ✅ |
| Professional License or Certification | `License.licenseType` (LicenseType enum) | ✅ |
| Supervising Physician | `SupervisingPhysician` table (full record) | ✅ |
| CAQH ID | `ProviderProfile.caqhProviderId` | ✅ |

### Section 2 — Professional Contact Information

| Evernorth field | Schema field | Status |
|---|---|---|
| Contracting/Credentialing Email | `ProviderProfile.email` (collapsed) | ⚠️ acceptable per founder |
| Appointment Availability Email | `ProviderProfile.email` (collapsed) | ⚠️ acceptable per founder |
| General Communication Email | `ProviderProfile.email` | ✅ |
| Billing Issues Email | `Practice.billingEmail` | ✅ |
| Supervisor's Phone | `SupervisingPhysician.supervisorPhone` | ✅ |
| Supervisor's Email | `SupervisingPhysician.supervisorEmail` | ✅ |

### Section 3 — Mailing Address

| Evernorth field | Schema field | Status |
|---|---|---|
| Mailing Street / PO Box | `ProviderAddress.addressLine1` with `AddressType.mailing` | ✅ |
| Mailing Suite | `ProviderAddress.addressLine2` | ✅ |
| Mailing City | `ProviderAddress.city` | ✅ |
| Mailing State | `ProviderAddress.state` | ✅ |
| Mailing Zip | `ProviderAddress.zipCode` | ✅ |

### Section 4 — Co-located With Cigna Physician

| Evernorth field | Schema field | Status |
|---|---|---|
| Medical Physician Name (checkbox + text) | `PayerEnrollmentData` row: `colocated_medical_physician_name` | ✅ via new table |
| Psychiatrist Name (checkbox + text) | `PayerEnrollmentData` row: `colocated_psychiatrist_name` | ✅ via new table |
| Referring Physician's Name | `PayerEnrollmentData` row: `referring_physician_name` | ✅ via new table |
| Office Name | `PayerEnrollmentData` row: `colocated_office_name` | ✅ via new table |

### Section 5 — Hospital Affiliations

| Evernorth field | Schema field | Status |
|---|---|---|
| Facility Name | `HospitalAffiliation.facilityName` | ✅ |
| Facility Street 1 | `HospitalAffiliation.facilityAddressLine1` | ✅ |
| Facility Street 2 | `HospitalAffiliation.facilityAddressLine2` _(new)_ | ✅ via new column |
| Facility City | `HospitalAffiliation.facilityCity` | ✅ |
| Facility State | `HospitalAffiliation.facilityState` | ✅ |
| Facility Zip | `HospitalAffiliation.facilityZipCode` | ✅ |
| Facility Tax ID | _not tracked_ | ✅ intentionally dropped per founder — Lanyard never knows facility TIN |

### Section 6 — W-9 Taxpayer Information

| Evernorth field | Schema field | Status |
|---|---|---|
| Tax Identification Number | `Practice.taxIdEncrypted` (group) or `ProviderBanking.accountHolderTaxIdEncrypted` (individual) | ✅ |
| Business Name | `Practice.name` | ✅ |
| Tax Payer Name | `Practice.name` (reused) | ✅ |
| Tax Payer Street Address | `Practice.addressLine1` | ✅ |
| Tax Payer Street 2 | `Practice.addressLine2` | ✅ |
| Tax Payer City | `Practice.city` | ✅ |
| Tax Payer State | `Practice.state` | ✅ |
| Tax Payer Zip | `Practice.zipCode` | ✅ |

### Section 7 — Pay To Information

| Evernorth field | Schema field | Status |
|---|---|---|
| Last Name / Business Name | `ProviderBanking.accountHolderName` | ⚠️ single string, no person/business split |
| First Name | `ProviderBanking.accountHolderName` (combined) | ⚠️ acceptable — no separate first-name field |
| NPI Type 2 | `Practice.groupNpi` | ✅ (confirmed Type 2 = group NPI) |
| Billing Street 1 | `PracticeLocation.billingAddressLine1` | ✅ |
| Billing Street 2 | `PracticeLocation.billingAddressLine2` | ✅ |
| Pay to City | `PracticeLocation.billingCity` | ✅ |
| Pay to State | `PracticeLocation.billingState` | ✅ |
| Billing Zip Code | `PracticeLocation.billingZipCode` | ✅ |
| Billing Phone | `PracticeLocation.phone` (reused) | ✅ derived per founder |
| Does info belong to group practice (Y/N) | derivable from `ProviderProfile.entityType` | ✅ derived |

### Section 8 — Behavioral Telehealth (gate)

| Evernorth field | Schema field | Status |
|---|---|---|
| Do you provide telehealth services? | derivable from `ProviderProfile.careType` (`virtual`/`hybrid`) or `PracticeLocation.locationType` | ⚠️ derivable |

### Section 9 — Service Location (Primary + 3 Additional)

Cigna allows up to 4 locations. `PracticeLocation` supports unlimited per provider, so the *count* maps fine. Field-level mapping:

| Evernorth field | Schema field | Status |
|---|---|---|
| Non-Office Service Area | _not tracked_ | ✅ intentionally dropped per founder |
| Street | `PracticeLocation.addressLine1` | ✅ |
| Suite | `PracticeLocation.addressLine2` | ✅ |
| City | `PracticeLocation.city` | ✅ |
| State | `PracticeLocation.state` | ✅ |
| Zip Code | `PracticeLocation.zipCode` | ✅ |
| Is office in your home? | `PracticeLocation.isHomeOffice` _(new)_ | ✅ via new column |
| Is service location handicap accessible? | `PracticeLocation.wheelchairAccessible` | ✅ |
| Apps / Intake Phone | `PracticeLocation.phone` (reused) | ✅ derived per founder |
| Fax | `PracticeLocation.fax` | ✅ |
| Crisis Phone | `PracticeLocation.phone` (reused) | ✅ derived per founder |
| Office Email (displayed in directory) | `PracticeLocation.email` | ✅ |
| Other Phone / Pager | _not tracked_ | ✅ intentionally dropped per founder |
| Office Website | `Practice.website` (reused per location) | ✅ one website per practice per founder |
| Self-Service Appt Scheduling Available | _defaults to false_ | ✅ Lanyard doesn't offer self-scheduling today |
| Qualified Medical Interpreter Language | `PracticeLocation.interpreterAvailable` (bool) + `languagesSpoken[]` | ⚠️ no per-language interpreter mapping |

### Section 10 — Practice Information

| Evernorth field | Schema field | Status |
|---|---|---|
| Areas of clinical practice (ADHD, Adoption, AIDS/HIV, …) | `ProviderSubSpecialty` → `SubSpecialty` taxonomy _(verify Cigna's full list is seeded)_ | ⚠️ |
| Appointment availability (Crisis 24/7, Non-24/7, Intermediate, Meet & Greet) | _not tracked_ | ✅ intentionally dropped per founder |
| After hours availability (Evening / Weekend) | derivable from `PracticeLocation.officeHours` JSON | ⚠️ derivable, no normalized flags |
| Languages (provider-level) | `ProviderProfile.languages[]` | ✅ |

### Section 11 — Specialty Networks

| Evernorth field | Schema field | Status |
|---|---|---|
| Disorders and treatment modalities (incl. ABA, DBT, etc.) | `ProviderService` → `ServiceOffering` _(verify Cigna's specialty network list is seeded)_ | ⚠️ |

### Section 12 — Specialty Patient Populations

| Evernorth field | Schema field | Status |
|---|---|---|
| Child 1–5 | `ProviderAgeGroup` → `PatientAgeGroup` _(verify age ranges match)_ | ⚠️ |
| Child 6–12 | `ProviderAgeGroup` → `PatientAgeGroup` | ⚠️ |
| Adolescent 13–17 | `ProviderAgeGroup` → `PatientAgeGroup` | ⚠️ |
| Adult 18+ | `ProviderAgeGroup` → `PatientAgeGroup` | ⚠️ |
| Geriatric 65+ | `ProviderAgeGroup` → `PatientAgeGroup` | ⚠️ |

### Section 13 — Fast Access Network

| Evernorth field | Schema field | Status |
|---|---|---|
| Enroll in Fast Access Network (opt-in) | `PayerEnrollmentData` row: `enroll_fast_access_network` | ✅ via new table |
| Fast Access criteria attestations (5) | `ProviderAttestation` rows | ✅ via new table |

### Section 14 — EAP Specialty Services

All seven flow into `PayerEnrollmentData` rows in `field_group="eap_capabilities"`:

| Evernorth field | Schema field | Status |
|---|---|---|
| CEAP | `PayerEnrollmentData` row: `eap_ceap` | ✅ via new table |
| Critical Incident Response (CIR) | `PayerEnrollmentData` row: `eap_cir_service` | ✅ via new table |
| Employee educational seminars | `PayerEnrollmentData` row: `eap_educational_seminars` | ✅ via new table |
| Provide general EAP Management referrals | `PayerEnrollmentData` row: `eap_management_referrals` | ✅ via new table |
| EAP Supervisory Training Sessions | `PayerEnrollmentData` row: `eap_supervisory_training` | ✅ via new table |
| SAP cert | `PayerEnrollmentData` row: `eap_sap_cert` | ✅ via new table |
| Substance Abuse Expert (SAE) | `PayerEnrollmentData` row: `eap_substance_abuse_expert` | ✅ via new table |

### Section 15 — EAP Assessment and Referral

| Evernorth field | Schema field | Status |
|---|---|---|
| Opt out of EAP Assessment and Referral | `PayerEnrollmentData` row: `opt_out_eap_assessment_referral` | ✅ via new table |

### Section 16 & 17 — Attestations & Signatures

All ~15 attestation blocks flow into `ProviderAttestation` rows (one per attestation, keyed by `attestation_key`):

| Evernorth field | Schema field | Status |
|---|---|---|
| Provider attestation block | `ProviderAttestation` row: `cigna_evernorth_provider_attestation` | ✅ via new table |
| Provider signature | derive from `ProviderProfile.firstName` + `lastName` | ✅ derived per founder |
| Behavioral Telehealth attestation | `ProviderAttestation` row: `cigna_telehealth_attestation` | ✅ via new table |
| Home Office attestation | `ProviderAttestation` row: `cigna_home_office_attestation` | ✅ via new table |
| Crisis Stabilization 24/7 attestation | `ProviderAttestation` row: `cigna_crisis_24_7_attestation` | ✅ via new table |
| Crisis Stabilization Non-24/7 attestation | `ProviderAttestation` row: `cigna_crisis_non_24_7_attestation` | ✅ via new table |
| Intermediate Care (Urgent) attestation | `ProviderAttestation` row: `cigna_intermediate_urgent_attestation` | ✅ via new table |
| Meet and Greet attestation | `ProviderAttestation` row: `cigna_meet_and_greet_attestation` | ✅ via new table |
| DBT-Adherent attestation | `ProviderAttestation` row: `cigna_dbt_adherent_attestation` | ✅ via new table |
| Office Email use attestation | `ProviderAttestation` row: `cigna_office_email_attestation` | ✅ via new table |
| Specialty patient population (non-adult) attestation | `ProviderAttestation` row: `cigna_specialty_population_attestation` | ✅ via new table |
| EAP General Mgmt Referrals attestation | `ProviderAttestation` row: `cigna_eap_general_mgmt_attestation` | ✅ via new table |
| CEAP / CIR / Seminars / SAP / SAE / Supervisory attestations | `ProviderAttestation` rows (one per key) | ✅ via new table |
| Application Submission Date | derivable as `Enrollment.submittedAt` (or audit timestamp on attestation row) | ✅ |

---

### Tally (post-2026-05-17 decisions)

| Status | Count |
|---|---|
| ✅ Direct match, derivable, or intentionally dropped per founder | ~89 |
| ⚠️ Partial match (acceptable per founder) | ~6 |
| ❌ Genuinely missing requiring schema work | 0 — all covered by 4 additions below |

**100% of Evernorth's required data has a home in the schema with the 4 additions.**

---

## 4. Recommended approach for gaps

Per founder decisions on 2026-05-17, gaps reduce to **2 column additions + 2 new tables**. The two new tables are payer-agnostic and unblock future payers' quirks and attestations without further schema work.

### Addition 1: `PracticeLocation.isHomeOffice` (Boolean, default `false`)

For Section 9 — "Is office in your home?" Yes/No checkbox on each service location.

### Addition 2: `HospitalAffiliation.facilityAddressLine2` (`String?`, nullable)

For Section 5 — facility suite numbers that the existing single-line `facilityAddressLine1` can't hold.

### Addition 3: `PayerEnrollmentData` table — generic key/value per provider × payer track

Replaces the per-payer `EnrollmentRun` pattern. One row per (provider, payer track, fieldKey). Reusable across every payer.

**Shape:**
- `id` cuid
- `providerId` (FK → providers)
- `payerTrackId` (FK → payer_tracks)
- `fieldKey` string (e.g. `enroll_fast_access_network`)
- `fieldValue` text nullable
- `fieldGroup` string nullable (optional grouping)
- audit columns
- unique on `(providerId, payerTrackId, fieldKey)`

**Cigna-specific rows this table will hold:**

| `field_key` | `field_group` | Purpose |
|---|---|---|
| `colocated_medical_physician_name` | `co_located_physician` | Section 4 |
| `colocated_psychiatrist_name` | `co_located_physician` | Section 4 |
| `referring_physician_name` | `co_located_physician` | Section 4 |
| `colocated_office_name` | `co_located_physician` | Section 4 |
| `enroll_fast_access_network` | `fast_access_network` | Section 13 opt-in |
| `opt_out_eap_assessment_referral` | `eap_assessment` | Section 15 opt-out |
| `eap_ceap` | `eap_capabilities` | Section 14 |
| `eap_cir_service` | `eap_capabilities` | Section 14 |
| `eap_educational_seminars` | `eap_capabilities` | Section 14 |
| `eap_management_referrals` | `eap_capabilities` | Section 14 |
| `eap_supervisory_training` | `eap_capabilities` | Section 14 |
| `eap_sap_cert` | `eap_capabilities` | Section 14 |
| `eap_substance_abuse_expert` | `eap_capabilities` | Section 14 |

### Addition 4: `ProviderAttestation` table — legal acknowledgements with timestamp + signer

One row per signed attestation. Reusable across every payer.

**Shape:**
- `id` cuid
- `providerId` (FK → providers)
- `payerTrackId` (FK → payer_tracks)
- `attestationKey` string (e.g. `cigna_crisis_24_7_attestation`)
- `attestationText` text — full legal text shown to provider
- `attested` boolean (default false)
- `attestedAt` datetime nullable
- `signedByName` string nullable (first + last typed/signed)
- audit columns
- unique on `(providerId, payerTrackId, attestationKey)`

**Cigna attestation keys:**

```
cigna_evernorth_provider_attestation
cigna_telehealth_attestation
cigna_home_office_attestation
cigna_crisis_24_7_attestation
cigna_crisis_non_24_7_attestation
cigna_intermediate_urgent_attestation
cigna_meet_and_greet_attestation
cigna_dbt_adherent_attestation
cigna_office_email_attestation
cigna_specialty_population_attestation
cigna_eap_general_mgmt_attestation
cigna_ceap_attestation
cigna_cir_attestation
cigna_eap_seminars_attestation
cigna_sap_attestation
cigna_sae_attestation
cigna_supervisory_training_attestation
cigna_fast_access_network_attestation
```

18 attestation keys for Cigna alone. The case for a single `ProviderAttestation` table (rather than booleans on Provider/Practice) gets stronger with every payer added.

### Effort summary

| Type | Count | Effort |
|---|---|---|
| Boolean column on `PracticeLocation` | 1 (`isHomeOffice`) | one migration |
| Nullable string column on `HospitalAffiliation` | 1 (`facilityAddressLine2`) | same migration |
| New `PayerEnrollmentData` table | 1 | same migration |
| New `ProviderAttestation` table | 1 | same migration |
| Seed taxonomy rows (Cigna's clinical-practice list, specialty network list, age groups) | ~15+ | data-only, no schema work |

**One Prisma migration delivers all four additions.** Both new tables are payer-agnostic.

### Things explicitly NOT being added (per founder decisions on 2026-05-17)

| Not adding | Why |
|---|---|
| Per-location `intakePhone`, `crisisPhone`, `otherPhone` | Use existing `PracticeLocation.phone` for all three |
| Per-location `website` column | Use existing `Practice.website` for every location |
| `selfServiceSchedulingAvailable` | Defaults to "No" — Lanyard doesn't offer self-scheduling today |
| `contractingEmail`, `appointmentAvailabilityEmail` | Collapse all email contacts into `ProviderProfile.email` |
| `billingPhone` on Practice/ProviderBanking | Use `PracticeLocation.phone` |
| `accountHolderFirstName` | Acceptable to use single `ProviderBanking.accountHolderName` field |
| `w9TaxpayerName` | Acceptable to reuse `Practice.name` |
| `adaAccessible` (broader than wheelchair) | `wheelchairAccessible` is sufficient |
| `telehealthAtLocation` boolean | Derivable from `careType` / `locationType` |
| `emailVisibleInDirectory` boolean | Out of scope — directory display not a current concern |
| `facilityTaxIdEncrypted` | Founder doesn't track facility tax IDs — never knows them |
| `nonOfficeServiceArea` enum | Not tracked |
| Per-payer `CignaEvernorthEnrollmentRun` table | Replaced by generic `PayerEnrollmentData` |
| Appointment availability picklist (Crisis 24/7, Non-24/7, Intermediate, Meet & Greet) | Not tracked |

---

## 5. Open questions to verify

| # | Question | Status |
|---|---|---|
| 1 | Does Cigna's "Medicare Identification Number" expect a PTAN or a PECOS ID? | **Open** — tag the right `IdentifierType` enum value when populating |
| 2 | Does `ProviderProfile.entityType` reliably distinguish "individual provider with own TIN" vs "joining a group" the way Cigna's group-practice Y/N expects? | **Open** — if string parsing is fragile, add a normalized boolean later |
| 3 | Does Cigna actually distinguish Type 1 NPI (provider) from Type 2 NPI (group) in two separate boxes? | **Closed** — confirmed (Section 1 = Type 1, Section 7 = Type 2). Verify `Practice.groupNpi` populates Type 2 |
| 4 | Is the "Non-Office Service Area" dropdown a free-form value or an enum? | **Closed** — not tracking per founder |
| 5 | Cigna shows up to 4 service-location slots — does the form back-end accept more, or hard-cap at 4? | **Open** — if hard-cap, the agent must select the 4 most relevant locations when a provider has >4 |
| 6 | Is `Practice.billingEmail` actually used today, or is it dormant? | **Open** — if dormant, wire it through the application page |
| 7 | Are the Fast Access Network and EAP opt-ins payer-specific (Cigna only) or do other payers reuse the same shape? | **Closed** — using generic `PayerEnrollmentData`, payer-shape-agnostic |

---

## What this means for the application page (UI contract)

When the Cigna/Evernorth track is selected, the application page should:

1. **Auto-populate (green badge "from database")** every ✅ field — provider can review without editing
2. **Pre-fill with caveat (yellow badge "partial — verify")** every ⚠️ field — provider must confirm or override
3. **Show empty input** for every field that genuinely has no data on file — provider must enter it
4. **Block submission** until at least one Specialty Patient Population is selected (Cigna's hard requirement)
5. **Block submission** until every required attestation is signed (count: 18 for Cigna)

This is the contract the data-mapping agent needs to follow. **No agent should fabricate a value for a field with no source data** — empty inputs must be visible to the human-in-the-loop.

---

## Status

**Stage:** Migration design locked. 4 schema additions (2 columns + 2 tables) cover all gaps. Both new tables are payer-agnostic and unblock future payers' quirks and attestations without further schema work.

**Next:** Ship the 4-addition migration as a separate PR.

**Last updated:** 2026-05-17
