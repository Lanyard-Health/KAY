-- Rename tax_id columns to tax_id_encrypted to reflect AES-256-GCM encryption

-- Practice: rename tax_id → tax_id_encrypted
ALTER TABLE "practices" RENAME COLUMN "tax_id" TO "tax_id_encrypted";

-- PracticeLocation: rename tax_id → tax_id_encrypted
ALTER TABLE "practice_locations" RENAME COLUMN "tax_id" TO "tax_id_encrypted";

-- TerminationLetter: rename tax_id → tax_id_encrypted
ALTER TABLE "termination_letters" RENAME COLUMN "tax_id" TO "tax_id_encrypted";
