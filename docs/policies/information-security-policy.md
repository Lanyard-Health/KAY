# Information Security Policy

| | |
|---|---|
| **Owner** | Kentesha Ward, Founder |
| **Version** | 1.0 (draft) |
| **Effective date** | `[BLANK — set on approval]` |
| **Approved by** | `[BLANK — Kay signature + date]` |
| **Review cadence** | Annual, or on material change to the system |
| **Next review** | `[BLANK — effective date + 12 months]` |

This is the master policy. Access Control, Change Management, Incident Response, Vendor Management, Data Retention, and Business Continuity are subordinate documents that inherit their scope and definitions from this one.

Statements describing current implementation cite the source file or runbook. Statements of *requirement* are normative and binding regardless of current state; where implementation does not yet meet a requirement, it is listed in §14 Known Exceptions with a remediation date.

---

## 1. Purpose and scope

Lanyard Health operates a provider credentialing and payer enrollment platform. The platform stores regulated personal information about healthcare providers and practice owners, including Social Security numbers, dates of birth, tax identification numbers, banking details, DEA and CDS registration numbers, and professional license data.

**Data boundary.** Lanyard processes **provider and practice personal information**. It does not operate as a repository of patient health records. Maintaining this boundary is itself a control — see §3.3.

This policy applies to all Lanyard Health personnel, contractors, and automated systems, and to all environments (production, staging, local development) and all third parties that process Lanyard data.

**Systems in scope:**

| System | Role |
|---|---|
| Backend API (`packages/backend`) | Express + Prisma, hosted on Render |
| Frontend (`packages/frontend`) | React SPA, `portal.lanyardhealth.com` |
| PostgreSQL | Primary datastore, Render-managed |
| AWS Cognito | Identity provider |
| Cloudflare R2 | Document storage |
| GitHub (`Lanyard-Health/KAY`) | Source control and CI |

---

## 2. Roles and responsibilities

| Role | Responsibility |
|---|---|
| **Founder (Kay)** | Accountable for all security decisions. Approves this policy, owns the risk register, authorizes exceptions, is the incident commander. |
| **Backup contact — John Mayes, Director of Operations** | Acts on the Founder's behalf when the Founder is unavailable: receives and triages incident reports, authorizes emergency changes under §8, and initiates the continuity procedures in §12. |
| **All personnel** | Comply with this policy; complete annual training; report suspected incidents immediately. |

**Segregation of duties.** Production system administration and code deployment are performed by a single individual (the Founder). Peer review of production changes is therefore not achievable, and self-approval is not permitted by the source control platform. The compensating controls are: (a) every production change passes through a pull request leaving a permanent record, (b) the `Security Gate` status check is enforced against administrators, and (c) the audit log is append-only and cannot be modified by application code. See §7 and §8.

`[CONFIRM — Kay: does John Mayes hold any account in the production system? If yes, two things change. (1) §15 Personnel Security applies to a real person today, not at some future hire — background check, policy acknowledgment, and training records are owed now. (2) If that account has administrative or deployment rights, the segregation-of-duties statement above is inaccurate and peer review becomes partially achievable, which weakens the §8 exception. If John holds no system account, the paragraph above stands as written and §15 still applies in its acknowledgment and training elements.]`

---

## 3. Data classification

### 3.1 Classification levels

| Level | Definition | Examples |
|---|---|---|
| **Restricted** | Regulated personal data. Breach triggers state notification law. | SSN, date of birth, tax ID / EIN, bank routing and account numbers, DEA and CDS numbers, payer portal credentials |
| **Confidential** | Business or personal data not public, not independently regulated | Provider demographics, enrollment status, internal staff notes, document OCR output |
| **Internal** | Operational data | Audit logs, application logs, workflow configuration |
| **Public** | Published information | NPI numbers, marketing content, API documentation |

NPI is **Public** — it is published in the NPPES registry. It is nonetheless excluded from external logging under §7.3 to avoid it acting as a correlation key.

### 3.2 Handling requirements

| | Restricted | Confidential | Internal |
|---|---|---|---|
| Encrypted at rest (field level) | Required | Not required | Not required |
| Encrypted in transit | Required | Required | Required |
| Masked in API responses by default | Required | — | — |
| Access logged | Required | Required for reads | Writes |
| Permitted in external services (AI, ticketing, email) | Prohibited | Sanitized only | Sanitized only |

