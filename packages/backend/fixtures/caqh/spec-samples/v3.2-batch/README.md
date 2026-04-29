# CAQH Roster API Spec v3.2 — Batch Fixtures

Sourced from:
`~/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/CAQH Specs 042526/drive-download-20260425T171441Z-3-001/CAQH Credentialing and Directory Management Roster and Status Check API Specification Sample Files/Provider Data Roster API Samples/`

## Files

- `response-batch-add-rejected-empty.json` — verbatim copy of `Roster Response for Add Update Delete Request Sample.txt`. The spec sample literally ships with `batch_id: ""`. Per #206 we treat this as enqueue rejection — CAQH did not accept the request.
- `response-batch-add-success.json` — synthetic success shape with a non-empty `batch_id`. The real production batch_id format is opaque (CAQH-assigned); the only contract is "non-empty string".

## Why batch is async

The `/RosterAPI/API/Roster` endpoint is a **fire-and-forget enqueue**. The immediate POST response only acknowledges that CAQH accepted the request into its batch queue (`batch_id` returned) or rejected the enqueue (empty/missing `batch_id`). Per-provider success/failure outcomes arrive later via `GET /RosterAPI/api/ProviderStatus` polling, which is **not yet implemented** (#206 residual gap). This blindness is why `CAQH_ROSTER_MODE` now defaults to `individual` — set `CAQH_ROSTER_MODE=batch` only as a rollback if the synchronous individual path misbehaves.
