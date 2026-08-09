# Business Continuity and Disaster Recovery Plan

| | |
|---|---|
| **Owner** | Kentesha Ward, Founder |
| **Version** | 1.0 (draft) |
| **Effective date** | `[BLANK — set on approval]` |
| **Review cadence** | Annual |
| **Tested** | Database recovery: 2026-06-09. Other scenarios: never |

Subordinate to the Information Security Policy (`information-security-policy.md`). Where a disruption is caused by a security event, `incident-response-plan.md` governs and this document supplies the recovery procedures.

---

## 1. Recovery objectives

| System | RPO | RTO | Basis |
|---|---|---|---|
| PostgreSQL (production) | ≤ 5 seconds | ~5 minutes | Measured in a real restore drill, 2026-06-09 |
| Backend API | 0 (stateless) | ~10 minutes | Redeploy from source |
| Frontend | 0 (static) | ~10 minutes | Redeploy from source |
| Object storage (R2) | N/A | N/A | See §3.3 — **no independent backup** |

Database figures are measured, not estimated. Application figures are deployment-time estimates and have not been drilled.

---

## 2. Continuous protection in place

| Control | Detail |
|---|---|
| Database | Continuous write-ahead log streaming, point-in-time recovery to any second within a 7-day window |
| Source code | GitHub, plus local working copies. Independent of the hosting provider |
| Secrets | Hosting provider environment configuration — **single copy**, see §3.4 |
| Deployment integrity | Automated watchdog, 15-minute cron, self-heals missed deploys |
| Monitoring | Sentry, both tiers |

---

## 3. Scenarios

### 3.1 Database loss or corruption

**Detection:** application errors, failed health checks, Sentry.
**RTO:** ~5 minutes to a restored instance. **Tested 2026-06-09.**

1. Determine the last known-good timestamp — for corruption, the moment before the bad write.
2. Restore to a **new instance** via the provider's point-in-time recovery. Never restore over the live database; it destroys the ability to compare.
3. Verify: row counts on core tables, most recent `audit_logs` entry, a sample provider record decrypts correctly.
4. Repoint the application's database URL to the restored instance and redeploy.
5. Note that the restored instance has a different credential — update configuration, do not assume it carries over.

Full procedure and drill evidence: `docs/db-backup-restore-runbook.md`.

**Limit:** the recovery window is 7 days. Corruption discovered on day 8 is unrecoverable. This is the strongest argument for a longer retention tier as the customer base grows.

### 3.2 Hosting provider outage

**Regional or platform-wide outage at Render.**

There is no warm standby. Recovery is bounded by the provider's own restoration. Lanyard's actions:

1. Confirm scope via the provider's status page.
2. Communicate to affected customers — availability incidents damage trust mainly through silence.
3. Monitor and verify recovery once service returns: live commit SHA, health endpoint, a real login.

**Accepted risk.** A multi-provider architecture is not justified at current scale. Reassessed annually or on the first customer contract with an availability commitment.

`[CONFIRM — Kay: has any signed customer contract committed to an uptime figure? If yes, this section is inadequate and Availability likely belongs in the SOC 2 scope alongside Security.]`

### 3.3 Object storage loss

Uploaded documents — licenses, W-9s, insurance certificates — are held in Cloudflare R2 with **no independent backup**. Durability rests entirely on the provider's guarantees.

Loss of that bucket means loss of every uploaded document. The underlying records survive in PostgreSQL; the files do not. Recovery would mean asking every provider to re-upload.

**Options assessed 2026-08-08:**

