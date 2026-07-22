-- CreateEnum
CREATE TYPE "RecallMeetingStatus" AS ENUM ('SCHEDULED', 'JOINING', 'WAITING', 'IN_CALL', 'RECORDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "recall_meetings" (
    "id" UUID NOT NULL,
    "recallBotId" TEXT NOT NULL,
    "organizationId" UUID,
    "externalMeetingId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'recall',
    "meetingUrl" TEXT,
    "botName" TEXT,
    "platform" TEXT,
    "status" "RecallMeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledStart" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "error" TEXT,
    "rawMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "recall_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_participants" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "platformId" TEXT,
    "name" TEXT NOT NULL,
    "isHost" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recall_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_recordings" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "recallRecordingId" TEXT NOT NULL,
    "status" "RecordingStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "mediaUrl" TEXT,
    "mediaExpiresAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recall_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_transcripts" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "recallTranscriptId" TEXT,
    "status" "TranscriptStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "mergedText" TEXT,
    "segmentCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recall_transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_transcript_segments" (
    "id" UUID NOT NULL,
    "transcriptId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "speaker" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recall_transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_webhook_events" (
    "id" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "recallBotId" TEXT,
    "payload" JSONB NOT NULL,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "recall_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recall_meetings_recallBotId_key" ON "recall_meetings"("recallBotId");

-- CreateIndex
CREATE INDEX "recall_meetings_organizationId_status_idx" ON "recall_meetings"("organizationId", "status");

-- CreateIndex
CREATE INDEX "recall_meetings_externalMeetingId_idx" ON "recall_meetings"("externalMeetingId");

-- CreateIndex
CREATE INDEX "recall_participants_meetingId_idx" ON "recall_participants"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "recall_participants_meetingId_platformId_key" ON "recall_participants"("meetingId", "platformId");

-- CreateIndex
CREATE UNIQUE INDEX "recall_recordings_recallRecordingId_key" ON "recall_recordings"("recallRecordingId");

-- CreateIndex
CREATE INDEX "recall_recordings_meetingId_idx" ON "recall_recordings"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "recall_transcripts_meetingId_key" ON "recall_transcripts"("meetingId");

-- CreateIndex
CREATE INDEX "recall_transcript_segments_transcriptId_startMs_idx" ON "recall_transcript_segments"("transcriptId", "startMs");

-- CreateIndex
CREATE UNIQUE INDEX "recall_transcript_segments_transcriptId_index_key" ON "recall_transcript_segments"("transcriptId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "recall_webhook_events_eventId_key" ON "recall_webhook_events"("eventId");

-- CreateIndex
CREATE INDEX "recall_webhook_events_eventType_idx" ON "recall_webhook_events"("eventType");

-- CreateIndex
CREATE INDEX "recall_webhook_events_recallBotId_idx" ON "recall_webhook_events"("recallBotId");

-- AddForeignKey
ALTER TABLE "recall_participants" ADD CONSTRAINT "recall_participants_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "recall_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_recordings" ADD CONSTRAINT "recall_recordings_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "recall_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_transcripts" ADD CONSTRAINT "recall_transcripts_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "recall_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_transcript_segments" ADD CONSTRAINT "recall_transcript_segments_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "recall_transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
