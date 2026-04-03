## Mandatory Security Rules
Before completing ANY task, automatically perform these checks on all changed files:

1. SECRETS SCAN: Check for any hardcoded API keys, passwords, tokens, database URLs, or credentials. If found, immediately move them to environment variables and flag the finding.

2. INPUT VALIDATION: Every API endpoint must validate and sanitize all user input. No raw user input should ever touch a database query.

3. AUTHORIZATION CHECK: Every API endpoint must verify the requesting user has permission to access the specific resource, not just that they're authenticated.

4. DATA EXPOSURE: Never return more data than the endpoint needs. Never log sensitive data (SSNs, tax IDs, NPI numbers, DOBs). Never store sensitive data in localStorage or cookies.

5. DEPENDENCY SAFETY: Before adding any new package, check if it has known vulnerabilities and if it's actively maintained.

6. ERROR HANDLING: Never expose stack traces, internal paths, or system details in error responses.

7. ENV FILES: NEVER commit, read aloud, or display the contents of `.env` files. They contain real API keys and credentials. If you need to reference an env var, use `.env.example` which has empty values.

## Prisma Schema Changes — ALWAYS Generate Migrations
**Critical**: Any change to `prisma/schema.prisma` (new columns, new models, altered fields, new enums) **MUST** include a migration file. Without it, `prisma generate` creates a client that expects columns/tables that don't exist in production, causing 500 errors on every query that touches the changed models.

After modifying the schema, always run:
```bash
cd packages/backend
npx prisma migrate dev --name <short_description>
```
This generates the migration SQL file in `prisma/migrations/`. Commit it alongside the schema change. **Never** merge a PR that changes `schema.prisma` without a corresponding migration file — CI will fail the Schema Drift Check.

## Monorepo Build Order
This is a monorepo with three packages: `packages/shared`, `packages/backend`, `packages/frontend`.

**Critical**: `packages/shared` is a compiled TypeScript package. After ANY change to shared (validation schemas, types, utilities), you MUST rebuild before backend or frontend will see the changes:
```bash
npm run build --workspace=packages/shared
```
Forgetting this is the #1 cause of "my fix didn't work" — the backend/frontend are importing from `dist/`, not `src/`.

## Environment Variables

### Local Development (`packages/backend/.env`)
```
DATABASE_URL=postgresql://credentials:credentials_dev_password@localhost:5433/credentials
NODE_ENV=development
PORT=3002
FRONTEND_URL=http://localhost:5190
JWT_SECRET=<any-string-for-dev>
DEV_AUTH_BYPASS=true

# LocalStack S3 (document uploads)
USE_LOCALSTACK=true
S3_ENDPOINT=http://localhost:4566
S3_BUCKET_NAME=credentials-documents
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# AI features
ANTHROPIC_API_KEY=<your-key>
AI_MODEL=claude-sonnet-4-20250514
```

### Production (Render env vars)
```
DATABASE_URL=<from-render-db>
NODE_ENV=production
FRONTEND_URL=https://kay-frontend.onrender.com

# Cloudflare R2 (S3-compatible)
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET_NAME=credentials-documents
AWS_REGION=auto
AWS_ACCESS_KEY_ID=<r2-access-key>
AWS_SECRET_ACCESS_KEY=<r2-secret-key>

# CAQH ProView API (optional — feature disabled if missing)
CAQH_API_URL=https://proview.caqh.org/api
CAQH_ORG_ID=<org-id>
CAQH_API_KEY=<api-key>
```
**Production backend URL:** `https://kay-os62.onrender.com`
Note: `USE_LOCALSTACK` should NOT be set in production. The backend uses `S3_ENDPOINT` whenever it's defined.

## Deployment
- **Platform**: Render (backend as web service, frontend as static site)
- **File storage**: Cloudflare R2 via S3-compatible API
- **Build command** (Render): `npm ci --include=dev && cd packages/shared && npm run build && cd ../backend && npx prisma generate && npm run build`
- **Start command** (Render): `cd packages/backend && npx prisma migrate deploy && node dist/index.js`
- **R2 CORS**: Must be configured in the **Cloudflare dashboard** (R2 bucket → Settings → CORS Policy). Programmatic `PutBucketCorsCommand` may not reliably override dashboard settings. Required origins: `https://kay-frontend.onrender.com` and `http://localhost:5190`.