### 3.3 Patient data

Patient health information is out of scope for the platform. Two ingress paths could violate this boundary and are monitored: uploaded documents, and malpractice claim records. Any discovery of patient health data in the system is treated as a security incident under the Incident Response Plan.

---

## 4. Access control

### 4.1 Identity

All human access uses a unique named account in AWS Cognito. Shared accounts are prohibited. Service accounts must be identifiable, attributable to an owner, and separate from human accounts.

### 4.2 Multi-factor authentication

MFA is **required** for all users. Two factors are offered — authenticator app (TOTP) and email code — and the user selects at sign-in. Configuration and recovery procedure: `docs/cognito-mfa-runbook.md`.

### 4.3 Authorization

Access is role-based and least-privilege. Defined roles (`packages/shared/src/types/user.ts:3`):

`admin` · `lanyard_staff` · `credentialing_staff` · `provider` · `practice_admin`

Every API route declares its permitted roles explicitly. Authentication and authorization are applied per-router rather than globally; adding a route without a guard is a defect and is called out in §14.

### 4.4 Tenant isolation

Customer practices are isolated. Every request carries a resolved practice scope, and a request that resolves to no permitted practice receives a deny-all sentinel rather than an empty filter — absence of scope must never widen access. A dedicated blocking CI job (`tenant-scope`, `.github/workflows/security-scan.yml:872`) tests this on every pull request.

### 4.5 Database privileges

The application runtime connects using a restricted role with no schema-modification rights. Migrations use a separate administrative credential. Both are supplied as distinct environment variables (`DATABASE_URL`, `DATABASE_URL_ADMIN`).

The runtime role holds `INSERT` and `SELECT` on `audit_logs` and does not hold `UPDATE` or `DELETE`.

### 4.6 Access reviews

Access is reviewed **quarterly**. The review enumerates every active account, its role, and its practice associations, and confirms each is still required. Results are recorded with a date and retained as audit evidence. Tooling: `packages/backend/src/modules/access-review/`.

### 4.7 Provisioning and deprovisioning

Access is granted only on documented request and only at the minimum role required. Access is revoked **within one business day** of role change or departure, by deactivating the Cognito user and clearing the active flag on the user record. Revocation is recorded.

`[BLANK — Kay: no departures have occurred. This requirement takes effect at first hire.]`

---

## 5. Cryptography

### 5.1 In transit

TLS is required for all external connections. HSTS is enforced with a one-year max-age, `includeSubDomains`, and preload (`packages/backend/src/index.ts:123`). A restrictive Content Security Policy (`default-src 'none'`, `frame-ancestors 'none'`) and `strict-origin-when-cross-origin` referrer policy are applied to all API responses. Cross-origin access is restricted to an explicit allow-list; in production the only permitted origin is the configured frontend URL (`index.ts:143`).

### 5.2 At rest

Restricted fields are encrypted at the application layer with **AES-256-GCM** before storage (`packages/backend/src/utils/crypto.ts`). The master key is supplied as a 32-byte value via environment variable and is never present in source control. GCM authentication tags are stored and verified on decrypt, so tampered ciphertext fails rather than decrypting to garbage.

Payer portal credentials use an additional layer: a per-tenant key derived from the master key via **HKDF-SHA256**, keyed by practice identifier (`crypto.ts:deriveTenantKey`). Ciphertext from one practice cannot be decrypted with another practice's derived key.

Currently encrypted fields include SSN, tax ID and EIN, bank routing and account numbers, DEA and CDS numbers, webhook signing secrets, and payer portal usernames, passwords, and MFA seeds.

Underlying disk encryption for the database and object storage is provided by Render and Cloudflare respectively.

### 5.3 Key management

The master encryption key is stored only in the hosting provider's environment configuration. Keys are never committed, logged, or transmitted. Access to the environment configuration is limited to the Founder.

**Rotation cadence.** The master encryption key is rotated **annually**, and immediately on any of the following triggers:

- Suspected or confirmed exposure of the key
- Departure of any individual who held access to the hosting provider's environment configuration
- Compromise of the hosting provider account

Third-party API credentials (§5.4) are rotated **annually** and immediately on suspected exposure or on departure of anyone who held them.

