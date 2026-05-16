# Aetna — Field Map

## 1. Source

- **PDF:** `~/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/Customers/Great Cognition/Edit_Aetna_Submission.pdf`
- **Date pulled:** 2026-05-16
- **Submission shape:** Behavioral Health Professional (Specialist), Type 1 NPI, Individual TIN, Kansas
- **PII handling:** Per folder README, this file documents the *field structure* of the Aetna application. No Tax IDs, DOBs, NPIs, license numbers, phone numbers, or personal names from the source PDF are reproduced here.

---

## 2. Fields extracted from the PDF

Aetna's "Request for Participation" form has 12 sections and ~70 distinct fields.

### Section 1 — Submitter(s) Information
- Last Name
- First Name
- Role (Credentialing / Enrollment — Director, Manager, Coordinator)
- Email
- Phone Number
- Fax Number
- Email Acknowledgement (checkbox attestation)
- "I agree the above information is correct" (checkbox attestation)

### Section 2 — Network Participation Check
- Provide telehealth services (Y/N)
- I provide (In-person / Telehealth only / Hybrid services)
- I am joining (dropdown — group / individual / situation)
- Situation ("I want to be contracted in the state selected below")
- State
- Primary ZIP Code
- Tax ID Type (SSN vs EIN)
- Tax ID applying under
- Tax ID Name
- Individual Type 1 NPI Number
- Practitioner Name (Last, First)
- "I agree the above information is correct"

### Section 3 — Participation Details
- Is your TIN a Group or Individual Tax ID?
- I am joining as a (e.g., Behavioral Health Professional — Specialist)

### Section 4 — Specialty Details
- Degree Type (e.g., PhD)
- Primary Specialty
- Provider Role
- Agree to behavioral health provider manual (attestation)
- "I agree the above information is correct"

### Section 5 — Practitioner Information
- Last Name
- First Name
- Middle Initial
- Date of Birth
- State Medical License Was Issued In
- Medical License Number
- Medical License Expiration Date
- CAQH ID
- Website URL
- Is the provider hospitalist or exclusively facility/hospital-based?
- Is electronic prescribing offered?

### Section 6 — Contracting Information
- Contact Person for Contracting
- Preferred Contact Method

### Section 7 — Contract Authority Signature Information
- Contract Authority Signature 1

### Section 8 — Primary Place of Service
- Place of Service type (e.g., Office Based)
- Street
- Street 2
- City
- State
- Primary Location ZIP Code
- County
- Phone Number
- Fax Number
- Languages spoken by Office Staff
- Languages spoken by Interpreter
- Facility Fee (Y/N)
- Is this location ADA accessible? (Y/N)
- Access Accommodations (text)
- Frequency of Practice
- Working days for providers
- Office Hours Days and Times
- Telehealth services at this location (Y/N)
- Telehealth services provided (multi-select)
- Methods of telehealth (multi-select — Video / Phone / RPM / Three-Way / Online Adaptive)
- Types of telehealth services (multi-select)
- Other telehealth services (text)
- HIPAA-compliant platform attestation (Y/N)

### Section 9 — Primary Service Location Mailing Address
- Same as primary service location OR separate mailing address

### Section 10 — Primary Service Location Billing Address
- Same as primary service location OR separate billing address

### Section 11 — Other Information
- Hospital Admitting Privileges (Y/N)
- Facility Admitting Privileges (Y/N)
- Special populations you work with
- W9 Attachment (file upload)

### Section 12 — Additional Behavioral Health Provider Details
- Age groups you work with (multi-select)
- Medicare certified (Y/N)
- Medicare PTAN
- Medicaid certified (Y/N)
- EAP participation (Y/N)
- American Sign Language (Y/N)
- Languages spoken by the Provider
- Provider Practice Focus (multi-select — CBT, Group, Neuropsych Testing, Psychological Testing, Psychotic Disorders, etc.)

---

## 3. Schema mapping

### Section 1 — Submitter(s) Information

