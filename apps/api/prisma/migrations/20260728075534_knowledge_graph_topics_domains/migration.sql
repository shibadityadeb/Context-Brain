-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "KnowledgeObjectType" ADD VALUE 'DOMAIN';
ALTER TYPE "KnowledgeObjectType" ADD VALUE 'TOPIC';

-- AlterTable
ALTER TABLE "knowledge_objects" ADD COLUMN     "sourceMeetingId" TEXT;

-- AlterTable
ALTER TABLE "knowledge_references" ADD COLUMN     "meetingId" TEXT;
