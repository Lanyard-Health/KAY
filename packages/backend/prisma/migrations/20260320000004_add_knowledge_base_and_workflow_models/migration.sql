-- ProviderCaqhMirror
CREATE TABLE "provider_caqh_mirrors" (
    "id" TEXT NOT NULL,
    "provider_profile_id" TEXT NOT NULL,
    "raw_json" JSONB NOT NULL,
    "licenses" JSONB,
    "dea_registrations" JSONB,
    "education" JSONB,
    "work_history" JSONB,
    "malpractice" JSONB,
    "hospital_affiliations" JSONB,
    "board_certifications" JSONB,
    "last_pulled_at" TIMESTAMP(3) NOT NULL,
    "sync_status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_caqh_mirrors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "provider_caqh_mirrors_provider_profile_id_key" ON "provider_caqh_mirrors"("provider_profile_id");
ALTER TABLE "provider_caqh_mirrors" ADD CONSTRAINT "provider_caqh_mirrors_provider_profile_id_fkey" FOREIGN KEY ("provider_profile_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PayerTrack
CREATE TABLE "payer_tracks" (
    "id" TEXT NOT NULL,
    "payer_name" TEXT NOT NULL,
    "parent_org" TEXT,
    "payer_type" TEXT NOT NULL,
    "state_region" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "submission_method" TEXT NOT NULL,
    "enrollment_link" TEXT,
    "portal_url" TEXT,
    "product_lines" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payer_tracks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payer_tracks_payer_name_track_state_region_key" ON "payer_tracks"("payer_name", "track", "state_region");

-- PayerContact
CREATE TABLE "payer_contacts" (
    "id" TEXT NOT NULL,
    "payer_track_id" TEXT NOT NULL,
    "contact_type" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "fax" TEXT,
    "portal_url" TEXT,
    "hours" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payer_contacts_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "payer_contacts" ADD CONSTRAINT "payer_contacts_payer_track_id_fkey" FOREIGN KEY ("payer_track_id") REFERENCES "payer_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PayerTimeline
CREATE TABLE "payer_timelines" (
    "id" TEXT NOT NULL,
    "payer_track_id" TEXT NOT NULL,
    "process_type" TEXT NOT NULL,
    "min_days" INTEGER,
    "max_days" INTEGER,
    "state_overrides" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payer_timelines_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "payer_timelines" ADD CONSTRAINT "payer_timelines_payer_track_id_fkey" FOREIGN KEY ("payer_track_id") REFERENCES "payer_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PayerStateRule
CREATE TABLE "payer_state_rules" (
    "id" TEXT NOT NULL,
    "payer_track_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "effective_date" TIMESTAMP(3),
    "expiration_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payer_state_rules_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "payer_state_rules" ADD CONSTRAINT "payer_state_rules_payer_track_id_fkey" FOREIGN KEY ("payer_track_id") REFERENCES "payer_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PayerForm
CREATE TABLE "payer_forms" (
    "id" TEXT NOT NULL,
    "payer_track_id" TEXT NOT NULL,
    "form_name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "url" TEXT,
    "destination" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payer_forms_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "payer_forms" ADD CONSTRAINT "payer_forms_payer_track_id_fkey" FOREIGN KEY ("payer_track_id") REFERENCES "payer_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RequirementUniversal
CREATE TABLE "requirement_universals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "applies_to" TEXT NOT NULL,
    "is_blocking" BOOLEAN NOT NULL,
    "standard_minimum" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirement_universals_pkey" PRIMARY KEY ("id")
);

-- PayerRequirement
CREATE TABLE "payer_requirements" (
    "id" TEXT NOT NULL,
    "payer_track_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "override_type" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "applies_to" TEXT,
    "is_blocking" BOOLEAN NOT NULL,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payer_requirements_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "payer_requirements" ADD CONSTRAINT "payer_requirements_payer_track_id_fkey" FOREIGN KEY ("payer_track_id") REFERENCES "payer_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- KnowledgeBaseEmbedding
CREATE TABLE "knowledge_base_embeddings" (
    "id" TEXT NOT NULL,
    "payer_track_id" TEXT,
    "payer_requirement_id" TEXT,
    "payer_state_rule_id" TEXT,
    "payer_timeline_id" TEXT,
    "payer_form_id" TEXT,
    "requirement_universal_id" TEXT,
    "content_text" TEXT NOT NULL,
    "embedding" vector(1536),
    "model_used" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_base_embeddings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "knowledge_base_embeddings_payer_track_id_idx" ON "knowledge_base_embeddings"("payer_track_id");
CREATE INDEX "knowledge_base_embeddings_payer_requirement_id_idx" ON "knowledge_base_embeddings"("payer_requirement_id");
ALTER TABLE "knowledge_base_embeddings" ADD CONSTRAINT "knowledge_base_embeddings_payer_track_id_fkey" FOREIGN KEY ("payer_track_id") REFERENCES "payer_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_base_embeddings" ADD CONSTRAINT "knowledge_base_embeddings_payer_requirement_id_fkey" FOREIGN KEY ("payer_requirement_id") REFERENCES "payer_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_base_embeddings" ADD CONSTRAINT "knowledge_base_embeddings_payer_state_rule_id_fkey" FOREIGN KEY ("payer_state_rule_id") REFERENCES "payer_state_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_base_embeddings" ADD CONSTRAINT "knowledge_base_embeddings_payer_timeline_id_fkey" FOREIGN KEY ("payer_timeline_id") REFERENCES "payer_timelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_base_embeddings" ADD CONSTRAINT "knowledge_base_embeddings_payer_form_id_fkey" FOREIGN KEY ("payer_form_id") REFERENCES "payer_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_base_embeddings" ADD CONSTRAINT "knowledge_base_embeddings_requirement_universal_id_fkey" FOREIGN KEY ("requirement_universal_id") REFERENCES "requirement_universals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- WorkflowTemplate
CREATE TABLE "workflow_templates" (
    "id" TEXT NOT NULL,
    "payer_track_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "created_by" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_payer_track_id_fkey" FOREIGN KEY ("payer_track_id") REFERENCES "payer_tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- WorkflowTemplateStep
CREATE TABLE "workflow_template_steps" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "step_type" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "required_documents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trigger_days_after_prev" INTEGER,
    "is_blocking" BOOLEAN NOT NULL DEFAULT true,
    "reviewer_instructions" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_template_steps_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "workflow_template_steps" ADD CONSTRAINT "workflow_template_steps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- WorkflowTemplateCondition
CREATE TABLE "workflow_template_conditions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "condition_type" TEXT NOT NULL,
    "condition_value" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_step_order" INTEGER,
    "step_definition" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_template_conditions_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "workflow_template_conditions" ADD CONSTRAINT "workflow_template_conditions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FollowUpTemplate
CREATE TABLE "follow_up_templates" (
    "id" TEXT NOT NULL,
    "payer_track_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "created_by" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_templates_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "follow_up_templates" ADD CONSTRAINT "follow_up_templates_payer_track_id_fkey" FOREIGN KEY ("payer_track_id") REFERENCES "payer_tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FollowUpTemplateStep
CREATE TABLE "follow_up_template_steps" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "trigger_days_after_prev" INTEGER NOT NULL,
    "escalation_level" INTEGER NOT NULL DEFAULT 1,
    "email_subject" TEXT,
    "email_body_template" TEXT,
    "email_tone" TEXT,
    "retell_script_template" TEXT,
    "retell_agent_id" TEXT,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_template_steps_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "follow_up_template_steps" ADD CONSTRAINT "follow_up_template_steps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "follow_up_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FollowUpRun
CREATE TABLE "follow_up_runs" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "current_step_order" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_runs_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "follow_up_runs" ADD CONSTRAINT "follow_up_runs_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "payer_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_up_runs" ADD CONSTRAINT "follow_up_runs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "follow_up_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RetellCallLog
CREATE TABLE "retell_call_logs" (
    "id" TEXT NOT NULL,
    "follow_up_run_id" TEXT NOT NULL,
    "retell_call_id" TEXT NOT NULL,
    "payer_contact_id" TEXT,
    "phone_number" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "outcome" TEXT,
    "transcript" TEXT,
    "duration_seconds" INTEGER,
    "called_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retell_call_logs_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "retell_call_logs" ADD CONSTRAINT "retell_call_logs_follow_up_run_id_fkey" FOREIGN KEY ("follow_up_run_id") REFERENCES "follow_up_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DenialTriage
CREATE TABLE "denial_triages" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "denial_reason" TEXT NOT NULL,
    "denial_date" TIMESTAMP(3) NOT NULL,
    "triage_report" TEXT,
    "identified_gaps" JSONB,
    "recommended_action" TEXT,
    "recommended_steps" JSONB,
    "status" TEXT NOT NULL,
    "reviewed_by" TEXT NOT NULL,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "model_used" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "denial_triages_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "denial_triages" ADD CONSTRAINT "denial_triages_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "payer_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add foreign keys from Enrollment to PayerTrack and WorkflowTemplate
ALTER TABLE "payer_enrollments" ADD CONSTRAINT "payer_enrollments_payer_track_id_fkey" FOREIGN KEY ("payer_track_id") REFERENCES "payer_tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payer_enrollments" ADD CONSTRAINT "payer_enrollments_workflow_template_id_fkey" FOREIGN KEY ("workflow_template_id") REFERENCES "workflow_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
