# Incident Response Plan

| | |
|---|---|
| **Owner** | Kentesha Ward, Founder |
| **Version** | 1.0 (draft) |
| **Effective date** | `[BLANK — set on approval]` |
| **Review cadence** | Annual, and after every SEV1 or SEV2 incident |
| **Tested** | Annually, via tabletop exercise. Last test: **none** |

Subordinate to the Information Security Policy (`information-security-policy.md`). Definitions of Restricted, Confidential, and Internal data are inherited from §3 of that document.

---

## 1. When this plan applies

A **security incident** is any event that compromises, or plausibly compromises, the confidentiality, integrity, or availability of Lanyard systems or data.

Applies to:

- Unauthorized access to provider or practice data
- Exposure of a credential, API key, or encryption key
- Data visible across a practice boundary
- Compromise of a Lanyard account or an infrastructure provider account
- Malicious code, ransomware, or unexpected data modification
- Loss of production data or extended platform unavailability
- Breach at a vendor that processes Lanyard data
- Discovery of patient health data in the system (see Information Security Policy §3.3)

Does **not** apply to: routine bugs, planned maintenance, or single-user login failures. Those follow normal engineering triage.

**When uncertain, treat it as an incident.** Downgrading later costs nothing. Discovering three weeks on that it should have been declared costs the notification clock.

---

## 2. Severity

| Level | Definition | Lanyard examples | Response |
|---|---|---|---|
| **SEV1** | Confirmed unauthorized access to Restricted data, or total platform loss | SSNs, DOBs, or banking data accessed by an unauthorized party; database exfiltration; ransomware | Immediate. Drop everything. |
| **SEV2** | Probable exposure, or confirmed exposure of Confidential data | Encryption key or production credential leaked; cross-tenant data exposure confirmed; admin account compromised | Within 1 hour |
| **SEV3** | Possible exposure, contained before confirmation | Vulnerability exploitable but no evidence of use; vendor breach with unclear scope; misdirected email containing Confidential data | Within 1 business day |
| **SEV4** | Security-relevant, no exposure | Failed intrusion attempt; expired certificate; security control found misconfigured but unexploited | Within 5 business days |

Severity is assigned by the Incident Commander at declaration and revised as facts change. **Revisions are recorded, not overwritten** — the assessment history is itself evidence.

---

## 3. Roles

| Role | Who | Responsibility |
|---|---|---|
| **Incident Commander** | Kentesha Ward (Founder) | Declares the incident, assigns severity, makes containment and notification decisions, owns the timeline |
| **Deputy** | John Mayes, Director of Operations | Assumes Incident Commander duties when the Founder is unavailable or unreachable for 2 hours during a SEV1/SEV2 |
| **Reporter** | Anyone | Reports; does not investigate alone |

There is one Incident Commander at a time. If both are unavailable at SEV1, the Deputy's contact escalates to the infrastructure providers' support channels to preserve evidence and halt further loss.

`[BLANK — Kay: contact details. Phone numbers for both, and a rule for reaching each other outside business hours. An IR plan whose first step is "find Kay" fails at 2am.]`

---

## 4. Detection

| Source | Covers |
|---|---|
| Sentry | Application errors and exceptions, both tiers |
| Bug Monitor → Linear + Slack + email | Runtime errors, frontend crashes, CI failures, security findings |
| Deploy watchdog (15-min cron) | Deployment integrity, missed deploys |
| CI security jobs | Secrets committed, vulnerable dependencies, tenant-scope regressions |
| `audit_logs` | Who accessed what — the primary forensic source |
| Customer or provider report | Anything user-visible |
| External researcher | Reported via the published security contact |

`[BLANK — Kay: no published security contact exists (Information Security Policy §2.3, CC2.3). Create security@lanyardhealth.com and publish it. Without it, a researcher who finds a flaw has no way to tell you, and will eventually tell someone else.]`

---

## 5. Response

### Phase 1 — Declare (immediately)

