# Lanyard Health — Automation System Audit

**Date:** February 28, 2026
**Scope:** Full backend automation system — agents, workers, schedulers, triggers, supporting services

---

## EXECUTIVE SUMMARY

**Overall automation system health: 6/10**

The backend infrastructure is remarkably complete — every agent, worker, queue, and scheduler job has real production code. However, critical gaps in the status monitor (fully stubbed), portal coverage (3 of ~20 major payers), and missing automation triggers make the system significantly less autonomous than it appears.

**Component Breakdown:**
- Fully working: 14 components
- Partially working: 5 components
- Stubbed: 1 component (Status Monitor — critical)
- Not implemented: 2 areas (additional portal adapters, automation run history)

**Top 3 Most Critical Issues:**
1. **Status Monitor is fully stubbed** — always returns `pending`, never polls any payer. "Real-time status tracking" is non-functional for all payers.
2. **Portal document uploads don't trigger OCR** — providers upload documents but no automatic processing runs. Documents sit with `reviewStatus: pending` indefinitely.
3. **SLA system requires manual data entry** — `slaTargetDate` is never auto-populated, making both SLA breach detection and approaching-breach triggers effectively inert.

**Top 3 Easiest Wins:**
1. Auto-trigger document processing on portal upload (add one queue call in confirm-upload route)
2. Add `CREDENTIAL_CREATORS` entries for DEA, diploma, CME (mappers already exist, just need save logic)
3. Fix manual adapter expiry bug (7-day approvals never auto-deny because they bypass the expiry queue)

**Estimated Current Automation Rate: ~35%**

---

## SECTION 1: CORE INFRASTRUCTURE HEALTH CHECK

### [1.1] BullMQ Queue System

```
Status: WORKING
Files reviewed: agents/queues.ts, agents/workers.ts, utils/redis.ts
```

**6 queues, all with matching workers:**

| Queue | Name | Concurrency | Processor |
|-------|------|-------------|-----------|
| ORCHESTRATOR | `agent-orchestrator` | 3 | `processOrchestratorJob()` |
| DOCUMENT | `agent-document` | 2 | `processDocumentJob()` |
| PORTAL | `agent-portal` | 1 | `processPortalJob()` |
| MONITOR | `agent-monitor` | 5 | `processMonitorJob()` |
| EXCEPTION | `agent-exception` | 2 | `processExceptionJob()` |
| APPROVAL | `agent-approval` | 2 | `processApprovalJob()` |

**Retry/Backoff:** All queues share `attempts: 3`, exponential backoff starting at 2s. `removeOnComplete: { count: 1000 }`, `removeOnFail: { count: 5000 }`.

**DLQ:** No explicit dead letter queue. Failed jobs (after 3 retries) sit in BullMQ's failed set. The `worker.on('failed')` handler only logs — no alerting, no notification, no automated resolution.

**Redis:** Exponential backoff retry (up to 10 retries, max 5s delay). TLS and password support. `maxRetriesPerRequest: null` correctly set for BullMQ.

**What's missing:**
- No alerting when jobs permanently fail (after 3 retries)
- No DLQ processing — permanently failed jobs require manual inspection
- All concurrency guards are in-process (boolean flags) — horizontal scaling would cause duplicate cron fires

**Risk level: LOW**
**Easy win: YES** — Add `notifyAdminUsers()` call in `worker.on('failed')` when `job.attemptsMade >= 3`. Instant visibility into automation failures.

---

### [1.2] AI Orchestrator

```
Status: WORKING
Files reviewed: agents/orchestrator/orchestrator.service.ts, system-prompt.ts, tool-executor.ts, tool-schemas.ts
```

**Configuration:**
- Model: `claude-sonnet-4-20250514` (configurable via `AI_MODEL` env)
- Token budget: 50,000 per workflow (configurable via `AGENT_WORKFLOW_TOKEN_BUDGET`)
- Max tool calls per invocation: 20 (hardcoded)
- Max replans: 5 (hardcoded `MAX_REPLAN_COUNT`)

**7 registered tools — all fully implemented:**

| Tool | Implementation | Status |
|------|---------------|--------|
| `get_provider_profile` | Full Prisma query with all relations | Complete |
| `get_payer_requirements` | Reads `PayerAdapterConfig` | Complete |
| `check_credential_completeness` | Cross-references 6 credential types vs payer requirements | Complete |
| `dispatch_task` | Creates `AgentTask`, enqueues to correct BullMQ queue, auto-injects providerId/payerId | Complete |
| `request_human_approval` | Creates `PendingApproval`, pauses workflow | Complete |
| `get_workflow_state` | Reads full workflow with tasks and approvals | Complete |
| `escalate_to_exception` | Enqueues to exception queue | Complete |

