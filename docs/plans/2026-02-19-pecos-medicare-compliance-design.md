# PECOS Medicare Compliance Feature — Design

**Date:** 2026-02-19
**Status:** Approved

## Problem

The backend already has 5 PECOS API endpoints (`/api/v1/pecos/*`) that proxy CMS public data, but:
- The frontend only shows a small sidebar card on the Provider Detail page with no persistence
- There's no way to see Medicare status across all providers at a glance
- Every page load hits the CMS API live (no DB caching)
- No bulk verification capability

## Solution

Three changes to surface PECOS data properly:

1. **Persist PECOS data to DB** via a new `MedicareVerification` model
2. **Enhance the Provider Detail Medicare section** with full enrollment data and re-verify action
3. **Add Medicare Status column + filter to the Provider List** with bulk verify

## Data Layer

### New Prisma Model: `MedicareVerification`

```prisma
model MedicareVerification {
  id         String   @id @default(uuid())
  providerId String   @unique @map("provider_id")
  provider   Provider @relation(fields: [providerId], references: [id], onDelete: Cascade)

  status     MedicareStatus @default(UNVERIFIED)
  verifiedAt DateTime?      @map("verified_at")

  npi              String?
  pacId            String?  @map("pac_id")
  enrollmentCount  Int      @default(0) @map("enrollment_count")
  enrollmentStates String[] @default([]) @map("enrollment_states")
  rawData          Json?    @map("raw_data")

  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@map("medicare_verifications")
}

enum MedicareStatus {
  ENROLLED
  NOT_ENROLLED
  UNVERIFIED
}
```

**Design decisions:**
- **One-to-one** with Provider (unique on `providerId`)
- **Denormalized JSON snapshot** in `rawData` — stores the full `MedicareEnrollmentResult` from CMS. This avoids normalizing enrollment records into separate tables (YAGNI — CMS is the source of truth, we just cache it)
- **Indexed status fields** (`status`, `verifiedAt`) for fast list filtering
- **30-day stale threshold** — if `verifiedAt` > 30 days, UI shows amber "Stale" indicator

## Backend: New Verification Endpoints

Two new endpoints added to `pecos.routes.ts`:

### `POST /api/v1/pecos/verify/:providerId`
- Looks up the provider's NPI from DB
- Calls `PECOSService.lookupByNPI(npi)`
- Upserts `MedicareVerification` record with result
- Returns the verification record

### `POST /api/v1/pecos/verify-batch`
- Accepts `{ providerIds: string[] }` (max 50)
- Fetches each provider's NPI, calls `batchLookup()`
- Upserts all `MedicareVerification` records
- Returns summary: `{ verified: number, enrolled: number, notEnrolled: number, errors: number }`

Both endpoints reuse existing `PECOSService` methods. The existing `GET /pecos/lookup/:npi` stays untouched.

### Provider List Query Change

The backend provider list endpoint (`GET /api/v1/providers`) will include the `medicareVerification` relation in its Prisma `include`, adding `{ status, verifiedAt }` to each provider response. Supports optional `?medicareStatus=ENROLLED|NOT_ENROLLED|UNVERIFIED` query param for filtering.

## Frontend: Enhanced Provider Detail

Replace the current small sidebar card (ProviderDetail.tsx lines ~1489-1539) with an expanded section:

- **Status badge**: Enrolled (green) / Not Enrolled (yellow) / Unverified (gray)
- **PAC ID** display when available
- **All enrollment records** listed: state + provider type + enrollment date
- **Ordering privileges** with checkmarks: Part B, DME, HHA, PMD, Hospice
- **"Last Verified" timestamp** with relative time display
- **"Re-verify" button** calling `POST /pecos/verify/:providerId`
- **Stale indicator**: amber badge if `verifiedAt` > 30 days ago

Data loads from DB record first (instant), re-verify hits CMS live and updates DB.

## Frontend: Provider List Changes

In `ProviderList.tsx`:

- **New filter dropdown**: "Medicare" with options All / Enrolled / Not Enrolled / Unverified (next to existing Status filter)
- **Table view**: new "Medicare" column between Status and Progress, showing colored status badge
- **Card view**: small Medicare badge on each card near provider type
- **"Verify All" button**: in filter bar, calls `POST /pecos/verify-batch` with visible provider IDs, shows progress toast

No extra API calls — Medicare status comes from the provider list response.

## Not Building

- No separate Medicare page or tab
- No automatic scheduled re-verification (manual only)
- No normalized enrollment tables (JSON snapshot sufficient)
- No provider-role access to verification (admin/staff only)

## Error Handling

- CMS API failures during verify: return partial results, mark failed providers as UNVERIFIED
- Provider without NPI: skip with error message
- Batch timeout: 30s per provider (existing `PECOSService` behavior)
- Frontend: toast on verify failure, doesn't break the page
