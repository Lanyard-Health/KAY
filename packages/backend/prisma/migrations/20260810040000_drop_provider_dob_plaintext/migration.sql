-- Phase 5b — drop the plaintext date-of-birth columns.
--
-- Both columns are empty: Phase 3 encrypted every row and Phase 4 cleared the
-- plaintext, verified at 0 rows on staging and production on 2026-08-09.
--
-- APPLIED BY HAND AS THE ADMIN ROLE. Do not let the boot-time
-- `prisma migrate deploy` run this: it executes as `lanyard_app`, which cannot
-- ALTER tables owned by the admin role, and a failed migration at boot means
-- the app never starts. This migration is recorded via
-- `prisma migrate resolve --applied` BEFORE the deploying commit merges, so the
-- automatic run finds it already applied and no-ops.
--
-- Ordering is the inverse of Phase 1: deploy the code that stops referencing
-- these columns FIRST, then drop them. A still-running old container would
-- otherwise fail with 42703 on a column that no longer exists.
--
-- Irreversible in the sense that matters: the columns can be re-added, but they
-- would come back empty. The data lives only in date_of_birth_encrypted.
ALTER TABLE "providers" DROP COLUMN "date_of_birth";
ALTER TABLE "provider_applications" DROP COLUMN "date_of_birth";
