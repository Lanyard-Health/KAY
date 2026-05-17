# Payer Application Field Maps

Each payer Lanyard Health supports has its own credentialing application form. The fields on those forms must map cleanly to the Lanyard database — otherwise the data-mapping agent will submit incomplete applications.

This folder holds **one markdown file per payer** that audits the payer's form against our schema, identifies gaps, and recommends the schema changes (if any) needed to close them.

---

## Folder contents

| File | Payer | Status |
|---|---|---|
| [aetna-field-map.md](aetna-field-map.md) | Aetna (Behavioral Health Professional) | Initial mapping complete — schema-verification pass done; awaiting migration design |
| [cigna-evernorth-field-map.md](cigna-evernorth-field-map.md) | Cigna / Evernorth (Behavioral Provider) | Migration design locked (2026-05-17) — 4 additions (2 columns + 2 tables) |

_Add a row each time a new payer's field map is created._

---

## Why this exists

When a payer track is selected, the first step in the workflow is creating the application page populated with the data that payer requires. Most of that data should already be in the database — but until we have proof for each payer, the agents can't be trusted.

These files are the proof. Each one answers three questions:
1. What fields does this payer's form ask for?
2. Which of those fields does the Lanyard schema already store?
3. For the fields we don't store, what's the recommended schema change?

---

## Template every payer file uses

Each `<payer>-field-map.md` has the same five sections:

1. **Source** — path to the completed-application PDF (in iCloud), date pulled
2. **Fields extracted from the PDF** — every field, grouped by the section it appears in on the form
3. **Schema mapping** — table per section: PDF field → schema field → status (✅ / ⚠️ / ❌)
4. **Recommended approach for gaps** — for every ❌, where the new column/enum/table should go
5. **Open questions to verify** — anything that needs a quick schema/DB check before locking the design

---

## Status legend

| Symbol | Meaning |
|---|---|
| ✅ | **Direct match** — schema has a clean field for this; just wire it into the page |
| ⚠️ | **Partial match** — schema captures part of it but loses fidelity (e.g. wrong shape, missing sub-options, ambiguous) |
| ❌ | **Missing** — no schema field; needs a new column, enum, or table |

---

## Source PDFs

Completed-application PDFs live in iCloud (not in the repo, because they contain customer PII):

```
~/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/Customers/<customer>/
```

The field map files in this folder reference the PDF filename + date pulled, but never reproduce PII (Tax IDs, DOBs, license numbers are redacted as `XXXX`).

---

## Workflow

When a new payer needs analysis:

1. Drop the completed application PDF in the customer's iCloud folder
2. Ask Claude: _"Audit the [payer] application at [path] against the Lanyard schema and produce `docs/payer-applications/<payer>-field-map.md` using the standard template"_
3. Review the resulting file
4. Commit to GitHub
5. Use the **Recommended approach for gaps** section as the source of truth when designing schema changes

---

## Related

- Schema: `packages/backend/prisma/schema.prisma`
- Existing payer models: `Payer`, `PayerTrack`, `PayerForm`, `PayerFormField`, `PayerEnrollmentData`, `AetnaEnrollmentRun`
- CAQH spec docs (similar evidence-first pattern): `~/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/CAQH Specs 042526/`