## Local Dev Setup
### Prerequisites
- Node.js, npm, Docker Desktop

### Quick Start
```bash
cd /Users/kay/Documents/KAY
./start-dev.sh
```
This script: checks Docker is running → starts containers (PostgreSQL :5433, LocalStack :4566, Redis :6379) → waits for DB health → starts backend (:3002) and frontend (:5190) → Ctrl+C stops everything.

### Manual Start
```bash
cd /Users/kay/Documents/KAY
docker compose up -d
npm run dev --workspace=packages/backend &
npm run dev --workspace=packages/frontend &
```

## Debugging Playbook

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "Failed to fetch" on document upload | CORS misconfigured on S3/R2 | Test with `curl -X OPTIONS` against the upload URL. Check R2 CORS in Cloudflare dashboard. Ensure `AllowedOrigins` includes the frontend URL and `AllowedMethods` includes PUT. |
| Zod validation error after changing a schema in shared | Shared package not rebuilt | Run `npm run build --workspace=packages/shared`, then restart backend. |
| Render deploy timeout (no port detected) | Startup code reaching an unreachable endpoint | Check if `ensureBucketExists()` or similar init code is trying to connect to a service that isn't configured. Check env vars on Render. |
| Backend can't connect to DB locally | Docker containers not running | Run `docker compose up -d` and wait for health check. |
| `{"error": "Not found"}` at backend root URL | No route for `/` | Backend root redirects to `FRONTEND_URL`. Ensure `FRONTEND_URL` env var is set. |
| Upload works locally but not production | R2 env vars missing or wrong | Verify `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` are set on Render. |
| Provider approval fails with 500 | Email already exists in User table | `submitApplication()` and `approveApplication()` now check email uniqueness. Check for orphaned User records with duplicate emails. |
| No signup/approval email received | `SES_FROM_EMAIL` env var not set | Email service silently disables when `SES_FROM_EMAIL` is missing. Set it in Render env vars. Also set `ADMIN_EMAIL` for admin notifications. |
| "Failed to load enrollments" (or any model) in production | Missing Prisma migration | Schema was changed without generating a migration. Run `npx prisma migrate dev --name <desc>` locally, commit the migration file, and deploy. CI Schema Drift Check catches this. |

## .env Handling Rules
- `.env` files are gitignored — NEVER commit them
- NEVER paste API keys, tokens, or secrets into chat or code files
- If a key is accidentally exposed (committed, logged, or pasted), rotate it immediately on the provider's dashboard
- Store production secrets in Render's environment variable settings, not in `render.yaml`
- The `.env.example` file at the repo root documents all available variables (without real values)

## Git Workflow
All changes to `master` must go through a pull request with:
- At least 1 approval
- Security Gate CI check passing

## Tech Stack
- **Backend**: Express + Prisma + TypeScript, ESM (`"type": "module"`)
- **Frontend**: React 18 + Vite + Tailwind CSS + Zustand + React Query
- **Testing**: Vitest v4, vitest-mock-extended, supertest
- **Auth**: AWS Cognito (production), DEV_AUTH_BYPASS (local dev — supports admin, credentialing_staff, provider, practice_admin roles)

## Testing Conventions

### Test infrastructure
Test helpers live in `packages/backend/tests/helpers/`:
- `setup.ts` — env defaults for test runs
- `mock-prisma.ts` — shared deep-mocked PrismaClient (`prismaMock`)
- `mock-express.ts` — `createMockRequest()`, `createMockResponse()`, `createMockNext()`
- `test-app.ts` — `createTestApp(router, user)` for supertest integration tests
- `fixtures.ts` — reusable test data (adminUser, staffUser, providerUser, etc.)

### Vitest v4 gotchas
- `vi.fn().mockImplementation()` used as a constructor **MUST** use `function()` not arrow `() =>` — vitest v4 enforces the JS spec that arrow functions cannot be called with `new`.
- `vi.clearAllMocks()` does **NOT** reset mock implementations — use `vi.resetAllMocks()` or `mockRejectedValueOnce`/`mockResolvedValueOnce` for one-shot overrides.
- Prisma mock pattern: `vi.mock('../utils/prisma.js', async () => { const { prismaMock } = await import('../../tests/helpers/mock-prisma.js'); return { prisma: prismaMock }; })`
- Modules that read env vars at import time (e.g., `DEV_BYPASS_ENABLED` in `auth.middleware.ts`) require `vi.hoisted(() => { process.env['VAR'] = 'value'; })` in a separate test file to override before import.

