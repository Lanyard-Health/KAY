-- Consolidate lanyard_admin role into admin
-- Step 1: Migrate existing lanyard_admin users to admin
UPDATE "users" SET "role" = 'admin' WHERE "role" = 'lanyard_admin';

-- Step 2: Remove lanyard_admin from the UserRole enum
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('admin', 'credentialing_staff', 'provider', 'practice_admin');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole" USING ("role"::text::"UserRole");
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'credentialing_staff';
DROP TYPE "UserRole_old";