**Replan limit enforcement:** Stored in `workflow.plan.replanCount`. When exhausted, workflow status → `paused`. **Gap:** No admin notification sent when replan limit is hit — workflow silently stalls.

**Error handling gaps:**
- No timeout on Claude API calls — a hung call blocks the worker thread indefinitely
- No rate-limit-aware retry (429 errors get generic 3-attempt backoff)
- Tool call count limit (20) breaks the loop silently with no event logged

**Risk level: MEDIUM**
**Easy win: YES** — Add `timeout: 60000` to Anthropic client options. Prevents hung workers.

---

### [1.3] Workflow Coordinator

```
Status: WORKING
Files reviewed: agents/coordinator.service.ts, agents/approval.service.ts
```

**Lifecycle:** Creation (with concurrent workflow limit per provider, default 10) → Orchestrator plans → Tasks dispatched to BullMQ → Workers process → `notifyTaskCompletion()` callback → Orchestrator replans → Repeat until complete/failed.

**Task failure handling:** Workers call `notifyTaskCompletion(workflowId, taskId, 'task_failed')` → enqueues `task_callback` job → orchestrator re-evaluates and can replan, escalate, or fail the workflow.

**Callback robustness:** BullMQ-backed (durable). If Redis is down when callback is enqueued, the job is lost and the workflow stalls. No fallback polling mechanism. BullMQ's default stalled job detection (30s) provides some recovery.

**What's missing:**
- No "stuck workflow" detection — workflows stuck in `active` or `planning` for >24h are invisible
- No circuit breaker — systematic orchestrator failures cycle through retries with no alert

**Risk level: LOW**
**Easy win: YES** — Add a scheduled job that finds workflows stuck in non-terminal status for >24h and creates admin notifications.

---

### [1.4] Event Logger

```
Status: WORKING
Files reviewed: agents/event-logger.ts
```

**Fire-and-forget:** The function never throws — all errors caught and logged via `logger.warn`. Safe to `await` or drop the promise.

**Schema:** `AgentEvent` records with `workflowId`, `taskId`, `agent`, `action`, `data` (JSON), `level`, `createdAt`. Stored in Postgres.

**Events logged:** ~25 distinct event types across all agents (workflow lifecycle, task dispatch, document processing steps, approvals, exceptions, monitoring).

**Automation rate calculation:** Possible via SQL — count workflows completed without `PendingApproval` vs total. No pre-built endpoint exists.

**What's missing:**
- `runAutomation()` (agent-automation.service.ts) does NOT call `logAgentEvent()` — automation trigger runs are invisible in the event log
- No TTL/archival policy — `AgentEvent` table grows indefinitely

**Risk level: LOW**
**Easy win: YES** — Add an automation rate metric to the dashboard stats endpoint.

---

### [1.5] WebSocket

```
Status: PARTIALLY WORKING
Files reviewed: agents/websocket.ts
```

**Events emitted:** 13 event types across workflow rooms + a broadcast `approvals` room. Covers document processing, portal submissions, monitoring, exceptions, and approvals.

**What's missing:**
- **No authorization on `subscribe:workflow`** — any authenticated user can subscribe to any workflow by UUID, regardless of practice membership. Multi-tenant data leak.
- **No practice scoping on `approvals` room** — all approval events broadcast to all subscribers across all practices.
- No event replay on reconnect (missed events are lost).

**Risk level: MEDIUM** (authorization gap)
**Easy win: YES** — Add a DB check in the `subscribe:workflow` handler to verify the workflow belongs to the user's practice.

---

## SECTION 2: AGENT WORKERS DEEP DIVE

### [2.1] Document Parser

```
Status: FULLY IMPLEMENTED (with gaps in credential auto-save coverage)
Files reviewed: agents/document-agent.ts, agents/extractors/textract-extractor.ts,
  agents/extractors/vision-extractor.ts, agents/document-classifier.ts, agents/credential-mapper.ts
```

**Happy path:** BullMQ job → fetch document metadata → cross-provider safety check → classify type (Claude Haiku if unknown) → download from S3 → extract fields (Textract for PDFs, Claude Vision for images) → map to credential schema → auto-save if confidence >= 90% → update task status → emit WebSocket events.

**Extraction pipeline — all real:**
- **Textract:** `AnalyzeDocumentCommand` with `FORMS` + `TABLES` features. Synchronous, max 10 pages.
- **Vision:** Claude Sonnet with image input. Document-type-specific prompts. Parses structured JSON with per-field confidence.
- **Classifier:** Claude Haiku. 16 document types supported.
- **Mapper:** 6 type-specific mappers (license, board cert, malpractice, DEA, diploma, CME). State normalization, date parsing, currency parsing.

**Critical gap — only 3 of 16 types auto-save:**

