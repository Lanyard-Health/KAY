# CAQH Integration Hardening

**Date:** 2026-02-14
**Status:** Approved
**Scope:** All 30+ identified limitations across backend, frontend, schema, and config

---

## Section 1: Backend Service Hardening (`caqh.service.ts`)

### 1.1 Remove demo URL default
If `CAQH_API_URL` is missing, `isConfigured()` returns false. No silent fallback to `proview-demo.caqh.org`. The constructor stores the env var as-is; callers must check `isConfigured()` before using the service.

### 1.2 Add retry with exponential backoff
Add retry logic to `request()` — 3 attempts, 1s/2s/4s delays, only on 5xx and network errors (not 4xx). **Read-only operations only** (`checkStatus`, `pullCredentials`). Roster mutations (`addToRoster`, `removeFromRoster`) are non-idempotent and fail fast with no retry. The `request()` method accepts a `retryable: boolean` parameter.

### 1.3 Add request timeout
30s fetch timeout via `AbortController` on every request. Prevents hanging connections.

### 1.4 Log unknown mapping types (structured)
When `mapLicenseType`, `mapBoardType`, or `mapDegreeType` encounter unknown values, emit a structured warning:
```typescript
logger.warn({
  event: 'caqh_unknown_mapping',
  field: 'licenseType',
  rawValue: 'XYZ',
  defaultedTo: 'state_medical',
  providerId: '...'
});
```

### 1.5 Remove hardcoded fallback values
- No more `$1M` malpractice default or `perClaim * 3` aggregate formula.
- If CAQH omits malpractice amounts, skip creating the record entirely and log a warning. Users fill missing data manually.
- For education: remove `'Unknown'` and `'US'` placeholders. Use `null` for optional fields; only create records where required fields are present.
- For licenses: remove `new Date()` as fallback issueDate. Store `null` if CAQH doesn't provide it.

### 1.6 Type the `applyCaqhDataToProvider` parameter
Replace `caqhData: any` with a typed `MappedCaqhData` interface derived from `mapCaqhToInternal()` return type.

### 1.7 Delete dead code
Remove `getFormattedDataForPayer()` — never called anywhere in the codebase.

### 1.8 Add per-record error tracking
Extend `CaqhSyncSummary` with a `failed` count per category and a `failedRecords` array:
```typescript
export interface CaqhSyncSummary {
  licenses: { created: number; updated: number; skipped: number; failed: number };
  certifications: { created: number; updated: number; skipped: number; failed: number };
  education: { created: number; updated: number; skipped: number; failed: number };
  malpractice: { created: number; updated: number; skipped: number; failed: number };
  failedRecords: Array<{ category: string; identifier: string; error: string }>;
}
```
Individual record upserts are wrapped in try/catch so one failure doesn't abort the entire sync.

### 1.9 Structured sync logging
Sync completions emit structured logs:
```typescript
logger.info({
  event: 'caqh_sync_complete',
  providerId: 'p1',
  durationMs: 1234,
  changes: { ... },
  failedRecords: [...]
});
```

---

## Section 2: Credential Verification Hardening (`caqh-credentials.service.ts`)

### 2.1 Route-level rate limiting
5 req/min per user on `/credentials/test` and `/credentials/:providerId/verify` endpoints via express-rate-limit middleware. Fast HTTP-level guard that never touches Puppeteer.

### 2.2 DB-tracked verification throttle
Max 3 verification attempts per provider per hour, tracked via `caqhCredentialsLastChecked`. If exceeded, return 429 with "Please wait before retrying." These two limiters serve different purposes: route limiter protects the server, DB limiter prevents CAQH abuse.

### 2.3 Return full CAQH status
`getCredentialStatus()` returns additional fields: `caqhProviderId`, `caqhStatus`, `caqhLastSync` so the frontend has complete provider CAQH state in one call.

### 2.4 Mark MFA as unverified
If MFA is detected, store `caqhCredentialsValid: null` (unknown) instead of `true`. Frontend shows "MFA required — credentials not fully verified" instead of the current misleading "valid" state.

### 2.5 Puppeteer concurrency guard
Semaphore pattern: max 1 concurrent browser instance. Queue depth of 3 with 60s timeout per waiting request. If queue is full or timeout expires, return 503 "Credential verification busy, try again later." Prevents resource exhaustion from concurrent browser launches.

---