**Rotation procedure.** Because encryption is applied at the application layer, rotating the master key requires re-encrypting stored ciphertext rather than simply replacing the value. The procedure is:

1. Generate the new key and add it as a secondary environment value alongside the current one.
2. Deploy a decrypt-with-either, encrypt-with-new configuration so that every write uses the new key while reads accept both.
3. Run a backfill that reads and rewrites every encrypted field, moving all ciphertext to the new key.
4. Verify zero rows remain decryptable only under the old key.
5. Remove the old key from the environment and confirm the application operates normally.
6. Record the rotation date, operator, and verification result as audit evidence.

Steps 2 through 4 are not currently implemented. Until they are, a rotation would require an outage. See exception E-3 in §14.

Per-tenant derived keys (§5.2) rotate implicitly with the master key, since they are derived from it.

### 5.4 Secrets

All credentials are held as environment variables in the hosting provider. Committing a secret is prevented by a blocking pre-merge scan (`gitleaks`, `.github/workflows/security-scan.yml:14`, ruleset in `.gitleaks.toml`). A secret that reaches source control, a log, or any external system is **rotated immediately** and handled as an incident.

---

## 6. Application security

The following are requirements for all code merged to the production branch:

1. **Input validation.** All external input is validated and typed at the boundary. No unvalidated input reaches a database query.
2. **Authorization per resource.** Every endpoint verifies the caller may access the specific resource requested, not merely that the caller is authenticated.
3. **Minimal responses.** Endpoints return only the fields required. Restricted fields are masked by default; full values are returned only through an explicit, audited reveal path.
4. **Safe errors.** Error responses expose no stack traces, internal paths, or system detail.
5. **Dependency review.** New dependencies are checked for known vulnerabilities and active maintenance before adoption.

Automated enforcement runs on every pull request: static analysis (`semgrep`), security linting (`eslint-security`), dependency audit (`npm-audit`), schema drift detection, and application boot verification.

Rate limiting is applied to the API, with tighter per-route limits on authentication, signup, and lookup endpoints.

---

## 7. Logging and monitoring

### 7.1 Audit logging

The system records an audit entry for every state-changing request and for read access to sensitive resources — provider records, enrollment data, documents, and partner API traffic (`packages/backend/src/middleware/audit.middleware.ts:52`).

Entries capture actor, action, resource type and identifier, IP address, and user agent.

### 7.2 Access to unmasked restricted data

Revealing an unmasked restricted field — SSN, DEA, CDS — writes an audit entry **before** the value is returned. The write is awaited and a failure aborts the disclosure: no audit record, no disclosure (`audit.middleware.ts:258`). The field name is recorded; the value never is.

### 7.3 Prohibited log content

Restricted values must never appear in any log, ticket, alert, or external service. Audit entries are filtered against a deny-list of sensitive key names and value patterns before storage (`audit.middleware.ts:150`). Automated bug reports are sanitized before transmission to any third party, and changes to those sanitization rules require corresponding test updates.

### 7.4 Immutability

`audit_logs` is append-only. No application code path updates or deletes rows, and the runtime database role lacks the privilege to do so. Verification method and evidence: `docs/audit-log-retention-policy.md`.

### 7.5 Retention

Audit records are retained **seven years**. Full policy, including rationale and export procedure: `docs/audit-log-retention-policy.md`.

### 7.6 Monitoring

Application errors are captured in Sentry across both tiers. Runtime errors, frontend crashes, CI failures, and security findings are sanitized and routed to issue tracking with alerting on urgent items. Deployment integrity is verified by an automated watchdog on a fifteen-minute schedule.

Vulnerability scan output is reviewed **monthly**.

---

## 8. Change management

All changes to production reach it through a pull request against the protected branch. Direct pushes are impossible: force pushes and branch deletion are disabled, and protection is enforced against administrators (verified against the GitHub API, 2026-08-08).

The `Security Gate` status check must pass before merge. It aggregates secret scanning, dependency audit, static analysis, schema drift detection, tenant isolation testing, and boot verification.

Any change to the database schema must include a generated migration in the same change set. Schema drift is detected and blocks merge.

Changes are validated in staging before production where the change carries risk to data or authentication.

**Approval requirement.** Peer approval is not currently required, because Lanyard operates with a single engineer and the platform cannot accept self-approval. The compensating controls are those in §2. This is a deliberate, documented position rather than an oversight; it is revisited at first engineering hire.