| Document Type | Mapper | Auto-Save (`CREDENTIAL_CREATORS`) |
|--------------|--------|-----------------------------------|
| `license` | Yes | **Yes** → `prisma.license.create()` |
| `board_certification` | Yes | **Yes** → `prisma.boardCertification.create()` |
| `malpractice_certificate` | Yes | **Yes** → `prisma.malpracticeInsurance.create()` |
| `dea_certificate` | Yes | **No** — mapped but never saved |
| `diploma` | Yes | **No** |
| `cme_certificate` | Yes | **No** |
| 10 other types | No | **No** |

**Sub-90% confidence handling:** Status becomes `needs_review`. Task output stored with `needsReview: true`. **No `PendingApproval` created, no email notification, no review queue.** Documents requiring review are invisible unless someone checks the workflow detail page.

**Other issues:**
- Confidence threshold (0.90) is hardcoded, not configurable
- TIFF in `IMAGE_MIME_TYPES` but unsupported by Claude Vision API — would throw
- No connection to CAQH — extracted credentials don't enrich CAQH-pulled data

**Easy win: YES** — Add `CREDENTIAL_CREATORS` for `dea_certificate` (route to `deaRegistration` model — mapper already exists). Also add `PendingApproval` creation for sub-threshold documents.

---

### [2.2] Portal Interaction

```
Status: PARTIALLY IMPLEMENTED (3 adapters of ~20 needed)
Files reviewed: agents/portal/portal-agent.ts, payer-adapter.ts, index.ts,
  aetna-adapter.ts, caqh-adapter.ts, manual-adapter.ts,
  services/aetna/enrollment.service.ts, services/aetna/form-filler.ts, services/aetna/readiness.service.ts
```

**Adapter Registry:** Exactly 3 adapters. No partial implementations, no TODOs for other payers.

**Aetna Adapter — FULLY AUTOMATED (semi):**
- Playwright fills all 10 pages of Aetna's "Join the Network" form
- Screenshots uploaded to S3 at every page
- Stops before final submit — holds browser session for 30 minutes for human review
- `approveAndSubmit()` clicks the actual submit button
- `checkAetnaReadiness()` validates 9 pages of required fields with `fixPath` deep-links
- No CAPTCHA detection — bot detection would cause a generic timeout
- 10-minute global timeout on form fill via `Promise.race`

**CAQH Adapter — REAL (data sync, not enrollment):**
- Adds provider to CAQH roster via ProView API
- Pulls credential data back and maps to Prisma schema
- Not a payer enrollment — it's a credentialing data exchange

**Manual Adapter — REAL (human handoff):**
- Packages full credential manifest (licenses, certs, malpractice)
- Creates `PendingApproval` with 7-day expiry
- **Bug:** 7-day expiry never triggers auto-deny because it bypasses `requestApproval()` and never enqueues an expiry check job. Manual submission approvals sit forever.

**No other payer adapters exist** — Cigna, UHC, Humana, Optum, BCBS all route to manual adapter (if configured) or fail.

**Easy win: YES** — Fix manual adapter to wire through `requestApproval()` or at minimum enqueue an expiry check job after creating the approval.

---

### [2.3] Status Monitor

```
Status: STUBBED — CRITICAL
Files reviewed: agents/monitor/monitor-agent.ts, monitor-cron.ts, backoff.ts
```

**The actual polling code (lines 30-46 of monitor-agent.ts):**
```typescript
// For now, return pending. Real adapter integration will replace this.
if (taskInput['forcedStatus']) {
  statusResult = { status: taskInput['forcedStatus'] ... };
} else {
  statusResult = { status: 'pending' };
}
```

**Every monitor job returns `pending` and reschedules itself forever.** No HTTP requests to any payer system. No Playwright scraping. No API calls. The backoff schedule, stall detection, WebSocket events, and DB updates are all real — only the actual status query is a stub.

**Backoff schedule (real, but schedule differs from documentation):**
- 0–7 days since submission → 4-hour delay
- 8–14 days → 8-hour delay
- 15–30 days → 24-hour delay
- 31+ days → 48-hour delay (flagged as `isStalled`)

**Monitor cron (hourly, real):** Finds overdue `monitor_status` tasks and re-enqueues them. Works correctly but is a no-op when monitor jobs always return `pending`.

**Impact:** Any claim of automated enrollment status tracking is false. A human must manually set `forcedStatus` in the database to advance the state.

**Easy win: YES — highest priority.** For Aetna: look up the `AetnaEnrollmentRun` by `submissionId`, check its status in the DB (at minimum), or call Availity's enrollment status API with the provider NPI. The infrastructure (backoff, cron, WebSocket events, DB updates) is all there — only the status query needs implementing.

---