| Aetna field | Schema field | Status |
|---|---|---|
| Last Name | `User.lastName` | ✅ |
| First Name | `User.firstName` | ✅ |
| Role | `UserPractice.role` (PracticeRole enum) | ✅ |
| Email | `User.email` | ✅ |
| Phone Number | `User.phone` _(verify)_ | ⚠️ |
| Fax Number | _no fax on User_ | ❌ |
| Email Acknowledgement | _no attestation table_ | ❌ |
| "I agree" attestation | _no attestation table_ | ❌ |

### Section 2 — Network Participation Check

| Aetna field | Schema field | Status |
|---|---|---|
| Provide telehealth services | derivable from `PracticeService` / `PracticeLocation`, no boolean flag | ⚠️ |
| I provide (modality) | _no service-modality field_ | ❌ |
| I am joining (dropdown) | _no enrollment-intent field_ | ❌ |
| Situation | _no enrollment-intent field_ | ❌ |
| State | `Practice.state` / `PracticeLocation.state` | ✅ |
| Primary ZIP Code | `Practice.zipCode` / `PracticeLocation.zipCode` | ✅ |
| Tax ID Type (SSN/EIN) | _we store the encrypted ID but not the type_ | ❌ |
| Tax ID applying under | `Practice.taxIdEncrypted` | ✅ |
| Tax ID Name | `Practice.name` | ✅ |
| Individual Type 1 NPI Number | `ProviderProfile.npi` | ✅ |
| Practitioner Name | `ProviderProfile.firstName` / `lastName` | ✅ |

### Section 3 — Participation Details

| Aetna field | Schema field | Status |
|---|---|---|
| TIN: Group or Individual | `ProviderProfile.entityType` (free-text string) | ⚠️ — string, not enum |
| I am joining as a | `ProviderProfile.providerType` + `careType` | ✅ |

### Section 4 — Specialty Details

| Aetna field | Schema field | Status |
|---|---|---|
| Degree Type | `Education.degreeType` (DegreeType enum) | ✅ |
| Primary Specialty | `ProviderSpecialty` → `Specialty` | ⚠️ — needs `isPrimary` flag _(verify)_ |
| Provider Role | `ProviderProfile.providerType` partial overlap | ⚠️ |
| Provider-manual attestation | _no attestation table_ | ❌ |

### Section 5 — Practitioner Information

| Aetna field | Schema field | Status |
|---|---|---|
| Last Name | `ProviderProfile.lastName` | ✅ |
| First Name | `ProviderProfile.firstName` | ✅ |
| Middle Initial | `ProviderProfile.middleName` | ✅ |
| Date of Birth | `ProviderProfile.dateOfBirth` | ✅ |
| State License Issued In | `License.state` | ✅ |
| Medical License Number | `License.licenseNumber` | ✅ |
| Medical License Expiration Date | `License.expirationDate` | ✅ |
| CAQH ID | `ProviderProfile.caqhProviderId` | ✅ |
| Website URL | _no provider-level website (only `Practice.website`)_ | ❌ |
| Hospitalist / facility-based | `ProviderProfile.hospitalBasedFlag` | ✅ |
| Electronic prescribing | `ProviderProfile.ePrescribing` | ✅ |

### Section 6 — Contracting Information

| Aetna field | Schema field | Status |
|---|---|---|
| Contact Person for Contracting | _no contracting-contact field_ | ❌ |
| Preferred Contact Method | _no field_ | ❌ |

### Section 7 — Contract Authority Signature

| Aetna field | Schema field | Status |
|---|---|---|
| Contract Authority Signature 1 | _no signatory field_ | ❌ |

### Section 8 — Primary Place of Service

