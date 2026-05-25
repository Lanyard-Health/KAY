# CLAUDE.md — Lanyard Health

> **Read this file first every session. Do not scan source files to re-orient.**

---

## Session Startup Protocol

1. **Read this file first** — do not scan source files to re-orient.
2. State the current phase or task in one sentence and wait for confirmation before acting.
3. Ask one clarifying question if scope is unclear — don't guess.
4. Execute immediately when told to run a command (don't just narrate intent).
5. After a successful build & test: share a summary of the build, commit and push (branch + PR, never direct to `master`).
6. Update this file after every meaningful push or milestone.

---

## Founder Context

**You are working with Kay, a non-technical solo founder.** This is the single most important thing to understand about every interaction in this repo. Adapt your behavior accordingly.

### What Kay can do
- Copy-paste commands you provide
- Run scripts like `./start-dev.sh`, `docker compose up -d`, `npm test`
- Click through the app's UI and report what they see
- Read terminal/console output and paste it back
- Make product decisions (what to build, what's important, what the user experience should be)
- Approve PRs after reviewing your plain-English summary

### What Kay cannot do
- Verify that your code is correct by reading it
- Debug TypeScript or runtime errors without your help
- Decide whether a refactor is "clean" or an abstraction is "right"
- Know whether a library or dependency choice is safe
- Spot a security issue or PHI leak in a diff
- Tell whether your tests actually cover the right cases

### What this means for you (Claude)

1. **Explain in plain English before pasting code.** State what code does in everyday terms, not just what it is.
2. **Provide complete, copy-pasteable commands.** Never say "run your tests" — say `cd packages/backend && npm test`. Include the directory.
3. **Predict failures, give recovery instructions.** Every step in a plan needs a "Did it work?" check AND "If it didn't, paste the error and I'll fix it." Kay can't diagnose a stack trace alone.
4. **Surface trade-offs in plain language.** Don't bury decisions. "Option A is cheaper but harder to undo. Option B is more expensive but safer." Make the cost visible.
5. **Default to confirmation on irreversible actions.** DB migrations, force pushes, destructive deletes, schema changes — confirm BEFORE, not after.
6. **No unexplained jargon.** First use of any acronym gets a parenthetical translation. "RBAC (the permission system that controls who can do what)."
7. **Never assume Kay will catch a code bug.** Tests, type checks, smoke tests, and YOUR verification are the only safety net.
8. **For multi-step plans, use TaskCreate.** Kay can't hold a 9-step plan in their head while executing. Visible checkboxes help them know where you are.
9. **When you finish, summarize in plain English.** What changed, what's deployed, what's left, what could go wrong. Not "shipped 3 commits to feat/branch."

### What this does NOT mean
- Don't dumb down product decisions. Kay knows the business better than you do.
- Don't add hedging caveats to every sentence. Be direct and clear.
- Don't refuse to do things because they "require technical knowledge." Your job is to provide that knowledge.

---

## Project Overview

**Lanyard Health** is a healthcare credentialing management system for small-to-mid-size behavioral health practices, telehealth providers, and small medical practices. It automates provider credentialing, payer enrollment, document management, and compliance tracking.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Vite 7, TypeScript 5.4, Tailwind CSS 3.4, Zustand, React Query, React Router 6, Headless UI, Heroicons, Framer Motion, Recharts |
| **Backend** | Express 4.19, TypeScript 5.4, ESM modules (`"type": "module"`), node-cron, BullMQ |
| **Database** | PostgreSQL 16 with pgvector extension, Prisma 5.12 ORM |
| **Auth** | AWS Cognito (production), DEV_AUTH_BYPASS (local dev) |
| **AI/APIs** | Anthropic SDK (Claude — chat, denial triage, payer intelligence, bug triage), OpenAI (text-embedding-3-small for RAG), AWS Textract (OCR), Retell AI (voice) |
| **Storage** | Cloudflare R2 / AWS S3 / LocalStack (local dev) |
| **Email** | AWS SES / Gmail API / Resend |
| **Monitoring** | Sentry, Winston logger |
| **Testing** | Vitest 4, Testing Library, Playwright (e2e), supertest |
| **Deployment** | Render (backend web service + static frontend + PostgreSQL) |
| **CI/CD** | GitHub Actions (security lint + security scan + schema drift check) |

### Architecture

```
packages/
  frontend/    → React SPA (port 5190), Vite proxy /api → localhost:3002
  backend/     → Express API (port 3002), Prisma ORM, 46 route files, 70+ services
  shared/      → Compiled TS package: types, Zod schemas, utilities
  mcp-server/  → MCP server integration
```

- **Monorepo** managed with npm workspaces + Turborepo
- Frontend lazy-loads all pages via `React.lazy()` in `App.tsx`
- Backend uses singleton PrismaClient (`utils/prisma.ts`) — never create `new PrismaClient()` elsewhere
- Shared package compiles to `dist/` — must rebuild after any change: `npm run build --workspace=packages/shared`

### Current Build Phase

**Platform Redesign** — 4 phases over 8 weeks targeting "Linear meets Mercury" aesthetic with deep AI automation. Schema redesign (75 models, 80+ enums, pgvector) is complete (PR #152). See memory file `project_schema_redesign.md` for details.

---

## Database Schema

**75 models, 80+ enums** — Full schema at `packages/backend/prisma/schema.prisma`

### Core Tables

| Category | Tables |
|----------|--------|
| **Users & Auth** | User, Practice, UserPractice |
| **Provider Data** | ProviderProfile, ProviderAddress, ProviderIdentifier, ProviderDemographics, ProviderBanking, ProviderDisclosure, ProviderCaqhMirror, DeaRegistration |
| **Credentials** | License, BoardCertification, MalpracticeInsurance, Education, WorkHistory, HospitalAffiliation, ProfessionalReference, DisciplinaryAction, ContinuingEducation, SupervisingPhysician, MalpracticeClaim |
| **Practice** | PracticeLocation, PracticeSignup |
| **Documents** | ProviderChecklist, Document |
| **Enrollments** | Enrollment, EnrollmentWorkflowStep, Payer, PayerSubmissionConfig, PayerTrack, PayerContact, PayerTimeline, PayerStateRule, PayerForm, PayerRequirement, PayerEnrollmentData |
| **Workflows** | EnrollmentWorkflow, WorkflowTemplate, WorkflowTemplateStep, WorkflowTemplateCondition, FollowUpTemplate, FollowUpTemplateStep, FollowUpRun, PendingApproval |
| **AI & Chat** | ChatConversation, ChatMessage, AiRecommendation, DenialTriage, AgentWorkflow, AgentTask, AgentEvent |
| **Integrations** | CaqhSyncLog, RetellCallLog, AetnaEnrollmentRun |
| **Admin** | Task, TerminationLetter, AdminNotification, InAppNotification, ProviderApplication, ProviderImport |
| **Audit** | AuditLog, KnowledgeBaseEmbedding, Notification |
| **Billing** | Subscription, Invoice |
| **Taxonomies** | OrganizationType, Specialty, SubSpecialty, ServiceCategory, ServiceOffering, PatientAgeGroup, PatientGenderIdentity, PatientSexualOrientation, SpecialPopulation, CustomService |
| **Practice Services** | PracticeSpecialty, PracticeSubSpecialty, PracticeService, PracticeAgeGroup, PracticeGenderIdentity, PracticeSexualOrientation, PracticeSpecialPopulation |
| **Provider Services** | ProviderSpecialty, ProviderSubSpecialty, ProviderService, ProviderAgeGroup, ProviderGenderIdentity, ProviderSexualOrientation, ProviderSpecialPopulation |

### Schema Rules

- **ANY schema change MUST include a migration**: `cd packages/backend && npx prisma migrate dev --name <desc>`
- Never merge a PR that changes `schema.prisma` without a corresponding migration file — CI Schema Drift Check catches this
- pgvector extension enabled — `KnowledgeBaseEmbedding` uses `vector(1536)` columns
- Docker uses `pgvector/pgvector:pg16` image for local pgvector support
- All PII fields (SSN, tax IDs, banking) must be encrypted via `encrypt()`/`encryptSafe()` (AES-256-GCM)

---

## Knowledge Base + Embeddings

End-to-end semantic search over payer credentialing knowledge (payer tracks, timelines, state rules, forms, requirements). Used by chat + denial triage to ground AI responses in real payer data.

### Pipeline (wired end to end)

| Stage | File | What happens |
|-------|------|--------------|
| **Schema** | `prisma/schema.prisma` (KnowledgeBaseEmbedding) | `vector(1536)` column via pgvector; FKs to PayerTrack / PayerTimeline / PayerStateRule / PayerForm / PayerRequirement / RequirementUniversal |
| **Write trigger** | `routes/knowledgeBase.routes.ts` (`triggerEmbedding()`) | Fires async on every KB POST/PATCH; fire-and-forget, doesn't block API response |
| **Embedding gen** | `services/knowledgeBase.embedding.service.ts` (`generateEmbedding`) | Calls OpenAI `text-embedding-3-small` via raw fetch; no SDK dependency |
| **Storage** | Same service (`upsertEmbedding`) | Raw `Prisma.$executeRaw` insert because Prisma ORM doesn't natively support pgvector type |
| **Search** | Same service (`searchSimilarWithSources`) | pgvector `<=>` cosine similarity; hydrates results with full source object |
| **Search route** | `routes/knowledgeBase.routes.ts` `GET /search?q=...&limit=N` | Admin/staff only; returns ranked source records |
| **Consumers** | `chat.service.ts`, `denial-triage.service.ts` | Chat queries on `'knowledge_base'` intent; denial triage always augments prompt |

### Cost

`text-embedding-3-small` = $0.02 / 1M tokens. A typical KB record is ~500 tokens. At 235 records, total embedding cost is ~$0.002. Even daily re-embedding for a year is under $1. **Cost is not a constraint.** Don't optimize a non-problem.

### `OPENAI_API_KEY`

Required for embeddings to actually generate. If unset, `isConfigured()` returns false, the trigger logs a warning and silently no-ops. The search route still works but returns empty. **Verify with:**
`docker exec credentials-db psql -U credentials credentials -c "SELECT COUNT(*) FROM knowledge_base_embeddings;"`
A non-zero count = pipeline is working.

### Operational notes

- **Embeddings are async.** A KB record created at T=0 may not have an embedding until ~1s later. Tests that check the embeddings table immediately after a POST will be flaky; if you need synchronous behavior, await the trigger.
- **Backfill is manual.** `triggerEmbedding()` only fires on create/update. If `OPENAI_API_KEY` was unset when records were created, they have no embedding even after the key is set. A backfill script that walks all KB source tables and calls `upsertEmbedding` is the standard fix.
- **No Anthropic/Voyage/local fallback.** Switching providers means changing `generateEmbedding()` and re-embedding everything (vector dimensions differ).

---

## Key Source Files

### Backend (`packages/backend/src/`)

| Path | Description |
|------|-------------|
| `index.ts` | Express server entry point, startup sequence, health gate |
| `routes/` | 46 route files — auth, provider, credential, enrollment, dashboard, AI, CAQH, Aetna, portal, bug-report, etc. |
| `services/` | 70+ service files — business logic layer |
| `services/ai.service.ts` | AI intent classification + data fetching (12 functions) |
| `services/chat.service.ts` | Conversation persistence (3 functions) |
| `services/portal.service.ts` | Provider application lifecycle: submit → review → approve/reject with Cognito + DB transaction |
| `services/practiceSignup.service.ts` | Practice self-signup with Cognito rollback |
| `services/caqh.service.ts` | CAQH roster management, credential pull, nightly sync |
| `services/caqh-credentials.service.ts` | Encrypted CAQH credential storage + Puppeteer verification |
| `services/bug-monitor/` | Automated bug detection pipeline: sanitizer → fingerprint → noise filter → triage → Linear |
| `agents/` | AI agent orchestration (monitor, portal, extractors, exception, orchestrator, approval) |
| `middleware/auth.middleware.ts` | JWT + Cognito auth, DEV_AUTH_BYPASS, practice scope, role checks |
| `middleware/bug-monitor.middleware.ts` | Error capture → bug monitor pipeline |
| `utils/prisma.ts` | PrismaClient singleton (globalThis caching) — always import from here |
| `utils/cache.ts` | In-memory TTL cache: `getCached()`, `setCache()`, `invalidateCache(prefix)` |
| `utils/encryption.ts` | AES-256-GCM encrypt/decrypt with `encryptSafe()`/`decryptSafe()` |

### Frontend (`packages/frontend/src/`)

| Path | Description |
|------|-------------|
| `App.tsx` | Routes + lazy loading (all pages except LoginPage, Layout, PortalLayout) |
| `features/` | 22 feature directories (providers, enrollments, documents, dashboard, AI agent, admin, portal, denials, etc.) |
| `components/` | 40+ shared UI components (StatusBadge, ProgressRing, HealthScoreGauge, CommandPalette, PasswordStrength, BugReportingErrorBoundary, etc.) |
| `hooks/useAi.ts` | 11 AI-related hooks for chat interface |
| `stores/` | Zustand state stores |

### Shared (`packages/shared/src/`)

| Path | Description |
|------|-------------|
| `types/` | Provider, credentials, documents, user, common type definitions |
| `validation/` | Zod schemas for provider, credentials, documents, AI, portal, provider directory |
| `utils/` | Nullable validation helper |

### Config Files

| Path | Description |
|------|-------------|
| `docker-compose.yml` | PostgreSQL (pgvector:pg16, port 5433), LocalStack (4566), Redis (6379) |
| `render.yaml` | Render deployment config (backend + frontend + DB) |
| `start-dev.sh` | One-command local dev startup |
| `.github/workflows/security-lint.yml` | ESLint security checks |
| `.github/workflows/security-scan.yml` | Security scanning + Linear issue filing + schema drift check |
| `tsconfig.base.json` | Base TypeScript config (ES2022, strict mode) |

---

## Conventions and Rules

### Architectural Rules

The following rules are platform-wide architectural laws. Every PR must comply. Violations fail review.

1. **API-FIRST FEATURE PARITY**: Every UI feature ships in the API before (or with) the UI. No UI route may exist without a corresponding API endpoint exposing equivalent capability. PRs adding UI-only features are rejected. Internal agents and any future external API consumers depend on this — UI-only features create silent capability gaps.

2. **OPENAPI SPEC IS THE CONTRACT**: The OpenAPI 3.1 spec at `packages/backend/openapi.json` is the source of truth for the API surface. Spec is regenerated from route handlers in CI. Drift between handlers and spec fails the build. Treat the OpenAPI spec like a Prisma migration — schema changes require spec updates.

3. **API QUALITY TARGETS**: Read endpoints p95 latency < 500ms. Write endpoints p95 latency < 2s. Uptime target 99.9% (publicly attested post-SOC 2). Coverage rule: every supported payer × provider type × state combination must respond — no silent "not supported" 404s. Latency budgets monitored in Sentry; budget violations open a P2 issue automatically.

These rules apply to all existing agents (orchestrator, document, portal, monitor, exception, approval) and all future agents (maintenance, inbox, etc.). They are no-regret investments that compound toward both partial inversion (current focus) and full inversion (future state per `full-inversion-roadmap.md`) paths.

### Mandatory Security Rules

1. **SECRETS SCAN**: Check for hardcoded API keys — move to env vars
2. **INPUT VALIDATION**: Every API endpoint validates + sanitizes input. No raw user input touches DB queries.
3. **AUTHORIZATION**: Verify user permission for EACH resource, not just authentication
4. **DATA EXPOSURE**: Never return excess data. Never log PII (SSN, tax ID, NPI, DOB).
5. **DEPENDENCY SAFETY**: Check vulnerabilities before adding packages
6. **ERROR HANDLING**: Never expose stack traces or internal paths in error responses
7. **ENV FILES**: NEVER commit `.env`. Never read aloud or display `.env` contents. Use `.env.example` for reference.
8. **HIPAA PII**: Zero plaintext tolerance — SSN, tax IDs, banking data always encrypted via `encryptSafe()` (throws if ENCRYPTION_KEY missing)

### Structural Rules

- **Read first, ask before changing.** Always read the relevant code before proposing changes. Present the plan and get explicit approval before modifying any files.
- **One prompt = one task.** Never combine schema changes + service logic + UI work.
- **"Do not touch any other files"** — respect every time. Never "improve" adjacent code unprompted.
- **Verify at each gate.** Run migrate, seed, query, then move on.
- **No AI-generated test data.** User's spreadsheet is the single source of truth for knowledge base.

### Third-party API Integration

1. **Spec before code.** Before integrating with any third-party API, locate official docs/specs/sample payloads in the workspace (search `~/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/`, `docs/`, `packages/*/docs/`). If they exist, read them first. If they don't, ask before inferring API behavior from error responses.
2. **Evidence hierarchy** (highest to lowest): published spec → vendor sample payloads → captured real responses → inferred behavior from error envelopes. Inference is the floor, not the default. When sources conflict, flag the contradiction — don't silently pick one.
3. **API errors mean what they say.** When a third-party returns "Required Field missing/invalid: X", X is the actual problem. Don't dismiss listed validation failures as "fallout from another issue." Treat error envelopes as authoritative descriptions of API expectations.
4. **CAQH spec docs**: `~/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/CAQH Specs 042526/drive-download-20260425T171441Z-3-001/` (Roster Individual v2.0 PDF, batch v3.2 PDF, Credentialing v9.0 PDF, sample payload txt files). Always read these before changing any CAQH integration code.

### Build and Run Commands

```bash
# Local dev (one command)
cd /Users/kay/Documents/KAY && ./start-dev.sh

# Manual start
docker compose up -d
npm run dev --workspace=packages/backend &
npm run dev --workspace=packages/frontend &

# Build shared (REQUIRED after any shared package change)
npm run build --workspace=packages/shared

# Run tests
npm run test                    # Vitest unit/integration
npm run test:e2e                # Playwright headless
npm run test:e2e:ui             # Playwright UI mode

# Prisma
cd packages/backend
npx prisma migrate dev --name <desc>   # Generate migration
npx prisma generate                     # Regenerate client
npx prisma studio                       # DB browser

# Lint
npm run lint
```

### Testing Conventions

- Test helpers: `packages/backend/tests/helpers/` (setup, mock-prisma, mock-express, test-app, fixtures)
- Prisma mock pattern: `vi.mock('../utils/prisma.js', async () => { const { prismaMock } = await import('../../tests/helpers/mock-prisma.js'); return { prisma: prismaMock }; })`
- `vi.fn().mockImplementation()` used as constructor MUST use `function()` not arrow `() =>` (Vitest v4)
- `vi.clearAllMocks()` does NOT reset implementations — use `vi.resetAllMocks()`
- Modules reading env vars at import time need `vi.hoisted(() => { process.env['VAR'] = 'value'; })`
- `ZodError instanceof` fails across packages — use `.name === 'ZodError'`
- PrismaClient: always import from `utils/prisma.ts`, never instantiate directly

### Git Workflow

- **NEVER push directly to `master`** — branch protection requires PRs + Security Gate CI
- When user says "push it": create branch → push → `gh pr create`
- Always warn before any push to a protected branch

### Debugging Playbook

| Symptom | Fix |
|---------|-----|
| "Failed to fetch" on upload | CORS misconfigured on R2 — check Cloudflare dashboard |
| Zod validation error after shared change | Rebuild shared: `npm run build --workspace=packages/shared` |
| Render deploy timeout | Check if init code (e.g. `ensureBucketExists()`) hitting unconfigured service |
| Backend can't connect to DB | `docker compose up -d` and wait for health check |
| Provider approval 500 | Email already exists in User table — check for duplicates |
| No signup email received | `SES_FROM_EMAIL` env var not set on Render |
| Model query 500 in production | Missing Prisma migration — generate and deploy |

---

## Do-Not-Touch List

### Login Page (`packages/frontend/src/features/auth/LoginPage.tsx`)
- **NEVER remove** the green gradient background: `bg-gradient-to-br from-primary-800 via-primary-600 to-emerald-500`
- **NEVER replace** the logo with text/SVG: `<img src="/logo.png" className="h-16 mx-auto brightness-0 invert" />`
- Logo is the interlocking "S" curve symbol — NEVER substitute
- This has been accidentally reverted multiple times — always preserve it

### Files Requiring Explicit Approval
- `packages/backend/prisma/schema.prisma` — always needs migration
- `packages/shared/` — any change requires rebuild + downstream verification
- `.github/workflows/` — CI pipeline changes
- `docker-compose.yml` — shared infrastructure
- `render.yaml` — deployment config

### Never Commit or Log
- `.env` files (gitignored)
- API keys, tokens, secrets
- Patient/provider PII (SSN, tax ID, banking, NPI, DOB)
- If a key is accidentally exposed, rotate immediately

### Environment Variables

**Local Dev** (`packages/backend/.env`):
```
DATABASE_URL=postgresql://credentials:credentials_dev_password@localhost:5433/credentials
NODE_ENV=development
PORT=3002
FRONTEND_URL=http://localhost:5190
DEV_AUTH_BYPASS=true
USE_LOCALSTACK=true
S3_ENDPOINT=http://localhost:4566
S3_BUCKET_NAME=credentials-documents
AWS_REGION=us-east-1
ANTHROPIC_API_KEY=<your-key>
AI_MODEL=claude-sonnet-4-20250514
```

**Production**: `https://kay-os62.onrender.com` — all secrets stored in Render env vars. `USE_LOCALSTACK` must NOT be set in production. `DEV_AUTH_BYPASS=true` with `NODE_ENV=production` will intentionally crash the server.

### CAQH environment configuration

CAQH has two separate environments, and we keep strict separation between them to avoid accidentally writing test data to production or leaking prod credentials to local dev.

| Environment | POID | Base URL                                | Credential location           |
|-------------|------|-----------------------------------------|-------------------------------|
| **Demo**    | 6279 | `https://proview-demo.nonprod.caqh.org` | `packages/backend/.env`       |
| **Prod**    | 1873 | `https://proview.caqh.org`              | Render env vars only          |

**Rules:**
- Local dev and `.env` use **demo** credentials only.
- Production CAQH credentials live **only** in Render env vars — never in `.env`, never in `.env.example`, never in committed files.
- Discovery calls, integration tests, and any new CAQH endpoint validation run against demo first. Only flip to prod after the demo call has been captured, reviewed, and shipped behind a feature flag or equivalent rollback path.
- Test providers added to the demo roster should be tracked in a "Phase X cleanup" checklist and derostered once the feature ships.
- `.env.example` ships with demo URL + POID pre-filled because they're non-secret; username/password are the only blanks.

---

## Running typechecks and tests

This codebase's `tsc --noEmit` and `vitest run` can legitimately take 5–15 minutes on a cold cache because the shared Prisma client + generated types are large. That's fine — but it means tooling defaults that assume fast commands will kill the run and produce a misleading "SIGTERM / exit 144" that looks like a code failure when it's actually a harness timeout.

**Rules for AI agents in this repo:**

1. **Foreground only.** Always run typechecks and tests in the foreground with an explicit 10-minute timeout. Never launch them as background tasks and poll. Polling loops and `pgrep`/`sleep` waiters add their own 2-minute timeouts on top and will kill the underlying process.
   - In Claude Code: pass `timeout: 600000` to the Bash tool. Do not set `run_in_background: true`.
2. **Pipe to a log, print exit.** Single command per check:
   ```bash
   npm run typecheck > /tmp/tsc.log 2>&1; echo "exit: $?"
   ```
   Then `cat /tmp/tsc.log | tail -60` only if you need to see errors.
3. **Separate calls per package.** Run backend and frontend typechecks in two different bash invocations — never combine them with `&&`, never parallelize them. Each gets its own 10-minute budget.
4. **Use incremental + changed.** Prefer `tsc --noEmit --incremental` and `vitest run --changed HEAD~1` when iterating on a single phase. Only run the full suite before pushing.
5. **If a check legitimately needs more than 10 minutes**, stop and ask. Don't silently extend the timeout further or split via polling — raise it as a cache/hardware issue to investigate.
6. **Never wrap in `npx`** for long-running checks — it adds an extra process layer that can hang. Invoke the binary directly: `node ./node_modules/typescript/bin/tsc --noEmit` or `./node_modules/.bin/vitest run`.

**Symptoms to recognize:**
- "exit code 144" on a tsc/vitest wrapper → the harness killed the parent shell, not the typecheck itself. Kill leftover processes (`pkill -f "tsc --noEmit"`) and re-run in the foreground with `timeout: 600000`.
- Multiple stale tsc/vitest processes piling up → previous background invocations that weren't cleanly reaped. Always `pkill` before retrying.

---

## Running typechecks and tests

This codebase's `tsc --noEmit` and `vitest run` can legitimately take 5–15 minutes on a cold cache because the shared Prisma client + generated types are large. That's fine — but it means tooling defaults that assume fast commands will kill the run and produce a misleading "SIGTERM / exit 144" that looks like a code failure when it's actually a harness timeout.

**Rules for AI agents in this repo:**

1. **Foreground only.** Always run typechecks and tests in the foreground with an explicit 10-minute timeout. Never launch them as background tasks and poll. Polling loops and `pgrep`/`sleep` waiters add their own 2-minute timeouts on top and will kill the underlying process.
   - In Claude Code: pass `timeout: 600000` to the Bash tool. Do not set `run_in_background: true`.
2. **Pipe to a log, print exit.** Single command per check:
   ```bash
   npm run typecheck > /tmp/tsc.log 2>&1; echo "exit: $?"
   ```
   Then `cat /tmp/tsc.log | tail -60` only if you need to see errors.
3. **Separate calls per package.** Run backend and frontend typechecks in two different bash invocations — never combine them with `&&`, never parallelize them. Each gets its own 10-minute budget.
4. **Use incremental + changed.** Prefer `tsc --noEmit --incremental` and `vitest run --changed HEAD~1` when iterating on a single phase. Only run the full suite before pushing.
5. **If a check legitimately needs more than 10 minutes**, stop and ask. Don't silently extend the timeout further or split via polling — raise it as a cache/hardware issue to investigate.
6. **Never wrap in `npx`** for long-running checks — it adds an extra process layer that can hang. Invoke the binary directly: `node ./node_modules/typescript/bin/tsc --noEmit` or `./node_modules/.bin/vitest run`.

**Symptoms to recognize:**
- "exit code 144" on a tsc/vitest wrapper → the harness killed the parent shell, not the typecheck itself. Kill leftover processes (`pkill -f "tsc --noEmit"`) and re-run in the foreground with `timeout: 600000`.
- Multiple stale tsc/vitest processes piling up → previous background invocations that weren't cleanly reaped. Always `pkill` before retrying.

---

## Design Context

### Users
Small-to-mid-size behavioral health practices, telehealth providers, and small medical practices who need to credential providers and manage payer enrollments without enterprise software complexity.

### Brand Personality
**Professional. Trustworthy. Effortless.**

### Visual Style

| Element | Value |
|---------|-------|
| **Primary color** | `#0A3D2E` (deep forest green) |
| **Palette** | Tailwind green primary (already rebranded) |
| **Font** | Inter |
| **Aesthetic** | "Linear meets Mercury" — consumer-grade polish, not enterprise bloat |
| **Motion** | Framer Motion for transitions, subtle and purposeful |
| **Components** | Headless UI, clsx for conditional classes, Heroicons for icons |

### Core Design Principles
1. **All-in-one simplicity** — every workflow completable without leaving the app
2. **Enter once** — data entered once, reused everywhere (no redundant forms)
3. **Ambient AI** — AI recommendations surface inline, not hidden in a chat panel
4. **10-minute onboarding** — new practice to first enrollment in under 10 minutes
5. **UI is the #1 differentiator** — competitors have terrible UX; ours must be exceptional

---

## After Every Task
Provide a brief security summary: what was checked, any issues found, and any issues fixed.

---

*Last updated: 2026-04-16*
