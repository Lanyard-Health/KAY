-- Provider date of birth encryption — Phase 1 (SOC 2 exception E-1).
--
-- HAND-APPLIED. The runtime role `lanyard_app` cannot ALTER `providers` or
-- `provider_applications` (created by the 2026-01-29 init migration, owned by
-- the admin role) and 42501s. render.yaml runs `prisma migrate deploy` as the
-- start command under the runtime role, so a failure here means the app never
-- boots. Apply via DATABASE_URL_ADMIN first, then merge.
-- See prisma/manual/PROVIDER_DOB_APPLY_STEPS.md.
--
-- Additive only: no data is read, written, or dropped. The plaintext columns
-- stay authoritative until Phase 4.

-- AlterTable
ALTER TABLE "providers" ADD COLUMN "date_of_birth_encrypted" TEXT;

-- AlterTable
ALTER TABLE "provider_applications" ADD COLUMN "date_of_birth_encrypted" TEXT;

-- AlterTable: widen so Phase 4 can clear plaintext without further DDL
ALTER TABLE "provider_applications" ALTER COLUMN "date_of_birth" DROP NOT NULL;
