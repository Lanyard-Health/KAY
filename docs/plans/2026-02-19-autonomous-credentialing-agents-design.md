# Autonomous Credentialing Agent System — Design Document

**Date:** 2026-02-19
**Status:** Approved
**Author:** Architecture Session (Claude + Kay)

---

## Table of Contents

1. [System Summary](#1-system-summary)
2. [Architectural Overview](#2-architectural-overview)
3. [Core Components & Agent Definitions](#3-core-components--agent-definitions)
4. [Concrete Workflow Example](#4-concrete-workflow-example)
5. [Integration Roadmap & Tech Stack](#5-integration-roadmap--tech-stack)
6. [Monitoring, Governance, and Safety](#6-monitoring-governance-and-safety)
7. [Deployment Plan & Milestones](#7-deployment-plan--milestones)

---

## 1. System Summary

### Definition: Autonomous Agents

In Lanyard Health's context, an **autonomous agent** is not a chatbot or copilot. It is a software entity that:

- **Observes** environment state (provider records, enrollment statuses, portal responses, document uploads)
- **Reasons** about what to do next using an LLM (Claude) with full domain context
- **Plans** multi-step workflows by decomposing goals into ordered tasks
- **Acts** by invoking tools (APIs, Puppeteer automation, database writes, document parsers)
- **Coordinates** with other specialized agents via job queues
- **Escalates** to humans when encountering high-risk actions or ambiguous situations

### Key Term Definitions

| Term | Definition |
|---|---|
| **Workflow** | A complete credentialing engagement: intake -> validation -> submission -> monitoring -> resolution. Tracked as an `AgentWorkflow` record with full state history. |
| **Agent** | A Claude-powered process with a specific role, a set of tools it can invoke, and a system prompt defining its expertise. Runs as a BullMQ job processor. |
| **Tool** | A function an agent can call: `queryProvider`, `submitToPortal`, `parseDocument`, `requestHumanApproval`, `sendNotification`. Wraps existing services. |
| **State** | The current status of a workflow and all its tasks, persisted in Postgres. Agents are stateless — they read state from DB at the start of each turn and write results back. |
| **Memory** | Two types: (1) **Workflow memory** — the execution log of what's been done, stored in `AgentEvent` table. (2) **Agent context** — the system prompt + relevant data passed to Claude on each invocation. |
| **Exception** | Any deviation from the expected path: missing documents, portal errors, rejections, timeouts, CAPTCHA challenges. Classified by severity and routed to the Exception Agent or human queue. |

### Domain Goal

> **Automatically complete credentialing workflows for a given provider with specified payers — from document intake through portal submission, status monitoring, and error resolution — with human approval gates before external submissions.**

The system handles:
- Single-payer enrollments (enroll Dr. X with Payer Y)
- Multi-payer batch enrollments (enroll Dr. X with all contracted payers)
- Re-credentialing workflows (renewal before expiration)
- Exception remediation (rejection analysis, missing document requests)

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Payer interaction model | Full coverage (API + RPA + manual fallback) | Covers all payers regardless of digital maturity |
| Orchestration | LLM-driven planner (Claude) | Most flexible, handles novel situations, dynamic replanning |
| Agent framework | Anthropic Agent SDK | Native to existing Claude stack, TypeScript, first-party support |
| Deployment | Design for scale, deploy simple (BullMQ/Redis) | Single instance initially, split to worker service via config when needed |
| Autonomy level | Approve-before-execute | Human gates on submissions and rejections; everything else autonomous |
| Document parsing | Existing stack + Claude Vision | Textract for PDFs, Claude Vision for scans, CAQH mapper for structured data |
| Internal architecture | Single-service, multi-queue | Per-agent queue isolation, built-in retries, clean split path |

---

## 2. Architectural Overview

### High-Level System Diagram

```
+-----------------------------------------------------------------------------+
|                          LANYARD HEALTH AGENT SYSTEM                        |
|                                                                             |
|  +-------------+    +------------------------------------------------------+|
|  |  Frontend   |    |              Express Backend                         ||
|  |  (React)    |<-->|  +---------------------------------------------+    ||
|  |             |    |  |  API Layer (existing + agent endpoints)      |    ||
|  | - Dashboard |    |  +----------------------+----------------------+    ||
|  | - Approval  |    |                         |                           ||
|  |   Queue UI  |    |  +----------------------v----------------------+    ||
|  | - Workflow   |    |  |  Agent Coordinator Service                  |    ||
|  |   Monitor   |    |  |  (creates workflows, enqueues jobs)         |    ||
|  | - Chat      |    |  +----------------------+----------------------+    ||
|  +------+------+    |                         |                           ||
|         | WebSocket  |  +----------------------v----------------------+    ||
|         +----------->|  |          BullMQ Queues (Redis)              |    ||
|                      |  |                                             |    ||
|                      |  |  +---------+ +----------+ +---------+      |    ||
|                      |  |  |orchestr-| |document- | |portal-  |      |    ||
|                      |  |  |ator-q   | |queue     | |queue    |      |    ||
|                      |  |  +----+----+ +----+-----+ +----+----+      |    ||
|                      |  |  +----+----+ +----+-----+ +----+----+      |    ||
|                      |  |  |monitor- | |exception-| |approval-|      |    ||
|                      |  |  |queue    | |queue     | |queue    |      |    ||
|                      |  |  +---------+ +----------+ +---------+      |    ||
|                      |  +----------------------+----------------------+    ||
|                      |                         |                           ||
|                      |  +----------------------v----------------------+    ||
|                      |  |        Agent Processors (Workers)           |    ||
|                      |  |                                             |    ||
|                      |  |  +---------------+  +----------------+     |    ||
|                      |  |  | Orchestrator  |  | Document       |     |    ||
|                      |  |  | Agent         |  | Parsing Agent  |     |    ||
|                      |  |  | (Claude+tools)|  | (Textract +    |     |    ||
|                      |  |  |               |  |  Claude Vision) |     |    ||
|                      |  |  +---------------+  +----------------+     |    ||
|                      |  |  +---------------+  +----------------+     |    ||
|                      |  |  | Portal        |  | Monitoring     |     |    ||
|                      |  |  | Interaction   |  | Agent          |     |    ||
|                      |  |  | Agent         |  | (polls status, |     |    ||
|                      |  |  | (API+Puppet.) |  |  detects chgs) |     |    ||
|                      |  |  +---------------+  +----------------+     |    ||
|                      |  |  +---------------+                         |    ||
|                      |  |  | Exception     |                         |    ||
|                      |  |  | Agent         |                         |    ||
|                      |  |  | (error triage |                         |    ||
|                      |  |  |  + remediate) |                         |    ||
|                      |  |  +---------------+                         |    ||
|                      |  +--------------------------------------------+    ||
|                      +----------------------------------------------------+|
|                                         |                                   |
|              +--------------------------+--------------------------+        |
|              |                          |                          |        |
|         +----v-----+            +-------v-------+          +------v--+     |
|         |PostgreSQL|            |    Redis      |          |   S3    |     |
|         |          |            |               |          |  (R2)   |     |
|         |-Provider |            |-BullMQ queues |          |         |     |
|         |-Workflow |            |-Job state     |          |-Docs    |     |
|         |-Tasks    |            |-Pub/sub       |          |-Uploads |     |
|         |-Events   |            |-Cache         |          |-Parsed  |     |
|         |-Approvals|            |               |          |         |     |
|         +----------+            +---------------+          +---------+     |
+---------------------------------------------------------------------------+
                                      |
                    +-----------------+-----------------+
                    |                 |                  |
             +------v------+  +------v------+  +-------v------+
             | Payer APIs  |  |Payer Portals|  | External     |
             | (CAQH,      |  | (Puppeteer  |  | Services     |
             |  Aetna FHIR,|  |  automation)|  | (Cognito,    |
             |  Availity)  |  |             |  |  SES, NPPES) |
             +-------------+  +-------------+  +--------------+
```

### Agent Interaction Pattern

Agents never call each other directly. All communication flows through:

1. **Job queues** — Agent A completes a task, the Orchestrator picks up the result and dispatches the next task to Agent B's queue
2. **Shared state** — All agents read/write to the same `AgentWorkflow`, `AgentTask`, and `AgentEvent` tables
3. **Orchestrator as hub** — After every agent completes a task, the Orchestrator is re-invoked to decide the next step

```
Agent A completes task
        |
        v
AgentTask.status = 'completed'
AgentEvent logged
        |
        v
orchestrator-queue receives "task_completed" event
        |
        v
Orchestrator Agent re-invoked with:
  - Original goal
  - Current workflow state (all tasks + statuses)
  - Latest event context
        |
        v
Claude decides next action:
  - Dispatch next planned task?
  - Replan due to new information?
  - Request human approval?
  - Mark workflow complete?
```

---

## 3. Core Components & Agent Definitions

### A. Credential Ingestion & Document Parsing Agent

**Purpose:** Convert unstructured documents (PDFs, images, spreadsheets, email attachments) into structured credential data.

**Queue:** `document-queue`

**Triggers:**
- Orchestrator dispatches a `parse_document` task
- User uploads a new document to a provider profile
- Bulk import initiated by admin

**Input schema:**
```json
{
  "taskId": "agt_task_abc123",
  "workflowId": "agt_wf_xyz789",
  "providerId": "provider_uuid",
  "documents": [
    {
      "documentId": "doc_uuid",
      "s3Key": "uploads/provider_uuid/medical-license.pdf",
      "fileName": "medical-license.pdf",
      "mimeType": "application/pdf",
      "uploadedAt": "2026-02-19T10:00:00Z"
    }
  ],
  "extractionHints": {
    "expectedTypes": ["license", "board_certification"],
    "providerNpi": "1234567890",
    "providerState": "TX"
  }
}
```

**Output schema:**
```json
{
  "taskId": "agt_task_abc123",
  "status": "completed",
  "results": [
    {
      "documentId": "doc_uuid",
      "documentType": "state_medical_license",
      "confidence": 0.95,
      "extractedData": {
        "licenseType": "state_medical",
        "licenseNumber": "TX-MED-123456",
        "state": "TX",
        "issueDate": "2023-01-15",
        "expirationDate": "2027-01-15",
        "status": "active",
        "holderName": "Jane A. Doe, MD"
      },
      "validationIssues": [],
      "rawTextExcerpt": "Texas Medical Board License #TX-MED-123456..."
    }
  ],
  "unmappedFields": [],
  "processingTimeMs": 3200
}
```

**Tools:**

| Tool | What it does |
|---|---|
| `downloadFromS3(s3Key)` | Retrieve document bytes from R2/S3 |
| `extractWithTextract(buffer, mimeType)` | AWS Textract for structured PDF extraction |
| `extractWithClaudeVision(buffer, prompt)` | Claude Vision API for scanned/image documents |
| `lookupNppes(npi)` | Cross-reference extracted NPI against NPPES registry |
| `validateCredentialData(type, data)` | Run Zod schema validation against internal credential schemas |
| `mapToInternalSchema(rawFields, type)` | Normalize field names/formats to Prisma model fields |

**Decision logic:**

```
Receive document
    |
    +-- Check mimeType
    |   +-- application/pdf        -> extractWithTextract()
    |   +-- image/*                -> extractWithClaudeVision()
    |   +-- text/csv, excel        -> direct field mapping
    |   +-- unknown                -> extractWithClaudeVision() as fallback
    |
    +-- Textract returns structured fields?
    |   +-- Yes + confidence > 0.85 -> mapToInternalSchema()
    |   +-- No or low confidence    -> re-extract with Claude Vision
    |
    +-- Cross-validate extracted NPI against NPPES
    |   +-- Match    -> proceed
    |   +-- Mismatch -> flag as validationIssue, don't block
    |
    +-- Run Zod validation on extracted data
    |   +-- Valid          -> return completed result
    |   +-- Invalid fields -> return with validationIssues[]
    |
    +-- If nothing extracted -> status: "failed", escalate to exception-queue
```

---

### B. Workflow Orchestrator Agent

**Purpose:** The "project manager" — receives a high-level credentialing goal, decomposes it into tasks, dispatches to specialized agents, tracks progress, and dynamically replans when things change.

**Queue:** `orchestrator-queue`

**Triggers:**
- New workflow created (user or API initiates enrollment)
- Any agent task completes, fails, or times out
- Human approval granted or denied
- Scheduled re-evaluation (stalled workflow detection)

**Input (initial invocation):**
```json
{
  "workflowId": "agt_wf_xyz789",
  "goal": "enroll_provider_with_payer",
  "providerId": "provider_uuid",
  "payerId": "payer_uuid",
  "priority": "normal",
  "requestedBy": "user_uuid"
}
```

**Input (task completion callback):**
```json
{
  "workflowId": "agt_wf_xyz789",
  "event": "task_completed",
  "taskId": "agt_task_abc123",
  "agentType": "document_parser",
  "result": {},
  "currentState": {
    "completedTasks": ["validate_completeness", "parse_documents"],
    "pendingTasks": ["prepare_submission"],
    "failedTasks": [],
    "blockedTasks": ["submit_to_portal"]
  }
}
```

**Output (planning decision):**
```json
{
  "workflowId": "agt_wf_xyz789",
  "decision": "dispatch_next",
  "reasoning": "Document parsing complete. All required credentials extracted. Next step: prepare submission package.",
  "newTasks": [
    {
      "type": "prepare_submission",
      "targetQueue": "portal-queue",
      "input": { "providerId": "...", "payerId": "...", "credentialData": {} },
      "dependsOn": [],
      "requiresApproval": false
    }
  ],
  "updatedPlan": [
    { "step": 1, "task": "validate_completeness", "status": "completed" },
    { "step": 2, "task": "parse_documents", "status": "completed" },
    { "step": 3, "task": "prepare_submission", "status": "dispatched" },
    { "step": 4, "task": "human_approval", "status": "pending", "gate": true },
    { "step": 5, "task": "submit_to_portal", "status": "blocked" },
    { "step": 6, "task": "schedule_monitoring", "status": "pending" }
  ]
}
```

**Tools:**

| Tool | What it does |
|---|---|
| `getProviderProfile(providerId)` | Full provider record with all credentials, enrollments, documents |
| `getPayerRequirements(payerId)` | Payer-specific field requirements, submission method, portal URL |
| `checkCredentialCompleteness(providerId, payerId)` | Compare credentials against payer requirements, return gaps |
| `dispatchTask(queue, taskInput)` | Enqueue a task to a specialized agent's queue |
| `requestHumanApproval(workflowId, context)` | Create PendingApproval, notify via WebSocket, pause workflow |
| `getWorkflowState(workflowId)` | Current state of all tasks in this workflow |
| `updateWorkflowPlan(workflowId, plan)` | Persist updated execution plan |
| `markWorkflowComplete(workflowId, outcome)` | Finalize workflow with success/failure/partial |
| `escalateToException(workflowId, issue)` | Route to exception-queue |

**Decision logic — LLM-driven planning:**

The Orchestrator does NOT follow a fixed pipeline. On each invocation, Claude receives the original goal, provider state, payer requirements, all task results, and the current plan. Claude outputs a decision: `dispatch_next | replan | request_approval | escalate | complete`.

If a document parse reveals a missing credential not in the original plan, the Orchestrator dynamically adds steps. If steps become unnecessary based on results, the Orchestrator skips them. This is the core intelligence of the system.

**Replanning example:**
```
Original plan: validate -> submit -> monitor

Task "validate_completeness" returns: { missing: ["dea_registration"] }

Orchestrator replans:
  1. validate_completeness        [completed]
  2. request_missing_document     [NEW - dispatched]
  3. parse_documents              [NEW - blocked by #2]
  4. re_validate_completeness     [NEW]
  5. prepare_submission           [moved]
  6. human_approval               [moved]
  7. submit_to_portal             [moved]
  8. schedule_monitoring          [moved]
```

**Guardrails:**
- Replan loop limit: 5 replans per workflow before auto-pause
- Token budget per workflow: 50,000 tokens default, checked before each Claude call
- Stale workflow detection: no progress in 48 hours -> mark stalled, notify admin

---

### C. Portal / API Interaction Agent

**Purpose:** Handle all external payer communication — API calls where available, browser automation where not, structured handoff to humans for manual-only payers.

**Queue:** `portal-queue`

**Triggers:**
- Orchestrator dispatches `submit_to_portal` or `check_portal_status` task
- Human approval granted for a pending submission

**Three submission methods — Payer Adapter pattern:**

```
Portal Interaction Agent
    |
    +-- payerAdapter = "aetna_fhir"
    |   +-- AetnaFhirAdapter (REST API)
    |       +-- authenticate via OAuth2
    |       +-- POST /fhir/v1/Practitioner
    |       +-- parse FHIR response
    |
    +-- payerAdapter = "caqh_directassure"
    |   +-- CaqhApiAdapter (existing caqh.service.ts)
    |       +-- authenticate via API key
    |       +-- addToRoster() / pullCredentials()
    |       +-- parse JSON response
    |
    +-- payerAdapter = "uhc_portal"
    |   +-- UhcPortalAdapter (Puppeteer RPA)
    |       +-- acquire browser semaphore
    |       +-- navigate to portal login
    |       +-- fill credentials, handle MFA
    |       +-- navigate to enrollment form
    |       +-- populate fields from submissionData
    |       +-- screenshot before submit (audit)
    |       +-- submit, capture confirmation
    |
    +-- payerAdapter = "manual_submission"
        +-- ManualAdapter (human handoff)
            +-- generate pre-filled PDF package
            +-- create PendingApproval with instructions
            +-- wait for human to mark complete
```

**Error handling:**

```typescript
async function executePortalSubmission(task: PortalTask): Promise<PortalResult> {
  const adapter = getPayerAdapter(task.payerAdapter);
  const maxRetries = adapter.type === 'api' ? 3 : 1; // no retry on RPA

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const preSnapshot = await adapter.capturePreSubmitState(task);
      await logEvent(task, 'pre_submit_snapshot', preSnapshot);

      const result = await adapter.submit(task.submissionData);

      await logEvent(task, 'submission_success', result);
      return { status: 'completed', submissionResult: result };

    } catch (error) {
      await logEvent(task, 'submission_error', {
        attempt, error: error.message, type: classifyError(error)
      });

      if (error instanceof SessionExpiredError) {
        await adapter.reauthenticate();
        continue;
      }
      if (error instanceof CaptchaDetectedError) {
        return escalateToHuman(task, 'captcha_detected', {
          screenshotKey: await adapter.takeScreenshot(),
          portalUrl: adapter.getPortalUrl(),
          fieldsAlreadyFilled: task.submissionData,
        });
      }
      if (error instanceof PortalMaintenanceError) {
        return reschedule(task, { delayMs: 2 * 60 * 60 * 1000 });
      }
      if (error instanceof TimeoutError && attempt < maxRetries) {
        await sleep(exponentialBackoff(attempt));
        continue;
      }

      return {
        status: 'failed',
        error: { type: classifyError(error), message: error.message },
        escalatedTo: 'exception-queue'
      };
    } finally {
      if (adapter.type === 'rpa') {
        await adapter.releaseBrowser();
      }
    }
  }
}
```

**Secure credential handling:**
- Portal credentials stored encrypted (AES-256-GCM, existing `crypto.ts`)
- Decrypted only in-memory for session duration
- MFA tokens handled via TOTP where possible, human escalation otherwise
- All portal sessions logged with entry/exit timestamps
- Screenshots taken pre-submit and post-submit for audit

---

### D. Monitoring & Status Tracking Agent

**Purpose:** Periodically check enrollment statuses, detect changes, advance workflows.

**Queue:** `monitor-queue`

**Triggers:**
- Orchestrator dispatches `schedule_monitoring` after successful submission
- Cron scheduler for batch status checks (default every 4 hours business hours)
- Manual "check now" from dashboard

**Polling strategy:**

```
Submission day 1-7:    check every 4 hours (business hours)
Submission day 8-14:   check every 8 hours
Submission day 15-30:  check every 24 hours
Submission day 31+:    check every 48 hours + flag as stalled

Rate limiting per payer:
  API payers:    max 10 checks/hour aggregate
  Portal payers: max 2 checks/hour (browser resource constraint)

On status change detected:
  approved               -> notify orchestrator -> workflow complete
  denied                 -> notify orchestrator -> route to exception agent
  pending                -> log check, continue schedule
  additional_info_needed -> notify orchestrator -> replan
```

**Batch monitoring (cron-driven):**

```typescript
async function batchStatusCheck() {
  const activeMonitors = await prisma.agentTask.findMany({
    where: {
      type: 'monitor_status',
      status: 'in_progress',
      nextCheckAt: { lte: new Date() }
    },
    orderBy: { nextCheckAt: 'asc' },
    take: 50
  });

  for (const monitor of activeMonitors) {
    await monitorQueue.add('check_status', {
      taskId: monitor.id,
      workflowId: monitor.workflowId,
      ...monitor.input
    }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 }
    });
  }
}
```

---

### E. Exception Handling Agent

**Purpose:** Detect, classify, and resolve errors. Uses Claude to analyze rejection reasons, suggest corrective actions, auto-remediate or escalate.

**Queue:** `exception-queue`

**Triggers:**
- Any agent task fails
- Monitoring agent detects denial or additional info request
- Portal agent encounters unrecoverable error
- Workflow stalled beyond threshold (48 hours)

**Exception categories and response patterns:**

| Category | Severity | Auto-remediable? | Response |
|---|---|---|---|
| `missing_document` | medium | Often yes | Search existing docs -> request from provider if not found -> resubmit |
| `invalid_data` | medium | Sometimes | Cross-check against NPPES/internal records -> correct -> resubmit |
| `expired_credential` | high | No | Alert provider + admin -> block workflow until renewed |
| `duplicate_submission` | low | Yes | Retrieve existing enrollment ID -> link to workflow -> skip resubmit |
| `portal_error` | varies | Sometimes | Classify (maintenance/bug/auth) -> retry/reschedule/escalate |
| `captcha_blocked` | low | No | Escalate to human with screenshot + pre-filled context |
| `payer_system_outage` | low | Yes | Schedule retry with backoff, notify admin if >24hrs |
| `unknown_denial` | high | No | Claude analyzes denial text -> suggests remediation -> human review required |
| `timeout_stall` | medium | Sometimes | Re-invoke monitoring agent -> if still stalled, escalate |

**Claude-driven denial analysis:**

```typescript
async function analyzeDenial(context: ExceptionContext): Promise<Analysis> {
  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 1500,
    system: `You are a healthcare credentialing expert analyzing enrollment denials.
Given the denial reason and provider context, classify the issue and suggest
specific remediation steps. Be precise about what documents or data corrections
are needed.`,
    messages: [{
      role: 'user',
      content: `
Denial reason: ${context.denialReason}
Denial code: ${context.denialCode}
Provider credentials on file: ${JSON.stringify(context.providerCredentials)}
Payer requirements: ${JSON.stringify(context.payerRequirements)}

Classify this denial and provide a remediation plan as JSON:
{
  "category": "missing_document|invalid_data|expired_credential|...",
  "severity": "low|medium|high|critical",
  "rootCause": "plain English explanation",
  "autoRemediable": boolean,
  "steps": [{ "action": "...", "description": "..." }]
}`
    }]
  });

  return JSON.parse(stripCodeFences(response.content[0].text));
}
```

---

### F. Human Oversight Interface

Not an agent — a frontend feature + API layer that agents interact with via `requestHumanApproval`.

**Components:**

| Component | Purpose |
|---|---|
| Approval Queue page | Pending approvals with full context, approve/deny buttons |
| Workflow Monitor page | Real-time view of active workflows, task states, timeline |
| Agent Event Log | Searchable audit trail of every agent action and decision |
| Exception Review panel | Unresolved exceptions with AI-suggested remediations |
| Override controls | Manually advance, pause, or cancel any workflow |

**WebSocket notifications:**
- Agent requests approval -> push to all admin/staff users
- Workflow changes state -> update live dashboard
- Exception escalated -> alert badge on dashboard

---

## 4. Concrete Workflow Example

**Scenario:** Staff triggers enrollment of Dr. Jane Doe (NPI: 1234567890) with Aetna. Dr. Doe has most credentials on file but is missing a malpractice certificate. Aetna uses FHIR API.

### Step 1: Workflow Initiation

```
POST /api/v1/agent/workflows
{ "goal": "enroll_provider_with_payer", "providerId": "prov_a1b2c3", "payerId": "payer_aetna_01" }
```

Agent Coordinator creates `AgentWorkflow` record, enqueues to `orchestrator-queue`.

### Step 2: Orchestrator Plans

Claude receives goal + provider data. Discovers malpractice insurance is NOT ON FILE (3/4 required credentials = 75% complete). Plans 8 steps starting with checking for unparsed uploads.

### Step 3: Document Agent Finds Existing Upload

Document Parsing Agent searches provider's S3 prefix. Finds `malpractice-cert-2025.pdf` (uploaded but never parsed). Extracts via Textract:
- Carrier: Medical Protective
- Policy: MP-2025-789012
- Coverage: $1M/$3M occurrence
- Period: 2025-07-01 to 2026-07-01
- Confidence: 0.92

Saves as `MalpracticeInsurance` record with `source: 'agent_parsed'`.

### Step 4: Orchestrator Replans — Skips Steps

Claude sees malpractice was found. Skips "request missing document" and "parse malpractice doc" steps. Advances to completeness validation. **This is LLM-driven planning in action.**

### Step 5: Completeness Validation Passes

All 4 required credentials present (score: 1.0). Warning: malpractice expires in 131 days.

### Step 6: Prepare FHIR Submission Package

Portal agent assembles Aetna FHIR Practitioner resource with all credentials mapped.

### Step 7: Human Approval Gate

`PendingApproval` created with full submission preview. WebSocket push to staff. Staff reviews credential list, warnings, FHIR payload preview. Clicks "Approve".

### Step 8: Submit to Aetna

Portal agent POSTs FHIR payload to `https://apif1.aetna.com/fhir/v1/Practitioner`. Receives 201 with confirmation ID `AETNA-ENR-2026-78901`. Enrollment status updated to `submitted`.

### Step 9: Monitoring Scheduled

Monitor agent begins polling: every 4 hours business hours, backoff after 14 days.

### Step 10: Denial Detected (Day 12)

Monitor detects status change to `rejected`: "Malpractice insurance coverage gap: no documentation for period 2024-01-01 to 2025-06-30. Continuous coverage required for past 3 years."

### Step 11: Exception Agent Analyzes

Claude analyzes denial. Root cause: Aetna requires 3 years continuous coverage. We submitted current policy (2025-2026) but not the prior policy (2024-2025). Remediation: request historical certificate from provider, then resubmit.

### Step 12: Orchestrator Replans for Recovery

Adds 6 remediation steps: notify provider -> wait for upload -> parse -> revalidate -> approval gate -> resubmit. Sends notification to provider with upload instructions.

### Complete Event Timeline

```
T+0:00    coordinator    workflow_created
T+0:00    orchestrator   plan_created (8 steps, 1 blocker)
T+0:01    orchestrator   task_dispatched -> document-queue
T+0:15    doc_parser     document_parsed (malpractice found, 0.92 conf)
T+0:15    orchestrator   plan_updated (skipped steps 2-3)
T+0:16    orchestrator   completeness_validated (4/4, score: 1.0)
T+0:45    portal         submission_package_prepared
T+0:45    orchestrator   approval_requested
T+3:04    human          approval_granted (staff_01)
T+3:05    portal         submission_sent (FHIR 201)
T+3:05    portal         confirmation_received (AETNA-ENR-2026-78901)
T+3:05    orchestrator   monitoring_scheduled
T+288:00  monitor        status_change_detected (denied)
T+288:00  exception      denial_analyzed (missing_document)
T+288:01  orchestrator   plan_updated (6 remediation steps)
T+288:01  orchestrator   provider_notified (document_request)
```

---

## 5. Integration Roadmap & Tech Stack

### Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Agent Runtime | Anthropic Agent SDK (TypeScript) | Native to existing Claude stack |
| LLM | Claude Sonnet (reasoning), Claude Haiku (classification) | Sonnet for orchestrator/exception, Haiku for routing/detection |
| Job Queue | BullMQ + Redis (existing) | Per-queue concurrency, retries, delayed jobs, rate limiting |
| Database | PostgreSQL + Prisma (existing) | New tables for workflow state |
| Document Parsing | AWS Textract (existing) + Claude Vision API | No new dependencies |
| Browser Automation | Puppeteer (existing) | Per-payer page object adapters |
| Real-time | Socket.io | Push approvals, workflow updates to dashboard |
| File Storage | Cloudflare R2 via S3 API (existing) | Documents, screenshots, audit artifacts |
| Auth | AWS Cognito (existing) | No change |
| Monitoring | Structured logging + Prometheus (prom-client) | Agent-specific metrics |

### New Dependencies

| Package | Purpose |
|---|---|
| `bullmq` | Job queue with Redis backend |
| `@anthropic-ai/agent` | Agent SDK with tool_use loop |
| `socket.io` | WebSocket for real-time dashboard |
| `prom-client` | Prometheus metrics collection |

### File Structure

```
packages/backend/src/
+-- agents/
|   +-- orchestrator.agent.ts
|   +-- document.agent.ts
|   +-- portal.agent.ts
|   +-- monitor.agent.ts
|   +-- exception.agent.ts
|   +-- coordinator.service.ts
|   +-- queues.ts
|   +-- workers.ts
|
+-- payer-adapters/
|   +-- base.adapter.ts
|   +-- aetna-fhir.adapter.ts
|   +-- caqh-directassure.adapter.ts
|   +-- uhc-portal.adapter.ts
|   +-- manual.adapter.ts
|   +-- registry.ts
|
+-- agents/tools/
    +-- provider.tools.ts
    +-- document.tools.ts
    +-- portal.tools.ts
    +-- approval.tools.ts
    +-- notification.tools.ts
```

### Payer Adapter Interface

```typescript
export interface PayerAdapter {
  payerId: string;
  payerName: string;
  submissionMethod: 'api' | 'rpa' | 'manual';

  supportsStatusCheck: boolean;
  supportsDirectSubmission: boolean;
  requiresCredentials: boolean;

  authenticate(): Promise<void>;
  getRequiredFields(): PayerFieldRequirement[];
  validateSubmission(data: SubmissionData): ValidationResult;
  submit(data: SubmissionData): Promise<SubmissionResult>;
  checkStatus(confirmationId: string): Promise<StatusResult>;
  disconnect(): Promise<void>;
}
```

Adding a new payer = implementing this interface + registering in `registry.ts`. No agent code changes.

### Database Schema Additions

```prisma
model AgentWorkflow {
  id              String              @id @default(uuid())
  goal            String
  goalParams      Json
  status          AgentWorkflowStatus
  priority        String              @default("normal")
  plan            Json?

  providerId      String
  provider        Provider            @relation(fields: [providerId], references: [id])
  payerId         String?
  payer           Payer?              @relation(fields: [payerId], references: [id])
  enrollmentId    String?
  enrollment      PayerEnrollment?    @relation(fields: [enrollmentId], references: [id])

  requestedBy     String
  requestedByUser User                @relation(fields: [requestedBy], references: [id])

  tasks           AgentTask[]
  events          AgentEvent[]
  approvals       PendingApproval[]

  startedAt       DateTime            @default(now())
  completedAt     DateTime?
  cancelledAt     DateTime?
  cancelReason    String?

  totalTokensUsed Int                 @default(0)
  totalDurationMs Int?

  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  @@index([status])
  @@index([providerId])
  @@index([requestedBy])
}

model AgentTask {
  id               String          @id @default(uuid())
  workflowId       String
  workflow         AgentWorkflow   @relation(fields: [workflowId], references: [id])

  type             String
  agentType        String
  status           AgentTaskStatus

  input            Json
  output           Json?
  error            Json?

  stepNumber       Int
  dependsOn        String[]
  requiresApproval Boolean         @default(false)

  bullmqJobId      String?
  queue            String?
  attempts         Int             @default(0)
  maxAttempts      Int             @default(3)

  queuedAt         DateTime?
  startedAt        DateTime?
  completedAt      DateTime?

  tokensUsed       Int             @default(0)

  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

  @@index([workflowId, status])
  @@index([agentType, status])
  @@index([bullmqJobId])
}

model AgentEvent {
  id          String        @id @default(uuid())
  workflowId  String
  workflow    AgentWorkflow @relation(fields: [workflowId], references: [id])
  taskId      String?

  agent       String
  action      String
  data        Json

  level       String        @default("info")

  timestamp   DateTime      @default(now())

  @@index([workflowId, timestamp])
  @@index([agent, action])
}

model PendingApproval {
  id            String        @id @default(uuid())
  workflowId    String
  workflow      AgentWorkflow @relation(fields: [workflowId], references: [id])
  taskId        String

  type          String
  status        ApprovalStatus

  context       Json

  requestedAt   DateTime      @default(now())
  expiresAt     DateTime

  decidedBy     String?
  decidedByUser User?         @relation(fields: [decidedBy], references: [id])
  decidedAt     DateTime?
  decisionNotes String?

  @@index([status])
  @@index([workflowId])
}

model PayerAdapterConfig {
  id               String  @id @default(uuid())
  payerId          String  @unique
  payer            Payer   @relation(fields: [payerId], references: [id])

  adapterType      String
  submissionMethod String

  config           Json
  credentials      Json?

  requiredFields   Json

  isActive         Boolean  @default(true)
  lastTestedAt     DateTime?
  lastTestResult   String?

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

enum AgentWorkflowStatus {
  planning
  active
  paused
  waiting_approval
  completed
  failed
  cancelled
}

enum AgentTaskStatus {
  pending
  queued
  in_progress
  completed
  failed
  skipped
  cancelled
}

enum ApprovalStatus {
  pending
  approved
  denied
  expired
}
```

### API Routes

```
POST   /api/v1/agent/workflows                    Create new workflow
GET    /api/v1/agent/workflows                    List workflows (filtered)
GET    /api/v1/agent/workflows/:id                Get workflow detail + tasks
PATCH  /api/v1/agent/workflows/:id                Pause/resume/cancel
GET    /api/v1/agent/workflows/:id/events         Event timeline
GET    /api/v1/agent/workflows/:id/plan           Current execution plan

GET    /api/v1/agent/approvals                    List pending approvals
POST   /api/v1/agent/approvals/:id/decide         Approve or deny
GET    /api/v1/agent/approvals/:id                Get approval detail

GET    /api/v1/agent/adapters                     List configured adapters
GET    /api/v1/agent/adapters/:payerId            Get adapter config
POST   /api/v1/agent/adapters/:payerId/test       Test adapter connectivity

GET    /api/v1/agent/metrics                      Dashboard metrics
GET    /api/v1/agent/metrics/tokens               Token usage breakdown
```

### HIPAA Compliance

| Concern | Approach |
|---|---|
| PHI in LLM calls | System prompts forbid storing/repeating SSNs, DOBs, tax IDs. Tools pass only IDs — agents fetch PHI at execution time, never in conversation history. |
| Audit trail | Every action in `AgentEvent` — immutable, append-only, timestamped. 2-year retention. |
| Encryption at rest | Portal credentials AES-256-GCM. DB encrypted via Render. R2 encrypted by default. |
| Encryption in transit | All external calls over TLS. Redis TLS in production. |
| Access control | Workflows inherit requesting user's practice scope. Agents cannot access cross-practice data. |
| Minimum necessary | Agents receive only data required for their specific task. |
| BAA coverage | Anthropic (Claude API), AWS (Cognito, Textract, S3), Render, Cloudflare R2 — all support BAAs. |

---

## 6. Monitoring, Governance, and Safety

### Logging Hierarchy

```
Workflow Level (AgentWorkflow)
  |  "Enroll Dr. Doe with Aetna" - status, plan, duration, outcome
  |
  +-- Task Level (AgentTask)
  |     "parse_document" - input, output, agent, timing, attempts
  |
  +-- Event Level (AgentEvent)
        Every discrete action, decision, and state change
        Immutable, append-only, timestamped to millisecond
```

**Never logged:** SSNs, tax IDs, dates of birth, portal passwords, raw document content containing PHI.

### Human-in-the-Loop Policies

| Policy | Rule |
|---|---|
| Submission gate | Every first submission requires human approval |
| Resubmission gate | Every resubmission after denial requires approval |
| Low-confidence gate | Credential modifications with confidence < 0.90 require review |
| High-confidence auto-save | Extractions >= 0.90 saved with `source: 'agent_parsed'`, reviewable after the fact |
| Manual payer fallback | No adapter -> workflow pauses with pre-assembled document package |
| Escalation timeout | No action in 24hrs -> notify all admins. 48hrs -> urgent flag. |

### Escalation Levels

```
Level 0: Normal — Agent handles autonomously. Logged for audit.

Level 1: Uncertainty — Confidence < 0.90, unknown fields.
  Agent flags items, workflow continues, flagged items shown in approval.

Level 2: Approval required — Portal submission, resubmission, credential correction.
  Workflow pauses. WebSocket notification to staff.

Level 3: Agent blocked — CAPTCHA, MFA, broken selectors.
  Workflow pauses. Human task created with screenshots. Admin notified.

Level 4: System failure — Agent crash, budget exhausted, DB down.
  Workflow failed. All tasks cancelled. Admin alerted. DLQ preserves failed job.
```

### Runaway Agent Guardrails

| Guardrail | Mechanism |
|---|---|
| Token ceiling per workflow | 50,000 tokens default. Orchestrator checks before each call. Exceeded -> pause. |
| Replan loop limit | 5 replans max -> pause and escalate |
| Task attempt limit | 3 attempts per task (BullMQ enforced) -> fail -> exception agent |
| Workflow timeout | 30 days no progress -> stalled. Cron detects and notifies. |
| Concurrent workflow limit | 10 active per practice. Configurable. |
| RPA concurrency | Puppeteer semaphore: max 1 browser, queue 3. |
| Cost alerting | Alert at 80% daily budget. Hard stop at 100%. |

### Metrics

**Operational (Prometheus):**

| Metric | Type |
|---|---|
| `agent_workflows_total` | Counter by status/goal |
| `agent_workflow_duration_seconds` | Histogram |
| `agent_tasks_total` | Counter by agent_type/status |
| `agent_task_duration_seconds` | Histogram by agent_type |
| `agent_tokens_used_total` | Counter by agent_type |
| `agent_approvals_pending` | Gauge |
| `agent_approval_response_seconds` | Histogram |
| `agent_exceptions_total` | Counter by category/severity |
| `agent_portal_submissions_total` | Counter by payer/method |
| `agent_portal_success_rate` | Gauge per adapter (7-day rolling) |
| `bullmq_queue_depth` | Gauge per queue |
| `bullmq_queue_latency_seconds` | Histogram |

**Business KPIs:**

| KPI | Target |
|---|---|
| Workflow completion rate | > 85% without human intervention beyond approval gate |
| Time to submission (API payers) | < 15 minutes |
| Time to submission (RPA payers) | < 30 minutes |
| Denial recovery rate | > 70% auto-remediated |
| Human approval turnaround | < 4 hours median |
| Document parsing accuracy | > 90% fields correct |
| Cost per enrollment | < $2.00 in LLM tokens |

### Safety Principles

```
 1. NEVER submit to a payer without human approval
 2. NEVER modify credentials with confidence < 0.90 without human review
 3. NEVER expose PHI in logs, LLM prompts, or errors
 4. NEVER retry a failed portal submission more than 3 times without human review
 5. ALWAYS capture pre/post screenshots for RPA actions
 6. ALWAYS log reasoning behind every orchestrator decision
 7. ALWAYS enforce token budgets — pause, never silently fail
 8. ALWAYS maintain practice-scoped data isolation
 9. PREFER pausing a workflow over making an uncertain decision
10. ASSUME portal layouts will change — detect and escalate, never guess
```

---

## 7. Deployment Plan & Milestones

### Sprint Roadmap (13 Weeks)

```
Phase 1        Phase 2        Phase 3        Phase 4        Phase 5        Phase 6
Foundation  -> Document    -> Portal Agent-> Full        -> Exception  -> Production
& Queue        Agent         + Approval     Orchestr.      + Monitor     Hardening
Infra                        Gate           Loop           Agent         & Scale
(2 weeks)    (2 weeks)     (3 weeks)     (2 weeks)     (2 weeks)     (2 weeks)
```

### Phase 1: Foundation & Queue Infrastructure (Weeks 1-2)

- Add BullMQ + Socket.io dependencies
- Prisma schema migration (AgentWorkflow, AgentTask, AgentEvent, PendingApproval, PayerAdapterConfig)
- Queue definitions (6 named queues on Redis)
- Worker skeleton (processors log job receipt)
- Agent Coordinator service (POST /api/v1/agent/workflows)
- Basic agent loop (orchestrator calls Claude with one tool)
- WebSocket setup (Socket.io, authenticated subscriptions)
- Agent API routes (list/get workflows, events)

**Gate:** Create workflow via API -> orchestrator picks up -> calls Claude -> event received via WebSocket.

### Phase 2: Document Parsing Agent (Weeks 3-4)

- Document agent with tools (S3, Textract, Claude Vision, validation, mapping)
- Document type detection via Claude Haiku
- PDF extraction pipeline (Textract -> schema mapping)
- Image extraction pipeline (Claude Vision -> schema mapping)
- Confidence scoring (0.90 threshold for auto-save)
- Save extracted credentials with `source: 'agent_parsed'`
- Wire into orchestrator dispatch/completion loop

**Gate:** Upload scanned license -> agent extracts all fields at 0.90+ confidence -> saved as credential.

### Phase 3: Portal Agent + Approval Gate (Weeks 5-7)

- Payer adapter base interface
- CAQH DirectAssure adapter (wraps existing service)
- Aetna FHIR adapter (OAuth2, FHIR resource assembly)
- Manual fallback adapter (document package generation)
- Adapter registry
- Portal agent (submission via adapter pattern)
- Human approval system (PendingApproval CRUD, WebSocket push, frontend page)
- Approval gate in orchestrator (pause/resume on approval)
- Error handling (retries, session expiry, CAPTCHA, maintenance)
- One Puppeteer RPA adapter as proof of concept

**Gate:** Full submission flow with approval gate working end-to-end. Manual adapter creates downloadable package.

### Phase 4: Full Orchestrator Loop (Weeks 8-9)

- Complete orchestrator tool suite (9 tools)
- Planning prompt engineering (tested against 10+ scenarios)
- Replan loop with guard (5 replan limit)
- Conditional step execution (skip steps based on results)
- Multi-payer batch workflows (parent + child sub-workflows)
- Workflow pause/resume/cancel from admin
- Token budget enforcement per workflow
- Stale workflow detection (48hr cron)

**Gate:** Full Dr. Doe scenario end-to-end with dynamic replanning.

### Phase 5: Exception Agent + Monitoring Agent (Weeks 10-11)

- Monitoring agent (polls status, detects changes, backoff schedule)
- Rate limiting per payer adapter
- Exception agent (Claude-powered denial analysis, categorization, remediation)
- All 9 exception category handlers
- Auto-remediation for known patterns
- Denial -> replan -> resubmit loop
- Notification system for exceptions (WebSocket + email escalation)

**Gate:** Submit -> denial detected -> analyzed -> remediated -> resubmitted. Full recovery loop.

### Phase 6: Production Hardening (Weeks 12-13)

- Prometheus metrics (all operational metrics)
- Workflow monitor dashboard (frontend)
- Approval queue dashboard (frontend)
- Exception review panel (frontend)
- Agent event audit viewer (frontend)
- Cost tracking dashboard
- Load testing (50 concurrent workflows)
- Dead letter queue handling
- Graceful shutdown
- Documentation (API docs, adapter dev guide, ops runbook)

**Gate:** 5+ real enrollments processed. Dashboard live. Metrics tracking.

### Post-Launch Roadmap

| Priority | Item |
|---|---|
| High | RPA adapters for top 5 payers (UHC, Cigna, BCBS, Humana, Centene) |
| High | Re-credentialing automation (trigger 90 days before expiration) |
| Medium | Bulk enrollment ("Enroll all providers with Payer X") |
| Medium | Provider self-service workflow status in portal |
| Low | Predictive analytics (approval likelihood per payer) |
| Low | Cross-practice benchmarking (anonymized payer turnaround metrics) |
