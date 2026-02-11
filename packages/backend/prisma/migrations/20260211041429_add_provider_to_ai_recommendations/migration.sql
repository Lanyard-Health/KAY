-- AlterTable
ALTER TABLE "ai_recommendations" ADD COLUMN     "provider_id" TEXT,
ALTER COLUMN "enrollment_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ai_recommendations_provider_id_idx" ON "ai_recommendations"("provider_id");

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
