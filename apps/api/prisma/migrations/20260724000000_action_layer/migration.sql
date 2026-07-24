-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('CALENDAR_MANAGEMENT', 'EMAIL_DRAFT', 'EMAIL_SEND', 'MEETING_SCHEDULE', 'BROWSER_AUTOMATION', 'WEB_RESEARCH', 'FORM_FILLING', 'FILE_MANAGEMENT', 'DOCUMENT_GENERATION', 'TASK_CREATION', 'FOLLOW_UP_REMINDER', 'OTHER');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PLANNING', 'PENDING_APPROVAL', 'APPROVED', 'RUNNING', 'COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "ActionStepStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ActionLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "actions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "request" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ActionType" NOT NULL DEFAULT 'OTHER',
    "status" "ActionStatus" NOT NULL DEFAULT 'PLANNING',
    "goal" TEXT,
    "reasoning" TEXT,
    "estimatedImpact" TEXT,
    "estimatedTools" TEXT[],
    "approvalMode" "ApprovalMode" NOT NULL DEFAULT 'MANUAL',
    "approvedBy" UUID,
    "contextSources" JSONB,
    "result" JSONB,
    "error" TEXT,
    "relatedMeetingIds" UUID[],
    "relatedDocumentIds" UUID[],
    "relatedConversationIds" UUID[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_steps" (
    "id" UUID NOT NULL,
    "actionId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "tool" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "status" "ActionStepStatus" NOT NULL DEFAULT 'PENDING',
    "output" JSONB,
    "error" TEXT,
    "organizationId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_logs" (
    "id" UUID NOT NULL,
    "actionId" UUID NOT NULL,
    "stepId" UUID,
    "level" "ActionLogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "data" JSONB,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "actions_organizationId_status_idx" ON "actions"("organizationId", "status");

-- CreateIndex
CREATE INDEX "actions_createdBy_idx" ON "actions"("createdBy");

-- CreateIndex
CREATE INDEX "actions_organizationId_type_idx" ON "actions"("organizationId", "type");

-- CreateIndex
CREATE INDEX "action_steps_actionId_idx" ON "action_steps"("actionId");

-- CreateIndex
CREATE UNIQUE INDEX "action_steps_actionId_index_key" ON "action_steps"("actionId", "index");

-- CreateIndex
CREATE INDEX "action_logs_actionId_createdAt_idx" ON "action_logs"("actionId", "createdAt");

-- AddForeignKey
ALTER TABLE "actions" ADD CONSTRAINT "actions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actions" ADD CONSTRAINT "actions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actions" ADD CONSTRAINT "actions_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_logs" ADD CONSTRAINT "action_logs_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_logs" ADD CONSTRAINT "action_logs_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "action_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

