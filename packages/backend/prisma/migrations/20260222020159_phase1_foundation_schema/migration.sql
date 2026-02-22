-- CreateEnum
CREATE TYPE "ServiceTier" AS ENUM ('full_service', 'white_glove', 'self_serve');

-- CreateEnum
CREATE TYPE "OpsWorkItemStatus" AS ENUM ('backlog', 'todo', 'in_progress', 'waiting_external', 'review', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "OpsWorkItemPriority" AS ENUM ('urgent', 'high', 'normal', 'low');

-- CreateEnum
CREATE TYPE "OpsWorkItemCategory" AS ENUM ('initial_enrollment', 're_credentialing', 'follow_up', 'document_collection', 'payer_outreach', 'data_entry', 'verification', 'termination', 'general');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('STARTER', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'PAUSED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'ops_staff';

-- AlterTable
ALTER TABLE "payer_enrollments" ADD COLUMN     "sla_breached_at" TIMESTAMP(3),
ADD COLUMN     "sla_target_date" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payers" ADD COLUMN     "average_processing_days" INTEGER,
ADD COLUMN     "vertical_tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "practices" ADD COLUMN     "billing_email" TEXT,
ADD COLUMN     "contract_end_date" TIMESTAMP(3),
ADD COLUMN     "contract_start_date" TIMESTAMP(3),
ADD COLUMN     "group_npi" TEXT,
ADD COLUMN     "onboarded_at" TIMESTAMP(3),
ADD COLUMN     "primary_ops_staff_id" TEXT,
ADD COLUMN     "service_tier" "ServiceTier" NOT NULL DEFAULT 'self_serve',
ADD COLUMN     "setup_complete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sla_target_days" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "tax_id" TEXT;

-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "onboarding_data" JSONB;

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT NOT NULL,
    "stripe_customer_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT,
    "stripe_price_id" TEXT,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'STARTER',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "provider_count" INTEGER NOT NULL DEFAULT 0,
    "provider_limit" INTEGER NOT NULL DEFAULT 10,
    "trial_ends_at" TIMESTAMP(3),
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "stripe_invoice_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "invoice_url" TEXT,
    "pdf_url" TEXT,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_assignments" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "practice_id" TEXT,
    "provider_id" TEXT,
    "enrollment_id" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_id" TEXT NOT NULL,
    "unassigned_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_work_items" (
    "id" TEXT NOT NULL,
    "practice_id" TEXT,
    "provider_id" TEXT,
    "enrollment_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "OpsWorkItemCategory" NOT NULL,
    "status" "OpsWorkItemStatus" NOT NULL DEFAULT 'todo',
    "priority" "OpsWorkItemPriority" NOT NULL DEFAULT 'normal',
    "assigned_to_id" TEXT,
    "due_date" TIMESTAMP(3),
    "sla_deadline" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "estimated_minutes" INTEGER,
    "actual_minutes" INTEGER,
    "blocker_notes" TEXT,
    "parent_work_item_id" TEXT,
    "source_task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_work_item_comments" (
    "id" TEXT NOT NULL,
    "work_item_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_work_item_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_practice_id_key" ON "subscriptions"("practice_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_customer_id_key" ON "subscriptions"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_stripe_invoice_id_key" ON "invoices"("stripe_invoice_id");

-- CreateIndex
CREATE INDEX "ops_work_items_assigned_to_id_status_idx" ON "ops_work_items"("assigned_to_id", "status");

-- CreateIndex
CREATE INDEX "ops_work_items_status_priority_idx" ON "ops_work_items"("status", "priority");

-- CreateIndex
CREATE INDEX "ops_work_items_due_date_idx" ON "ops_work_items"("due_date");

-- CreateIndex
CREATE INDEX "ops_work_items_sla_deadline_idx" ON "ops_work_items"("sla_deadline");

-- CreateIndex
CREATE INDEX "ops_work_item_comments_work_item_id_idx" ON "ops_work_item_comments"("work_item_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_assignments" ADD CONSTRAINT "ops_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_assignments" ADD CONSTRAINT "ops_assignments_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_assignments" ADD CONSTRAINT "ops_assignments_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_assignments" ADD CONSTRAINT "ops_assignments_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "payer_enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_assignments" ADD CONSTRAINT "ops_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_work_items" ADD CONSTRAINT "ops_work_items_practice_id_fkey" FOREIGN KEY ("practice_id") REFERENCES "practices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_work_items" ADD CONSTRAINT "ops_work_items_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_work_items" ADD CONSTRAINT "ops_work_items_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "payer_enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_work_items" ADD CONSTRAINT "ops_work_items_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_work_items" ADD CONSTRAINT "ops_work_items_parent_work_item_id_fkey" FOREIGN KEY ("parent_work_item_id") REFERENCES "ops_work_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_work_item_comments" ADD CONSTRAINT "ops_work_item_comments_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "ops_work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_work_item_comments" ADD CONSTRAINT "ops_work_item_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
