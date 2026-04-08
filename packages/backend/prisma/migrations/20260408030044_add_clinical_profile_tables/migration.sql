-- CreateEnum
CREATE TYPE "TaxonomySection" AS ENUM ('INDIVIDUAL', 'NON_INDIVIDUAL');

-- CreateEnum
CREATE TYPE "ServiceDomain" AS ENUM ('BEHAVIORAL_HEALTH', 'WOMENS_HEALTH', 'PRIMARY_CARE');

-- CreateEnum
CREATE TYPE "CustomServiceStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "organization_type_id" TEXT;

-- CreateTable
CREATE TABLE "organization_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specialties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxonomy_section" "TaxonomySection" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_specialties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" "ServiceDomain" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_offerings" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "cpt_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "service_category_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_age_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "age_range_start" INTEGER NOT NULL,
    "age_range_end" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_age_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_gender_identities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_convenience_toggle" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_gender_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_sexual_orientations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_convenience_toggle" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_sexual_orientations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "special_populations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "special_populations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_services" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "practice_id" TEXT,
    "provider_id" TEXT,
    "status" "CustomServiceStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_specialties" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "specialty_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_sub_specialties" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "sub_specialty_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_sub_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_services" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "service_offering_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_age_groups" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "patient_age_group_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_age_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_gender_identities" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "patient_gender_identity_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_gender_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_sexual_orientations" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "patient_sexual_orientation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_sexual_orientations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_special_populations" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "special_population_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_special_populations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_specialties" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "specialty_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_sub_specialties" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "sub_specialty_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_sub_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_services" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "service_offering_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_age_groups" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "patient_age_group_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_age_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_gender_identities" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "patient_gender_identity_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_gender_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_sexual_orientations" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "patient_sexual_orientation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_sexual_orientations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_special_populations" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "special_population_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_special_populations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_types_name_key" ON "organization_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "organization_types_slug_key" ON "organization_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "specialties_name_taxonomy_section_key" ON "specialties"("name", "taxonomy_section");

