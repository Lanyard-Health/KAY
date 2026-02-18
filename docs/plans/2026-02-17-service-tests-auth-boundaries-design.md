# Service Unit Tests + Authorization Boundary Tests

## Scope

5 service unit test suites for services with zero test coverage, plus route-level authorization boundary tests for cross-practice isolation and provider self-scope.

## Service Unit Tests

### 1. email.service.test.ts (~12 tests)

**Mocks:** `@aws-sdk/client-ses` (SendRawEmailCommand), Prisma

- `isConfigured()` returns false when `SES_FROM_EMAIL` missing
- `getConfig()` returns null when not configured, SES info when configured
- `verifyConnection()` returns error when not configured
- `sendEmail()` skips silently when not configured (returns success: false)
- `sendEmail()` sends raw MIME via SES, logs to Notification table
- `sendEmail()` logs failed Notification on SES error
- `buildMimeMessage()` produces correct multipart/alternative structure
- `buildMimeMessage()` strips CRLF from to/subject (header injection prevention)
- `buildMimeMessage()` adds base64 attachments when provided
- `sendTestEmail()` delegates to `sendEmail` with correct template

### 2. caqh.service.test.ts (~20 tests)

**Mocks:** global `fetch`, Prisma

- `isConfigured()` returns false when env vars missing
- `request()` retries on 5xx with exponential backoff (1s, 2s, 4s)
- `request()` does not retry on 4xx client errors
- `request()` does not retry when `retryable=false` (POST/DELETE ops)
- `request()` times out after 30s via AbortController
- `request()` returns `{}` for empty response body
- `request()` throws on invalid JSON with truncated log
- `addToRoster()` POSTs correct payload
- `removeFromRoster()` sends DELETE
- `checkStatus()` returns parsed status response
- `pullCredentials()` returns parsed credentials
- `mapCaqhToInternal()` maps all license types (MD, DO, PSY, SW, etc.)
- `mapCaqhToInternal()` logs warning + defaults for unknown license types
- `mapCaqhToInternal()` maps board types via case-insensitive includes
- `mapCaqhToInternal()` handles missing malpractice (empty array)
- `applyCaqhDataToProvider()` creates new license records
- `applyCaqhDataToProvider()` updates existing caqh_sync records
- `applyCaqhDataToProvider()` skips manual_entry records
- `applyCaqhDataToProvider()` tracks per-record failures in summary
- `applyCaqhDataToProvider()` skips malpractice without perClaimAmount
- `syncProvider()` orchestrates pull -> map -> apply -> log
- `syncProvider()` logs failure to CaqhSyncLog on error

### 3. document.service.test.ts (~14 tests)

**Mocks:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-textract`, `uuid`, Prisma

- `getUploadUrl()` creates Document record + returns pre-signed URL
- `getUploadUrl()` sanitizes file extension (strips non-alphanumeric)
- `confirmUpload()` updates fileSize from S3 GetObject
- `confirmUpload()` links checklist documents (w9, coi, cp575)
- `confirmUpload()` skips OCR in LocalStack mode (marks not_applicable)
- `confirmUpload()` starts OCR for PDF/image MIME types
- `confirmUpload()` marks non-OCR MIME types as not_applicable
- `confirmUpload()` throws on missing document
- `linkChecklistDocument()` is no-op for non-checklist document types
- `deleteDocument()` sends DeleteObjectCommand
- `getDownloadUrl()` returns pre-signed GET URL
- `shouldRunOcr()` identifies supported MIME types correctly
- `processOcrResults()` extracts KEY_VALUE_SET blocks, computes avg confidence
- `handleOcrNotification()` processes completed OCR job via jobId lookup

### 4. expiration.service.test.ts (~12 tests)

**Mocks:** `@aws-sdk/client-ses` (SendEmailCommand), Prisma

- `getUpcomingExpirations()` queries all 4 credential types (license, cert, insurance, document)
- `getUpcomingExpirations()` filters by type when specified
- `getUpcomingExpirations()` includes/excludes expired based on flag
- `getUpcomingExpirations()` sorts by expiration date ascending
- `getDashboardData()` aggregates counts across 7/30/60/90 day buckets
- `getProviderExpirations()` filters by providerId
- `sendExpirationReminders()` sends emails for each threshold day
- `sendExpirationReminders()` logs successful notifications to DB
- `sendExpirationReminders()` logs failed notifications and continues processing
- `getExpiringOnDay()` filters to exact calendar day (midnight-aligned)
- `getDaysUntil()` computes correct day difference
- Documents included as 4th credential type in queries

### 5. chat.service.test.ts (~10 tests)

**Mocks:** Anthropic SDK, Prisma

- Intent classification correctly identifies all 6 intents
- Context-aware data fetching scoped to practice
- Conversation persistence (ChatConversation + ChatMessage)
- Token budget enforcement
- Input sanitization against prompt injection
- Error handling for API failures

## Authorization Boundary Tests

File: `tests/authorization-boundaries.test.ts` (~12 tests)

Uses `createTestApp` + supertest to test full middleware chains on real routes.

### Cross-practice isolation

- Staff from Practice A cannot GET provider in Practice B -> 403
- Staff from Practice A cannot list providers from Practice B (filtered out)
- Practice admin from Practice A cannot access Practice B enrollment -> 403
- Staff with no practice assignments only sees unassigned providers
- Enrollment list route applies `getPracticeRelationFilter` correctly

### Provider self-scope

- Provider can GET their own profile -> 200
- Provider cannot GET another provider's profile -> 403
- Provider cannot list all providers -> 403 (role gate)
- Provider cannot access admin-only routes (users, practices, AI) -> 403

### Edge cases

- Provider with `practiceId: null` accessible to all staff (deliberate design)
- Admin bypasses all practice filters (never gets 403)

## Conventions

- Co-located tests: `src/services/<name>.test.ts` (matches existing pattern)
- Auth boundary tests: `tests/authorization-boundaries.test.ts` (integration)
- Prisma mock: `vi.mock('../utils/prisma.js', ...)` per CLAUDE.md pattern
- Logger mock: silent `vi.fn()` stubs
- AWS SDK mocks: `vi.mock('@aws-sdk/client-ses', ...)` with mock send functions
- Constructor env vars: `vi.hoisted()` where needed for import-time reads