### [2.4] Exception Handler

```
Status: FULLY IMPLEMENTED
Files reviewed: agents/exception/exception-agent.ts, prompt.ts, types.ts
```

**Real Claude call** (Sonnet, max 1500 tokens). 9 typed exception categories. Structured action steps with typed actions (`request_document`, `correct_data`, `renew_credential`, `retry_submission`, `escalate_to_human`, `wait_and_retry`).

**Auto-remediation:** If Claude determines `autoRemediable === true`, re-enqueues orchestrator for replanning. If false, marks workflow as `failed`.

**Malformed response handling:** Falls back to `unknown_denial` with `escalate_to_human` step.

**Gap:** `payerRequirements` context is usually null/empty for most payers — Claude has limited payer-specific context for remediation.

**Easy win: YES** — Seed `PayerAdapterConfig.requiredFields` for the top 5 payers to improve exception analysis quality.

---

### [2.5] Approval Handler

```
Status: FULLY IMPLEMENTED
Files reviewed: agents/approval/approval-agent.ts, agents/approval.service.ts
```

**48h expiry with auto-deny:** Confirmed for standard approvals. Manual adapter uses 7-day expiry (bypasses the standard flow — see 2.2 bug).

**Race condition guard:** `prisma.pendingApproval.updateMany()` with `where: { id, status: 'pending' }`. Optimistic concurrency — safe even under multi-instance scaling (Postgres row-level atomicity).

**Denial handling:** Updates approval → fails workflow → cancels all pending/queued tasks → notifies orchestrator → emits WebSocket.

**What requires approval (hardcoded, not configurable):**
1. Orchestrator `request_human_approval` tool — general workflow approval
2. Manual adapter — all manual payer submissions
3. Aetna adapter — separate review via `AetnaEnrollmentRun` (not `PendingApproval`)

**Gap:** No email notification to approvers when a new approval arrives. Only WebSocket delivery — if staff isn't connected, they don't know.

**Easy win: YES** — Add SES email notification to approvers. Email infrastructure already exists.

---

## SECTION 3: SCHEDULED JOBS VERIFICATION

### [3.1] Agent Automation — Every 4h

```
Status: PARTIALLY WORKING
Files reviewed: services/agent-automation.service.ts
```

**4 triggers, all real with queries and deduplication:**

| Trigger | Query | Dedup Check | Workflow Created |
|---------|-------|-------------|-----------------|
| Overdue Follow-Ups | `payerEnrollment` where submitted/pending_review + 14 days old | provider + enrollment combo | "Send follow-up for X's Y enrollment" (normal priority) |
| Expiring Credentials | `license` + `boardCertification` expiring within 30 days | provider only (coarse!) | "Renew expiring X for Y" (high priority) |
| Stale Enrollments | `payerEnrollment` where not_started/in_progress + 30 days stale | provider + enrollment combo | "Review stale X enrollment for Y" (normal priority) |
| SLA Breach Approaching | `payerEnrollment` where slaTargetDate within 7 days | provider + enrollment combo | "Urgent: X enrollment approaching SLA" (urgent if ≤3d) |

**Issues found:**
- **Malpractice insurance NOT checked** in Trigger 2 — only licenses and board certs
- **Dedup for Trigger 2 is too coarse** — checks `hasActiveWorkflow(providerId)` with no credential ID. Any existing workflow for that provider blocks all credential-expiry triggers
- **All thresholds hardcoded** (14d, 30d, 30d, 7d/3d)
- **Batch cap of 50 per trigger** — large practices could exceed this
- **Automation runs not logged to `AgentEvent` table** — invisible in event history

**Easy win: YES** — Add malpractice insurance to Trigger 2 (one more `findMany` query). Fix Trigger 2 dedup to include credential type.

---

### [3.2] CAQH Sync — 2am Daily

```
Status: FULLY WORKING
Files reviewed: services/caqh.service.ts, scheduler.service.ts
```

**What it does:** Finds providers with `caqhProviderId != null` AND `caqhCredentialsValid: true`. For each: pulls credentials from CAQH ProView API → maps to internal schema → applies to provider record (create/update licenses, certs, education, malpractice).

**Real features:** 3-attempt retry with exponential backoff, 30s timeout, per-record error tracking, concurrency guard, typed `MappedCaqhData`, change detection and admin notification.

**Gaps:**
- No inter-provider rate limit (could hammer CAQH API)
- Education records are always `upsert`-ed — existing manually-curated data could be overwritten
- Feature silently disabled if `CAQH_API_URL` / `CAQH_ORG_ID` / `CAQH_API_KEY` not set

**Easy win: YES** — Add `sleep(1000)` between provider syncs to rate-limit API calls.

---

### [3.3] Expiration Alerts (AI) — 7am Daily