1. Assign severity (§2).
2. Start a timeline document. Every entry gets a UTC timestamp. **Start it before you start fixing** — reconstructing a timeline afterward is unreliable and auditors can tell.
3. Notify the Deputy for SEV1 and SEV2.

### Phase 2 — Preserve evidence (before containment, where possible)

**Do not delete anything.** Not logs, not the compromised account, not the offending record.

1. Export relevant `audit_logs` rows to a location outside the production database.
2. Capture Sentry events, application logs, and infrastructure logs for the window.
3. Note the current deployed commit SHA and the state of environment configuration.
4. Screenshot dashboards showing the anomalous state.

Containment often destroys evidence — revoking a key erases the ability to see what it did next. Capture first where the delay is measured in minutes, not hours. At SEV1 with active exfiltration, containment wins.

### Phase 3 — Contain

Stop the bleeding. Playbooks in §6.

### Phase 4 — Assess scope

Answer, in writing:

1. **What data?** Which classification level. Restricted changes everything downstream.
2. **Whose data?** Which practices, which providers, how many individuals.
3. **What window?** First and last moment of exposure.
4. **Accessed or merely exposed?** `audit_logs` is the authority. Exposure without evidence of access is a materially different finding — but absence of a log entry is only meaningful where logging covered that path.
5. **Still ongoing?**

### Phase 5 — Eradicate and recover

1. Remove the root cause. A patch that hides the symptom is not eradication.
2. Rotate every credential that could plausibly have been exposed. When in doubt, rotate.
3. Restore data if needed (`docs/db-backup-restore-runbook.md`).
4. Verify the fix in staging before production where the change carries risk.
5. Confirm the anomalous behavior has stopped, using the detection source that first surfaced it.

### Phase 6 — Notify

See §7.

### Phase 7 — Post-incident review

Within **five business days** of closure, for every SEV1 and SEV2:

1. Timeline: detection → declaration → containment → resolution.
2. Root cause. Not "human error" — the condition that let human error reach production.
3. What worked, what failed, what was missing.
4. Corrective actions, each with an owner and a date.
5. Whether this plan needs revision.

The review is retained as audit evidence. Corrective actions are tracked to completion in Linear.

---

## 6. Containment playbooks

### 6.1 Leaked secret (key, token, or credential in source control, logs, or a third-party system)

1. Rotate the credential at the provider. Rotate first, investigate second — leaked credentials are scraped within minutes.
2. Update the hosting provider's environment configuration; confirm the application recovers.
3. Search `audit_logs` and provider-side access logs for use of the old credential.
4. If the credential was the **master encryption key**: this is SEV1. Encrypted-at-rest data must be treated as exposed. Follow the rotation procedure in Information Security Policy §5.3, and note that steps 2–4 of that procedure are not yet implemented — expect an outage.
5. Purge from source control history if committed. Assume it was captured regardless.

### 6.2 Compromised user account

1. Disable the account in the identity provider and clear the active flag.
2. Invalidate active sessions.
3. Query `audit_logs` for everything that account did — this is exactly what the read-audit trail exists for.
4. Determine whether MFA was bypassed or the factor itself was compromised.
5. Rotate any credential the account could have reached.
6. Re-enable only after the access path is understood and closed.

### 6.3 Cross-tenant data exposure

1. Identify the code path. Deploy a fix or disable the endpoint.
2. Query `audit_logs` for every request that traversed the path, and cross-reference actor practice against resource practice to separate actual cross-boundary reads from in-scope ones.
3. The affected parties are **both** practices — the one whose data was exposed and the one that saw it. Both may require notification.
4. Add a regression test to the blocking `tenant-scope` CI job before closing.

### 6.4 Infrastructure provider account compromise

1. Rotate the provider account password; verify MFA is intact.
2. Review the provider's own audit log for configuration changes, particularly environment variables and database access.
3. Rotate **every** secret held by that provider. A hosting account compromise means all 55 production values are exposed.
4. Verify no unauthorized deploy occurred: compare the live commit SHA against source control.

