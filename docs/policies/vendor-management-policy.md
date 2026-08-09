# Vendor Management Policy

| | |
|---|---|
| **Owner** | Kentesha Ward, Founder |
| **Version** | 1.0 (draft) |
| **Effective date** | `[BLANK — set on approval]` |
| **Review cadence** | Annual, per vendor |

Subordinate to the Information Security Policy (`information-security-policy.md`). Data classification levels are inherited from §3 of that document.

---

## 1. Purpose

Lanyard depends on third parties to operate. Data Lanyard is accountable for sits in systems Lanyard does not control. This policy defines how those relationships are assessed and monitored.

It also serves a second purpose: **physical and environmental security controls are satisfied by inheritance.** Lanyard operates no data centre and no on-premises storage. The evidence for those controls is the infrastructure providers' attestation reports, collected under this policy.

---

## 2. Tiering

Vendors are tiered by the most sensitive data they can access.

| Tier | Criterion | Requirements |
|---|---|---|
| **Tier 1** | Can access **Restricted** data | SOC 2 Type 2 report or equivalent; data-processing terms; annual review; documented in incident response scope |
| **Tier 2** | Can access **Confidential** data | Security attestation reviewed; annual review |
| **Tier 3** | **Internal** data or none | Recorded in the inventory; no formal assessment |

Tier is set by **capability, not intent.** A vendor that receives only sanitized data but could technically receive more is tiered by what the integration permits.

---

## 3. Inventory

Derived from the production environment configuration on 2026-08-08. This is the working inventory; it is authoritative once reviewed and confirmed.

### Tier 1 — Restricted data

| Vendor | Purpose | Data held | SOC 2 collected |
|---|---|---|---|
| **Render** | Application hosting, PostgreSQL, Redis | Everything. The primary datastore and all 55 production secrets | `[ ]` |
| **Cloudflare** | Object storage (R2), CDN, DNS | Uploaded documents — licenses, W-9s, insurance certificates. Routinely contain SSN and tax ID | `[ ]` |
| **AWS (Cognito)** | Identity provider | User identities, authentication factors | `[ ]` |
| **CAQH / DataSpring** | Credentialing data source | Provider credentialing records, bidirectional | `[ ]` |

### Tier 2 — Confidential data

| Vendor | Purpose | Data held | Assessment |
|---|---|---|---|
| **Anthropic** | AI inference | Provider data in prompts | `[ ]` — see §5 |
| **OpenAI** | AI inference | Provider data in prompts | `[ ]` — see §5 |
| **Resend** | Transactional email | Recipient names and addresses, message content | `[ ]` |
| **Google (Gmail API)** | Email integration | Message content | `[ ]` |
| **Defacto** | Network participation | `[CONFIRM — Kay: what provider data does this integration send or receive?]` | `[ ]` |

### Tier 3 — Internal or no customer data

| Vendor | Purpose | Note |
|---|---|---|
| **GitHub** | Source control, CI | No customer data. Holds source and CI secrets — compromise is a Tier 1 event even though the tier is 3 |
| **Sentry** | Error monitoring | Sanitized before transmission |
| **Linear** | Issue tracking | Sanitized before transmission |
| **Slack** | Alerting | Sanitized before transmission |
| **Firecrawl** | Payer website monitoring | Public payer sites only |
| **Stedi** | Payer catalog | Reference data only |

**Note on Sentry, Linear, and Slack.** Their Tier 3 status depends entirely on the sanitization layer holding (Information Security Policy §7.3). If sanitization regresses, these become Tier 2 silently. This is why sanitizer test coverage is mandatory.

`[CONFIRM — Kay: review this inventory for anything reached outside the production environment configuration — accounting, CRM, e-signature, analytics, password manager, or anything with an OAuth grant against a Lanyard account.]`

---

## 4. Onboarding a vendor

Before a new vendor processes Lanyard data:

1. Determine the tier (§2).
2. For Tier 1 and 2: obtain and read their current security attestation. A trust centre page is not an attestation.
3. For Tier 1: confirm data-processing terms exist covering confidentiality, permitted use, subprocessors, breach notification to Lanyard, and deletion on termination.
4. Record in the inventory with tier, data types, owner, and renewal date.
5. Provision credentials at minimum necessary scope; store only in the hosting provider's environment configuration.

A vendor added mid-audit-window without this is an exception under Information Security Policy §16.

---

## 5. AI service providers

Anthropic and OpenAI receive provider personal information in prompts. Two requirements:

1. **Zero retention and no training use.** Terms must confirm submitted data is not retained beyond the request and not used for model training. Where a provider offers this only on a specific plan or endpoint, Lanyard must be on it.
2. **Minimization.** Prompts carry the least data needed. Restricted fields (SSN, DOB, banking, DEA) must never be included in a prompt.

`[BLANK — Kay: neither is currently confirmed. This is the vendor gap with the most direct exposure, because it moves provider data outside the system on every AI request rather than only on a breach.]`

---

## 6. Annual review

Each Tier 1 and Tier 2 vendor is reviewed annually:

1. Obtain the current attestation report. A report older than twelve months does not satisfy the control.
2. Read the exceptions section. A clean opinion with material exceptions in scope is not a pass.
3. Confirm the data types held still match the inventory — integrations grow.
4. Confirm credentials are still minimum-scope and still needed.
5. Check for publicly disclosed breaches in the period.
6. Record the review date and outcome.

Reviews may be batched into a single annual exercise. The record must show each vendor individually.

---

## 7. Offboarding a vendor

1. Revoke Lanyard's credentials.
2. Request written confirmation of data deletion, where the vendor held Restricted or Confidential data.
3. Remove the environment configuration values.
4. Mark inactive in the inventory with a date. Do not delete the row — the historical record is evidence.

---

## 8. Vendor incidents

A breach at a vendor is a Lanyard incident. See `incident-response-plan.md` §6.6.

Tier 1 vendors must notify Lanyard of a breach affecting Lanyard data. Where that obligation is not contractually present, it is recorded as an exception.

---

## 9. Concentration risk

Render hosts the application, the database, and Redis, and holds every production secret. Loss of that single account is simultaneously a total availability event and a total confidentiality event.

Accepted deliberately at current scale. Mitigations: MFA on the account, an off-platform copy of the recovery procedure, and the source of truth for code held separately at GitHub. Reassessed at the annual review.

---

## Drafting note

Drafted 2026-08-08. The inventory was derived by reading production environment variable **names** — values were never accessed. Tier assignments are proposed based on integration capability and require confirmation. Not reviewed by counsel or an auditor.
