-- CreateEnum
CREATE TYPE "PracticeInvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');


-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "billing_address_line_1" TEXT,
ADD COLUMN     "billing_address_line_2" TEXT,
ADD COLUMN     "billing_city" TEXT,
ADD COLUMN     "billing_clearinghouse" TEXT,
ADD COLUMN     "billing_state" TEXT,
ADD COLUMN     "billing_vendor" TEXT,
ADD COLUMN     "billing_zip_code" TEXT,
ADD COLUMN     "dba" TEXT,
ADD COLUMN     "emr_vendor" TEXT,
ADD COLUMN     "entity_type" TEXT,
ADD COLUMN     "legal_name" TEXT,
ADD COLUMN     "mailing_address_line_1" TEXT,
ADD COLUMN     "mailing_address_line_2" TEXT,
ADD COLUMN     "mailing_city" TEXT,
ADD COLUMN     "mailing_state" TEXT,
ADD COLUMN     "mailing_zip_code" TEXT,
ADD COLUMN     "tax_id_last4" TEXT;

-- CreateTable
CREATE TABLE "practice_owners" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ssn_encrypted" TEXT,
    "ssn_last4" TEXT,
    "ownership_percentage" DECIMAL(5,2),
    "date_of_birth_encrypted" TEXT,
    "home_address_line_1" TEXT,
    "home_address_line_2" TEXT,
    "home_city" TEXT,
    "home_state" TEXT,
    "home_zip_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "practice_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_invitations" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "PracticeRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "PracticeInvitationStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "invited_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_owners_practice_id_idx" ON "practice_owners"("practice_id");

-- CreateIndex
CREATE UNIQUE INDEX "practice_invitations_token_hash_key" ON "practice_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "practice_invitations_practice_id_idx" ON "practice_invitations"("practice_id");

-- CreateIndex
CREATE INDEX "practice_invitations_email_idx" ON "practice_invitations"("email");

-- AddForeignKey
ALTER TABLE "practice_owners" ADD CONSTRAINT "practice_owners_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_owners" ADD CONSTRAINT "practice_owners_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_owners" ADD CONSTRAINT "practice_owners_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_invitations" ADD CONSTRAINT "practice_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_invitations" ADD CONSTRAINT "practice_invitations_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

