-- CreateTable
CREATE TABLE "practice_payers" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "payer_id" TEXT NOT NULL,
    "group_npi" TEXT,
    "group_tax_id_encrypted" TEXT,
    "group_contract_number" TEXT,
    "primary_contact_name" TEXT,
    "primary_contact_email" TEXT,
    "primary_contact_phone" TEXT,
    "coi_on_file_url" TEXT,
    "w9_on_file_url" TEXT,
    "effective_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_payers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practice_payers_practice_id_payer_id_key" ON "practice_payers"("practice_id", "payer_id");

-- CreateIndex
CREATE INDEX "practice_payers_payer_id_idx" ON "practice_payers"("payer_id");

-- AddForeignKey
ALTER TABLE "practice_payers" ADD CONSTRAINT "practice_payers_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_payers" ADD CONSTRAINT "practice_payers_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: for every (practice, payerId-in-targetPayerIds) pair where the
-- referenced payer actually exists, seed an empty PracticePayer row so the
-- UI has a record to edit. Idempotent — ON CONFLICT skips collisions.
INSERT INTO "practice_payers" ("id", "practice_id", "payer_id", "created_at", "updated_at")
SELECT
    gen_random_uuid()::text AS "id",
    p."id" AS "practice_id",
    target_id AS "payer_id",
    CURRENT_TIMESTAMP AS "created_at",
    CURRENT_TIMESTAMP AS "updated_at"
FROM "practices" p
CROSS JOIN LATERAL unnest(p."target_payer_ids") AS target_id
INNER JOIN "payers" py ON py."id" = target_id
ON CONFLICT ("practice_id", "payer_id") DO NOTHING;