## Section 3: Routes & API (`caqh.routes.ts`)

### 3.1 Input validation
Validate username/password are non-empty strings with length limits (1-256 chars). Reject empty strings that currently pass the `!username` check.

### 3.2 Sync history pagination
Accept `?page=1&limit=20` query params. Default limit=20, max limit=100. Return `{ data: [...], pagination: { page, limit, total } }`.

### 3.3 Scheduler status endpoint
`GET /api/v1/caqh/config` returns:
```json
{
  "configured": true,
  "syncSchedule": "0 2 * * *",
  "syncJobRunning": false,
  "lastSyncAt": "2026-02-14T02:00:00Z",
  "nextSyncAt": "2026-02-15T02:00:00Z"
}
```

### 3.4 Differentiate error codes
Return structured error responses:
- `{ code: 'PROVIDER_NOT_FOUND', message: 'Provider does not exist' }` (404)
- `{ code: 'CAQH_NOT_REGISTERED', message: 'Provider is not registered with CAQH' }` (404)
- `{ code: 'CAQH_NOT_CONFIGURED', message: 'CAQH integration is not configured' }` (503)

### 3.5 Per-provider access check
Add `requireProviderAccess` middleware to provider-specific routes to verify the requesting user has access to the specific provider, not just any provider in their practice.

---

## Section 4: Schema & Data (`schema.prisma`)

### 4.1 Unique index on caqhProviderId
Add `@@index([caqhProviderId])` and a unique constraint (where not null) to prevent two providers sharing the same CAQH ID. Run a pre-migration duplicate check query before applying.

### 4.2 CaqhSyncLog enhancements
Add fields:
- `retryCount Int @default(0)` — track retry attempts
- `durationMs Int?` — sync performance tracking

### 4.3 Add `source` field to Education model
Add `source String?` to the Education model for consistency with License and BoardCertification. The CAQH sync will set `source: 'caqh_sync'` and the manual_entry skip logic will apply to education records too.

---

## Section 5: Frontend

### 5.1 Sync history viewer
Add "View Sync History" button/modal on CaqhCard. Calls `GET /sync-history/:providerId` with pagination. Displays: date, status (completed/failed), changes count, error message, duration.

### 5.2 Roster management buttons
Add "Add to CAQH Roster" and "Remove from Roster" buttons on CaqhCard, calling existing `POST /roster` and `DELETE /roster/:providerId` endpoints. Show roster status (pending/active/inactive).

### 5.3 Scheduler status display
Show sync schedule info on CaqhCard: "Auto-sync: Daily at 2:00 AM" and "Last sync: 2h ago" using the new `GET /config` endpoint.

### 5.4 Persist sync result via React Query
Use React Query's cache for sync results so they survive page navigation. Already using React Query elsewhere; just need proper query keys.

### 5.5 Specific error messages
Map error codes from Section 3.4 to user-friendly messages:
- `CAQH_NOT_REGISTERED` → "This provider is not registered with CAQH. Add them to the roster first."
- `CAQH_NOT_CONFIGURED` → "CAQH integration is not configured. Contact your administrator."
- Network error → "Unable to reach CAQH. Please try again later."
- MFA required → "CAQH requires multi-factor authentication. Credentials saved but not fully verified."

### 5.6 Delete CaqhCredentialsCard.tsx (if unused)
Grep for imports first. If truly unused, delete. If referenced, refactor into CaqhCard.

### 5.7 Add `useCaqhSync` hook
New hook consolidating: sync history (paginated), roster add/remove, config status, force re-sync. Follows existing hook patterns in the codebase.

---

## Conflict Resolution Behavior (post-hardening)

The existing `source = 'manual_entry'` skip logic is unchanged. New behavior:
- If CAQH sends a record that matches an existing `caqh_sync` record missing amounts → update to `null` (visible gap for user to fill).
- If CAQH sends a new record with missing required fields (e.g., malpractice without amounts) → skip creation entirely, log warning, increment `failed` count.
- Manual entries are never overwritten by sync.

---

## Security Checklist
- [x] No silent demo URL fallback
- [x] Rate limiting on credential verification (two layers)
- [x] Puppeteer concurrency guard with queue limits
- [x] Input validation with length limits
- [x] Per-provider access control
- [x] Structured logging (no sensitive data in logs)
- [x] MFA treated as unverified (not falsely valid)
- [x] No hardcoded financial defaults