### 8.1 Emergency changes

An emergency change is one where following the standard process would cause or prolong a production outage, active data loss, or an unmitigated security exposure. Convenience, schedule pressure, and a failing test that is merely inconvenient are **not** emergencies.

**Authorization.** The Founder authorizes emergency changes. In the Founder's absence, the Backup Contact (§2) may authorize. Authorization is recorded in writing — a message with a timestamp is sufficient — before the change is applied, or immediately after where seconds matter.

**Permitted deviations, in order of preference:**

1. **Merge with a failing non-blocking check.** No deviation required; unit tests do not gate merge (see E-7). Always prefer this.
2. **Revert rather than fix forward.** Reverting to the last known-good commit follows the standard process and is almost always faster than a hotfix.
3. **Temporarily disable branch protection.** Last resort. Must be re-enabled immediately after the merge, in the same working session.

Deleting the audit trail, bypassing the secret scan, or deploying code that was never committed are **never** permitted, under any severity.

**Required after every emergency change, within one business day:**

1. Branch protection restored and verified, if it was altered.
2. A pull request opened retroactively containing the change, so the permanent record exists.
3. A written retrospective recording: what broke, what was changed, who authorized it, which controls were bypassed, and what prevents recurrence.
4. If a security control was bypassed, the event is also logged as an incident under §11.

**Review.** Emergency changes are reviewed at the monthly vulnerability review (§9). More than two in a quarter indicates the standard process is too slow and should be fixed rather than routinely bypassed.

---

## 9. Vulnerability and patch management

Dependencies are scanned on every pull request and continuously by the source control platform's advisory service.

Remediation targets:

| Severity | Target |
|---|---|
| Critical | 7 days |
| High | 30 days |
| Medium | 90 days |
| Low | Next convenient release |

A finding may be accepted rather than remediated where reachability analysis shows it is not exploitable in the deployed configuration — for example, a development-only dependency, or a vulnerable code path that is not invoked. Acceptance requires written rationale recorded with the finding, and re-evaluation at each monthly review.

Penetration testing: `[BLANK — Kay: none performed. Not strictly required for SOC 2 but frequently requested by enterprise customers.]`

---

## 10. Vendor management

Third parties that process Lanyard data are inventoried, and their security posture is assessed before adoption and reviewed annually. Where a vendor provides a SOC 2 report or equivalent attestation, it is obtained and retained.

Physical and environmental security controls are inherited from infrastructure providers and evidenced through their attestation reports rather than assessed directly.

Vendors that process **Restricted** data require data-processing terms addressing confidentiality, permitted use, and retention. Providers of AI inference services must be covered by terms confirming submitted data is not retained or used for model training.

Full inventory, tiering, and assessment records: `vendor-management-policy.md`.

---

## 11. Incident response

All suspected security incidents are reported to the Founder immediately.

Loss of confidentiality of **Restricted** data may trigger notification obligations under state data-breach statutes in all fifty states. Determination of notification requirements is made as part of incident handling.

Detailed procedure, severity definitions, containment playbooks, and notification decision: `incident-response-plan.md`.

Response capability is exercised at least **annually** through a tabletop exercise, with dated notes retained.

---

## 12. Business continuity

The production database is protected by continuous write-ahead log streaming with point-in-time recovery over a seven-day window. Measured recovery objectives: RPO under five seconds, RTO approximately five minutes.

Restore capability is tested **at least annually** against a non-production instance, with results recorded. Last verified test: 2026-06-09. Procedure and evidence: `docs/db-backup-restore-runbook.md`.

Broader continuity planning — hosting provider outage, object storage loss, loss of the secrets store, and extended founder unavailability — is documented in `business-continuity-plan.md`.

Two scenarios in that plan are flagged as urgent independent of SOC 2: object storage has no independent backup, and the master encryption key exists in a single location with no offline copy. See §14, E-9 and E-10.

---

## 13. Data retention and disposal

Audit records: seven years (§7.5).

Customer and provider data is retained for the duration of the customer relationship. Records are soft-deleted in normal operation, which preserves referential integrity and the audit trail.

### 13.1 Retention periods

