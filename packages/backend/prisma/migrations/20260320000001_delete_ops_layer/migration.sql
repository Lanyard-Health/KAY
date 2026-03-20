-- Data migration: update any ops_staff users to admin before removing the enum value
UPDATE "users" SET "role" = 'admin' WHERE "role" = 'ops_staff';

-- Drop tables (in dependency order - children first)
DROP TABLE IF EXISTS "ops_work_item_comments";
DROP TABLE IF EXISTS "ops_work_items";
DROP TABLE IF EXISTS "ops_assignments";
DROP TABLE IF EXISTS "roster_templates";
DROP TABLE IF EXISTS "provider_directory_alerts";
DROP TABLE IF EXISTS "provider_directory_snapshots";
DROP TABLE IF EXISTS "medicare_verifications";
DROP TABLE IF EXISTS "BugFingerprint";

-- Remove ops fields from practices
ALTER TABLE "practices" DROP COLUMN IF EXISTS "service_tier";
ALTER TABLE "practices" DROP COLUMN IF EXISTS "primary_ops_staff_id";
ALTER TABLE "practices" DROP COLUMN IF EXISTS "sla_target_days";

-- Update UserRole enum: remove ops_staff, add lanyard_admin
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'lanyard_admin';
-- Note: PostgreSQL cannot remove enum values in a transaction.
-- ops_staff is now unused (all rows updated above) but will remain in the enum type.
-- A future migration can recreate the enum without it if needed.

-- Drop unused enums
DROP TYPE IF EXISTS "ServiceTier";
DROP TYPE IF EXISTS "OpsWorkItemStatus";
DROP TYPE IF EXISTS "OpsWorkItemPriority";
DROP TYPE IF EXISTS "OpsWorkItemCategory";
DROP TYPE IF EXISTS "DirectoryListingStatus";
DROP TYPE IF EXISTS "MedicareStatus";
