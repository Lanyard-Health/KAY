-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'enrollment_follow_up';

-- AlterTable
ALTER TABLE "payer_enrollments" ADD COLUMN     "follow_up_email" TEXT,
ADD COLUMN     "follow_up_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "follow_up_frequency_days" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "last_follow_up_sent_at" TIMESTAMP(3),
ADD COLUMN     "next_follow_up_date" TIMESTAMP(3);
