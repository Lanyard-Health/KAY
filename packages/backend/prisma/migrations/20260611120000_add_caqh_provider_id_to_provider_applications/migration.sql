-- CAQH-first onboarding PR 1: capture CAQH Provider ID at registration.
-- Copied to provider_profiles.caqh_provider_id on application approval.
ALTER TABLE "provider_applications" ADD COLUMN "caqh_provider_id" TEXT;
