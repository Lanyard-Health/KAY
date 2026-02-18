# Automated Aetna Provider Enrollment — Design Document

**Date:** 2026-02-18
**Status:** Approved
**Epic:** Payer Enrollment Automation

## Goal

Enable credentialing specialists to submit Aetna provider enrollment applications directly from Lanyard, reducing enrollment time from 30–45 minutes to under 5 minutes per provider with zero data re-entry and mandatory human review before submission.

## Architecture

Four layers:

1. **Readiness Check** — Pure data validation comparing provider/practice/location data against the 39 required Aetna fields. Returns per-page completeness with guidance on where to fix gaps.

2. **Form Filler Service** — Playwright-based headless Chromium automation. Navigates all 10 pages of the Aetna Angular SPA form, fills fields using `formcontrolname` selectors, screenshots each page. Captures Request ID from page 3. Stops at the final submit popup on page 10 and holds the browser session in memory.

3. **Review + Approval API** — Serves screenshots to the frontend for human review. On approve, triggers final submit. On reject or 30-minute timeout, closes browser without submitting. Generates a PDF of all screenshots on successful submission.

4. **AetnaEnrollmentRun Model** — Tracks the full lifecycle: `pending` → `filling` → `awaiting_review` → `submitting` → `completed` (or `failed` / `rejected` / `timed_out`). Stores Request ID, form payload snapshot, screenshot document IDs, automation log, and errors.

## Data Flow

```
User clicks "Check Readiness"
  → Backend validates provider data against Aetna field map
  → Returns { ready, pages: [{ page, title, ready, missingFields }] }

User clicks "Start Aetna Enrollment"
  → Creates AetnaEnrollmentRun (status: filling)
  → Playwright fills pages 1–10, screenshots each
  → Captures Request ID from page 3
  → Status → awaiting_review
  → Browser session held in memory (30-min timeout)

User reviews screenshots in UI
  → Approve: Playwright clicks final submit → captures confirmation → PDF → status: completed
  → Reject: Browser closed → status: rejected
  → Timeout: Browser closed → status: timed_out
```

## Schema Changes

### New Model: AetnaEnrollmentRun

```prisma
enum AetnaRunStatus {
  pending
  filling
  awaiting_review
  submitting
  completed
  failed
  rejected
  timed_out
}

model AetnaEnrollmentRun {
  id                  String         @id @default(uuid())
  payerEnrollmentId   String
  payerEnrollment     PayerEnrollment @relation(fields: [payerEnrollmentId], references: [id])

  status              AetnaRunStatus @default(pending)
  aetnaRequestId      String?

  formPayload         Json
  automationLog       String?        @db.Text
  errorMessage        String?
  errorPage           Int?

  screenshotDocIds    String[]
  confirmationPdfId   String?

  startedAt           DateTime?
  reviewExpiresAt     DateTime?
  submittedAt         DateTime?
  completedAt         DateTime?

  initiatedById       String
  initiatedBy         User           @relation(fields: [initiatedById], references: [id])

  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt
}
```

### Field Additions to Existing Models

**Provider:**
- `acceptingMedicare  Boolean @default(false)`
- `acceptingMedicaid  Boolean @default(false)`
- `ePrescribing       Boolean @default(false)`

**HospitalAffiliation:**
- `facilityNpi          String?`
- `facilityPhone        String?`
- `facilityAddressLine1 String?`
- `facilityCity         String?`
- `facilityState        String?`
- `facilityZipCode      String?`

## Backend Services

### aetna-readiness.service.ts

Pure validation — no browser, no side effects.

- Maps each of the 39 required Aetna fields to a Prisma query path on the Provider and related models
- Returns per-page breakdown: `{ ready, pages: [{ page, title, ready, missing: [{ field, label, fixPath }] }] }`
- `fixPath` directs the frontend to the correct edit screen (e.g., `/providers/:id/edit#licenses`)
- Checks: NPI, name, DOB, email, phone, primary license (state + number + expiration), CAQH ID, degree type, primary specialty, primary practice location (street, city, state, zip, county, fax, phone), tax ID, accepting new patients, hospital privileges status

### aetna-enrollment.service.ts

Orchestrator — manages the lifecycle of an enrollment run.

