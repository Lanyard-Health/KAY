-- Tier 1 #3: Stalled-task watchdog for jobs that vanish on Redis restart / deploy.
-- Adds a nullable timestamp the watchdog sets when it detects an orphaned task,
-- plus an index that lets the watchdog scan in_progress tasks by start time.
ALTER TABLE "agent_tasks" ADD COLUMN "stalled_detected_at" TIMESTAMP(3);

CREATE INDEX "agent_tasks_status_started_at_idx" ON "agent_tasks"("status", "started_at");
