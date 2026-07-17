-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'ASSIGNED_BY';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'CREATED_BY';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'REPORTED_BY';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'MENTIONED_IN';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'BLOCKED_BY';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'GENERATED_FROM';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'DISCUSSED_IN';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'CREATED_IN';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'UPDATED_IN';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'REFERENCES';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'ATTACHED_TO';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'APPROVED_BY';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'REQUESTED_BY';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'COMPLETED_BY';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'IMPLEMENTS';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'FIXES';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'USES';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'CONNECTS_TO';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'FOLLOWS';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'PRECEDES';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'SUPERSEDES';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'PARENT_OF';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'CHILD_OF';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'DUPLICATE_OF';
ALTER TYPE "KnowledgeRelationshipType" ADD VALUE 'RELATED_TO';

-- AlterTable
ALTER TABLE "knowledge_relationships" ADD COLUMN     "evidenceSnippet" TEXT,
ADD COLUMN     "isInferred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceEmailId" TEXT,
ADD COLUMN     "sourceMeetingId" UUID,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "transcriptMs" INTEGER,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "knowledge_relationships_organizationId_fromId_type_idx" ON "knowledge_relationships"("organizationId", "fromId", "type");

-- CreateIndex
CREATE INDEX "knowledge_relationships_organizationId_toId_type_idx" ON "knowledge_relationships"("organizationId", "toId", "type");

-- CreateIndex
CREATE INDEX "knowledge_relationships_organizationId_isInferred_idx" ON "knowledge_relationships"("organizationId", "isInferred");