| Aetna field | Schema field | Status |
|---|---|---|
| Place of Service type | `PracticeLocation.locationType` | ✅ |
| Street | `PracticeLocation.addressLine1` | ✅ |
| Street 2 | `PracticeLocation.addressLine2` | ✅ |
| City | `PracticeLocation.city` | ✅ |
| State | `PracticeLocation.state` | ✅ |
| ZIP Code | `PracticeLocation.zipCode` | ✅ |
| County | `PracticeLocation.county` | ✅ |
| Phone | `PracticeLocation.phone` | ✅ |
| Fax | `PracticeLocation.fax` | ✅ |
| Languages — Office Staff | `PracticeLocation.languagesSpoken[]` | ⚠️ — array doesn't separate staff vs interpreter |
| Languages — Interpreter | `PracticeLocation.interpreterAvailable` (bool only) | ⚠️ — bool, not language list |
| Facility Fee (Y/N) | _no field_ | ❌ |
| ADA accessible | `PracticeLocation.wheelchairAccessible` | ⚠️ — narrower than ADA |
| Access Accommodations (text) | _no field_ | ❌ |
| Frequency of Practice | _no field_ | ❌ |
| Working days | `PracticeLocation.officeHours` (JSON) | ✅ |
| Office Hours Days/Times | `PracticeLocation.officeHours` (JSON) | ✅ |
| Telehealth at this location | _no boolean flag_ | ❌ |
| Telehealth provided (modality) | _no field_ | ❌ |
| Methods of telehealth | _no field_ | ❌ |
| Types of telehealth services | `PracticeService` taxonomy _(verify)_ | ⚠️ |
| Other telehealth services (text) | _no field_ | ❌ |
| HIPAA-compliant platform attestation | _no attestation table_ | ❌ |

### Section 9 — Mailing Address

| Aetna field | Schema field | Status |
|---|---|---|
| Mailing address | `ProviderAddress` with `AddressType.mailing`; no mailing fields on `PracticeLocation` | ⚠️ |

### Section 10 — Billing Address

| Aetna field | Schema field | Status |
|---|---|---|
| Billing address | `PracticeLocation.billingAddressLine1/2/City/State/ZipCode` | ✅ |

### Section 11 — Other Information

| Aetna field | Schema field | Status |
|---|---|---|
| Hospital Admitting Privileges | `ProviderProfile.hospitalPrivilegeFlag` + `HospitalAffiliation` | ✅ |
| Facility Admitting Privileges | _no field_ | ❌ |
| Special populations | `ProviderSpecialPopulation` → `SpecialPopulation` taxonomy | ✅ |
| W9 Attachment | `Document` (`DocumentType.w9`) + `ProviderBanking.w9OnFile` | ✅ |

### Section 12 — Additional Behavioral Health Provider Details

| Aetna field | Schema field | Status |
|---|---|---|
| Age groups | `ProviderAgeGroup` → `PatientAgeGroup` | ✅ |
| Medicare certified | `ProviderProfile.acceptingMedicare` | ✅ |
| Medicare PTAN | `ProviderIdentifier` w/ `IdentifierType` enum _(verify PTAN value)_ | ⚠️ |
| Medicaid certified | `ProviderProfile.acceptingMedicaid` | ✅ |
| EAP participation | _no field_ | ❌ |
| American Sign Language | could live in `PracticeLocation.languagesSpoken` | ⚠️ |
| Languages spoken by Provider | `ProviderProfile.languages[]` | ✅ |
| Practice Focus (CBT, Group, etc.) | `ProviderService` → `ServiceOffering` _(verify offerings seeded)_ | ⚠️ |

---

### Tally

| Status | Count |
|---|---|
| ✅ Direct match | ~36 |
| ⚠️ Partial match | ~14 |
| ❌ Missing | ~20 |

---

## 4. Recommended approach for gaps

### Group A — Boolean columns to add (single migration)

| Field | Table | Column |
|---|---|---|
| Submitter fax | `User` | `fax` (string) |
| Facility Fee | `PracticeLocation` | `facilityFee` (bool) |
| ADA accessible | `PracticeLocation` | `adaAccessible` (bool — keep `wheelchairAccessible` as a more-specific child) |
| Telehealth at this location | `PracticeLocation` | `telehealthAtLocation` (bool) |
| Facility Admitting Privileges | `ProviderProfile` | `facilityPrivilegeFlag` (bool — mirror of `hospitalPrivilegeFlag`) |
| EAP participation | `ProviderProfile` | `participatesInEap` (bool) |

