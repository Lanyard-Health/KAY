# Lanyard Health — Healthcare Credentialing Management System

A web-based credentialing repository for behavioral health and mental health providers. Stores provider information and enables form completion for CAQH ProView and insurance payer applications.

## Stack

- **Frontend**: React 18 + Vite (port 5000)
- **Backend**: Node.js + Express + Prisma ORM (port 3002)
- **Database**: PostgreSQL (Replit built-in, auto-provisioned)
- **Shared**: TypeScript types/schemas shared between frontend and backend
- **MCP Server**: `packages/mcp-server/`

## Running on Replit

Two workflows are configured:

| Workflow | Command | Port |
|---|---|---|
| **Start application** | `npm run dev --workspace=packages/frontend` | 5000 (webview) |
| **Backend** | builds `packages/shared` then `npm run dev --workspace=packages/backend` | 3002 (console) |

Start **Backend** first, then **Start application**. The frontend proxies `/api` and `/ws` to `http://localhost:3002`.

## Dev Auth Bypass

`DEV_AUTH_BYPASS=true` is set — the login page shows one-click buttons for:
- **Dev Admin**, **Dev Provider**, **Dev Practice Admin**, **Dev Staff**

No AWS Cognito credentials needed in dev.

## Environment Variables (Replit)

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | auto | Replit runtime-managed |
| `NODE_ENV` | `development` | |
| `PORT` | `3002` | Backend port |
| `DEV_AUTH_BYPASS` | `true` | Skip Cognito |
| `VITE_DEV_AUTH_BYPASS` | `true` | Frontend dev login |
| `FRONTEND_URL` | `http://localhost:5000` | CORS origin |

Optional (features degrade gracefully without them): `REDIS_URL`, `AWS_*` / S3, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `COGNITO_*`, `CAQH_*`.

## Database

Replit's built-in PostgreSQL is used in place of Docker. Migrations are managed by Prisma.

```bash
# Apply migrations
npm run db:migrate --workspace=packages/backend

# Open Prisma Studio
npm run db:studio --workspace=packages/backend
```

## PII Encryption & Key Rotation

Sensitive fields (SSN, tax IDs, banking data, CAQH/portal credentials) are encrypted with AES-256-GCM using the `ENCRYPTION_KEY` Replit Secret (64-char hex = 32 random bytes). `packages/backend/src/utils/crypto.ts` also derives per-tenant keys from it via HKDF, so rotating the master key invalidates all tenant-derived keys too.

**Generate a key:** `openssl rand -hex 32` (or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

**Rotation procedure** (there is no built-in multi-key support — data must be re-encrypted):
1. Generate a new 64-char hex key; do NOT overwrite the old secret yet.
2. Write/run a one-off script that, for every encrypted column (see `packages/backend/src/services/` — credential, CAQH mirror, portal credential fields), decrypts with the old key and re-encrypts with the new key inside a transaction.
3. Update the `ENCRYPTION_KEY` secret to the new value and restart the Backend workflow (and update the production env before the next deploy).
4. Verify: backend starts with no ENCRYPTION_KEY warnings and a spot-check decrypt of a re-encrypted record succeeds.
5. Securely discard the old key only after verification and backups made with the old key are no longer needed (restoring an old backup requires the key that encrypted it).

If the old key is lost, encrypted data is unrecoverable — treat the key like a database backup.

## Build Notes

- `packages/shared` must be compiled before `packages/backend` can TypeScript-compile. The Backend workflow handles this automatically.
- The shell-quote package is overridden to `>=1.10.0` in the root `package.json` (Replit security policy blocks 1.8.3).
- TypeScript watch mode reports `cron` namespace errors — these are type-only and do not affect runtime.

## User Preferences

- Keep the project's existing monorepo structure (turbo + npm workspaces).
- Do not migrate the database away from Prisma or restructure packages.
