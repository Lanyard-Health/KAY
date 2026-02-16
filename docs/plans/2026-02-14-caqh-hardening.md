# CAQH Integration Hardening — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 30+ identified limitations in the CAQH integration across backend, frontend, schema, and config.

**Architecture:** Five batches: (1) schema migration, (2) backend service hardening, (3) credential verification hardening, (4) route/API improvements, (5) frontend enhancements. Each batch builds on the previous.

**Tech Stack:** Prisma, Express, Puppeteer, React Query, Vitest, express-rate-limit

---

## Batch 1: Schema & Migration

### Task 1: Add `source` field to Education model + CaqhSyncLog enhancements + unique index

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`

**Step 1: Run duplicate check query**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx prisma db execute --stdin <<< "SELECT caqh_provider_id, COUNT(*) FROM providers WHERE caqh_provider_id IS NOT NULL GROUP BY caqh_provider_id HAVING COUNT(*) > 1;"`
Expected: Empty result (no duplicates)

**Step 2: Update schema**

In `schema.prisma`, add to Education model (after `programDirectorPhone` field, before `// Audit` comment):

```prisma
  source               CredentialSource   @default(manual_entry)
```

In CaqhSyncLog model (after `changesApplied` field):

```prisma
  retryCount     Int       @default(0) @map("retry_count")
  durationMs     Int?      @map("duration_ms")
```

In Provider model (after `caqhProviderId` line 219), add nothing — but add a unique index. After the existing `@@index` directives at the bottom of the Provider model, add:

```prisma
  @@unique([caqhProviderId], name: "unique_caqh_provider_id")
```

Note: Prisma handles nullable unique fields correctly — null values are excluded from uniqueness.

**Step 3: Run migration**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx prisma migrate dev --name caqh_hardening_schema`
Expected: Migration created and applied successfully

**Step 4: Verify**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx prisma generate`
Expected: Prisma Client generated successfully

**Step 5: Commit**

```bash
git add packages/backend/prisma/
git commit -m "schema: add Education source field, CaqhSyncLog enhancements, unique caqhProviderId index"
```

---

## Batch 2: Backend Service Hardening (`caqh.service.ts`)

### Task 2: Remove demo URL default, add request timeout and retry logic

**Files:**
- Modify: `packages/backend/src/services/caqh.service.ts`

**Step 1: Update constructor and isConfigured**

Replace the constructor (lines 51-55):

```typescript
constructor() {
  this.baseUrl = process.env['CAQH_API_URL'] || '';
  this.orgId = process.env['CAQH_ORG_ID'] || '';
  this.apiKey = process.env['CAQH_API_KEY'] || '';
}
```

Update `isConfigured()` (line 457-459):

```typescript
isConfigured(): boolean {
  return !!(this.baseUrl && this.orgId && this.apiKey);
}
```

**Step 2: Add retry logic and timeout to `request()`**

Replace `request()` method (lines 57-80):

```typescript
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
          'Authorization': `Bearer ${this.apiKey}`,
          'Organization-Id': this.orgId,
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`CAQH API error: ${response.status}`);

        // Don't retry on 4xx client errors
        if (response.status >= 400 && response.status < 500) {
          logger.error(`CAQH API client error: ${response.status} - ${errorText}`);
          throw error;
        }

        // Retry on 5xx server errors
        logger.warn({
          event: 'caqh_api_retry',
          attempt,
          maxRetries,
          status: response.status,
          endpoint,
        });
        lastError = error;
        if (attempt < maxRetries) {
          await this.sleep(1000 * Math.pow(2, attempt - 1));
          continue;
        }
        throw error;
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
```

**Step 3: Update roster methods to use retryable=false**

In `addToRoster()` (line 92):
```typescript
const response = await this.request<CaqhRosterResponse>('/roster/add', {
  method: 'POST',
  body: JSON.stringify({ ... }),
}, false);  // non-idempotent — no retry
```

In `removeFromRoster()` (line 108):
```typescript
await this.request(`/roster/${caqhProviderId}`, {
  method: 'DELETE',
}, false);  // non-idempotent — no retry
```

`checkStatus` and `pullCredentials` keep the default `retryable = true`.

