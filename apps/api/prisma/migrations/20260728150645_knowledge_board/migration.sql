-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "KnowledgeObjectType" ADD VALUE 'IDEA';
ALTER TYPE "KnowledgeObjectType" ADD VALUE 'BLOCKER';
ALTER TYPE "KnowledgeObjectType" ADD VALUE 'REMINDER';
ALTER TYPE "KnowledgeObjectType" ADD VALUE 'FOLLOW_UP';
ALTER TYPE "KnowledgeObjectType" ADD VALUE 'DISCUSSION';

-- AlterTable
ALTER TABLE "knowledge_objects" ADD COLUMN     "boardColumnId" UUID;

-- CreateTable
CREATE TABLE "board_columns" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "semanticStatus" "KnowledgeObjectStatus",
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "board_columns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_columns_organizationId_order_idx" ON "board_columns"("organizationId", "order");

-- CreateIndex
CREATE INDEX "knowledge_objects_organizationId_boardColumnId_idx" ON "knowledge_objects"("organizationId", "boardColumnId");

-- AddForeignKey
ALTER TABLE "knowledge_objects" ADD CONSTRAINT "knowledge_objects_boardColumnId_fkey" FOREIGN KEY ("boardColumnId") REFERENCES "board_columns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
