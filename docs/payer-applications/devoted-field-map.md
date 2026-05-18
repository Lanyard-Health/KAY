# Devoted Health — Field Map

## 1. Source

- **PDF:** `~/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/Applications/Devoted/Page 1.pdf` through `Page 8.pdf` (8 PDF screenshots, one per relevant form page)
- **Form name:** Devoted Health Provider Participation Request Form
- **Form origin:** Google Forms — `docs.google.com/forms/d/e/1FAIpQLSd1MXj4kykU8xQCgU4WnTK2xXGHQseBTc5cORNQV2Gh2PcF8g/formResponse`
- **Date pulled:** 2026-05-17
- **Submission shape:** Provider (individual/group), Behavioral Health, currently contracted with Devoted. The form has a claimed 18 pages but uses conditional branching — only **8 pages are pertinent for this path** (pages 1, 2, 3, 4, 5, 6, 16, 18). The other 10 pages route to specialty-specific or facility-specific flows we don't hit.
- **PII handling:** Per folder README, this file documents the *field structure* of the Devoted application. The PDF screenshots contain test data the founder entered to capture form structure (placeholder practice/provider names, fabricated NPIs/TIN). No values are reproduced here — only field shapes.

---

## 2. Fields extracted from the PDF

Devoted's participation-request form has **8 pertinent pages** and **28 distinct fields** plus 3 supporting document uploads. Pages are referenced by their on-form number (1–18); gaps in numbering reflect skipped conditional pages.

### Page 1 — Existing relationship
- Are you currently contracted with Devoted Health? (radio: No / Yes / Not sure)

### Page 2 — Existing contract details (conditional — appears only if currently contracted = Yes)
- Practice Name + TIN + Billing NPI of currently contracted group (single free-text field — three values combined)

