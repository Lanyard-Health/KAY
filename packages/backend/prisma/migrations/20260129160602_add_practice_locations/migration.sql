-- CreateTable
CREATE TABLE "practice_locations" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "location_name" TEXT NOT NULL,
    "location_type" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "address_line_1" TEXT NOT NULL,
    "address_line_2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip_code" TEXT NOT NULL,
    "county" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "phone" TEXT NOT NULL,
    "fax" TEXT,
    "email" TEXT,
    "tax_id" TEXT,
    "npi" TEXT,
    "office_hours" JSONB,
    "wheelchair_accessible" BOOLEAN NOT NULL DEFAULT false,
    "public_transit_access" BOOLEAN NOT NULL DEFAULT false,
    "parking_available" BOOLEAN NOT NULL DEFAULT true,
    "accepting_new_patients" BOOLEAN NOT NULL DEFAULT true,
    "languages_spoken" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "special_services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "practice_locations_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "practice_locations" ADD CONSTRAINT "practice_locations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
