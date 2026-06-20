-- Track which signup/login reminder stages were sent (at-most-once, mirrors CAQH remindersSent).
ALTER TABLE "practice_invitations" ADD COLUMN "reminders_sent" JSONB;
ALTER TABLE "users" ADD COLUMN "signup_reminders_sent" JSONB;
