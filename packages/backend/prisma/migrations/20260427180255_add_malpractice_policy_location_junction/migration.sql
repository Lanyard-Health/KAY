-- CreateTable
CREATE TABLE "malpractice_policy_locations" (
    "id" TEXT NOT NULL,
    "malpractice_insurance_id" TEXT NOT NULL,
    "practice_location_id" TEXT NOT NULL,
    "caqh_raw_label" TEXT,
    "matched_via" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "malpractice_policy_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "malpractice_policy_locations_practice_location_id_idx" ON "malpractice_policy_locations"("practice_location_id");

-- CreateIndex
CREATE UNIQUE INDEX "malpractice_policy_locations_malpractice_insurance_id_pract_key" ON "malpractice_policy_locations"("malpractice_insurance_id", "practice_location_id");

-- AddForeignKey
ALTER TABLE "malpractice_policy_locations" ADD CONSTRAINT "malpractice_policy_locations_malpractice_insurance_id_fkey" FOREIGN KEY ("malpractice_insurance_id") REFERENCES "malpractice_insurances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "malpractice_policy_locations" ADD CONSTRAINT "malpractice_policy_locations_practice_location_id_fkey" FOREIGN KEY ("practice_location_id") REFERENCES "practice_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
