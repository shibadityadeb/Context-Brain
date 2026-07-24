-- AlterEnum
ALTER TYPE "ActionStatus" ADD VALUE 'NEEDS_INPUT';

-- AlterTable
ALTER TABLE "actions" ADD COLUMN     "clarifications" JSONB;