| Option | Verdict |
|---|---|
| Object versioning | **Not available.** R2's bucket feature set is public buckets, CORS, bucket locks, event notifications, lifecycle rules, and storage classes. Versioning is not among them. |
| Native replication | **Not available.** R2 offers no bucket-to-bucket replication. |
| Bucket lock | **Not viable as-is.** Locks prevent deletion, and the application deletes objects from R2 in three live paths — `routes/document.routes.ts:483`, `routes/practice-documents.routes.ts:461`, `routes/portal-documents.routes.ts:169`. A lock breaks all three. It also conflicts with the 90-day hard-delete commitment in Information Security Policy §13.2, since a locked bucket cannot be emptied. Adopting it would require reworking deletion to unlink in the database while retaining the object, which is a design change, not a configuration change. |
| **Scheduled copy to a second bucket** | **Recommended.** Purely additive, breaks nothing, and addresses the actual risk in this section — loss of the bucket. |

Object keys are unique per upload (`document.service.ts:94` — UUID per document), so a copy job never overwrites and an incremental sync stays cheap.

`[DECISION — Kay: where should the copy land? A second bucket in the same Cloudflare account protects against accidental bucket deletion and application bugs, which are the likely failures. A separate provider additionally protects against loss of the Cloudflare account itself, at the cost of a second vendor to manage under vendor-management-policy.md.]`

### 3.4 Loss of the secrets store

All 55 production values exist in one place: the hosting provider's environment configuration. There is no export.

If the account is lost or the configuration deleted, the application cannot start, and **the master encryption key is gone** — meaning every encrypted field becomes permanently unreadable. Database backups do not help; they contain ciphertext.

This is the single highest-consequence scenario in this document.

`[ACTION — Kay: an offline copy of the master encryption key must exist outside the hosting provider. A sealed record in a password manager or a physical copy in a safe. Without it, losing one account permanently destroys every SSN, tax ID, and banking record in the system — with backups intact and useless. Treat as urgent, independent of SOC 2.]`

### 3.5 Source control loss

Low impact. Local working copies exist and the platform is independently reliable. Recovery: push from a local clone to a new remote, repoint CI.

CI configuration and branch protection would need reconstruction — the settings are not currently exported anywhere. Minor.

### 3.6 Founder unavailability

The scenario auditors ask about and companies of this size rarely document.

**Short-term (under one week).** John Mayes, Director of Operations, is the Deputy under `incident-response-plan.md` §3. Customer communication continues. No deployments occur. The platform runs unattended — this is survivable because deployment is not required for normal operation.

**Extended (over one week).** Requires access that the Deputy does not currently hold.

`[BLANK — Kay: decide and document how the Deputy obtains emergency access to the hosting provider, source control, and the identity provider. A sealed break-glass credential in a password manager with documented access conditions is the standard pattern. Currently, extended founder unavailability means nobody can deploy a fix, rotate a leaked key, or restore a database.]`

This gap and §3.4 share a root cause: single-person custody of everything that matters. One offline break-glass record addresses both.

---

## 4. Communication during disruption

1. **Customers.** The Founder, or the Deputy in the Founder's absence, notifies affected practices. State what is affected, what is not, and when the next update comes. Then send that update, even if nothing changed.
2. **Providers.** Notified only where the disruption affects them directly.
3. **Vendors.** Contacted where the disruption originates with them.

`[BLANK — Kay: no channel exists to reach customers when the platform is down, since notification currently flows through the platform. A status page or a maintained external contact list resolves it.]`

---

## 5. Testing

| Scenario | Cadence | Last tested |
|---|---|---|
| Database recovery (§3.1) | Annual | **2026-06-09 — passed** |
| Founder unavailability (§3.6) | Annual, tabletop | Never |
| Secrets recovery (§3.4) | Annual — verify the offline copy exists and is current | Never |
| Object storage (§3.3) | Annual, once a backup exists | N/A |

Each test records date, scenario, outcome, and gaps found. Retained as audit evidence.

**For a Type 2 audit, tests must fall inside the observation window.** The June 2026 database drill predates a window opening 2026-10-01 and will likely need repeating — see `docs/soc2-readiness-checklist.md`.

---

## Drafting note

Drafted 2026-08-08 from verified infrastructure configuration and the existing backup runbook. Database recovery figures are measured; everything else is estimated or untested and labelled as such. §3.4 is flagged as urgent on its own merits, not because of SOC 2.