- `startEnrollment(enrollmentId, userId)` — validates readiness, creates AetnaEnrollmentRun, launches form filler, manages status transitions
- `getRunStatus(runId)` — returns current status, screenshot signed URLs, automation log
- `approveAndSubmit(runId, userId)` — triggers final submit on the held browser session
- `rejectRun(runId, userId)` — closes browser, marks rejected
- `retryRun(runId, userId)` — retries a failed run from scratch
- Handles 30-min review timeout via `setTimeout` + cleanup (closes browser, marks timed_out)
- Concurrency: one active browser session per enrollment at a time

### aetna-form-filler.ts

Playwright page automation — one function per Aetna form page.

- Uses `page.locator('[formcontrolname="fieldName"]')` for Angular Material fields
- Special handling:
  - **Gateway:** Three cascading dropdown selections (Aetna → Medical → second option)
  - **Page 2:** Hidden email acknowledgement radio (must click link first, then select "Agree")
  - **Page 3:** Captures Request ID after form submission
  - **Page 4:** Click hyperlink (not button) to proceed; dismiss "Credentialing with CAQH" popup
  - **Page 4 specialty:** Dynamic dropdown — options populate based on degree type selection
  - **Page 7:** Material chip input for languages (type + Enter)
  - **Page 10:** Stop at "Submit Request for Participation" popup — do NOT click
- Screenshots each page after filling, stores to R2
- Returns `{ requestId, screenshots: string[], log: string }`

### aetna-field-mapper.ts

Maps Lanyard data to Aetna form values.

- Input: provider + practice + primary location + licenses + board certs + hospital affiliations + demographics
- Output: flat object keyed by `formcontrolname` → value
- Handles enum translations:
  - `DegreeType` (md/do/phd/psyd/msw...) → Aetna degree codes (MD/DO/PhD/PsyD/MSW...)
  - State codes
  - Tax ID type (EIN vs SSN)
  - Network joining option based on practice setup
- Sensitive fields (SSN, tax ID) decrypted at map time, never logged

## API Routes

Prefix: `/api/v1/enrollments/:enrollmentId/aetna`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/readiness` | Check readiness for Aetna enrollment |
| POST | `/start` | Begin automated enrollment |
| GET | `/runs/:runId` | Get run status + screenshot URLs |
| POST | `/runs/:runId/approve` | Approve and submit to Aetna |
| POST | `/runs/:runId/reject` | Reject submission |
| POST | `/runs/:runId/retry` | Retry failed submission |

All routes restricted to `admin`, `credentialing_staff`, `practice_admin`.

## Frontend Components

### Readiness Panel (enrollment detail page)
- Green/red per-page checklist
- "Fix" links for each missing field directing to the correct edit form
- "Check Readiness" button to refresh

### Enrollment Automation Panel
- "Start Aetna Enrollment" button (only enabled when readiness check passes)
- Progress indicator during form filling
- Status badge showing current automation state

### Review Screen
- Page-by-page screenshot carousel (10 images)
- "Approve & Submit" button with confirmation dialog ("This action cannot be undone")
- "Reject" button to cancel without submitting
- Countdown timer showing review window remaining (30 min)

### Enrollment Record
- Aetna Request ID display
- Submission timestamp
- Downloadable PDF of the complete submitted application
- Automation log (expandable)

## Dependencies

- **Playwright** — new backend dependency for browser automation
- **Existing R2/S3 service** — screenshot and PDF storage
- **Existing enrollment workflow** — AetnaEnrollmentRun links to PayerEnrollment

## Security Considerations

- Tax IDs and SSNs decrypted only at form-fill time, never persisted in `formPayload` in plaintext — store as masked values (last 4 digits) in the snapshot
- Playwright runs headless with `--no-sandbox` disabled (use Chromium's default sandbox)
- Browser sessions cleaned up on timeout/rejection — no orphaned processes
- All automation routes require authentication + authorization (admin/staff/practice_admin)
- Screenshots may contain PII — stored in R2 with same access controls as documents
- Rate limit: max 1 concurrent automation run per practice to prevent abuse

## Out of Scope

- Automating enrollment for payers other than Aetna
- Editing pre-filled data from within the review screen
- Automatic submission without human review
- CAPTCHA handling (Aetna form does not currently use one)

## Reference Files

- `aetna-form-complete.json` — curated field map with 10 pages, navigation notes, form controls
- `aetna-fields.json` — raw DOM extraction with selectors, CSS classes, hidden fields
- User story: `user-story-aetna-enrollment.md`