### 6.5 Database compromise or suspected exfiltration

1. SEV1 automatically.
2. Rotate database credentials, both runtime and administrative.
3. Determine the access path: application vulnerability, leaked credential, or provider compromise.
4. Restricted fields are encrypted at the application layer, so raw table access does not directly yield SSNs or banking data — **unless the encryption key was also exposed**, which is the question that determines severity of impact.
5. Assess whether restore from point-in-time recovery is needed for integrity.

### 6.6 Vendor breach

1. Determine what Lanyard data that vendor holds (Vendor Management Policy inventory).
2. Rotate the credential Lanyard holds for them.
3. Obtain their incident report and scope in writing.
4. Assess whether their breach constitutes exposure of Lanyard's Restricted data, which determines whether §7 notification applies to Lanyard's customers.

---

## 7. Notification

### 7.1 Decision

The Incident Commander decides whether notification is required, based on the §4 scope assessment. The decision — either way — is recorded with its reasoning. **A documented decision not to notify is a defensible position; an undocumented one is not.**

### 7.2 Regulatory

Lanyard stores Social Security numbers, dates of birth, financial account numbers, and government-issued identifiers about providers. Unauthorized acquisition of these triggers **state data breach notification statutes**, which exist in all fifty states.

Key characteristics that make this consequential:

- Obligation is driven by the **affected individual's state of residence**, not Lanyard's. Providers across many states means many statutes may apply simultaneously.
- Deadlines vary by state; several require notification **within 30 days** of determining a breach occurred, and some also require notice to the state Attorney General above a threshold number of affected residents.
- Many statutes provide a **safe harbor for encrypted data** where the encryption key was not also compromised. This is the practical reason field-level encryption (Information Security Policy §5.2) matters to the response, not only to prevention.

`[BLANK — Kay: the 50-state matrix of deadlines and thresholds is not reproduced here and should not be assembled from memory. Obtain it once, from a current authoritative source, and attach it as an appendix before the audit window opens. Getting a deadline wrong is worse than not having the table.]`

### 7.3 Customers

Affected practices are notified without unreasonable delay once scope is established. Notification states: what happened, what data, over what window, what Lanyard has done, what the customer should do, and a contact for questions.

Notify when the facts are established, not when they are complete. A holding notice with what is known beats silence.

### 7.4 Vendors and providers

Where an incident originates with or affects a vendor, notify them and obtain written confirmation of their assessment.

### 7.5 Templates

`[BLANK — Kay: draft a customer notification template and a holding-notice template in advance. Writing these under incident pressure produces bad drafts, and bad drafts are what get forwarded to lawyers and regulators.]`

---

## 8. Testing

A tabletop exercise is conducted **at least annually**, walking a realistic scenario end to end without touching production.

Rotate the scenario. Suggested first: *a payer portal credential for one practice is found in a public code repository.* It exercises §6.1, the tenant key derivation, the audit log query path, and the §7 notification decision — the four things most likely to be shaky.

Retained per exercise: date, participants, scenario, gaps found, corrective actions with owners.

**No exercise has been conducted.** For a Type 2 audit, one must fall inside the observation window — see `docs/soc2-readiness-checklist.md`.

---

## 9. Incident register

Every declared incident is recorded, including SEV3 and SEV4.

| Field | |
|---|---|
| ID | `INC-YYYY-NN` |
| Declared | UTC timestamp |
| Severity | At declaration, and final if revised |
| Summary | One line |
| Data involved | Classification level and scope |
| Notification | Required? Sent? Date? Or documented reason not required |
| Closed | Date |
| Review | Link, for SEV1/SEV2 |

An empty register is a valid state. A register that does not exist is a finding.

---

## Drafting note

Drafted 2026-08-08 from the Lanyard system configuration and the Information Security Policy. Not reviewed by counsel or an auditor. Becomes operative when approved and dated. Items marked `[BLANK]` must be completed before this plan is usable in an actual incident — particularly §3 contact details and §7.2.