### Page 3 — Service area
- State (dropdown — Devoted's 27 service-area states only)

### Page 4 — Contract type
- Request to be contracted and credentialed as: (radio — Provider / Facility or Ancillary / Vision Provider)

### Page 5 — Specialty
- Choose your Specialty (single-select radio — 37 specialty options plus "Other" free text; asterisked specialties follow a different enrollment flow)

### Page 6 — Practice details
- Business Name as shown on W9
- DBA as shown on W9
- How many providers (including mid-levels)
- Provider Name (First, Last — one only; additional providers go in the page-18 comment field)
- Provider NPI Number (one only; additional NPIs go in the page-18 comment field)
- Group NPI Number
- Billing TIN Number as shown on W9
- Practice Address
- City
- Zip code
- County or Counties
- Website (optional)
- In-house Laboratory Services? (checkbox — Yes / No / Other free-text for preferred lab vendor)
- In-house Radiology Services? (checkbox — Yes / No / Other free-text for referred radiology groups)
- Performs Surgeries? (checkbox — Yes / No / Other free-text for preferred Hospital/ASC)
- Additional services — In-home services? (Yes/No grid)
- Additional services — Telehealth services? (Yes/No grid)

### Page 16 — Submitter information
- Contact Name (first + last)
- Title (multi-select checkbox: Office Manager or Administrator / Provider Credentialing / Facility Credentialing / Billing / Owner / Other free-text)
- Contact Phone Number
- Email Address
- Will you be the Authorized Signatory for the Agreement? (radio: Yes / No)

### Page 18 — Final comments + supporting documents
- Free-text comments (optional — also used to list additional providers/NPIs that didn't fit on page 6)

**Supporting documents (uploads, not form fields):**
- Roster template + credentialing data (per `devoted.com/providers/providers-data-cred/`)
- W-9 (current year only)
- SNF Facilities Form (supplied by Devoted's network team — only required for SNFs)

---

## 3. Schema mapping

### Page 1 — Existing relationship

| Devoted field | Schema field | Status |
|---|---|---|
| Currently contracted with Devoted? | _no stored flag — derived from `Enrollment` row existing for (provider, Devoted)_ | ⚠️ — computed at form-fill time |

### Page 2 — Existing contract details

| Devoted field | Schema field | Status |
|---|---|---|
| Practice Name + TIN + Billing NPI (combined) | `Practice.name` + `Practice.taxIdEncrypted` + `Practice.groupNpi` | ✅ — values exist; compose into one string at submit time |

### Page 3 — Service area

| Devoted field | Schema field | Status |
|---|---|---|
| State | `Practice.state` / `PracticeLocation.state` / `ProviderProfile.targetStates[]` | ✅ |

### Page 4 — Contract type

| Devoted field | Schema field | Status |
|---|---|---|
| Provider / Facility / Vision | `Practice.organizationTypeId` → `OrganizationType` lookup | ⚠️ — column exists; need DB read to confirm Devoted's 3 values are seeded as rows |

### Page 5 — Specialty

| Devoted field | Schema field | Status |
|---|---|---|
| Specialty (37 options) | `PracticeSpecialty` join → `Specialty` (NUCC taxonomy) | ⚠️ — schema supports it; need DB read to confirm Devoted's specialty labels match seeded `Specialty.name` values |

### Page 6 — Practice details

| Devoted field | Schema field | Status |
|---|---|---|
| Business Name (W9) | `Practice.name` | ✅ |
| DBA (W9) | _no `dbaName` column on `Practice`_ | ❌ |
| Number of providers (incl. mid-levels) | _no stored count — derived from `COUNT(ProviderProfile WHERE practiceId = X)`_ | ⚠️ — derivable; mid-level distinction limited (only `pmhnp` in `ProviderType` enum, no `np` / `pa`) |
| Provider Name | `ProviderProfile.firstName` + `lastName` | ✅ |
| Provider NPI | `ProviderProfile.npi` | ✅ |
| Group NPI | `Practice.groupNpi` (also on `PracticeLocation.groupNpi`) | ✅ |
| Billing TIN (W9) | `Practice.taxIdEncrypted` (AES-256-GCM — decrypt to populate) | ✅ |
| Practice Address | `Practice.addressLine1` / `PracticeLocation.addressLine1` | ✅ |
| City | `Practice.city` / `PracticeLocation.city` | ✅ |
| Zip code | `Practice.zipCode` / `PracticeLocation.zipCode` | ✅ |
| County | `PracticeLocation.county` (nullable) | ⚠️ — only on `PracticeLocation`, not on `Practice`. A practice with no location row has no county |
| Website | `Practice.website` | ✅ |
| In-house Lab (Y/N + Other) | _no `performsInHouseLab` boolean; no `labVendorNotes` text_ | ❌ |
| In-house Radiology (Y/N + referred groups) | _no `performsInHouseRadiology` boolean; no referred-group text_ | ❌ |
| Performs Surgeries (Y/N + preferred Hospital/ASC) | _no practice-level boolean; `HospitalAffiliation` is per-provider, not the group's preferred facilities_ | ❌ |
| In-home services (Y/N, practice-level) | `ProviderProfile.careType` has `in_home` enum; `PracticeLocation.locationType` is free-text — no practice-level Y/N | ⚠️ |
| Telehealth services (Y/N, practice-level) | `PracticeLocation.locationType` can be `"telehealth"`; no practice-level Y/N | ⚠️ |

### Page 16 — Submitter information

| Devoted field | Schema field | Status |
|---|---|---|
| Contact Name | `User.firstName` + `lastName` | ✅ |
| Title (6 role options) | `User.role` / `UserPractice.role` (PracticeRole enum) | ⚠️ — Devoted's 6 options (Office Manager, Provider Credentialing, Facility Cred, Billing, Owner, Other) don't 1:1 match the existing enum |
| Contact Phone Number | `User.phone` | ✅ |
| Email Address | `User.email` | ✅ |
| Authorized Signatory (Y/N) | _no `isAuthorizedSignatory` flag on `User` or `UserPractice`_ | ❌ |

### Page 18 — Final comments + supporting documents

| Devoted field | Schema field | Status |
|---|---|---|
| Free-text comments / additional providers + NPIs | Comments → `Enrollment.notes` (existing). Additional providers → generated from `ProviderProfile` list under the practice. | ✅ — composed at submit time |
| W-9 upload | `Document` with `documentType = w9` | ✅ |
| Roster template | _not stored — generated from `ProviderProfile` list_ | ✅ — output, not input |
| SNF Facilities Form | _N/A unless practice is an SNF_ | — |

---

### Tally

| Status | Count |
|---|---|
| ✅ Direct match | 18 |
| ⚠️ Partial match | 5 |
| ❌ Missing | 5 |

(28 form fields; supporting documents tallied separately.)

---

## 4. Recommended approach for gaps

### Group A — Boolean columns to add (single migration)

| Field | Table | Column |
|---|---|---|
| In-house Lab services | `Practice` | `performsInHouseLab` (bool) |
| In-house Radiology | `Practice` | `performsInHouseRadiology` (bool) |
| Performs Surgeries | `Practice` | `performsSurgeries` (bool) |
| Offers In-home services | `Practice` | `offersInHomeServices` (bool — practice-level rollup) |
| Offers Telehealth | `Practice` | `offersTelehealth` (bool — practice-level rollup) |
| Authorized Signatory | `UserPractice` | `isAuthorizedSignatory` (bool — on the join table because the same person could be signatory for one practice but not another) |

### Group B — Strings / text columns to add (same migration)

| Field | Table | Column |
|---|---|---|
| DBA | `Practice` | `dbaName` (text, nullable) |
| Lab vendor notes ("Other" free-text) | `Practice` | `labVendorNotes` (text, nullable) |
| Radiology referral notes ("Other" free-text — referred groups) | `Practice` | `radiologyReferralNotes` (text, nullable) |
| Preferred surgical facilities ("Other" free-text — Hospital/ASC) | `Practice` | `preferredSurgicalFacilities` (text, nullable) |
| County (practice-level — optional alternative to reading from `PracticeLocation`) | `Practice` | `county` (text, nullable) — only add if a single rollup is required |

### Group C — Enum / role decision

The "Title" field on page 16 has 6 options. The existing `PracticeRole` enum (used by `UserPractice.role`) is the candidate, but its values don't 1:1 match Devoted's options.

**Recommended:** expand `PracticeRole` to include Devoted's 6 values OR add a separate `UserPractice.title` text field. The latter is less coupling — payer-form titles change more often than software-permission roles, and shouldn't be tangled together.

### Group D — Derivations / no schema change needed

| Field | Approach |
|---|---|
| Currently contracted with Devoted? | Helper query: `SELECT EXISTS(... FROM payer_enrollments WHERE provider_id = X AND payer_id = devoted_id AND status IN ('active', 'effective'))` |
| Number of providers (incl. mid-levels) | `COUNT(*) FROM provider_profiles WHERE practice_id = X` — but mid-level vs MD breakdown is limited by current `ProviderType` enum (only `pmhnp` is a recognized mid-level). Expand enum later if onboarding medical practices |
| Additional providers + NPIs (page-18 comment text) | Generate from `provider_profiles` list when more than one provider; format as `"Name (NPI), Name (NPI), …"` |

### Summary of work shape

| Type | Count | Effort |
|---|---|---|
| Boolean columns | 6 | one migration |
| String/text columns | 4–5 | same migration |
| Enum expansion OR new `UserPractice.title` field | 1 | same migration |
| Helper logic (derivations) | 3 | no schema change — service-layer functions |
| Already exists, just wire up | Website, W-9, address fields, NPI, TIN, etc. | zero schema work |

**One Prisma migration delivers Groups A–C.** After that, every Devoted PDF field has a home in the database or a documented derivation path.

---

## 5. Open questions to verify

Quick schema/DB checks to confirm before locking the migration:

| # | Question | If "no" |
|---|---|---|
| 1 | Is `OrganizationType` seeded with rows matching "Provider / Provider Group", "Facility / Ancillary", and "Vision Provider"? | Add as seed data rows (no schema change) |
| 2 | Does the `Specialty` table contain all 37 Devoted specialty labels (PCP, Behavioral Health, Cardiology, etc.) — checked by `name` or via NUCC code lookup? | Seed missing rows (no schema change) |
| 3 | What values does the `PracticeRole` enum currently hold? Do any of them line up with Devoted's 6 title options? | Decide between enum expansion vs. new `title` field per Group C |
| 4 | Does `ProviderType` enum need `np` / `pa` values for accurate mid-level counts in non-behavioral specialties? | Expand enum in the migration if Devoted onboards medical practices |
| 5 | Is `Enrollment.notes` the right home for the page-18 free-text comment, or should Devoted-specific submissions have a dedicated table (like `AetnaEnrollmentRun`)? | If dedicated table is needed, create `DevotedEnrollmentRun` mirroring `AetnaEnrollmentRun` |

---

## Status

**Stage:** Initial mapping complete. Awaiting schema-verification pass (open questions above) before designing the migration.

**Last updated:** 2026-05-17
