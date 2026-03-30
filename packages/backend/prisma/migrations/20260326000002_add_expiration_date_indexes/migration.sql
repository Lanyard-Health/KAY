-- CreateIndex
CREATE INDEX "licenses_expiration_date_idx" ON "licenses"("expiration_date");

-- CreateIndex
CREATE INDEX "board_certifications_expiration_date_idx" ON "board_certifications"("expiration_date");

-- CreateIndex
CREATE INDEX "malpractice_insurances_expiration_date_idx" ON "malpractice_insurances"("expiration_date");
