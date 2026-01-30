-- AlterTable
ALTER TABLE "payer_enrollments" ADD COLUMN     "date_contract_received" TIMESTAMP(3),
ADD COLUMN     "date_contract_signed" TIMESTAMP(3),
ADD COLUMN     "last_follow_up_date" TIMESTAMP(3),
ADD COLUMN     "product_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "recredentialing_date" TIMESTAMP(3);
