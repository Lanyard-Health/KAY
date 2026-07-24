---
name: Aetna RFP automation constraints
description: Hard constraints and unverified selectors in the Aetna Join-the-Network automation
---

- Aetna's network-check step creates a REAL saved application (and Request ID)
  the moment it passes — every readiness/mapping check must fail BEFORE the
  browser reaches it. Never test against the live wizard casually; set
  `AETNA_RFP_START_URL` to a mock for E2E.
- Telehealth branch (location page methods/types/HIPAA radio), W9 file input,
  Medicare PTAN field and language autocompletes were implemented from the
  reference submission PDF, NOT a live walk — the adapter locates them by
  candidate formcontrolname/id lists and fails loudly naming the field. First
  live run should be watched; update selectors from the failure messages.
- Exact Aetna option labels (age groups "Adults Ages: 18-64", telehealth
  "Hybrid services", methods/types) are stored verbatim in
  `PayerSubmissionDetail.bh*`/telehealth fields so no mapping is needed;
  the legacy `AETNA_AGE_GROUP_MAP`/`AETNA_PRACTICE_FOCUS_MAP` fallbacks remain
  empty and fail closed.
- Human-in-the-loop review sessions are in-memory (aetna-review.service.ts):
  a backend restart or the 25-min TTL kills the live browser; approve then
  409s and the run must be relaunched. Sessions don't survive multi-instance
  deployments.
