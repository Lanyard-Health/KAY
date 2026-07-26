-- Sync enum with dev DB drift: CAQH credential update notifications.
-- IF NOT EXISTS because dev already has the value out-of-band.
ALTER TYPE "InAppNotificationType" ADD VALUE IF NOT EXISTS 'caqh_credentials_updated';
