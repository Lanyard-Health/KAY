-- EncryptPayerSubmissionCredentials
--
-- Replaces the plaintext Json "credentials" column on payer_adapter_configs
-- with an AES-256-GCM encrypted String "credentials_encrypted" column.
--
-- Data migration note: As of 2026-03-25, the payer_adapter_configs table has
-- zero rows (verified via SELECT count(*) FROM payer_adapter_configs).
-- The migration steps below are written defensively so they will correctly
-- migrate any rows that exist at the time the migration runs.
--
-- If rows DO exist at migration time:
--   1. The new column is added (nullable).
--   2. Existing JSON values are copied as JSON text into credentials_encrypted.
--      IMPORTANT: This copies the raw JSON string — it is NOT yet AES-encrypted.
--      You MUST run the companion script (see below) to encrypt these values
--      before the application reads them.
--   3. The old column is dropped.
--
-- Companion encryption script (run AFTER this migration, BEFORE starting the app):
--   npx tsx prisma/scripts/encrypt-payer-credentials.ts
--
-- If the table is empty (expected), steps 2 is a no-op and no script is needed.

-- Step 1: Add the new encrypted column
ALTER TABLE "payer_adapter_configs" ADD COLUMN "credentials_encrypted" TEXT;

-- Step 2: Copy existing plaintext JSON values as serialized JSON strings.
-- These are NOT yet AES-encrypted — the companion script handles that.
UPDATE "payer_adapter_configs"
SET "credentials_encrypted" = "credentials"::text
WHERE "credentials" IS NOT NULL;

-- Step 3: Drop the old plaintext column
ALTER TABLE "payer_adapter_configs" DROP COLUMN "credentials";
