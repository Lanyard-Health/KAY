# SOC 2 Readiness Checklist — Lanyard Health

**Built:** 2026-08-08
**Scope:** Security (Common Criteria CC1–CC9). The mandatory category. Availability / Confidentiality / Processing Integrity / Privacy are opt-in and **not assessed here**.
**Source:** Vanta's *SOC 2 Compliance Checklist* (4pp, in iCloud) gives the process — pick Type 1 vs 2, buy tooling, hire an AICPA auditor, re-certify annually. It names CC1–CC9 but contains no controls. This document is the missing middle: the per-control list with Lanyard's actual evidence attached.

## How to read the status column

| Symbol | Meaning |
|---|---|
| ✅ | Evidence exists in code/infra. Cited below. Not the same as "an auditor accepted it." |
| ⚠️ | Partial — control exists but has a named hole. |
| ❌ | Gap — nothing exists. |
| 📝 | Non-technical. Only Kay can answer; no amount of code reading produces it. |

**Nothing here is a compliance determination.** Only a licensed CPA firm decides whether a control passes. "✅" means *evidence to hand the auditor exists*, nothing more.

**Evidence dates matter.** Items marked *(verified 2026-08-08)* were checked live while writing this. Items marked *(documented YYYY-MM-DD)* come from a runbook written on that date and were **not** re-verified — treat as a claim to re-confirm before an audit.

---

## The headline

Engineering controls are genuinely strong. Organizational controls are near-empty.

| Criterion | Ready |
|---|---|
| CC6 Logical & Physical Access | Strong — the best-covered area |
| CC7 System Operations | Strong on detection/backup, weak on documented process |
| CC8 Change Management | Strong tooling, one documented-vs-actual mismatch |
| CC1 Control Environment | Near-empty |
| CC2 Communication & Information | Near-empty |
| CC3 Risk Assessment | Empty |
| CC4 Monitoring Activities | Partial |
| CC5 Control Activities | Empty (it's the mapping doc, which doesn't exist) |
| CC9 Risk Mitigation | Empty |

Roughly: the code is audit-ready, the company is not. That is the normal position for a solo-founder company and it is fixable with writing, not engineering.

---

## CC1 — Control Environment

Integrity, board oversight, org structure, competence, accountability.

| # | Control | Status | Evidence / what's missing |
|---|---|---|---|
| 1.1 | Code of conduct exists, distributed, acknowledged | ❌📝 | No such document in repo. Solo founder — still needs to exist as a signed artifact before hiring. |
| 1.2 | Board / independent oversight of security | 📝 | No board documented. Auditors accept an advisor or designated oversight role for small companies — needs naming in writing. |
| 1.3 | Org chart + defined security responsibilities | ❌📝 | Nothing found. Minimum viable version: one page naming who owns security (you), who is backup, what happens if you're unavailable. |
| 1.4 | Background checks on personnel | 📝 | No hires yet. Policy must exist *before* the first hire, not after. |
| 1.5 | Security awareness training, tracked annually | ❌📝 | Nothing found. Applies to you too — auditors ask for your own completion record. |
| 1.6 | Performance/accountability process tied to security | 📝 | N/A while solo; required at first hire. |

---

## CC2 — Communication and Information

Internal and external communication of security commitments.

| # | Control | Status | Evidence / what's missing |
|---|---|---|---|
| 2.1 | Information security policy, written and approved | ❌ | No `SECURITY.md`, no policy doc anywhere in repo *(verified 2026-08-08 — searched `docs/`, root, `.github/`)*. This is the single highest-leverage missing document; several other controls reference it. |
| 2.2 | Policies communicated to personnel | ❌📝 | Blocked on 2.1. |
| 2.3 | External channel for reporting security issues | ❌ | No `SECURITY.md`, no `security@lanyardhealth.com` disclosure path documented. Cheap to fix. |
| 2.4 | Security commitments communicated to customers | ⚠️📝 | Marketing site exists; no published trust/security page. Needed for the enterprise sales motion SOC 2 is *for*. |
| 2.5 | Internal incident/issue reporting channel | ✅ | Bug Monitor pipeline: runtime errors → sanitized → Linear issue + Slack/email alert. `packages/backend/src/services/bug-monitor/`, `SLACK_ALERT_WEBHOOK_URL` + `BUG_ALERT_EMAIL` set in prod *(env var names verified 2026-08-08)*. |

---

## CC3 — Risk Assessment

Objectives, risk identification, fraud consideration, change impact.

