## Mandatory Security Rules
Before completing ANY task, automatically perform these checks on all changed files:

1. SECRETS SCAN: Check for any hardcoded API keys, passwords, tokens, database URLs, or credentials. If found, immediately move them to environment variables and flag the finding.

2. INPUT VALIDATION: Every API endpoint must validate and sanitize all user input. No raw user input should ever touch a database query.

3. AUTHORIZATION CHECK: Every API endpoint must verify the requesting user has permission to access the specific resource, not just that they're authenticated.

4. DATA EXPOSURE: Never return more data than the endpoint needs. Never log sensitive data (SSNs, tax IDs, NPI numbers, DOBs). Never store sensitive data in localStorage or cookies.

5. DEPENDENCY SAFETY: Before adding any new package, check if it has known vulnerabilities and if it's actively maintained.

6. ERROR HANDLING: Never expose stack traces, internal paths, or system details in error responses.

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
```
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
cd /Users/kay/KAY
./start-dev.sh
```
This script: checks Docker is running → starts containers (PostgreSQL :5433, LocalStack :4566, Redis :6379) → waits for DB health → starts backend (:3002) and frontend (:5190) → Ctrl+C stops everything.

### Manual Start
```bash
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

## DEV ENVIRONMENT RULES
- The dev bypass user must be auto-created on every backend startup when `DEV_AUTH_BYPASS=true`. Never require manual database intervention to start the dev environment.
- The backend exposes a readiness gate: `/health` and `/api/health` return `{ ready: false }` with 503 until all async initialization (DB warmup, dev user seeding) completes. The frontend retries automatically.
- The dev environment must work with a single command (`docker compose up -d && npm run dev`) after a clean restart — no manual steps, no seed scripts, no browser cache clearing.

## After Every Task
Provide a brief security summary: what was checked, any issues found, and any issues fixed.