-- CreateIndex
CREATE UNIQUE INDEX "sub_specialties_name_specialty_id_key" ON "sub_specialties"("name", "specialty_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_name_domain_key" ON "service_categories"("name", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_slug_domain_key" ON "service_categories"("slug", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "service_offerings_name_service_category_id_key" ON "service_offerings"("name", "service_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_age_groups_name_key" ON "patient_age_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "patient_age_groups_slug_key" ON "patient_age_groups"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "patient_gender_identities_name_key" ON "patient_gender_identities"("name");

-- CreateIndex
CREATE UNIQUE INDEX "patient_gender_identities_slug_key" ON "patient_gender_identities"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "patient_sexual_orientations_name_key" ON "patient_sexual_orientations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "patient_sexual_orientations_slug_key" ON "patient_sexual_orientations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "special_populations_name_key" ON "special_populations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "special_populations_slug_key" ON "special_populations"("slug");

-- CreateIndex
CREATE INDEX "practice_specialties_practice_id_idx" ON "practice_specialties"("practice_id");

-- CreateIndex
CREATE UNIQUE INDEX "practice_specialties_practice_id_specialty_id_key" ON "practice_specialties"("practice_id", "specialty_id");

-- CreateIndex
CREATE INDEX "practice_sub_specialties_practice_id_idx" ON "practice_sub_specialties"("practice_id");

-- CreateIndex
CREATE UNIQUE INDEX "practice_sub_specialties_practice_id_sub_specialty_id_key" ON "practice_sub_specialties"("practice_id", "sub_specialty_id");

-- CreateIndex
CREATE INDEX "practice_services_practice_id_idx" ON "practice_services"("practice_id");

-- CreateIndex
CREATE UNIQUE INDEX "practice_services_practice_id_service_offering_id_key" ON "practice_services"("practice_id", "service_offering_id");

-- CreateIndex
CREATE INDEX "practice_age_groups_practice_id_idx" ON "practice_age_groups"("practice_id");

-- CreateIndex
CREATE UNIQUE INDEX "practice_age_groups_practice_id_patient_age_group_id_key" ON "practice_age_groups"("practice_id", "patient_age_group_id");

-- CreateIndex
CREATE INDEX "practice_gender_identities_practice_id_idx" ON "practice_gender_identities"("practice_id");

-- CreateIndex
CREATE UNIQUE INDEX "practice_gender_identities_practice_id_patient_gender_ident_key" ON "practice_gender_identities"("practice_id", "patient_gender_identity_id");

-- CreateIndex
CREATE INDEX "practice_sexual_orientations_practice_id_idx" ON "practice_sexual_orientations"("practice_id");

-- CreateIndex
CREATE UNIQUE INDEX "practice_sexual_orientations_practice_id_patient_sexual_ori_key" ON "practice_sexual_orientations"("practice_id", "patient_sexual_orientation_id");

-- CreateIndex
CREATE INDEX "practice_special_populations_practice_id_idx" ON "practice_special_populations"("practice_id");

-- CreateIndex
CREATE UNIQUE INDEX "practice_special_populations_practice_id_special_population_key" ON "practice_special_populations"("practice_id", "special_population_id");

-- CreateIndex
CREATE INDEX "provider_specialties_provider_id_idx" ON "provider_specialties"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_specialties_provider_id_specialty_id_key" ON "provider_specialties"("provider_id", "specialty_id");

-- CreateIndex
CREATE INDEX "provider_sub_specialties_provider_id_idx" ON "provider_sub_specialties"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_sub_specialties_provider_id_sub_specialty_id_key" ON "provider_sub_specialties"("provider_id", "sub_specialty_id");

-- CreateIndex
CREATE INDEX "provider_services_provider_id_idx" ON "provider_services"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_services_provider_id_service_offering_id_key" ON "provider_services"("provider_id", "service_offering_id");

-- CreateIndex
CREATE INDEX "provider_age_groups_provider_id_idx" ON "provider_age_groups"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_age_groups_provider_id_patient_age_group_id_key" ON "provider_age_groups"("provider_id", "patient_age_group_id");

-- CreateIndex
CREATE INDEX "provider_gender_identities_provider_id_idx" ON "provider_gender_identities"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_gender_identities_provider_id_patient_gender_ident_key" ON "provider_gender_identities"("provider_id", "patient_gender_identity_id");

-- CreateIndex
CREATE INDEX "provider_sexual_orientations_provider_id_idx" ON "provider_sexual_orientations"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_sexual_orientations_provider_id_patient_sexual_ori_key" ON "provider_sexual_orientations"("provider_id", "patient_sexual_orientation_id");

-- CreateIndex
CREATE INDEX "provider_special_populations_provider_id_idx" ON "provider_special_populations"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_special_populations_provider_id_special_population_key" ON "provider_special_populations"("provider_id", "special_population_id");

-- AddForeignKey
ALTER TABLE "practices" ADD CONSTRAINT "practices_organization_type_id_fkey" FOREIGN KEY ("organization_type_id") REFERENCES "organization_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_specialties" ADD CONSTRAINT "sub_specialties_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_offerings" ADD CONSTRAINT "service_offerings_service_category_id_fkey" FOREIGN KEY ("service_category_id") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_services" ADD CONSTRAINT "custom_services_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_services" ADD CONSTRAINT "custom_services_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_specialties" ADD CONSTRAINT "practice_specialties_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_specialties" ADD CONSTRAINT "practice_specialties_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sub_specialties" ADD CONSTRAINT "practice_sub_specialties_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sub_specialties" ADD CONSTRAINT "practice_sub_specialties_sub_specialty_id_fkey" FOREIGN KEY ("sub_specialty_id") REFERENCES "sub_specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_services" ADD CONSTRAINT "practice_services_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_services" ADD CONSTRAINT "practice_services_service_offering_id_fkey" FOREIGN KEY ("service_offering_id") REFERENCES "service_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_age_groups" ADD CONSTRAINT "practice_age_groups_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_age_groups" ADD CONSTRAINT "practice_age_groups_patient_age_group_id_fkey" FOREIGN KEY ("patient_age_group_id") REFERENCES "patient_age_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_gender_identities" ADD CONSTRAINT "practice_gender_identities_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_gender_identities" ADD CONSTRAINT "practice_gender_identities_patient_gender_identity_id_fkey" FOREIGN KEY ("patient_gender_identity_id") REFERENCES "patient_gender_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sexual_orientations" ADD CONSTRAINT "practice_sexual_orientations_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sexual_orientations" ADD CONSTRAINT "practice_sexual_orientations_patient_sexual_orientation_id_fkey" FOREIGN KEY ("patient_sexual_orientation_id") REFERENCES "patient_sexual_orientations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_special_populations" ADD CONSTRAINT "practice_special_populations_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_special_populations" ADD CONSTRAINT "practice_special_populations_special_population_id_fkey" FOREIGN KEY ("special_population_id") REFERENCES "special_populations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_specialties" ADD CONSTRAINT "provider_specialties_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_specialties" ADD CONSTRAINT "provider_specialties_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_sub_specialties" ADD CONSTRAINT "provider_sub_specialties_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_sub_specialties" ADD CONSTRAINT "provider_sub_specialties_sub_specialty_id_fkey" FOREIGN KEY ("sub_specialty_id") REFERENCES "sub_specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_service_offering_id_fkey" FOREIGN KEY ("service_offering_id") REFERENCES "service_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_age_groups" ADD CONSTRAINT "provider_age_groups_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_age_groups" ADD CONSTRAINT "provider_age_groups_patient_age_group_id_fkey" FOREIGN KEY ("patient_age_group_id") REFERENCES "patient_age_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_gender_identities" ADD CONSTRAINT "provider_gender_identities_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_gender_identities" ADD CONSTRAINT "provider_gender_identities_patient_gender_identity_id_fkey" FOREIGN KEY ("patient_gender_identity_id") REFERENCES "patient_gender_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_sexual_orientations" ADD CONSTRAINT "provider_sexual_orientations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_sexual_orientations" ADD CONSTRAINT "provider_sexual_orientations_patient_sexual_orientation_id_fkey" FOREIGN KEY ("patient_sexual_orientation_id") REFERENCES "patient_sexual_orientations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_special_populations" ADD CONSTRAINT "provider_special_populations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_special_populations" ADD CONSTRAINT "provider_special_populations_special_population_id_fkey" FOREIGN KEY ("special_population_id") REFERENCES "special_populations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
