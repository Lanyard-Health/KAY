---
name: CORS vs Replit preview writes
description: Why CORS bugs only surface on write requests from the Replit preview, and how to allowlist preview origins correctly.
---

Rule: any dev CORS allowlist for Replit preview domains must match multi-label hosts (e.g. `xyz-uuid.picard.replit.dev`), not just `something.replit.dev` — use `([A-Za-z0-9-]+\.)+(replit\.dev|repl\.co)`.

**Why:** browsers omit the Origin header on same-origin GETs but always send it on PUT/POST/DELETE, so a too-strict origin regex lets all reads through and fails only on writes — presenting as a confusing "Not allowed by CORS" 500 the first time someone submits a form from the preview.

**How to apply:** when a write from the preview 500s with a CORS message while GETs work, check the origin regex first. Verify with `curl -H "Origin: https://$REPLIT_DEV_DOMAIN"` preflight + PUT against the backend.