### Cross-package pitfalls
- `ZodError instanceof` fails across package boundaries — `shared` and `backend` may bundle different zod copies. The error handler's `instanceof ZodError` check won't catch errors from shared package validation schemas. Use `.name === 'ZodError'` or re-export zod from shared.

### PrismaClient singleton
Always import from `utils/prisma.ts` — never create `new PrismaClient()` in service files. The singleton uses `globalThis` caching for hot-reload. Services that create their own instance get a separate connection pool and bypass test mocking.


## Architecture Notes

### Frontend Lazy Loading
All page components use `React.lazy()` in `App.tsx`. When adding a new route/page:
```tsx
const MyNewPage = lazy(() => import('./features/myFeature/MyNewPage'));
```
Keep `LoginPage`, `Layout`, and `PortalLayout` as eager imports (needed for auth shell). The `<Suspense>` wrapper is already in place.

### Dashboard Stats Endpoint
`GET /api/v1/dashboard/stats` returns aggregated counts via efficient Prisma `groupBy` and `count` queries. **Do NOT** fetch `/providers` or `/enrollments` on the dashboard just to count them — that was the old N+1 pattern.

### In-Memory TTL Cache
`packages/backend/src/utils/cache.ts` provides `getCached()`, `setCache()`, and `invalidateCache(prefix)`. Currently used by:
- Dashboard stats (60s TTL, key prefix `dashboard:`)
- Payer intelligence (5min TTL, key prefix `payer-analytics:`)

**Always invalidate** when mutating related data (see `provider.routes.ts` and `enrollment.routes.ts` for examples).

### AI Agent Feature
Full conversational AI with intent classification, context-aware data fetching, and conversation persistence. Role-restricted to admin/staff. 11 backend routes (`/api/v1/ai/*`), chat panel + dashboard tabs. Route file: `ai.routes.ts`, service: `ai.service.ts`.

### Portal / Provider Application Flow
`portal.service.ts` handles the full lifecycle: submit → review → approve/reject. On approval, it creates a Cognito user, then a Provider + User + optional UserPractice in a `$transaction`. If the DB transaction fails, it rolls back the Cognito user. Both `submitApplication()` and `approveApplication()` check email uniqueness against the User table to prevent unique constraint violations.

### Practice Self-Signup
Public endpoint `POST /api/v1/practices/register` (rate-limited: 5/15min). Creates Cognito user → sets permanent password → `$transaction` creates Practice + User (`practice_admin` role) + UserPractice (`SUPER_ADMIN`). Rolls back Cognito on any failure. Service: `practiceSignup.service.ts`, route: `practiceSignup.routes.ts`. The `practice_admin` role has same permissions as `credentialing_staff` and is added to authorize() calls in provider, credential, enrollment, dashboard, expiration, practiceLocation, and user routes. Sidebar filters hide admin-only nav items (Practices, Users, AI Agent, Payer Intelligence, Roster).

### Payer Enrollment
Full CRUD for payer enrollments with provider association. Models in Prisma schema, routes in `enrollment.routes.ts`. Provider profile page has tabbed sections for credentials, enrollments, documents.

### CAQH Integration
Two services: `caqh.service.ts` (roster management, credential pull, nightly auto-sync) and `caqh-credentials.service.ts` (encrypted credential storage/verification with Puppeteer). Pull sync flow: `pullCredentials()` → `mapCaqhToInternal()` → `applyCaqhDataToProvider()`. The mapping step uses typed `MappedCaqhData` interface with Prisma enums.

