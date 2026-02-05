-- CreateEnum
CREATE TYPE "AiRecommendationType" AS ENUM ('follow_up_email', 'strategy', 'priority_alert');

-- CreateEnum
CREATE TYPE "AiRecommendationStatus" AS ENUM ('pending', 'accepted', 'dismissed', 'expired');

-- CreateTable
CREATE TABLE "ai_recommendations" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "type" "AiRecommendationType" NOT NULL,
    "status" "AiRecommendationStatus" NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "reasoning" TEXT,
    "metadata" JSONB,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "model_used" TEXT,
    "acted_on_by" TEXT,
    "acted_on_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "columns" JSONB NOT NULL,
    "filters" JSONB,
    "sort_config" JSONB,
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roster_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_recommendations_enrollment_id_idx" ON "ai_recommendations"("enrollment_id");

-- CreateIndex
CREATE INDEX "ai_recommendations_type_idx" ON "ai_recommendations"("type");

-- CreateIndex
CREATE INDEX "ai_recommendations_status_idx" ON "ai_recommendations"("status");

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "payer_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_templates" ADD CONSTRAINT "roster_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
