-- AddForeignKey (NOT VALID — skips existing row validation; run VALIDATE CONSTRAINT separately after cleaning orphans)

-- ProviderProfile
ALTER TABLE "providers" ADD CONSTRAINT "providers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "providers" ADD CONSTRAINT "providers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- PracticeLocation
ALTER TABLE "practice_locations" ADD CONSTRAINT "practice_locations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "practice_locations" ADD CONSTRAINT "practice_locations_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- License
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- BoardCertification
ALTER TABLE "board_certifications" ADD CONSTRAINT "board_certifications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "board_certifications" ADD CONSTRAINT "board_certifications_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- MalpracticeInsurance
ALTER TABLE "malpractice_insurances" ADD CONSTRAINT "malpractice_insurances_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "malpractice_insurances" ADD CONSTRAINT "malpractice_insurances_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- Education
ALTER TABLE "educations" ADD CONSTRAINT "educations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "educations" ADD CONSTRAINT "educations_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- WorkHistory
ALTER TABLE "work_histories" ADD CONSTRAINT "work_histories_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "work_histories" ADD CONSTRAINT "work_histories_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- HospitalAffiliation
ALTER TABLE "hospital_affiliations" ADD CONSTRAINT "hospital_affiliations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "hospital_affiliations" ADD CONSTRAINT "hospital_affiliations_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- ProfessionalReference
ALTER TABLE "professional_references" ADD CONSTRAINT "professional_references_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "professional_references" ADD CONSTRAINT "professional_references_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- DisciplinaryAction
ALTER TABLE "disciplinary_actions" ADD CONSTRAINT "disciplinary_actions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "disciplinary_actions" ADD CONSTRAINT "disciplinary_actions_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- ContinuingEducation
ALTER TABLE "continuing_educations" ADD CONSTRAINT "continuing_educations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "continuing_educations" ADD CONSTRAINT "continuing_educations_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- SupervisingPhysician
ALTER TABLE "supervising_physicians" ADD CONSTRAINT "supervising_physicians_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "supervising_physicians" ADD CONSTRAINT "supervising_physicians_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- MalpracticeClaim
ALTER TABLE "malpractice_claims" ADD CONSTRAINT "malpractice_claims_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "malpractice_claims" ADD CONSTRAINT "malpractice_claims_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- ProviderDisclosure
ALTER TABLE "provider_disclosures" ADD CONSTRAINT "provider_disclosures_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "provider_disclosures" ADD CONSTRAINT "provider_disclosures_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- DeaRegistration
ALTER TABLE "dea_registrations" ADD CONSTRAINT "dea_registrations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "dea_registrations" ADD CONSTRAINT "dea_registrations_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- ProviderIdentifier
ALTER TABLE "provider_identifiers" ADD CONSTRAINT "provider_identifiers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "provider_identifiers" ADD CONSTRAINT "provider_identifiers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- ProviderBanking
ALTER TABLE "provider_banking" ADD CONSTRAINT "provider_banking_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "provider_banking" ADD CONSTRAINT "provider_banking_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- Enrollment
ALTER TABLE "payer_enrollments" ADD CONSTRAINT "payer_enrollments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "payer_enrollments" ADD CONSTRAINT "payer_enrollments_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
