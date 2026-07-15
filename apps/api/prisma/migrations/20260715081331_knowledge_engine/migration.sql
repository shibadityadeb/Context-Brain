-- CreateEnum
CREATE TYPE "KnowledgeObjectType" AS ENUM ('PERSON', 'TEAM', 'ORGANIZATION', 'PROJECT', 'TASK', 'BUG', 'ISSUE', 'MEETING', 'ACTION_ITEM', 'DECISION', 'DEADLINE', 'FEATURE', 'REQUIREMENT', 'MILESTONE', 'RISK', 'QUESTION', 'POLICY', 'CUSTOMER', 'VENDOR', 'BOOKING', 'PAYMENT', 'INVOICE', 'PRODUCT', 'SERVICE', 'LOCATION', 'EMAIL', 'CALENDAR_EVENT', 'DOCUMENT', 'FILE', 'URL', 'EVENT', 'CONVERSATION', 'COMMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "KnowledgeObjectStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED', 'COMPLETED', 'CANCELLED', 'ACTIVE', 'ARCHIVED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "KnowledgePriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE');

-- CreateEnum
CREATE TYPE "KnowledgeRelationshipType" AS ENUM ('ASSIGNED_TO', 'REPORTED', 'CREATED', 'CREATES', 'BELONGS_TO', 'OWNS', 'BLOCKS', 'DEPENDS_ON', 'MENTIONS', 'LINKS_TO', 'PART_OF', 'ATTENDED', 'WORKS_ON', 'MANAGES', 'RESOLVES', 'AFFECTS', 'SCHEDULED_FOR', 'RESPONSIBLE_FOR', 'RELATES_TO', 'DUPLICATES');

-- CreateEnum
CREATE TYPE "TimelineEventType" AS ENUM ('CREATED', 'UPDATED', 'MENTIONED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'ASSIGNED', 'RELATIONSHIP_ADDED', 'CONFIDENCE_CHANGED', 'MERGED', 'RESTORED', 'DELETED');

-- CreateTable
CREATE TABLE "knowledge_objects" (
    "id" UUID NOT NULL,
    "type" "KnowledgeObjectType" NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT,
    "status" "KnowledgeObjectStatus" NOT NULL DEFAULT 'UNKNOWN',
    "priority" "KnowledgePriority" NOT NULL DEFAULT 'NONE',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceDocumentId" UUID,
    "sourceChunkId" UUID,
    "createdBy" TEXT,
    "metadata" JSONB,
    "mergedIntoId" UUID,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "knowledge_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_relationships" (
    "id" UUID NOT NULL,
    "type" "KnowledgeRelationshipType" NOT NULL,
    "fromId" UUID NOT NULL,
    "toId" UUID NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "sourceDocumentId" UUID,
    "sourceChunkId" UUID,
    "metadata" JSONB,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "knowledge_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_aliases" (
    "id" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'extraction',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_mentions" (
    "id" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "chunkId" UUID,
    "snippet" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline_events" (
    "id" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "type" "TimelineEventType" NOT NULL,
    "title" TEXT,
    "payload" JSONB,
    "documentId" UUID,
    "actor" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_tags" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_object_tags" (
    "objectId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_object_tags_pkey" PRIMARY KEY ("objectId","tagId")
);

-- CreateTable
CREATE TABLE "knowledge_references" (
    "id" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "documentId" UUID,
    "chunkId" UUID,
    "url" TEXT,
    "label" TEXT,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_versions" (
    "id" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeType" TEXT NOT NULL,
    "changedBy" TEXT,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_objects_organizationId_type_idx" ON "knowledge_objects"("organizationId", "type");

-- CreateIndex
CREATE INDEX "knowledge_objects_organizationId_normalizedTitle_idx" ON "knowledge_objects"("organizationId", "normalizedTitle");

-- CreateIndex
CREATE INDEX "knowledge_objects_organizationId_status_idx" ON "knowledge_objects"("organizationId", "status");

-- CreateIndex
CREATE INDEX "knowledge_objects_sourceDocumentId_idx" ON "knowledge_objects"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "knowledge_relationships_organizationId_type_idx" ON "knowledge_relationships"("organizationId", "type");

-- CreateIndex
CREATE INDEX "knowledge_relationships_toId_idx" ON "knowledge_relationships"("toId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_relationships_fromId_toId_type_key" ON "knowledge_relationships"("fromId", "toId", "type");

-- CreateIndex
CREATE INDEX "entity_aliases_organizationId_normalizedAlias_idx" ON "entity_aliases"("organizationId", "normalizedAlias");

-- CreateIndex
CREATE UNIQUE INDEX "entity_aliases_objectId_normalizedAlias_key" ON "entity_aliases"("objectId", "normalizedAlias");

-- CreateIndex
CREATE INDEX "entity_mentions_objectId_idx" ON "entity_mentions"("objectId");

-- CreateIndex
CREATE INDEX "entity_mentions_documentId_idx" ON "entity_mentions"("documentId");

-- CreateIndex
CREATE INDEX "entity_mentions_organizationId_idx" ON "entity_mentions"("organizationId");

-- CreateIndex
CREATE INDEX "timeline_events_objectId_occurredAt_idx" ON "timeline_events"("objectId", "occurredAt");

-- CreateIndex
CREATE INDEX "timeline_events_organizationId_occurredAt_idx" ON "timeline_events"("organizationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_tags_organizationId_slug_key" ON "knowledge_tags"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "knowledge_references_objectId_idx" ON "knowledge_references"("objectId");

-- CreateIndex
CREATE INDEX "knowledge_references_organizationId_idx" ON "knowledge_references"("organizationId");

-- CreateIndex
CREATE INDEX "knowledge_versions_organizationId_idx" ON "knowledge_versions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_versions_objectId_version_key" ON "knowledge_versions"("objectId", "version");

-- AddForeignKey
ALTER TABLE "knowledge_objects" ADD CONSTRAINT "knowledge_objects_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_objects" ADD CONSTRAINT "knowledge_objects_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "knowledge_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_relationships" ADD CONSTRAINT "knowledge_relationships_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "knowledge_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_relationships" ADD CONSTRAINT "knowledge_relationships_toId_fkey" FOREIGN KEY ("toId") REFERENCES "knowledge_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "knowledge_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "knowledge_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "knowledge_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_object_tags" ADD CONSTRAINT "knowledge_object_tags_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "knowledge_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_object_tags" ADD CONSTRAINT "knowledge_object_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "knowledge_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_references" ADD CONSTRAINT "knowledge_references_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "knowledge_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_versions" ADD CONSTRAINT "knowledge_versions_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "knowledge_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