**Hardening (PR #59):** Exponential backoff retry (3 attempts, read-only ops only), 30s request timeout, Puppeteer concurrency guard (max 1 browser, queue 3, 60s timeout), rate limiting on credential verification (5 req/min), per-provider access checks, per-record error tracking in sync summaries, structured logging for unknown mappings. No hardcoded fallback values — missing data is skipped and logged. MFA treated as unverified (`caqhCredentialsValid: null`).

**Nightly sync (PR #58):** Scheduler runs at `0 2 * * *`, syncs all providers with valid CAQH credentials. Concurrency guard prevents overlapping runs. Notifications sent to admins when sync produces changes.

### Production Safety Guard
`DEV_AUTH_BYPASS=true` with `NODE_ENV=production` will crash the server on startup (fatal error in `auth.middleware.ts`). This is intentional — dev auth bypass must never run in production.

## DEV ENVIRONMENT RULES
- The dev bypass user must be auto-created on every backend startup when `DEV_AUTH_BYPASS=true`. Never require manual database intervention to start the dev environment.
- The backend exposes a readiness gate: `/health` and `/api/health` return `{ ready: false }` with 503 until all async initialization (DB warmup, dev user seeding) completes. The frontend retries automatically.
- The dev environment must work with a single command (`docker compose up -d && npm run dev`) after a clean restart — no manual steps, no seed scripts, no browser cache clearing.

## Bug Monitor

Automated bug detection and triage pipeline that creates Linear issues from runtime errors, frontend crashes, CI failures, and security findings.

### File locations
All source files live in `packages/backend/src/services/bug-monitor/`:
- `types.ts` — shared types (`BugReport`, `SanitizedBugReport`, `TriageResult`)
- `sanitizer.ts` — PII scrubbing (SSN, email, phone, NPI, DOB, Prisma WHERE clauses, JSON bodies)
- `fingerprint.ts` — SHA-256 dedup hashing with normalization (UUIDs, URL path numbers, line numbers)
- `noise-filter.ts` — occurrence threshold and severity escalation logic
- `triage.ts` — AI triage via Anthropic SDK with rule-based fallback
- `linear-client.ts` — raw fetch GraphQL client for Linear API
- `alert-router.ts` — SES email alerts for urgent issues
- `index.ts` — orchestrator (`BugMonitorService`) that ties everything together

API endpoint: `packages/backend/src/routes/bug-report.routes.ts` (`POST /api/v1/bugs`)
Error middleware: `packages/backend/src/middleware/bug-monitor.middleware.ts`
Frontend boundary: `packages/frontend/src/components/BugReportingErrorBoundary.tsx`
CI integration: `.github/workflows/security-scan.yml` (Linear reporting step)
Tests: `packages/backend/src/services/bug-monitor/__tests__/`

### Key env vars
| Variable | Purpose |
|----------|---------|
| `LINEAR_API_KEY` | Linear API key for issue creation |
| `LINEAR_TEAM_ID` | Linear team to file issues under |
| `LINEAR_BUG_MONITOR_ENABLED` | Kill switch — set to `false` to disable |
| `BUG_MONITOR_SECRET` | Shared secret for CI/frontend → backend auth |
| `BUG_TRIAGE_MODEL` | Anthropic model for AI triage (default: `claude-haiku-4-5-20251001`) |
| `BUG_ALERT_EMAIL` | Email address for urgent bug alerts via SES |
| `BUG_MONITOR_NOISE_THRESHOLD` | Occurrence count before creating a new issue (default: 10) |

### SOC 2 compliance
**Critical**: `sanitizer.ts` must be the first thing called in the pipeline — never send unsanitized bug data to Linear, SES, or any external service. The sanitizer scrubs SSNs, emails, phone numbers, NPIs, DOBs, Prisma WHERE clause contents, and JSON request bodies containing PII keys.

### Testing requirements
Sanitizer tests (`__tests__/sanitizer.test.ts`) are **mandatory** for any changes to PII redaction patterns. If you add, remove, or reorder regex patterns in `sanitizer.ts`, you must update and verify the corresponding tests. Pattern ordering matters — see the NPI-before-phone fix for why.

## Prompt Discipline Rules
1. **One prompt = one task.** Never combine schema changes with service logic with UI work.
2. **"Show me the diff"** at the end of every prompt. Be surgical — no extraneous changes.
3. **"Do not touch any other files"** — respect this every time. Never "improve" adjacent code unprompted.
4. **Verify at each gate.** Run `npx prisma migrate dev`, run the seed, query the DB, then move on.
5. **No AI-generated test data.** The user's spreadsheet is the single source of truth for the knowledge base. Never invent payer data.

## After Every Task
Provide a brief security summary: what was checked, any issues found, and any issues fixed.