| Data | Retention |
|---|---|
| Audit records | 7 years from creation (§7.5) |
| Customer and provider records | Duration of the customer relationship, then 90 days |
| Uploaded documents (object storage) | Same as the provider record they belong to |
| Application logs and error reports | 90 days |
| Backups (point-in-time recovery) | 7 days rolling |

### 13.2 Deletion on customer offboarding

1. **Day 0 — Termination.** Access is revoked for all users belonging to the practice (§4.7). Records are soft-deleted: hidden from the application, retained in the database.
2. **Days 1–90 — Recovery window.** Data remains restorable in case of accidental termination, billing dispute, or a customer request to export. Only the Founder may restore.
3. **Day 90 — Permanent deletion.** Provider and practice records are hard-deleted from the primary database. Associated documents are deleted from object storage. Encrypted credential records are destroyed.
4. **Retained after deletion.** Audit records are retained for their full seven-year period (§7.5). They reference deleted resources by identifier and record which actor accessed what and when. They do **not** contain the underlying restricted values, which are excluded at write time (§7.3). This is deliberate: the access history must survive deletion of the data it describes.
5. **Record of deletion.** Each permanent deletion is recorded with the practice identifier, date, record counts, and operator, and retained as audit evidence.

### 13.3 Deletion on request

A provider or practice may request deletion of their data outside the offboarding path. Requests are directed to the Founder, acknowledged within five business days, and completed within thirty days, subject to any legal or contractual retention obligation, which is stated to the requester if it applies.

### 13.4 Backup interaction

Deleted data persists in point-in-time recovery snapshots until those snapshots age out of the seven-day window. Deletion is therefore complete no later than 97 days after termination. Snapshots are not selectively edited; doing so would compromise recovery integrity.

### 13.5 Media disposal

Physical media destruction is the responsibility of the infrastructure providers and is inherited through their attestation reports (§10). Lanyard operates no on-premises storage.

`[CONFIRM — Kay: the 90-day recovery window and 30-day request-deletion turnaround are proposed defaults, not derived from any existing commitment. If any signed customer contract specifies different periods, the contract governs and these numbers must change to match.]`

---

## 14. Known exceptions

Recorded deliberately. A policy that omits its own gaps is less credible than one that names them with owners and dates.

| # | Exception | Risk | Remediation | Target |
|---|---|---|---|---|
| E-1 | Provider date of birth is stored unencrypted (`prisma/schema.prisma:532`, and a second instance at `:2396`), while practice owner DOB is encrypted (`:323`). Inconsistent with §3.2. | Restricted data unprotected at field level | Encrypt with existing AES-256-GCM helper; two-table migration and backfill | `[BLANK — Kay]` |
| E-2 | The document OCR review queue lists provider names and NPIs across practice boundaries, contrary to §4.4. | Cross-tenant disclosure of Confidential data | Scope the query to the caller's practices | `[BLANK — Kay]` |
| E-3 | No encryption key rotation cadence (§5.3). | Indefinite key lifetime | Define cadence and re-encryption procedure | `[BLANK — Kay]` |
| E-4 | Authentication is applied per-router rather than globally (§4.3), so a new route can ship without a guard. | Unprotected endpoint | Default-deny mounting, or a CI check enumerating unguarded routes | `[BLANK — Kay]` |
| E-5 | Proxy trust is configured for a single hop while production runs behind two (`index.ts:106`), degrading client IP accuracy in rate limiting and in audit records (§7.1). | Reduced evidence quality | Correct the trust depth for the deployed topology | `[BLANK — Kay]` |
| E-6 | API rate limiting is active only in production, so staging does not exercise it. | Untested control | Mount unconditionally | `[BLANK — Kay]` |
| E-7 | Unit tests do not block merge; only the security jobs gate (§8). | Regression risk | Promote the test job to blocking once reliably green | `[BLANK — Kay]` |
| E-8 | Hard-delete mechanism for §13.2 step 3 is not implemented; deletion is currently soft-delete only. | Data retained beyond stated period | Build the deletion routine and the deletion record | `[BLANK — Kay]` |
| E-9 | ~~The master encryption key exists only in the hosting provider's environment configuration~~ **CLOSED 2026-08-09.** Four copies now exist — live, Bitwarden, Deputy share, sealed physical — per `docs/key-custody-runbook.md`. Bitwarden copy verified by fingerprint match; the physical copy is recorded on the Founder's confirmation. | Residual: the physical copy has not been independently fingerprint-verified | Verify all copies at the annual check (runbook §4) | Closed — next verification 2027-08-08 |
| E-10 | ~~Object storage has no independent backup~~ **CLOSED 2026-08-09.** Daily sync to a second bucket via `.github/workflows/r2-document-backup.yml`; first run verified 79/79 objects. | Residual: both buckets are in the same Cloudflare account, and RPO is up to 24h | Cross-account or cross-provider copy, if a customer contract ever requires it | Closed — revisit at annual review |
| E-11 | Key rotation procedure steps 2–4 (§5.3) are not implemented, so rotation requires an outage. | Rotation is impractical, so it will not happen | Implement dual-key read support and a backfill | `[BLANK — Kay]` |
| E-12 | Staging and production share one `ENCRYPTION_KEY`. Both environments returned fingerprint `7c00d4ffd0d403fe` on 2026-08-09. Diverges from the per-environment split already adopted for R2 credentials (2026-06-05). | A staging compromise yields the key that decrypts **production** PII; ciphertext is portable between environments | Mint a distinct staging key and re-encrypt staging's encrypted columns. Deliberately deferred until after the E-1 migration completes — re-keying staging mid-migration would strand ciphertext written by the Phase 3 backfill. Depends on E-11. | After E-1 Phase 5 |

