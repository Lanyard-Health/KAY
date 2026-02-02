-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "caqh_credentials_last_checked" TIMESTAMP(3),
ADD COLUMN     "caqh_credentials_valid" BOOLEAN,
ADD COLUMN     "caqh_password" TEXT,
ADD COLUMN     "caqh_username" TEXT;
