-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('SEMANTIC', 'EPISODIC', 'PROCEDURAL', 'WORKING', 'ORGANIZATIONAL');

-- CreateEnum
CREATE TYPE "MemoryStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'MERGED', 'ARCHIVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MemorySource" AS ENUM ('DOCUMENT', 'EMAIL', 'CALENDAR', 'MEETING', 'KNOWLEDGE', 'GIT', 'SLACK', 'MANUAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MemoryEventType" AS ENUM ('DOCUMENT_IMPORTED', 'DOCUMENT_UPDATED', 'EMAIL_RECEIVED', 'CALENDAR_UPDATED', 'KNOWLEDGE_OBJECT_CREATED', 'KNOWLEDGE_OBJECT_UPDATED', 'KNOWLEDGE_RELATIONSHIP_CHANGED', 'MEETING_TRANSCRIPT', 'GIT_COMMIT', 'PULL_REQUEST', 'SLACK_MESSAGE');

-- CreateEnum
CREATE TYPE "MemoryEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EntityTimelineEventType" AS ENUM ('CREATED', 'ASSIGNED', 'MENTIONED', 'DISCUSSED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'DECISION_MADE', 'UPDATED', 'RELATIONSHIP_CHANGED', 'RESOLVED', 'RELEASED', 'MERGED', 'CONFLICT_DETECTED', 'OTHER');

-- CreateEnum
CREATE TYPE "ConflictStatus" AS ENUM ('OPEN', 'AUTO_RESOLVED', 'MANUALLY_RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ConflictResolution" AS ENUM ('LATEST_WINS', 'HIGHEST_CONFIDENCE', 'SOURCE_PRIORITY', 'MANUAL');

-- CreateTable
CREATE TABLE "memories" (
    "id" UUID NOT NULL,
    "memoryType" "MemoryType" NOT NULL,
    "subject" TEXT NOT NULL,
    "normalizedSubject" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "entityId" UUID,
    "entityType" TEXT,
    "entityLabel" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source" "MemorySource" NOT NULL,
    "status" "MemoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "references" JSONB,
    "attributes" JSONB,
    "metadata" JSONB,
    "mergedIntoId" UUID,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_versions" (
    "id" UUID NOT NULL,
    "memoryId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeType" TEXT NOT NULL,
    "changeSummary" TEXT,
    "changedBy" TEXT,
    "sourceEventId" UUID,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_events" (
    "id" UUID NOT NULL,
    "type" "MemoryEventType" NOT NULL,
    "source" "MemorySource" NOT NULL,
    "status" "MemoryEventStatus" NOT NULL DEFAULT 'PENDING',
    "dedupeHash" TEXT NOT NULL,
    "entityId" UUID,
    "entityHint" TEXT,
    "documentId" UUID,
    "externalId" TEXT,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memoryId" UUID,
    "workflowId" TEXT,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "memory_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_timelines" (
    "id" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "entityType" TEXT,
    "entityLabel" TEXT,
    "summary" TEXT,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "firstEventAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "memory_timelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_timeline_events" (
    "id" UUID NOT NULL,
    "timelineId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "type" "EntityTimelineEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source" "MemorySource" NOT NULL,
    "dedupeHash" TEXT NOT NULL,
    "memoryId" UUID,
    "eventId" UUID,
    "documentId" UUID,
    "actor" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_records" (
    "id" UUID NOT NULL,
    "memoryId" UUID NOT NULL,
    "entityId" UUID,
    "attribute" TEXT NOT NULL,
    "latestValue" JSONB NOT NULL,
    "previousValue" JSONB NOT NULL,
    "latestSource" "MemorySource" NOT NULL,
    "previousSource" "MemorySource" NOT NULL,
    "latestConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "previousConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "latestAt" TIMESTAMP(3) NOT NULL,
    "previousAt" TIMESTAMP(3) NOT NULL,
    "status" "ConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "ConflictResolution",
    "resolvedValue" JSONB,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "conflict_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_states" (
    "id" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "entityType" TEXT,
    "label" TEXT,
    "currentState" JSONB NOT NULL,
    "status" TEXT,
    "priority" TEXT,
    "assignee" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "memoryCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "entity_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_scores" (
    "id" UUID NOT NULL,
    "memoryId" UUID NOT NULL,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freshness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "frequency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "composite" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "frequencyCount" INTEGER NOT NULL DEFAULT 1,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memories_organizationId_memoryType_idx" ON "memories"("organizationId", "memoryType");

-- CreateIndex
CREATE INDEX "memories_organizationId_entityId_idx" ON "memories"("organizationId", "entityId");

-- CreateIndex
CREATE INDEX "memories_organizationId_status_idx" ON "memories"("organizationId", "status");

-- CreateIndex
CREATE INDEX "memories_organizationId_updatedAt_idx" ON "memories"("organizationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "memories_organizationId_memoryType_dedupeKey_key" ON "memories"("organizationId", "memoryType", "dedupeKey");

-- CreateIndex
CREATE INDEX "memory_versions_organizationId_createdAt_idx" ON "memory_versions"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "memory_versions_memoryId_version_key" ON "memory_versions"("memoryId", "version");

-- CreateIndex
CREATE INDEX "memory_events_organizationId_status_idx" ON "memory_events"("organizationId", "status");

-- CreateIndex
CREATE INDEX "memory_events_organizationId_occurredAt_idx" ON "memory_events"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "memory_events_entityId_idx" ON "memory_events"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "memory_events_organizationId_dedupeHash_key" ON "memory_events"("organizationId", "dedupeHash");

-- CreateIndex
CREATE INDEX "memory_timelines_organizationId_lastEventAt_idx" ON "memory_timelines"("organizationId", "lastEventAt");

-- CreateIndex
CREATE UNIQUE INDEX "memory_timelines_organizationId_entityId_key" ON "memory_timelines"("organizationId", "entityId");

-- CreateIndex
CREATE INDEX "memory_timeline_events_timelineId_occurredAt_idx" ON "memory_timeline_events"("timelineId", "occurredAt");

-- CreateIndex
CREATE INDEX "memory_timeline_events_organizationId_occurredAt_idx" ON "memory_timeline_events"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "memory_timeline_events_entityId_occurredAt_idx" ON "memory_timeline_events"("entityId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "memory_timeline_events_timelineId_dedupeHash_key" ON "memory_timeline_events"("timelineId", "dedupeHash");

-- CreateIndex
CREATE INDEX "conflict_records_organizationId_status_idx" ON "conflict_records"("organizationId", "status");

-- CreateIndex
CREATE INDEX "conflict_records_memoryId_idx" ON "conflict_records"("memoryId");

-- CreateIndex
CREATE INDEX "entity_states_organizationId_updatedAt_idx" ON "entity_states"("organizationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "entity_states_organizationId_entityId_key" ON "entity_states"("organizationId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "memory_scores_memoryId_key" ON "memory_scores"("memoryId");

-- CreateIndex
CREATE INDEX "memory_scores_organizationId_composite_idx" ON "memory_scores"("organizationId", "composite");

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_versions" ADD CONSTRAINT "memory_versions_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_events" ADD CONSTRAINT "memory_events_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_timeline_events" ADD CONSTRAINT "memory_timeline_events_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "memory_timelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_records" ADD CONSTRAINT "conflict_records_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_scores" ADD CONSTRAINT "memory_scores_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

