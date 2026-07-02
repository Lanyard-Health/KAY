-- Backfill practice_payers: every (practice, payer) pair that already has an
-- enrollment gets a settings row, so the practice's Payers tab reflects payers
-- actually in use. Previously rows were only seeded when a payer was picked as
-- a target payer on the Settings tab, so enrollments added directly on a
-- provider never appeared there.
INSERT INTO "practice_payers" ("id", "practice_id", "payer_id", "updated_at")
SELECT gen_random_uuid()::text, p."practice_id", e."payer_id", CURRENT_TIMESTAMP
FROM "payer_enrollments" e
JOIN "providers" p ON p."id" = e."provider_id"
WHERE p."practice_id" IS NOT NULL
  AND p."deleted_at" IS NULL
GROUP BY p."practice_id", e."payer_id"
ON CONFLICT ("practice_id", "payer_id") DO NOTHING;
