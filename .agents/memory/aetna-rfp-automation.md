---
name: Aetna RFP automation constraints
description: Operational hard constraints for the Aetna Join-the-Network automation
---

- Aetna's network-check step creates a REAL saved application (and Request ID)
  the moment it passes. **Why:** verified during recon; there is no sandbox.
  **How to apply:** all readiness checks must fail before the browser reaches
  it; never exercise the live wizard casually — use the env override to point
  runs at a mock for E2E testing.
- Parts of the wizard behind the telehealth=Yes branch were never walked live;
  their selectors came from a reference submission PDF. **How to apply:** watch
  the first live telehealth run and fix selectors from the adapter's loud
  field-naming errors rather than assuming they're correct.
- Human review sessions hold a live browser in process memory; restarts or the
  TTL kill them, and relaunching files another real Aetna Request ID — warn
  users before restarting the backend while a review is pending.
- Never commit real enrollment/submission artifacts (PDF extractions etc.) —
  `.agents/outputs/` is git-ignored for this reason; keep any real-data
  scratch output there or in /tmp.
