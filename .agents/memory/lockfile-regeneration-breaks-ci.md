---
name: Lockfile regeneration breaks CI
description: Replit-side package-lock.json regeneration can drop packages and crash GitHub CI's npm ci
---

The Replit environment can regenerate `package-lock.json` (huge diff, fewer `"resolved"` entries). GitHub Actions' `npm ci` then crashes with only "npm error Exit handler never called!", and downstream builds fail with missing modules (e.g. "Cannot find module 'zod'").

**Why:** A workspace-wide lock regenerated under a different npm/environment silently dropped ~180 resolved packages; CI installs from the lock alone, so builds break even though local dev (with existing node_modules) works fine.

**How to apply:** Before pushing/PRing, sanity-check lock diffs (`grep -c '"resolved"' package-lock.json` vs the previous version). To repair: restore the last-good lock from git, run `npm install --package-lock-only`, verify with `npm ci --dry-run`, commit.
