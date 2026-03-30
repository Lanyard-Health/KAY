-- Step 1: Add new encrypted column
ALTER TABLE "dea_registrations" ADD COLUMN "dea_number_encrypted" TEXT;

-- Step 2: Copy plaintext values (will be encrypted by post-migration script)
UPDATE "dea_registrations"
SET "dea_number_encrypted" = "dea_number"
WHERE "dea_number" IS NOT NULL;

-- Step 3: Drop old plaintext column
ALTER TABLE "dea_registrations" DROP COLUMN "dea_number";

-- Step 4: Make the new column non-nullable (matches the original NOT NULL constraint)
ALTER TABLE "dea_registrations" ALTER COLUMN "dea_number_encrypted" SET NOT NULL;
