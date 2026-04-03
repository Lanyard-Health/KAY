-- CreateIndex
CREATE INDEX "payer_enrollments_status_idx" ON "payer_enrollments"("status");

-- CreateIndex
CREATE INDEX "payer_enrollments_payer_id_idx" ON "payer_enrollments"("payer_id");

-- CreateIndex
CREATE INDEX "documents_ocr_status_idx" ON "documents"("ocr_status");

-- CreateIndex
CREATE INDEX "aetna_enrollment_runs_status_idx" ON "aetna_enrollment_runs"("status");

-- CreateIndex
CREATE INDEX "follow_up_runs_status_idx" ON "follow_up_runs"("status");
