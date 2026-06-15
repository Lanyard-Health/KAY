-- Rename the placeholder AdapterType enum value AETNA_BH -> AETNA_RFP.
-- The Aetna "Request for Participation" wizard is one form covering all lines
-- of business (Medical / Behavioral Health / Dental / Facility / Pharmacy), so
-- the adapter is generic rather than BH-specific. AETNA_BH was never used in
-- data (placeholder only), so a value rename is safe.
ALTER TYPE "AdapterType" RENAME VALUE 'AETNA_BH' TO 'AETNA_RFP';
