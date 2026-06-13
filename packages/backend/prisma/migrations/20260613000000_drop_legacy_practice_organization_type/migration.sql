-- Drop the legacy free-text `organization_type` column on practices.
-- Superseded by the `organization_type_id` FK -> organization_types (the
-- relation the clinical-profile UI uses). Verified empty in prod (0/14 rows
-- populated) and unreferenced by any service/route before removal.
ALTER TABLE "practices" DROP COLUMN "organization_type";
