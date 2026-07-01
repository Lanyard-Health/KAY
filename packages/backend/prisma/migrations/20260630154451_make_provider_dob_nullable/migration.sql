-- Make provider date of birth optional.
-- Bulk import (practice_admin) may create providers without a DOB; we store NULL
-- instead of a 1900-01-01 sentinel. Other create paths still require DOB via their
-- own input validation.
-- AlterTable
ALTER TABLE "providers" ALTER COLUMN "date_of_birth" DROP NOT NULL;