```
Status: FULLY WORKING
Files reviewed: services/ai.service.ts (generateExpirationAlerts), scheduler.service.ts
```

**Real Claude API call.** Sends all credentials expiring within 90 days. Returns structured recommendations with urgency, category, and actionable steps. Stores results as `AiRecommendation` records.

**Thresholds:** 90-day window (hardcoded). AI generates per-credential alerts — doesn't use fixed 90/60/30 day milestones.

**Gap:** Recommendations stored in DB but no push notification to staff. Staff must visit the AI dashboard to see them. Shares `AI_DAILY_TOKEN_BUDGET` with interactive chat — heavy chat use could exhaust budget before this job runs.

**Easy win: YES** — Add admin in-app notification when new expiration alerts are generated.

---

### [3.4] Expiration Emails — 8am Daily

```
Status: FULLY WORKING
Files reviewed: services/expiration.service.ts, scheduler.service.ts
```

**Different from 3.3:** This sends HTML emails to *providers* (not staff alerts). Uses exact-day thresholds: `[90, 60, 30, 14, 7]` days. Via AWS SES `SendEmailCommand`.

**Issues:**
- Email template branded as "Credentials Management System" — not "Lanyard Health" (brand mismatch)
- No portal URL link in email body
- No dedup guard if server restarts and job fires twice
- SES delivery failures logged as `sent` (no bounce tracking)
- Providers only — staff never notified of what was sent

**Easy win: YES** — Fix brand name, add portal link, add dedup check against `Notification` table.

---

### [3.5] SLA Breach Detection — Hourly

```
Status: RUNNING BUT INEFFECTIVE
Files reviewed: services/opsWorkQueue.service.ts (checkSlaBreaches), scheduler.service.ts
```

**What it does:** Finds `PayerEnrollment` where `slaTargetDate < now` AND not already breached AND not in terminal status. Stamps `slaBreachedAt`, creates urgent `OpsWorkItem`, sends admin notification.

**Critical gap:** `slaTargetDate` is never auto-populated. If no one manually sets this field on each enrollment, this job processes zero records and is effectively a no-op.

**Easy win: YES** — Auto-populate `slaTargetDate` as `applicationDate + 90 days` when an enrollment status changes to `submitted`. One `prisma.$use` middleware or route hook.

---

### [3.6] Directory Verification — Sundays 3am

```
Status: PARTIALLY WORKING (Aetna only)
Files reviewed: services/providerDirectory.service.ts, services/aetna.auth.ts, scheduler.service.ts
```

**Real FHIR R4 integration** — OAuth2 client credentials → `GET /Practitioner?identifier=...npi|{npi}` → `GET /PractitionerRole` → compare name/phone/specialty against our records → store snapshot → create/resolve alerts.

**Only Aetna.** Framework is cleanly extensible (implement `PayerDirectoryAdapter`, register). Requires `AETNA_CLIENT_ID`, `AETNA_CLIENT_SECRET`, `AETNA_FHIR_BASE_URL` env vars — if not set, job isn't even scheduled.

**Gap:** No rate limiting between FHIR API calls. No admin notification when a provider disappears from directory.

**Easy win: YES** — Add per-provider delay between FHIR calls. Add notification for `not_found` status.

---

### [3.7] Notification Cleanup — Sundays 4am

```
Status: FULLY WORKING
Files reviewed: services/notification.service.ts, scheduler.service.ts
```

Deletes read notifications older than 90 days. Clean and correct. **Minor gap:** unread notifications older than 90 days accumulate forever.

---

### [3.8] Monitor Cron — Hourly

```
Status: RUNNING BUT INEFFECTIVE
Files reviewed: agents/monitor/monitor-cron.ts
```

Re-enqueues overdue `monitor_status` tasks. Infrastructure is correct but is effectively a no-op because the monitor agent (2.3) always returns `pending`. This cron becomes valuable once the monitor agent has real status polling.

---

## SECTION 4: AUTOMATION TRIGGER ENGINE

File: `services/agent-automation.service.ts`

### Hardcoded Thresholds (All Should Be Configurable)

| Value | Location | Current | Suggested Env Var |
|-------|----------|---------|-------------------|
| Follow-up initial delay | line 52 | 14 days | `FOLLOWUP_INITIAL_DAYS` |
| Credential expiry window | line 109 | 30 days | `CREDENTIAL_EXPIRY_ALERT_DAYS` |
| Stale enrollment window | line 185 | 30 days | `STALE_ENROLLMENT_DAYS` |
| SLA outer alert window | line 232 | 7 days | `SLA_ALERT_DAYS` |
| SLA urgent threshold | line 233 | 3 days | `SLA_URGENT_DAYS` |
| Batch cap per trigger | multiple | 50 | `AUTOMATION_BATCH_SIZE` |
| OCR confidence threshold | document-agent.ts line 12 | 0.90 | `OCR_CONFIDENCE_THRESHOLD` |
| Manual approval expiry | manual-adapter.ts line 60 | 7 days | `MANUAL_APPROVAL_EXPIRY_DAYS` |
| Notification retention | scheduler.service.ts | 90 days | `NOTIFICATION_RETENTION_DAYS` |

