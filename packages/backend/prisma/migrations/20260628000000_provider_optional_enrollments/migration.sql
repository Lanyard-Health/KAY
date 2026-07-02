-- Provider-optional enrollments.
-- An enrollment can now belong to a PRACTICE (group / state Medicaid) with no
-- individual provider. Payer stays required; only provider becomes optional.

-- 1. Discriminator enum. ORGANIZATION is reserved/designed-for, not used in v1.
CREATE TYPE "EnrollmentSubject" AS ENUM ('PROVIDER', 'PRACTICE', 'ORGANIZATION');

-- 2. New columns. subject_type defaults to PROVIDER, which also backfills every
--    existing row (all current enrollments are provider enrollments).
ALTER TABLE "payer_enrollments"
  ADD COLUMN "subject_type" "EnrollmentSubject" NOT NULL DEFAULT 'PROVIDER',
  ADD COLUMN "practice_id" TEXT;

-- 3. Provider becomes optional at the DB level. Existing required values are
--    untouched -> zero behavior change for current rows.
ALTER TABLE "payer_enrollments" ALTER COLUMN "provider_id" DROP NOT NULL;

-- 4. Replace the plain composite unique with two PARTIAL unique indexes.
--    A plain UNIQUE(provider_id, payer_id) can't enforce practice uniqueness:
--    Postgres treats NULLs as distinct, so many practice rows could share
--    provider_id=NULL with the same payer. Partial indexes scope each rule to
--    its own subject. Raw SQL because Prisma can't model partial indexes.
DROP INDEX "payer_enrollments_provider_id_payer_id_key";

CREATE UNIQUE INDEX "payer_enrollments_provider_payer_key"
  ON "payer_enrollments" ("provider_id", "payer_id")
  WHERE "provider_id" IS NOT NULL;

CREATE UNIQUE INDEX "payer_enrollments_practice_payer_key"
  ON "payer_enrollments" ("practice_id", "payer_id")
  WHERE "practice_id" IS NOT NULL;

-- 5. Practice FK + index. ON DELETE RESTRICT: a practice with enrollments can't
--    be deleted until its enrollments are removed (no silent enrollment loss).
CREATE INDEX "payer_enrollments_practice_id_idx" ON "payer_enrollments" ("practice_id");

ALTER TABLE "payer_enrollments"
  ADD CONSTRAINT "payer_enrollments_practice_id_fkey"
  FOREIGN KEY ("practice_id") REFERENCES "practices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
