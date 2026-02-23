-- CreateTable
CREATE TABLE "BugFingerprint" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "errorClass" TEXT,
    "linearIssueId" TEXT,
    "linearIssueUrl" TEXT,
    "currentSeverity" TEXT NOT NULL DEFAULT 'medium',
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "pendingSync" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BugFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BugFingerprint_hash_key" ON "BugFingerprint"("hash");

-- CreateIndex
CREATE INDEX "BugFingerprint_hash_idx" ON "BugFingerprint"("hash");

-- CreateIndex
CREATE INDEX "BugFingerprint_source_idx" ON "BugFingerprint"("source");

-- CreateIndex
CREATE INDEX "BugFingerprint_lastSeenAt_idx" ON "BugFingerprint"("lastSeenAt");

-- CreateIndex
CREATE INDEX "BugFingerprint_pendingSync_idx" ON "BugFingerprint"("pendingSync");