### Telemetry Gap

`runAutomation()` logs to application logs only — **does NOT write `AgentEvent` records**. Automation trigger runs are invisible in the event log. No database record of when triggers fired, what they found, or what was created. Building an automation history dashboard requires either: (a) a new `AutomationRun` table, or (b) adding `logAgentEvent()` calls with a synthetic agent name.

---

## SECTION 5: SUPPORTING SERVICES

### [5.1] Workflow Hydration

```
Status: FULLY IMPLEMENTED — production-ready templates
File: services/workflow-hydration.service.ts, config/payer-workflows.json
```

**5 payers with templates:** Aetna, Cigna, UHC, Optum, Humana. Each has `medical` and `behavioral_health` variants. Steps include action type, owner, estimated days, dependencies, documents needed, and warnings.

**BH templates are complete** — 11 provider type codes, payer-specific rules (Cigna 60-day license validity, Humana 45-day rule), Medicare LPC/MFT requirements, real URLs and phone numbers.

**Gap:** No mapping between `Payer` database records and JSON template keys. `payerWorkflowKey` must be pre-populated on the `Payer` record or hydration returns zero steps.

---

### [5.2] Termination Workflow

```
Status: FULLY IMPLEMENTED
File: services/terminationWorkflow.service.ts
```

**4 task types:** `TERMINATE_ENROLLMENT` (per enrollment), `DRAFT_TERM_LETTER` (per enrollment), `CHECK_AVAILITY` (provider-level), `UPDATE_CAQH` (provider-level). Auto-generates termination letters via AI. Triggered from enrollment routes when `terminationDate` is set. Idempotent by design.

---

### [5.3] Follow-Up Reminders

```
Status: PARTIALLY WORKING — emails work but never auto-fire
File: services/followup.service.ts
```

**Email generation is real** — two templates (internal reminder, external payer-facing). SES delivery. Updates `nextFollowUpDate` on success.

**Critical gap:** No cron job calls this automatically. The scheduler explicitly comments that automatic scheduling is disabled. Follow-ups only fire via manual `POST /api/v1/follow-up/run` API call. This is arguably the most important automation for credentialing (following up with payers) and it's manual-only.

**No effectiveness tracking** — no delivery confirmation, no response detection, no metric on whether follow-ups result in status changes.

---

### [5.4] CAQH Credentials Verification

```
Status: FULLY IMPLEMENTED (fragile)
File: services/caqh-credentials.service.ts
```

Full headless Puppeteer login to `proview.caqh.org`. AES-256-GCM encryption for stored credentials. Concurrency guard (max 1 browser, queue 3, 60s timeout). Correctly handles MFA as unverified.

**Fragility:** CSS selector cascade depends on CAQH's login page DOM. Any redesign breaks all selectors silently.

---

### [5.5] Notifications

```
Status: FULLY IMPLEMENTED (in-app only)
File: services/notification.service.ts
```

In-app notifications stored in `InAppNotification` table. CRUD + pagination + unread count. Frontend polls every 30 seconds.

**Notification fatigue risk:** High. CAQH sync sends one notification per provider with changes. 20 providers syncing = 20 notifications per admin. No batching or digest mechanism.

---

## SECTION 6: MISSING ITEMS — VALIDATED

### 6.1 Monitor Agent Status Polling — CONFIRMED STUBBED

Lines 30-46 of `monitor-agent.ts` explicitly return `{ status: 'pending' }` for all jobs without `forcedStatus`. Comment says "Real adapter integration will replace this." No adapter interface exists between the monitor and any payer status API.

**To make real for Aetna:** Look up `AetnaEnrollmentRun` by `submissionId` → call Availity enrollment status API with NPI → map response to `StatusCheckResult`. Infrastructure (backoff, cron, events, DB updates) is ready.

---

### 6.2 Portal Adapters — CONFIRMED 3 ONLY

Exactly `caqh_directassure`, `manual_submission`, `aetna`. Zero partial implementations for other payers. The adapter interface is clean — new payers are a single-file addition.

---

### 6.3 Command Center Automation Integration — CONFIRMED DISCONNECTED

`GET /api/v1/command-center/matrix` returns enrollment status only. No `activeWorkflowId`, `workflowStatus`, `slaBreached` fields. No `POST` endpoint to trigger workflows from cells. Zero imports from agent system.