### Group B — Enums / dropdowns to add (same migration)

| Field | Table | New enum |
|---|---|---|
| Tax ID Type | `Practice` | `taxIdType` → `{ ssn, ein }` |
| Preferred Contact Method | `Practice` | `preferredContactMethod` → `{ email, phone, fax }` |
| Service modality (covers both "I provide" and "Telehealth provided") | `PracticeLocation` | `serviceModality` → `{ in_person, telehealth_only, hybrid }` |

### Group C — Strings, text, arrays to add (same migration)

| Field | Table | Column |
|---|---|---|
| Website | **already exists** as `Practice.website` ✅ — just wire it in |
| Contracting Contact Name | `Practice` | `contractingContactName` |
| Contracting Contact Email | `Practice` | `contractingContactEmail` |
| Contracting Contact Phone | `Practice` | `contractingContactPhone` |
| Contract Authority Name | `Practice` | `contractAuthorityName` |
| Contract Authority Title | `Practice` | `contractAuthorityTitle` |
| Methods of telehealth | `PracticeLocation` | `telehealthMethods` (string[]) |
| Other telehealth services | `PracticeLocation` | `otherTelehealthServices` (text) |
| Access Accommodations | `PracticeLocation` | `accessAccommodations` (text) |
| Frequency of Practice | `PracticeLocation` | `frequencyOfPractice` (text) |

### Group D — Belongs on the enrollment, not on Provider/Practice

These are Aetna-form-specific intent, not durable provider state. Putting them on `ProviderProfile` would pollute it with one-off Aetna noise.

| Field | Home |
|---|---|
| "I am joining" (group situation dropdown) | `AetnaEnrollmentRun.joiningSituation` |
| "Situation" ("I want to be contracted in state X") | `AetnaEnrollmentRun.contractingIntent` (or skip — answer is always the same for Lanyard's flow) |

### Group E — Attestations (one new table for all of them)

Email Acknowledgement, "I agree", Provider Manual, HIPAA Compliant Platform — all the same shape: a checkbox confirming someone agreed to something at a point in time. Not provider data — audit-trail events.

**New table `EnrollmentAttestation`:**

| Column | Type | Purpose |
|---|---|---|
| `enrollmentId` | FK | Which application |
| `attestationKey` | string | e.g. `aetna_email_ack`, `aetna_provider_manual`, `aetna_hipaa_platform` |
| `attestedBy` | FK to User | Who clicked |
| `attestedAt` | timestamp | When clicked |
| `payerCode` | string | `aetna`, etc. |

**Why one table instead of 4 booleans on Provider/Practice:**
1. Every future payer adds 3–6 attestations. Adding booleans forever scales poorly.
2. Audit/legal requires "who clicked when" — booleans can't store that.
3. The application page just iterates the attestations the payer needs and renders a checkbox for each.

### Summary of work shape

| Type | Count | Effort |
|---|---|---|
| Boolean columns | 6 | one migration |
| Enums + columns | 3 | same migration |
| String/text/array columns | 9 | same migration |
| New `EnrollmentAttestation` table | 1 | same migration |
| `AetnaEnrollmentRun` columns | 1–2 | same migration |
| Already exists, just wire up | Website | zero schema work |

**One Prisma migration delivers Groups A–E.** After that, every Aetna PDF field has a home in the database.

---

## 5. Open questions to verify

Quick schema checks to confirm before locking the migration:

| # | Question | If "no" |
|---|---|---|
| 1 | Does `User` have a `phone` field? | Add `phone` alongside `fax` in Group A |
| 2 | Does `ProviderSpecialty` have an `isPrimary` boolean? | Add it in the migration |
| 3 | Does `IdentifierType` enum include `medicare_ptan`? | Add it in the migration |
| 4 | Is `ServiceOffering` taxonomy seeded with CBT, Group Therapy, Neuropsych Testing, Psychological Testing? | Seed them — data row only, no schema change |

---

## Status

**Stage:** Initial mapping complete. Awaiting schema-verification pass (open questions above) before designing the migration.

**Last updated:** 2026-05-16
