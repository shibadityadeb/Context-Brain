-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'JOINING', 'WAITING', 'LIVE', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'MISSED');

-- CreateEnum
CREATE TYPE "MeetingBotStatus" AS ENUM ('IDLE', 'DISPATCHED', 'JOINING', 'WAITING_ADMISSION', 'CAPTURING', 'LEFT', 'ERROR');

-- CreateEnum
CREATE TYPE "MeetingItemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MeetingParticipantRole" AS ENUM ('HOST', 'ATTENDEE', 'BOT');

-- CreateEnum
CREATE TYPE "MeetingItemSource" AS ENUM ('CALENDAR', 'TRANSCRIPT', 'DETECTED');

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "meetUrl" TEXT NOT NULL,
    "connectorId" UUID,
    "calendarEventExternalId" TEXT,
    "calendarId" TEXT,
    "organizerEmail" TEXT,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "botStatus" "MeetingBotStatus" NOT NULL DEFAULT 'IDLE',
    "botSessionId" TEXT,
    "workflowId" TEXT,
    "runId" TEXT,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "decisionCount" INTEGER NOT NULL DEFAULT 0,
    "taskCount" INTEGER NOT NULL DEFAULT 0,
    "topicCount" INTEGER NOT NULL DEFAULT 0,
    "memoryCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "metadata" JSONB,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_chunks" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "speakerId" UUID,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "processedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "transcript_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "speakers" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "resolvedEntityId" UUID,
    "participantId" UUID,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "speakers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_summaries" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "executive" TEXT NOT NULL,
    "detailed" TEXT NOT NULL,
    "keyPoints" JSONB,
    "followUps" JSONB,
    "sentiment" TEXT,
    "model" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "meeting_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_decisions" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "owner" TEXT,
    "rationale" TEXT,
    "transcriptChunkId" UUID,
    "knowledgeObjectId" UUID,
    "source" "MeetingItemSource" NOT NULL DEFAULT 'TRANSCRIPT',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "meeting_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_tasks" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "owner" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "MeetingItemStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "KnowledgePriority" NOT NULL DEFAULT 'NONE',
    "transcriptChunkId" UUID,
    "knowledgeObjectId" UUID,
    "source" "MeetingItemSource" NOT NULL DEFAULT 'TRANSCRIPT',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "meeting_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_topics" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'topic',
    "transcriptChunkId" UUID,
    "knowledgeObjectId" UUID,
    "source" "MeetingItemSource" NOT NULL DEFAULT 'TRANSCRIPT',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "meeting_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "role" "MeetingParticipantRole" NOT NULL DEFAULT 'ATTENDEE',
    "source" "MeetingItemSource" NOT NULL DEFAULT 'CALENDAR',
    "resolvedEntityId" UUID,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_memories" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "memoryId" UUID,
    "memoryEventId" UUID,
    "entityId" UUID,
    "kind" TEXT NOT NULL DEFAULT 'transcript',
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "meeting_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meetings_organizationId_status_idx" ON "meetings"("organizationId", "status");

-- CreateIndex
CREATE INDEX "meetings_organizationId_scheduledStart_idx" ON "meetings"("organizationId", "scheduledStart");

-- CreateIndex
CREATE INDEX "meetings_workflowId_idx" ON "meetings"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_organizationId_meetUrl_scheduledStart_key" ON "meetings"("organizationId", "meetUrl", "scheduledStart");

-- CreateIndex
CREATE INDEX "transcript_chunks_meetingId_startMs_idx" ON "transcript_chunks"("meetingId", "startMs");

-- CreateIndex
CREATE INDEX "transcript_chunks_organizationId_idx" ON "transcript_chunks"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "transcript_chunks_meetingId_index_key" ON "transcript_chunks"("meetingId", "index");

-- CreateIndex
CREATE INDEX "speakers_organizationId_idx" ON "speakers"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "speakers_meetingId_label_key" ON "speakers"("meetingId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_summaries_meetingId_key" ON "meeting_summaries"("meetingId");

-- CreateIndex
CREATE INDEX "meeting_summaries_organizationId_idx" ON "meeting_summaries"("organizationId");

-- CreateIndex
CREATE INDEX "meeting_decisions_meetingId_idx" ON "meeting_decisions"("meetingId");

-- CreateIndex
CREATE INDEX "meeting_decisions_organizationId_idx" ON "meeting_decisions"("organizationId");

-- CreateIndex
CREATE INDEX "meeting_tasks_meetingId_idx" ON "meeting_tasks"("meetingId");

-- CreateIndex
CREATE INDEX "meeting_tasks_organizationId_status_idx" ON "meeting_tasks"("organizationId", "status");

-- CreateIndex
CREATE INDEX "meeting_topics_meetingId_idx" ON "meeting_topics"("meetingId");

-- CreateIndex
CREATE INDEX "meeting_topics_organizationId_kind_idx" ON "meeting_topics"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "meeting_participants_meetingId_idx" ON "meeting_participants"("meetingId");

-- CreateIndex
CREATE INDEX "meeting_participants_organizationId_idx" ON "meeting_participants"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_participants_meetingId_displayName_email_key" ON "meeting_participants"("meetingId", "displayName", "email");

-- CreateIndex
CREATE INDEX "meeting_memories_meetingId_idx" ON "meeting_memories"("meetingId");

-- CreateIndex
CREATE INDEX "meeting_memories_organizationId_idx" ON "meeting_memories"("organizationId");

-- CreateIndex
CREATE INDEX "meeting_memories_memoryId_idx" ON "meeting_memories"("memoryId");

-- AddForeignKey
ALTER TABLE "transcript_chunks" ADD CONSTRAINT "transcript_chunks_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_chunks" ADD CONSTRAINT "transcript_chunks_speakerId_fkey" FOREIGN KEY ("speakerId") REFERENCES "speakers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speakers" ADD CONSTRAINT "speakers_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_summaries" ADD CONSTRAINT "meeting_summaries_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_tasks" ADD CONSTRAINT "meeting_tasks_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_topics" ADD CONSTRAINT "meeting_topics_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_memories" ADD CONSTRAINT "meeting_memories_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

