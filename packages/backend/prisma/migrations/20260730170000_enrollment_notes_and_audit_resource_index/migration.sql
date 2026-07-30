-- CreateTable: timestamped, authored enrollment notes
CREATE TABLE "enrollment_notes" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "enrollment_notes_enrollment_id_idx" ON "enrollment_notes"("enrollment_id");

ALTER TABLE "enrollment_notes" ADD CONSTRAINT "enrollment_notes_enrollment_id_fkey"
    FOREIGN KEY ("enrollment_id") REFERENCES "payer_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "enrollment_notes" ADD CONSTRAINT "enrollment_notes_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Per-resource audit reads (GET /audit/resource/:type/:id) currently table-scan
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- Backfill: preserve existing free-text enrollment notes as the first note entry.
-- Author attribution is best-effort (last editor, else creator); timestamp is the
-- enrollment's last update since the legacy column had no timestamp of its own.
INSERT INTO "enrollment_notes" ("id", "enrollment_id", "body", "author_id", "created_at")
SELECT
    gen_random_uuid()::text,
    e."id",
    e."notes",
    COALESCE(e."updated_by_id", e."created_by_id"),
    e."updated_at"
FROM "payer_enrollments" e
WHERE e."notes" IS NOT NULL AND btrim(e."notes") <> '';