**What's needed:** Add `activeWorkflowId` and `slaBreached` to the matrix cell response (backend: join against `AgentWorkflow` table). Add a `POST /trigger` endpoint that calls `createWorkflow()`. Frontend: show workflow status badges on cells, add "Run Workflow" context action.

---

### 6.4 Inline AI Recommendations — READY TO SURFACE

`getContextualRecommendations()` in `ai.service.ts` is a fast, pure rule engine (no LLM call, 10-minute cache). Checks license/DEA/cert/malpractice expiry, CAQH staleness, processing time vs payer average, SLA proximity. Returns typed recommendations with severity and `actionUrls`.

**Easiest to surface.** Accepts `entityType: 'provider' | 'enrollment'` and `entityId`. Add a frontend component that fetches and displays these on provider/enrollment detail pages.

---

### 6.5 Behavioral Health Templates — CONFIRMED COMPLETE

The `config/payer-workflows.json` has production-quality BH content for all 5 payers. 11 BH provider type codes. Payer-specific rules, real URLs, real timelines. Not placeholder data.

---

### 6.6 Portal Document Auto-OCR — CONFIRMED GAP

**The gap:** `POST /portal/documents/confirm` calls `documentService.confirmUpload()` which marks the upload complete but does NOT enqueue a document-agent job. Portal documents sit with `reviewStatus: pending` and no OCR runs.

**Fix:** Add `getQueue(QUEUE_NAMES.DOCUMENT).add('parse_document', { documentId, providerId })` in the confirm route handler or inside `confirmUpload()`. The document-agent pipeline is fully functional — only the trigger is missing.

---

### 6.7 Automation Settings — 15 Hardcoded Values Identified

See Section 4 table. All thresholds, batch caps, cache TTLs, and expiry windows are hardcoded. The scheduler cron expressions are the only configurable values (via env vars).

---

### 6.8 Automation Run History — NOT CAPTURABLE FROM CURRENT LOGS

`runAutomation()` does not write to the `AgentEvent` table. Results are logged to stdout only. Building an automation history dashboard requires adding `logAgentEvent()` calls or creating a new `AutomationRun` table.

---

## SECTION 7: EASY WINS

### Easy Win #1: Auto-Trigger OCR on Portal Document Upload

```
What to do: Add a BullMQ document-agent job enqueue in the portal document confirm route
Files to modify: routes/portal-documents.routes.ts OR services/document.service.ts
Estimated effort: HOURS
Impact: Every provider-uploaded document gets automatically processed. Currently zero OCR runs on portal uploads.
Dependencies: Redis running, document worker running
Risk: LOW
```

### Easy Win #2: Fix Manual Adapter Expiry Bug

```
What to do: Route manual adapter approval creation through requestApproval() or manually enqueue an expiry check job
Files to modify: agents/portal/manual-adapter.ts
Estimated effort: HOURS
Impact: Manual submission approvals (7-day) will actually auto-deny instead of sitting forever
Dependencies: None
Risk: LOW
```

### Easy Win #3: Add CREDENTIAL_CREATORS for DEA, Diploma, CME

```
What to do: Add entries in CREDENTIAL_CREATORS map (document-agent.ts) for dea_certificate, diploma, cme_certificate
Files to modify: agents/document-agent.ts
Estimated effort: HOURS
Impact: 3 more document types auto-save credentials instead of always falling to needs_review. Mappers already exist.
Dependencies: Prisma models for DEA registration, education, CME must exist (they do)
Risk: LOW
```

### Easy Win #4: Add Claude API Timeout

```
What to do: Add timeout: 60000 to Anthropic client options in orchestrator.service.ts
Files to modify: agents/orchestrator/orchestrator.service.ts
Estimated effort: HOURS
Impact: Prevents hung worker threads from blocking the orchestrator queue indefinitely
Dependencies: None
Risk: LOW
```

### Easy Win #5: Auto-Populate SLA Target Dates

```
What to do: Set slaTargetDate = applicationDate + 90 days when enrollment status changes to 'submitted'
Files to modify: routes/enrollment.routes.ts or a Prisma middleware
Estimated effort: HOURS
Impact: Activates SLA breach detection (currently a no-op for most enrollments) and SLA approaching trigger
Dependencies: None
Risk: LOW
```

### Easy Win #6: Add Malpractice to Expiring Credentials Trigger

```
What to do: Add prisma.malpracticeInsurance.findMany() query to Trigger 2 in agent-automation.service.ts
Files to modify: services/agent-automation.service.ts
Estimated effort: HOURS
Impact: Catches expiring malpractice insurance — currently invisible to automation triggers
Dependencies: None
Risk: LOW
```

### Easy Win #7: Email Approvers on New Approval Request

