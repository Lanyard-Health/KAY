# CAQH Roster Individual API v2.0 — Spec Sample Fixtures

These fixtures are the canonical golden samples for `addToRosterIndividual()` tests. They are derived directly from the CAQH spec PDF and vendor-provided sample files. **Do not edit these to make tests pass — fix the code instead.**

## Source documents

- **Primary spec**: `CAQH Credentialing and Directory Management Roster Individual API Specification v2.0.pdf` (Last Updated 12/1/2023). Local copy at `~/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/CAQH Specs 042526/drive-download-20260425T171441Z-3-001/`.
- **Vendor sample files**: `Provider Data Roster API Samples/*.txt` in the same directory. These are technically batch (v3.2) samples but use the identical envelope shape as v2.0 Individual — confirms wire format.

## Files

| File | Source | Purpose |
|------|--------|---------|
| `request-add-individual-template.json` | Spec section 3.1.1 | Empty-string template showing every legal request field. Use as a starting point for new test scenarios. |
| `request-add-individual-example-mft.json` | Authored from Tables 3 + 37 | Minimum-required Initial Add for a behavioral health MFT. Required fields only. |
| `response-add-individual-template.json` | Vendor `Response for Get Add to Roster Request Sample.txt` (batch poll) | Empty-string response showing every legal response field. |
| `response-add-individual-success.json` | Authored | Successful Initial Add: `roster_status=ACTIVE`, `authorization_flag=N` (auth pending), `exception_description` empty. |
| `response-add-individual-warning-non-fatal.json` | Spec Table 6 "Warning" row | Non-fatal warning case. **Critical**: `roster_status=ACTIVE` despite non-empty `exception_description`. Code must treat warning as success. |
| `response-add-individual-duplicate-failure.json` | Spec Table 6 "Add Failed" row | Duplicate-add failure. Confirms API is **not** idempotent — auto-retry would surface this. |
| `response-add-individual-required-missing.json` | Spec Table 6 "Required" rows | All required fields missing. Models the discovery-call response we initially misread. |
| `exception-strings-table-6.json` | Spec Table 6 (page 14) | All 22 exception strings categorized by fatal/non-fatal. Source of truth for the exception classifier. |
| `provider-type-codes-table-37.json` | Spec Appendix A.1 (pages 32-33) | All 43 valid Provider Type codes. The `provider.type` request field MUST match one of these. |
| `provider-status-values-table-38.json` | Spec Appendix A.2 (pages 33-34) | All 13 lifecycle Provider Status values. Returned in `provider.status` response field. |

## Wire format rules

1. **Request casing**: lowercase snake_case throughout.
2. **Response casing**: lowercase snake_case in JSON (despite spec tables documenting field names in PascalCase).
3. **Asymmetry**: request uses `provider.{city, state, zip}`; response uses `provider.{address_city, address_state, address_zip}`. Yes, really. Yes, that's per spec.
4. **Birthdate / all dates**: `YYYYMMDD` (8 digits, no separators).
5. **Endpoint**: `POST https://proview.caqh.org/ProviewAPI/API/RosterIndividual?product=PV` (PV = Credentialing; DA = Directory Management). Demo: `https://proview-demo.nonprod.caqh.org/...`.

## Caveat — demo server response casing

The CAQH demo server (POID 6279) returned PascalCase response keys when our discovery call was made on 2026-04-24, contradicting the spec's lowercase. The Zod parser must tolerate both shapes and normalize to lowercase. We do not yet know which casing prod returns. This caveat does NOT extend to requests — those must be lowercase per spec.