---

## 15. Personnel security

These requirements apply to employees, contractors, and anyone else granted access to Lanyard systems or data. They apply to the Founder equally — auditors request the Founder's own training and acknowledgment records.

### 15.1 Before access is granted

1. **Background check.** A background check is completed before access to **Restricted** data (§3.1) is granted. Scope: identity verification, criminal history, and employment verification, performed by a third-party screening provider and subject to applicable law and candidate consent. Results are recorded as pass/fail only; underlying reports are not retained in Lanyard systems.
2. **Confidentiality agreement.** Signed before first access.
3. **Policy acknowledgment.** The individual reads and signs acknowledgment of this policy. The signed record is retained for the duration of the relationship plus one year.

A background check is not required for roles with no access to Restricted data. Whether a role has such access is determined by the role assigned under §4.3, not by job title.

### 15.2 During the relationship

1. **Security awareness training** is completed at onboarding and **annually** thereafter. Completion records are dated and retained as audit evidence.
2. Training covers, at minimum: this policy, handling of Restricted data, phishing and social engineering, secure credential practice, and how to report an incident (§11).
3. **Policy re-acknowledgment** is required whenever this policy changes materially, and otherwise annually alongside training.

### 15.3 Offboarding

Executed **within one business day** of departure, and immediately where departure is involuntary or the individual held administrative access:

1. Disable the identity provider account and clear the active flag on the user record (§4.7).
2. Revoke access to the hosting provider, source control, and any third-party service.
3. Rotate any shared or service credential the individual could have accessed (§5.3).
4. Retrieve or wipe company data on personal devices.
5. Record completion of each step above, with a date. The record is retained as audit evidence.
6. Confirm removal at the next quarterly access review (§4.6).

### 15.4 Current state

Lanyard has one individual with production system access (the Founder) and one named Backup Contact (§2). No background checks, training records, or signed acknowledgments currently exist for either.

`[ACTION — Kay: this is now a live obligation, not a future one. Two people are named in this document. Before the audit window opens, both need a signed policy acknowledgment and a dated training completion record, and a decision is needed on whether the Backup Contact's role requires a background check — which depends on whether that role can reach Restricted data.]`

---

## 16. Exceptions to this policy

Exceptions require written approval from the Founder, must state the business justification, compensating control, and expiry date, and are recorded in §14. Exceptions do not persist silently — each is re-evaluated at the annual policy review.

---

## 17. Enforcement

Violations may result in revocation of access and, for personnel, disciplinary action up to termination. For third parties, violation may result in contract termination.

---

## 18. Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-08-08 | Drafted from verified system configuration | Initial draft. Not yet approved. |

---

## Drafting note

This draft was produced by reading the Lanyard codebase and live infrastructure configuration on 2026-08-08. Implementation claims cite their source. Every item marked `[BLANK]` describes something that cannot be determined from a codebase and must be answered by the Founder.

Nothing here has been reviewed by counsel or by an auditor. The document becomes policy when it is approved and dated, not when it is written.
