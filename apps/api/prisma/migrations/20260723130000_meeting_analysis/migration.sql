-- CreateEnum
CREATE TYPE "MeetingAnalysisStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "recall_meetings" ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "recall_meeting_analyses" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "status" "MeetingAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT,
    "actionItems" JSONB NOT NULL DEFAULT '[]',
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "topics" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recall_meeting_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recall_meeting_analyses_meetingId_key" ON "recall_meeting_analyses"("meetingId");

-- AddForeignKey
ALTER TABLE "recall_meeting_analyses" ADD CONSTRAINT "recall_meeting_analyses_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "recall_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

