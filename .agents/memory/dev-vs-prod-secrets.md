---
name: Dev workflows must exclude unreachable prod secrets
description: User's imported prod secrets (Render Redis, prod API URL) break dev on Replit; workflows unset them
---

The user imported their full production secret set. Two of them break dev on Replit:

- `REDIS_URL` → Render-hosted Redis (`red-...`), unreachable from Replit. When set, the backend rate limiter uses it and **every API request fails** ("Connection is closed"), which presents as login failure.
- `VITE_API_URL` → points the frontend at the production API instead of the local Vite proxy (`/api/v1`).

**How to apply:** Both dev workflows use `env -u <VAR>` to unset these before starting. If workflows are reconfigured, keep the `env -u REDIS_URL -u REDIS_HOST -u REDIS_PORT -u REDIS_PASSWORD` (Backend) and `env -u VITE_API_URL` (frontend) prefixes. Do not delete the user's secrets — production needs them.

**Why:** Secrets override shared env vars; the app trusts whatever REDIS_URL/VITE_API_URL it sees, with no reachability fallback.