| # | Control | Status | Evidence / what's missing |
|---|---|---|---|
| 3.1 | Documented risk assessment, refreshed annually | ❌📝 | None exists. Auditors will ask on day one. |
| 3.2 | Risk register with owner + likelihood + impact + treatment | ❌ | The June 2026 security audit punch list is the closest thing and is not in that format. |
| 3.3 | Fraud risk explicitly considered | ❌📝 | Not documented. In this business the honest entries are: insider misuse of provider PII, and a compromised partner API key. |
| 3.4 | Risk of significant change assessed | ⚠️ | Happens informally per-PR. Not written down as a process. |

---

## CC4 — Monitoring Activities

Ongoing evaluation that controls still work.

| # | Control | Status | Evidence / what's missing |
|---|---|---|---|
| 4.1 | Continuous control monitoring | ⚠️📝 | No compliance-automation tool connected. This is the Vanta-shaped hole — their checklist assumes you bought it. Not required; a manual quarterly review with dated notes also satisfies it. |
| 4.2 | Application error monitoring | ✅ | Sentry on both tiers: `@sentry/node ^10.38.0` (backend), `@sentry/react ^10.54.0` (frontend); `SENTRY_DSN` present in prod *(verified 2026-08-08)*. |
| 4.3 | Deployment/uptime monitoring | ✅ | `render-deploy-watchdog.yml` GitHub Action, 15-min cron, self-heals missed Render webhooks. |
| 4.4 | Periodic access review, documented | ⚠️ | Module exists: `packages/backend/src/modules/access-review/{accessReview.routes,accessReview.service,accessReview.types}.ts` + frontend page *(verified 2026-08-08)*. **Known hole:** it enumerates `prisma.user` only — future partner API keys would be invisible to it. Also no evidence a review has actually been *run and signed off* on a schedule. |
| 4.5 | Deficiencies tracked to resolution | ⚠️ | Linear is the tracker and it works. Not formalized as "security findings get an SLA." |

---

## CC5 — Control Activities

Selection and deployment of controls; policy-to-technology mapping.

| # | Control | Status | Evidence / what's missing |
|---|---|---|---|
| 5.1 | Controls selected to mitigate identified risks | ❌ | Cannot exist until CC3 does. The controls are real; the *mapping document* is what's missing. |
| 5.2 | Technology controls documented | ⚠️ | Three good runbooks exist (audit retention, DB backup/restore, Cognito MFA). No index tying them to criteria. **This checklist is the start of that index.** |
| 5.3 | Segregation of duties | ⚠️📝 | Structurally impossible while solo — auditors accept a documented compensating control (e.g. all prod changes leave a PR trail + immutable audit log). Needs writing down. |

---

## CC6 — Logical and Physical Access

The largest criterion and Lanyard's strongest area.