```
What to do: Add emailService.sendEmail() call in requestApproval() when a new PendingApproval is created
Files to modify: agents/approval.service.ts
Estimated effort: HOURS
Impact: Staff who aren't currently on the app get notified of pending approvals
Dependencies: SES configured (SES_FROM_EMAIL env var)
Risk: LOW
```

### Easy Win #8: Schedule Follow-Up Emails Automatically

```
What to do: Uncomment/add the follow-up job to the scheduler initialization
Files to modify: services/scheduler.service.ts
Estimated effort: HOURS
Impact: Payer follow-up emails fire automatically instead of requiring manual API call. Core credentialing function.
Dependencies: SES configured, follow-up email content tested
Risk: MEDIUM (need to verify email content quality before auto-sending to payers)
```

### Easy Win #9: Fix Expiration Email Branding

```
What to do: Change "Credentials Management System" to "Lanyard Health" in email template, add portal URL link
Files to modify: services/expiration.service.ts
Estimated effort: HOURS
Impact: Professional provider-facing emails instead of generic system name
Dependencies: None
Risk: LOW
```

### Easy Win #10: WebSocket Authorization on Workflow Subscription

```
What to do: Add DB check in subscribe:workflow handler to verify workflow belongs to user's practice
Files to modify: agents/websocket.ts
Estimated effort: HOURS
Impact: Closes multi-tenant data leak — currently any authenticated user can subscribe to any workflow
Dependencies: None
Risk: LOW (security fix)
```

---

## SECTION 8: AUTOMATION RATE CALCULATION

Based on the code audit, here is the honest automation rate:

### Steps Currently Handled Autonomously (~35%)

| Step | Automated? | Notes |
|------|-----------|-------|
| Document OCR extraction | Yes | Textract + Vision pipeline is real |
| Document classification | Yes | Claude Haiku classifier works |
| Credential auto-save (3 types) | Yes | License, board cert, malpractice |
| Credential auto-save (3 more types) | No | DEA, diploma, CME mappers exist but no save |
| Workflow planning | Yes | Orchestrator creates multi-step plans |
| Aetna form-fill (10 pages) | Yes | Full Playwright automation |
| Aetna form submit | No | Requires human review + click |
| CAQH roster sync | Yes | Nightly pull + apply |
| Expiring credential detection | Yes | 4h trigger + Claude alerts |
| Overdue follow-up detection | Yes | 4h trigger creates workflows |
| Follow-up email sending | No | Manual trigger only |
| Enrollment status monitoring | No | Fully stubbed |
| Portal submission (non-Aetna) | No | Manual only |
| Approval routing | Yes | Auto-routes, auto-expires |
| Exception analysis | Yes | Claude-powered, some auto-remediation |
| Directory verification | Partial | Aetna only |
| SLA breach detection | Partial | Works but slaTargetDate rarely populated |

### Summary

- **Autonomous (no human touch):** ~35% of workflow steps
- **Semi-automated (human-in-the-loop):** ~25% (Aetna review, approvals, manual adapter)
- **Fully manual:** ~40% (status monitoring, non-Aetna portals, follow-up emails, credential types without auto-save)

### Single Highest-Impact Change

**Implement real status polling for the monitor agent.** This single change would:
- Close the feedback loop on submitted enrollments (currently a black hole)
- Reduce the most time-consuming manual task (staff logging into payer portals to check status)
- Enable the stall detection and escalation logic that's already built but never fires
- Move ~15% of workflow steps from fully manual to automated

---

## RECOMMENDED ACTION PLAN (Top 10, Ordered by Impact-to-Effort)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 1 | Auto-trigger OCR on portal document upload | Hours | Every provider upload gets processed |
| 2 | Fix manual adapter expiry bug (approvals sit forever) | Hours | Unblocks stuck workflows |
| 3 | Auto-populate `slaTargetDate` on enrollment submission | Hours | Activates SLA breach detection system |
| 4 | Add `CREDENTIAL_CREATORS` for DEA, diploma, CME | Hours | 3 more doc types auto-save |
| 5 | Schedule follow-up emails automatically | Hours | Core credentialing function, currently manual |
| 6 | Email approvers on new approval requests | Hours | Staff know when action needed |
| 7 | Add malpractice to expiring credentials trigger | Hours | Catches expiring insurance |
| 8 | Fix WebSocket auth on workflow subscription | Hours | Security fix (multi-tenant leak) |
| 9 | Implement Aetna status polling in monitor agent | Days | Closes the biggest automation gap |
| 10 | Add workflow triggers + SLA badges to Command Center | Days | Makes matrix view actionable |

Items 1-8 are each a few hours of work. Items 9-10 are multi-day efforts but deliver the highest long-term value.
