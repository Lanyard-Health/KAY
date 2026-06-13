-- CAQH mirror encryption (launch-blocker P1-8):
-- 1. provider_caqh_mirrors gains raw_json_encrypted (AES-256-GCM ciphertext of the
--    full CAQH payload); raw_json becomes nullable so the app can stop writing
--    plaintext. A backfill script encrypts existing rows and nulls raw_json;
--    the column itself is dropped in a follow-up migration once verified clean.
-- 2. caqh_attestation_trackers gains baseline_section_hashes (sha256 fingerprint
--    per normalized Provider section) replacing the plaintext baseline_snapshot
--    for the re-attestation "anything changed?" diff.

-- AlterTable
ALTER TABLE "caqh_attestation_trackers" ADD COLUMN     "baseline_section_hashes" JSONB;

-- AlterTable
ALTER TABLE "provider_caqh_mirrors" ADD COLUMN     "raw_json_encrypted" TEXT,
ALTER COLUMN "raw_json" DROP NOT NULL;
