-- AlterTable
ALTER TABLE "agent_events" ADD COLUMN     "signature" TEXT,
ADD COLUMN     "signature_key_id" TEXT,
ADD COLUMN     "prev_hash" TEXT,
ADD COLUMN     "event_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "agent_events_workflow_id_event_hash_key" ON "agent_events"("workflow_id", "event_hash");