**Step 4: Build and verify**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit`
Expected: Clean build

**Step 5: Commit**

```bash
git add packages/backend/src/services/caqh.service.ts
git commit -m "fix: remove demo URL default, add retry logic and request timeout to CAQH service"
```

---

### Task 3: Type parameters, structured logging, remove dead code

**Files:**
- Modify: `packages/backend/src/services/caqh.service.ts`

**Step 1: Add MappedCaqhData interface**

After the existing `CaqhCredentialsResponse` interface (line 44), add:

```typescript
export interface MappedCaqhData {
  provider: {
    firstName: string;
    lastName: string;
    npi: string;
  };
  licenses: Array<{
    licenseType: string;
    licenseNumber: string;
    state: string;
    expirationDate: Date;
    issueDate?: Date;
  }>;
  certifications: Array<{
    boardType: string;
    boardName: string;
    specialty: string;
    expirationDate?: Date;
    initialCertificationDate?: Date;
  }>;
  education: Array<{
    institutionName: string;
    degree: string;
    graduationDate?: Date;
    fieldOfStudy?: string;
    country?: string;
  }>;
  malpractice: Array<{
    carrierName: string;
    policyNumber: string;
    expirationDate: string;
    perClaimAmount?: number;
    aggregateAmount?: number;
    coverageType?: string;
    effectiveDate?: string;
  }>;
}
```

**Step 2: Update `applyCaqhDataToProvider` signature**

Change (line 289-291):
```typescript
async applyCaqhDataToProvider(
  providerId: string,
  caqhData: MappedCaqhData
): Promise<CaqhSyncSummary> {
```

**Step 3: Add structured logging to mapping functions**

In each mapping function, replace the default return with a logged default. Example for `mapLicenseType`:

```typescript
private mapLicenseType(caqhType: string, providerId?: string): string {
  const mapping: Record<string, string> = {
    'MD': 'state_medical',
    'DO': 'state_medical',
    'PSY': 'state_psychology',
    'SW': 'state_social_work',
    'LPC': 'state_counseling',
    'MFT': 'state_marriage_family',
    'DEA': 'dea',
    'CDS': 'controlled_substance',
  };
  const result = mapping[caqhType];
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
```

Apply the same pattern to `mapBoardType` and `mapDegreeType`, adding `providerId?: string` parameter and logging when defaulting.

Update `mapCaqhToInternal` to pass `providerId` through to mapping functions (it doesn't currently receive it, so add it as a parameter or use a class field).

**Step 4: Delete `getFormattedDataForPayer`**

Remove the method (lines 214-234). It's dead code — never called anywhere.

**Step 5: Build and verify**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit`
Expected: Clean build

**Step 6: Commit**

```bash
git add packages/backend/src/services/caqh.service.ts
git commit -m "refactor: type CAQH data params, add structured logging for unknown mappings, remove dead code"
```

---

### Task 4: Remove hardcoded fallback values and add per-record error tracking

**Files:**
- Modify: `packages/backend/src/services/caqh.service.ts`

**Step 1: Update CaqhSyncSummary interface**

Replace the existing interface:

```typescript
export interface CaqhSyncSummary {
  licenses: { created: number; updated: number; skipped: number; failed: number };
  certifications: { created: number; updated: number; skipped: number; failed: number };
  education: { created: number; updated: number; skipped: number; failed: number };
  malpractice: { created: number; updated: number; skipped: number; failed: number };
  failedRecords: Array<{ category: string; identifier: string; error: string }>;
}
```

**Step 2: Update `applyCaqhDataToProvider` initial summary**

```typescript
const summary: CaqhSyncSummary = {
  licenses: { created: 0, updated: 0, skipped: 0, failed: 0 },
  certifications: { created: 0, updated: 0, skipped: 0, failed: 0 },
  education: { created: 0, updated: 0, skipped: 0, failed: 0 },
  malpractice: { created: 0, updated: 0, skipped: 0, failed: 0 },
  failedRecords: [],
};
```

**Step 3: Wrap each record upsert in try/catch**

For each loop (licenses, certifications, education, malpractice), wrap the inner body in try/catch:

```typescript
// Example for licenses loop:
for (const lic of caqhData.licenses) {
  try {
    // ... existing upsert logic ...
  } catch (error) {
    summary.licenses.failed++;
    summary.failedRecords.push({
      category: 'license',
      identifier: lic.licenseNumber,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
```

Apply the same pattern to certifications (identifier: `${cert.boardName}/${cert.specialty}`), education (identifier: `${edu.institutionName}/${edu.degree}`), malpractice (identifier: `mal.policyNumber`).

**Step 4: Remove hardcoded fallback values**

In Licenses section:
- Change: `issueDate: lic.issueDate ? new Date(lic.issueDate) : new Date()` → `issueDate: lic.issueDate ? new Date(lic.issueDate) : null`
  - Note: check if `issueDate` is required in schema. If required, use `new Date()` as last resort but log a warning.

In Education section:
- Change: `fieldOfStudy: edu.fieldOfStudy ?? 'Unknown'` → `fieldOfStudy: edu.fieldOfStudy ?? 'Not specified'`
- Add `source: 'caqh_sync'` to both create and update operations

In Malpractice section — skip creation when required fields are missing:
```typescript
for (const mal of malpracticeList) {
  // Skip if required financial data is missing
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

  if (existing) {
    await prisma.malpracticeInsurance.update({
      where: { id: existing.id },
      data: {
        carrierName: mal.carrierName ?? existing.carrierName,
        expirationDate: mal.expirationDate ? new Date(mal.expirationDate) : existing.expirationDate,
        perClaimAmount: mal.perClaimAmount,
        aggregateAmount: mal.aggregateAmount ?? existing.aggregateAmount,
      },
    });
    summary.malpractice.updated++;
  } else {
    await prisma.malpracticeInsurance.create({
      data: {
        providerId,
        carrierName: mal.carrierName,
        policyNumber: mal.policyNumber,
        coverageType: mal.coverageType ?? 'occurrence',
        perClaimAmount: mal.perClaimAmount,
        aggregateAmount: mal.aggregateAmount ?? null,
        effectiveDate: mal.effectiveDate ? new Date(mal.effectiveDate) : new Date(),
        expirationDate: new Date(mal.expirationDate),
      },
    });
    summary.malpractice.created++;
  }
}
```

**Step 5: Add duration tracking to syncProvider**

In `syncProvider()`, record start time and store duration:

```typescript
async syncProvider(providerId: string, caqhProviderId: string): Promise<{
  syncId: string;
  changes: CaqhSyncSummary;
}> {
  const startTime = Date.now();
  const syncLog = await prisma.caqhSyncLog.create({ ... });

  try {
    // ... existing logic ...

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

    // ... rest of existing logic ...
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
```

**Step 6: Build and test**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit`
Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/routes/caqh.routes.test.ts src/services/scheduler.service.test.ts`
Expected: Build clean, tests pass (may need to update test mocks for new `failed` and `failedRecords` fields)

**Step 7: Commit**

```bash
git add packages/backend/src/services/caqh.service.ts
git commit -m "fix: remove hardcoded fallback values, add per-record error tracking, duration tracking"
```

---

## Batch 3: Credential Verification Hardening

### Task 5: Puppeteer concurrency guard and MFA handling

**Files:**
- Modify: `packages/backend/src/services/caqh-credentials.service.ts`

**Step 1: Add semaphore at module level**

After imports, before the class:

```typescript
// Concurrency guard — only 1 browser at a time, queue up to 3
let activeBrowser = false;
const waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
const MAX_QUEUE_DEPTH = 3;
const QUEUE_TIMEOUT_MS = 60000;

async function acquireBrowserLock(): Promise<void> {
  if (!activeBrowser) {
    activeBrowser = true;
    return;
  }

  if (waitQueue.length >= MAX_QUEUE_DEPTH) {
    throw new Error('Credential verification busy, try again later');
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waitQueue.findIndex((w) => w.resolve === resolve);
      if (idx !== -1) waitQueue.splice(idx, 1);
      reject(new Error('Credential verification timed out waiting for availability'));
    }, QUEUE_TIMEOUT_MS);

    waitQueue.push({
      resolve: () => { clearTimeout(timer); resolve(); },
      reject: (err: Error) => { clearTimeout(timer); reject(err); },
    });
  });
}

function releaseBrowserLock(): void {
  if (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    next.resolve();
  } else {
    activeBrowser = false;
  }
}
```

**Step 2: Wrap verifyCredentials with semaphore**

At the start of `verifyCredentials()`:
```typescript
await acquireBrowserLock();
```

In the `finally` block (after browser close):
```typescript
finally {
  if (this.browser) {
    await this.browser.close();
    this.browser = null;
  }
  releaseBrowserLock();
}
```

**Step 3: Fix MFA handling**

In `checkLoginResult()`, change the MFA block (lines 430-436):

```typescript
return {
  success: true,
  valid: false,  // Changed from true — MFA means credentials not fully verified
  message: 'MFA required — credentials not fully verified',
  errorType: 'mfa_required',
};
```

**Step 4: Update verifyAndUpdateProvider MFA handling**

In `verifyAndUpdateProvider()`, after getting result (line 201-208):

```typescript
await prisma.provider.update({
  where: { id: providerId },
  data: {
    caqhCredentialsValid: result.errorType === 'mfa_required' ? null : result.valid,
    caqhCredentialsLastChecked: new Date(),
  },
});
```

**Step 5: Return full CAQH status from getCredentialStatus**

Update the return type and query:

```typescript
async getCredentialStatus(providerId: string): Promise<{
  hasCredentials: boolean;
  isValid: boolean | null;
  lastChecked: Date | null;
  username: string | null;
  caqhProviderId: string | null;
  caqhStatus: string | null;
  caqhLastSync: Date | null;
}> {
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    select: {
      caqhUsername: true,
      caqhCredentialsValid: true,
      caqhCredentialsLastChecked: true,
      caqhProviderId: true,
      caqhStatus: true,
      caqhLastSync: true,
    },
  });

  if (!provider) {
    throw new Error('Provider not found');
  }

  return {
    hasCredentials: !!provider.caqhUsername,
    isValid: provider.caqhCredentialsValid,
    lastChecked: provider.caqhCredentialsLastChecked,
    username: provider.caqhUsername,
    caqhProviderId: provider.caqhProviderId,
    caqhStatus: provider.caqhStatus,
    caqhLastSync: provider.caqhLastSync,
  };
}
```

**Step 6: Build and test**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit`
Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/services/caqh-credentials.service.test.ts`
Expected: Build clean, tests pass (update test expectations for new `valid: false` on MFA and new fields in getCredentialStatus)

**Step 7: Commit**

```bash
git add packages/backend/src/services/caqh-credentials.service.ts
git commit -m "fix: add Puppeteer concurrency guard, fix MFA handling, return full CAQH status"
```

---

## Batch 4: Routes & API

### Task 6: Input validation, rate limiting, error codes

**Files:**
- Modify: `packages/backend/src/routes/caqh.routes.ts`

**Step 1: Add rate limiting middleware**

At the top of the file, after imports:

```typescript
import rateLimit from 'express-rate-limit';

const credentialVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, error: 'Too many credential verification requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
```

Apply to credential test and verify endpoints:
```typescript
caqhRoutes.post('/credentials/test', credentialVerifyLimiter, async (req, res, next) => { ... });
caqhRoutes.post('/credentials/:providerId/verify', credentialVerifyLimiter, async (req, res, next) => { ... });
```

**Step 2: Strengthen input validation**

In `POST /credentials/test` and `POST /credentials/:providerId`:

```typescript
const { username, password } = req.body;

if (!username || typeof username !== 'string' || username.trim().length === 0 || username.length > 256) {
  return res.status(400).json({
    success: false,
    error: 'Valid username is required (1-256 characters)',
  });
}

if (!password || typeof password !== 'string' || password.trim().length === 0 || password.length > 256) {
  return res.status(400).json({
    success: false,
    error: 'Valid password is required (1-256 characters)',
  });
}
```

**Step 3: Differentiate error codes**

Create a helper at top of file:

```typescript
function caqhError(res: Response, code: string, message: string, status = 404) {
  return res.status(status).json({ success: false, code, error: message });
}
```

Replace `throw new NotFoundError('Provider')` with specific codes:
- Provider not found: `caqhError(res, 'PROVIDER_NOT_FOUND', 'Provider does not exist')`
- No CAQH registration: `caqhError(res, 'CAQH_NOT_REGISTERED', 'Provider is not registered with CAQH')`
- Service not configured: `caqhError(res, 'CAQH_NOT_CONFIGURED', 'CAQH integration is not configured', 503)`

**Step 4: Add requireProviderAccess to provider-specific routes**

Already imported but unused. Add to provider-specific routes:

```typescript
caqhRoutes.post('/credentials/:providerId', requireProviderAccess, async (req, res, next) => { ... });
caqhRoutes.get('/credentials/:providerId', requireProviderAccess, async (req, res, next) => { ... });
caqhRoutes.post('/credentials/:providerId/verify', credentialVerifyLimiter, requireProviderAccess, async (req, res, next) => { ... });
caqhRoutes.delete('/roster/:providerId', requireProviderAccess, async (req, res, next) => { ... });
caqhRoutes.get('/status/:providerId', requireProviderAccess, async (req, res, next) => { ... });
caqhRoutes.post('/pull/:providerId', requireProviderAccess, async (req, res, next) => { ... });
caqhRoutes.get('/sync-history/:providerId', requireProviderAccess, async (req, res, next) => { ... });
```

**Step 5: Commit**

```bash
git add packages/backend/src/routes/caqh.routes.ts
git commit -m "fix: add rate limiting, input validation, error codes, and per-provider access checks"
```

---

### Task 7: Sync history pagination and scheduler status endpoint

**Files:**
- Modify: `packages/backend/src/routes/caqh.routes.ts`

**Step 1: Add pagination to sync history**

Replace the sync-history route:

```typescript
caqhRoutes.get(
  '/sync-history/:providerId',
  requireProviderAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 20));
      const skip = (page - 1) * limit;

      const [syncLogs, total] = await Promise.all([
        prisma.caqhSyncLog.findMany({
          where: { providerId: req.params['providerId'] },
          orderBy: { startedAt: 'desc' },
          take: limit,
          skip,
        }),
        prisma.caqhSyncLog.count({
          where: { providerId: req.params['providerId'] },
        }),
      ]);

      res.json({
        success: true,
        data: syncLogs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      next(error);
    }
  }
);
```

**Step 2: Add config/status endpoint**

After the sync-history route, add:

```typescript
// GET /api/v1/caqh/config — Get CAQH integration configuration status
caqhRoutes.get(
  '/config',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const configured = caqhService.isConfigured();
      const schedule = process.env['CAQH_SYNC_SCHEDULE'] || '0 2 * * *';

      // Get last completed sync time
      const lastSync = await prisma.caqhSyncLog.findFirst({
        where: { status: 'completed' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      });

      res.json({
        success: true,
        data: {
          configured,
          syncSchedule: schedule,
          lastSyncAt: lastSync?.completedAt || null,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);
```

**Step 3: Build and test**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit`
Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run src/routes/caqh.routes.test.ts`
Expected: Build clean. Some tests may need updating for pagination response shape and new error codes.

**Step 4: Commit**

```bash
git add packages/backend/src/routes/caqh.routes.ts
git commit -m "feat: add sync history pagination and CAQH config status endpoint"
```

---

### Task 8: Update all backend tests

**Files:**
- Modify: `packages/backend/src/routes/caqh.routes.test.ts`
- Modify: `packages/backend/src/services/scheduler.service.test.ts`
- Modify: `packages/backend/src/services/caqh-credentials.service.test.ts`

**Step 1: Update caqh.routes.test.ts**

Key changes needed:
- Update CaqhService mock to include `sleep` method if it's used internally (private — shouldn't need mocking)
- Update sync history test to expect `{ data: [...], pagination: { page, limit, total, totalPages } }` response shape
- Add test for `GET /config` endpoint
- Add test for rate limiting (6th request → 429) on credential test/verify endpoints
- Update error expectations: `res.body.code` should be `'PROVIDER_NOT_FOUND'` or `'CAQH_NOT_REGISTERED'`
- Update the `SyncSummary` type in tests to include `failed` count and `failedRecords` array

**Step 2: Update scheduler.service.test.ts**

- Update `CaqhSyncSummary` expectations to include `failed` count and `failedRecords` array in mock return values
- Update notification expectations if `changes` structure changed

**Step 3: Update caqh-credentials.service.test.ts**

- Update `getCredentialStatus` test to expect new fields: `caqhProviderId`, `caqhStatus`, `caqhLastSync`
- Add test: MFA result sets `caqhCredentialsValid: null` (not `true`)
- Update mock prisma select to include new fields

**Step 4: Run full test suite**

Run: `cd /Users/kay/Documents/KAY/packages/backend && npx vitest run`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/backend/src/routes/caqh.routes.test.ts packages/backend/src/services/scheduler.service.test.ts packages/backend/src/services/caqh-credentials.service.test.ts
git commit -m "test: update all CAQH tests for hardened API"
```

---

## Batch 5: Frontend

### Task 9: Update hooks with new types and add useCaqhSync hook

**Files:**
- Modify: `packages/frontend/src/hooks/useCaqhCredentials.ts`
- Create: `packages/frontend/src/hooks/useCaqhSync.ts`

**Step 1: Update CaqhCredentialStatus interface**

In `useCaqhCredentials.ts`, update the interface:

```typescript
export interface CaqhCredentialStatus {
  hasCredentials: boolean;
  isValid: boolean | null;
  lastChecked: string | null;
  username: string | null;
  caqhProviderId: string | null;
  caqhStatus: string | null;
  caqhLastSync: string | null;
}
```

Update `getCredentialStatusLabel` to handle MFA:

```typescript
export function getCredentialStatusLabel(status: CaqhCredentialStatus): string {
  if (!status.hasCredentials) return 'Not Configured';
  if (status.isValid === null) return 'Not Verified';
  return status.isValid ? 'Valid' : 'Invalid';
}
```

**Step 2: Create useCaqhSync.ts**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

interface SyncHistoryEntry {
  id: string;
  providerId: string;
  direction: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  changesApplied: any;
  durationMs: number | null;
}

interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface CaqhConfig {
  configured: boolean;
  syncSchedule: string;
  lastSyncAt: string | null;
}

export function useCaqhSyncHistory(providerId: string, page = 1, limit = 10) {
  return useQuery({
    queryKey: ['caqh-sync-history', providerId, page, limit],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<SyncHistoryEntry>>(
        `/caqh/sync-history/${providerId}?page=${page}&limit=${limit}`
      );
      return response.data;
    },
    enabled: !!providerId,
    staleTime: 30 * 1000,
  });
}

export function useCaqhConfig() {
  return useQuery({
    queryKey: ['caqh-config'],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: CaqhConfig }>('/caqh/config');
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useAddToRoster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (providerId: string) => {
      const response = await api.post('/caqh/roster', { providerId });
      return response.data;
    },
    onSuccess: (_data, providerId) => {
      queryClient.invalidateQueries({ queryKey: ['caqh-credentials', providerId] });
      queryClient.invalidateQueries({ queryKey: ['provider', providerId] });
    },
  });
}

export function useRemoveFromRoster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (providerId: string) => {
      const response = await api.delete(`/caqh/roster/${providerId}`);
      return response.data;
    },
    onSuccess: (_data, providerId) => {
      queryClient.invalidateQueries({ queryKey: ['caqh-credentials', providerId] });
      queryClient.invalidateQueries({ queryKey: ['provider', providerId] });
    },
  });
}
```

**Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useCaqhCredentials.ts packages/frontend/src/hooks/useCaqhSync.ts
git commit -m "feat: update CAQH credential types, add useCaqhSync hook"
```

---

### Task 10: Update CaqhCard with sync history, roster management, and better errors

**Files:**
- Modify: `packages/frontend/src/components/CaqhCard.tsx`

**Step 1: Add imports**

```typescript
import { useCaqhSyncHistory, useCaqhConfig, useAddToRoster, useRemoveFromRoster } from '../hooks/useCaqhSync';
import { formatDistanceToNow } from 'date-fns';
```

**Step 2: Add hooks and state**

Inside the component, add:

```typescript
const [showSyncHistory, setShowSyncHistory] = useState(false);
const [syncHistoryPage, setSyncHistoryPage] = useState(1);

const { data: syncHistoryData } = useCaqhSyncHistory(providerId, syncHistoryPage, 5);
const { data: caqhConfig } = useCaqhConfig();
const addToRoster = useAddToRoster();
const removeFromRoster = useRemoveFromRoster();
```

**Step 3: Remove local syncResult state**

The sync mutation should use React Query's cache instead of local state. Change `syncMutation.onSuccess` to invalidate the sync history query:

```typescript
const syncMutation = useMutation({
  mutationFn: async () => {
    const response = await api.post(`/caqh/pull/${providerId}`);
    return response.data.data;
  },
  onSuccess: (data) => {
    queryClient.invalidateQueries({ queryKey: ['caqh-sync-history', providerId] });
    queryClient.invalidateQueries({ queryKey: ['provider', providerId] });
    queryClient.invalidateQueries({ queryKey: ['caqh-credentials', providerId] });
    toast.success('CAQH sync completed');
  },
  onError: (error: any) => {
    const code = error.response?.data?.code;
    const msg = code === 'CAQH_NOT_REGISTERED'
      ? 'This provider is not registered with CAQH. Add them to the roster first.'
      : code === 'CAQH_NOT_CONFIGURED'
      ? 'CAQH integration is not configured. Contact your administrator.'
      : error.response?.data?.error || 'CAQH sync failed';
    toast.error(msg);
  },
});
```

**Step 4: Add sections to the card JSX**

After the existing credential status section, add:

1. **CAQH Roster Status** — show `caqhStatus` and `caqhProviderId` from `credentialStatus`
2. **Sync Schedule** — show "Auto-sync: Daily at 2:00 AM" from `caqhConfig` if configured, plus "Last sync: Xh ago" from `credentialStatus.caqhLastSync`
3. **Roster Buttons** — "Add to Roster" / "Remove from Roster" based on `credentialStatus.caqhProviderId`
4. **Sync History Toggle** — "View Sync History" button that shows/hides a list of recent syncs
5. **MFA Warning** — update the MFA text from "credentials are valid" to "credentials not fully verified"

(Detailed JSX is context-specific; follow existing card patterns — use text-xs, bg-gray-50 sections, the same button styles.)

**Step 5: Build and verify**

Run: `cd /Users/kay/Documents/KAY/packages/frontend && npx tsc --noEmit`
Expected: Clean build

**Step 6: Commit**

```bash
git add packages/frontend/src/components/CaqhCard.tsx
git commit -m "feat: add sync history, roster management, scheduler status, and better error messages to CaqhCard"
```

---

### Task 11: Delete CaqhCredentialsCard (confirmed unused) and cleanup

**Files:**
- Delete: `packages/frontend/src/components/CaqhCredentialsCard.tsx`

**Step 1: Verify no imports**

Run: `cd /Users/kay/Documents/KAY && grep -r "CaqhCredentialsCard" packages/frontend/src/`
Expected: Only the file itself should show up

**Step 2: Delete the file**

```bash
rm packages/frontend/src/components/CaqhCredentialsCard.tsx
```

**Step 3: Build and verify**

Run: `cd /Users/kay/Documents/KAY/packages/frontend && npx tsc --noEmit`
Expected: Clean build (no broken imports)

**Step 4: Commit**

```bash
git add -A packages/frontend/src/components/CaqhCredentialsCard.tsx
git commit -m "chore: delete unused CaqhCredentialsCard component"
```

---

## Final: Run full test suite and verify

Run:
```bash
cd /Users/kay/Documents/KAY/packages/backend && npx vitest run
cd /Users/kay/Documents/KAY/packages/backend && npx tsc --noEmit
cd /Users/kay/Documents/KAY/packages/frontend && npx tsc --noEmit
```

Expected: All tests pass, both builds clean.

Then use superpowers:finishing-a-development-branch to push and create PR.