| # | Control | Status | Evidence / what's missing |
|---|---|---|---|
| 6.1 | Identity management with unique accounts | ✅ | AWS Cognito; `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID` in prod *(verified 2026-08-08)*. No shared logins. |
| 6.2 | MFA enforced | ✅ | **Require MFA**, Authenticator + Email, live since PR #345 *(documented 2026-06-09, `docs/cognito-mfa-runbook.md:15` — re-verify before audit)*. |
| 6.3 | Role-based access control | ✅ | 5 roles (`admin`, `lanyard_staff`, `credentialing_staff`, `provider`, `practice_admin`) with per-route `authorize()` guards. |
| 6.4 | Multi-tenant isolation | ✅ | `req.practiceScope` with deny-all sentinel `'__no_access__'`; dedicated blocking CI job `tenant-scope` in `security-scan.yml:872`. **Known limit:** that gate is a per-file substring check and can pass an unscoped file — the July 2026 per-handler audit found a real leak it couldn't see. |
| 6.5 | Encryption in transit | ✅ | TLS via Cloudflare → Render. HSTS/CSP via `helmet` at `packages/backend/src/index.ts:123`; CORS allow-list at `index.ts:143` (prod: `portal.lanyardhealth.com` only). |
| 6.6 | Encryption at rest for sensitive fields | ✅ | AES-256-GCM in `packages/backend/src/utils/crypto.ts` *(verified 2026-08-08)*; `ENCRYPTION_KEY` present in prod. Covers SSN, tax ID, banking, DEA/CDS. |
| 6.7 | Encryption gap — provider DOB | ❌ | `dateOfBirth` stored **plaintext** on `ProviderProfile` while `PracticeOwner` DOB is encrypted. Approved 2026-06-13, never built. ~12 call sites + two-table migration. **Highest-severity open technical item.** |
| 6.8 | Access to unmasked PII is logged | ✅ | `logSensitiveFieldReveal()` in `audit.middleware.ts:258` — **awaits** the write and re-throws, so no audit row ⇒ no disclosure (fail-closed, has a test). Shipped PR #386. |
| 6.9 | Sensitive reads produce an audit trail | ✅ | `SENSITIVE_READ_PATHS` at `audit.middleware.ts:52` covers providers / enrollments / documents / partner. Fixed 2026-08-08 (PR #538) — this was silently broken beforehand by Express router-relative path rewriting. |
| 6.10 | Audit log immutability | ✅ | Runtime DB role `lanyard_app` has INSERT/SELECT only on `audit_logs`; zero `update`/`delete` call sites *(documented 2026-06-09, `docs/audit-log-retention-policy.md`)*. |
| 6.11 | Least-privilege DB access | ✅ | Split roles: `DATABASE_URL` (runtime, restricted) vs `DATABASE_URL_ADMIN` (migrations only) *(both present in prod, verified 2026-08-08)*. |
| 6.12 | Secrets management | ✅ | All 55 prod secrets in Render env vars, never in repo. `.gitleaks.toml` present + blocking `gitleaks` CI job at `security-scan.yml:14`. |
| 6.13 | Credential rotation policy | ❌📝 | No documented rotation cadence for the 55 prod secrets. Known outstanding: Defacto key rotation. |
| 6.14 | User offboarding / deprovisioning | ⚠️📝 | Technically possible (deactivate Cognito user + `isActive` flag). No documented procedure, no SLA, no evidence of a drill. |
| 6.15 | Physical access controls | 📝 | Fully inherited from Render + AWS + Cloudflare. Satisfied by collecting **their** SOC 2 reports — see CC9. |
| 6.16 | Data disposal / secure deletion | ❌📝 | No documented procedure for provider data deletion on customer offboarding. Soft-delete is used; hard-delete policy undefined. |
| 6.17 | Rate limiting / brute-force protection | ⚠️ | `apiLimiter` mounted at `index.ts:176` but **inside a production-only conditional** — staging never exercises it. Redis-backed via `REDIS_URL` (present); without Redis it silently degrades to per-process memory, making the real limit `60 × instances`. |
| 6.18 | Known access-control gap — OCR review queue | ❌ | Lists provider names/NPIs across practice boundaries (`document.routes.ts`). Found in the July 2026 per-handler tenant audit. Open. |
| 6.19 | `trust proxy` correctness | ⚠️ | `app.set('trust proxy', 1)` at `index.ts:106` — likely wrong for a 2-hop Cloudflare → Render chain, which degrades rate-limiting **and** the IP address recorded in every audit log row. Cheap to fix, affects evidence quality. |

---

## CC7 — System Operations

Detect, respond, recover.

| # | Control | Status | Evidence / what's missing |
|---|---|---|---|
| 7.1 | Vulnerability detection | ✅ | Blocking `npm-audit` job (`security-scan.yml:84`), `semgrep` (`:305`), `eslint-security` (`:202`), plus GitHub Dependabot alerts. |
| 7.2 | Vulnerability remediation, with SLA | ⚠️ | Remediation happens (PostCSS closed 2026-08-08, PR #539). No written SLA — auditors ask "critical within N days." Current open set: 16 high/critical, all assessed as dev-only or authenticated-DoS. |
| 7.3 | Dependency update automation | ⚠️ | No `.github/dependabot.yml` *(verified absent 2026-08-08)* — so no automated update PRs configured in-repo. Alerts are a separate GitHub toggle; confirm it in the UI. |
| 7.4 | Secret scanning | ✅ | `.gitleaks.toml` + blocking CI job. |
| 7.5 | Anomaly / error detection | ✅ | Sentry + Bug Monitor with PII sanitization before anything leaves the system (`bug-monitor/sanitizer.ts`, sanitizer tests mandatory per CLAUDE.md). |
| 7.6 | Incident response plan | ❌📝 | **Nothing exists.** Highest-priority non-technical gap after CC2.1. Needs: severity levels, who is notified, breach-notification triggers (all 50 states apply to SSN/DOB/banking), and a communications template. |
| 7.7 | Incident response tested | ❌📝 | Blocked on 7.6. A tabletop exercise with dated notes satisfies it. |
| 7.8 | Backups configured | ✅ | Render PITR, 7-day window, continuous WAL streaming. RPO ≤5s *(documented 2026-06-09)*. |
| 7.9 | **Restore actually tested** | ✅ | Real PITR drill run on staging 2026-06-09: `recovery_in_progress → creating → available` in ~3 min, RTO ~5 min observed. `docs/db-backup-restore-runbook.md`. **This is the control most companies fail and you already have it.** |
| 7.10 | Log retention policy, written and enforced | ✅ | 7 years hot, `docs/audit-log-retention-policy.md`. **Caveat:** that doc is now stale in two places — it claims sensitive-read logging worked since PR #340 (it did not; that was the bug fixed 2026-08-08) and lists 3 audited paths where there are now 4. Fix before showing an auditor. |
| 7.11 | Cold archive for logs | ⚠️ | Planned (R2, >90 days), not built. Fine — the written policy is what's assessed. |

---

## CC8 — Change Management

| # | Control | Status | Evidence / what's missing |
|---|---|---|---|
| 8.1 | All changes go through PR | ✅ | Server-side branch protection on `master` with `enforce_admins: true`, `allow_force_pushes: false`, `allow_deletions: false` *(verified live 2026-08-08 via GitHub API)*. Plus a redundant local pre-push hook. |
| 8.2 | Changes reviewed before merge | ⚠️ | **`required_approving_review_count: 0`** *(verified live 2026-08-08)*. This is a deliberate, documented position, not a gap: GitHub does not permit self-approval, so requiring one approval would lock the sole engineer out of merging entirely. Accurately described in `CLAUDE.md:324` and Information Security Policy §8, with three compensating controls named. **Corrected 2026-08-09:** originally graded ❌ on the basis of a stale "At least 1 approval" line in a personal instructions file outside the repo; that file has been fixed and was never an audit artifact. Revisit at first engineering hire. |
| 8.3 | Automated testing gates merge | ⚠️ | `Security Gate` is the one required status check. But the backend test job runs with `\|\| true` — unit failures never block a merge. Only `tenant-scope`, `gitleaks`, `npm-audit`, `schema-drift`, `boot-smoke` genuinely gate. |
| 8.4 | Separate environments | ✅ | Prod (`kay-backend`) / staging (`kay-backend-staging` + `staging.lanyardhealth.com`, separate Cognito pool) / local Docker. |
| 8.5 | Schema changes controlled | ✅ | Blocking `schema-drift` job (`security-scan.yml:408`); migration required with every `schema.prisma` change. |
| 8.6 | Code owner review | ❌ | No `CODEOWNERS` file *(verified absent 2026-08-08)*. Low value while solo; needed at first hire. |
| 8.7 | Emergency change procedure | ❌📝 | Undocumented. What happens when prod is down at 2am and the gate is red? Auditors ask. |

---

## CC9 — Risk Mitigation

Vendor and business-disruption risk.

| # | Control | Status | Evidence / what's missing |
|---|---|---|---|
| 9.1 | Vendor inventory | ❌ | No list exists. **Starter, derived from the 55 prod env vars *(verified 2026-08-08)*:** Render (hosting + Postgres), AWS Cognito, Cloudflare R2, Anthropic, OpenAI, Resend, Google/Gmail API, Sentry, Linear, Slack, Firecrawl, Redis, CAQH/DataSpring, Defacto. Plus Stedi (payer catalog) and GitHub. |
| 9.2 | Vendor risk assessed; their SOC 2 reports collected | ❌📝 | None collected. This is how CC6.15 (physical security) gets satisfied — you inherit it from Render/AWS/Cloudflare and file *their* reports. Mostly a download exercise. |
| 9.3 | Data-processing terms with AI vendors | ⚠️📝 | Provider PII is sent to Anthropic and OpenAI. Zero-retention / data-handling terms are wanted and not confirmed. |
| 9.4 | Business continuity / disaster recovery plan | ⚠️ | The DB half is genuinely done and tested (CC7.9). The rest — "you are unavailable for two weeks" — is undocumented. |
| 9.5 | Insurance (cyber liability / E&O) | 📝 | Unknown. Auditors ask; not a pass/fail control. |
| 9.6 | Customer contracts include security commitments | 📝 | Unknown. |

---

## What to do first

Ranked by audit impact per hour spent. The first three are writing, not engineering.

1. **Information Security Policy** (CC2.1) — unblocks 2.2, 5.1, and parts of CC1. Half a day.
2. **Incident Response Plan** (CC7.6) — the gap auditors treat most seriously, and the one that matters most if provider SSNs ever leak. Half a day.
3. **Vendor inventory + collect their SOC 2 reports** (CC9.1/9.2) — mostly downloading PDFs. Satisfies physical security by inheritance. A day.
4. ~~**Fix the CC8.2 mismatch**~~ — **DONE 2026-08-09.** Re-verified: the enforced control was already accurately documented in `CLAUDE.md:324` and Information Security Policy §8. The contradicting line lived in a personal instructions file outside the repo and has been corrected. No approval-count change was made, and none should be — it would lock the sole engineer out of merging.
5. **Encrypt provider `dateOfBirth`** (CC6.7) — the largest open technical gap. Its own PR, ~12 sites, two-table migration.

Deliberately *not* in the top 5, and why: risk register (CC3) is real but auditors accept a young one; `trust proxy` (CC6.19) is cheap but low-severity; the OCR queue leak (CC6.18) is a genuine tenant bug and should be fixed on engineering grounds regardless of SOC 2.

---

## Type 2 — the target (decided 2026-08-08)

- **Type 1** — controls exist at a point in time. A snapshot.
- **Type 2** — controls *operated effectively* across a period. A time series. **This is the target.**

The difference isn't rigor, it's that Type 2 evidence accumulates and cannot be backfilled.

### The window has a hard start date

Every control must be live and operating on day 1. A control implemented in week 6 of a 12-week window becomes a disclosed exception or forces the window to be re-scoped. Sequence is implement → *then* start the clock, not both at once.

| Phase | Dates | What happens |
|---|---|---|
| Remediation | Aug–Sep 2026 | Write policies, close gaps, collect vendor reports |
| **Window opens** | **2026-10-01** | Everything must already be running |
| Observation | Oct–Dec 2026 | Evidence accrues; ritual controls must fire on schedule |
| Fieldwork | Jan 2027 | Auditor samples populations |
| Report issued | Feb 2027 | Hand to customers |

Dates are a working plan, not a commitment to an auditor. The window start moves if remediation slips — that is the correct response, not starting anyway.

### Your policies define your own homework

The auditor doesn't impose a cadence. They test the cadence **you wrote down**. "Monthly access review" in a 3-month window = three reviews owed, with three dates and three sets of notes. "Quarterly" = one.

Write the loosest defensible cadence, then actually hit it.

| Control | Cadence to write | Owed in a 3-month window | Effort |
|---|---|---|---|
| Access review (CC4.4) | Quarterly | 1 | Ritual |
| Vulnerability review (CC7.2) | Monthly | 3 | Near-free — CI already produces it |
| Risk assessment (CC3.1) | Annual | 1 (can predate window) | Ritual |
| Security awareness training (CC1.5) | Annual | 1 | Ritual |
| Incident response tabletop (CC7.7) | Annual | 1 | Ritual |
| Backup restore test (CC7.9) | Annual | 1 — **must fall inside the window** | Ritual |

### Period-scoping trap

Work done before the window generally does not count toward it.

Worked example: the PITR restore drill on **2026-06-09** is real, documented, and satisfies a Type 1. For a window opening 2026-10-01 it sits outside the period, so a **second drill inside the window** is likely required. The same logic applies to anything else completed earlier in 2026 and mentally filed as done.

### Two categories of evidence

**Automatic** — accrues with zero ongoing effort and gives the auditor a dense population to sample: every PR, every CI run, every `audit_logs` row, every Sentry event, every deploy-watchdog run. Three months of this piles up on its own. Lanyard is strong here.

**Ritual** — requires a human to remember: access reviews, training, tabletops, vendor re-reviews, the restore drill. **This is where Type 2 audits fail** — not because the control is hard, but because nobody did the thing in November.

Every ritual item above goes on a calendar **before** 2026-10-01.

### Ask the auditor

- **Shortened first window.** Some auditors run a 6-week or 1-month first Type 2 to get a report into a customer's hands sooner, then extend next year. Recalled as common practice, *not* read from AICPA guidance — confirm before planning around it.
- **Segregation of duties.** Solo founder means no second approver. Ask what compensating control they'll accept; the answer shapes CC5.3 and CC8.2.

### Recurring cost

A Type 2 report covers a period and goes stale in roughly twelve months. Customers ask for a current one, so this becomes an annual treadmill. The cadences chosen above are permanent operating overhead, not a one-time push — which is the argument for "quarterly" over "monthly."

---

## What this document is not

Written by an AI reading the codebase. Specifically **not**:

- A compliance determination. No control here is "passing" until a CPA firm says so.
- A readiness assessment. That's a paid engagement with an auditor (Vanta doc, Step 3).
- A penetration test. Nothing was exploited; reachability was judged by reading code and prod config.
- Evidence. Auditors want screenshots, signed policies, and dated approvals — artifacts that must come from real events, not from this file.
