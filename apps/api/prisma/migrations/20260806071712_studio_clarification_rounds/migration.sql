-- AlterTable
ALTER TABLE "studio_presentations" ADD COLUMN     "clarificationRounds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "knownDetails" JSONB;
