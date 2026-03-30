-- CreateIndex
CREATE INDEX "board_certifications_provider_id_idx" ON "board_certifications"("provider_id");

-- CreateIndex
CREATE INDEX "continuing_educations_provider_id_idx" ON "continuing_educations"("provider_id");

-- CreateIndex
CREATE INDEX "dea_registrations_provider_id_idx" ON "dea_registrations"("provider_id");

-- CreateIndex
CREATE INDEX "disciplinary_actions_provider_id_idx" ON "disciplinary_actions"("provider_id");

-- CreateIndex
CREATE INDEX "documents_provider_id_idx" ON "documents"("provider_id");

-- CreateIndex
CREATE INDEX "educations_provider_id_idx" ON "educations"("provider_id");

-- CreateIndex
CREATE INDEX "hospital_affiliations_provider_id_idx" ON "hospital_affiliations"("provider_id");

-- CreateIndex
CREATE INDEX "licenses_provider_id_idx" ON "licenses"("provider_id");

-- CreateIndex
CREATE INDEX "malpractice_claims_provider_id_idx" ON "malpractice_claims"("provider_id");

-- CreateIndex
CREATE INDEX "malpractice_insurances_provider_id_idx" ON "malpractice_insurances"("provider_id");

-- CreateIndex
CREATE INDEX "professional_references_provider_id_idx" ON "professional_references"("provider_id");

-- CreateIndex
CREATE INDEX "provider_addresses_provider_id_idx" ON "provider_addresses"("provider_id");

-- CreateIndex
CREATE INDEX "provider_banking_provider_id_idx" ON "provider_banking"("provider_id");

-- CreateIndex
CREATE INDEX "provider_disclosures_provider_id_idx" ON "provider_disclosures"("provider_id");

-- CreateIndex
CREATE INDEX "provider_identifiers_provider_id_idx" ON "provider_identifiers"("provider_id");

-- CreateIndex
CREATE INDEX "supervising_physicians_provider_id_idx" ON "supervising_physicians"("provider_id");

-- CreateIndex
CREATE INDEX "work_histories_provider_id_idx" ON "work_histories"("provider_id");
