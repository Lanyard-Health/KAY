-- Migration: extend_workflow_action_types
-- Adds new action type enum values to support researched payer workflow templates

ALTER TYPE "WorkflowActionType" ADD VALUE IF NOT EXISTS 'payer_review';
ALTER TYPE "WorkflowActionType" ADD VALUE IF NOT EXISTS 'payer_outreach';
ALTER TYPE "WorkflowActionType" ADD VALUE IF NOT EXISTS 'payer_internal';
ALTER TYPE "WorkflowActionType" ADD VALUE IF NOT EXISTS 'committee_review';
ALTER TYPE "WorkflowActionType" ADD VALUE IF NOT EXISTS 'contract_execution';
ALTER TYPE "WorkflowActionType" ADD VALUE IF NOT EXISTS 'contract_delivery';
ALTER TYPE "WorkflowActionType" ADD VALUE IF NOT EXISTS 'document_review';
ALTER TYPE "WorkflowActionType" ADD VALUE IF NOT EXISTS 'site_visit';
ALTER TYPE "WorkflowActionType" ADD VALUE IF NOT EXISTS 'system_processing';
ALTER TYPE "WorkflowActionType" ADD VALUE IF NOT EXISTS 'routing_decision';
ALTER TYPE "WorkflowActionType" ADD VALUE IF NOT EXISTS 'confirmation';
ALTER TYPE "WorkflowActionType" ADD VALUE IF NOT EXISTS 'account_creation';
