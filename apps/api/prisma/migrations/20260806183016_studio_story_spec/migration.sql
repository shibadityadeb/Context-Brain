-- AlterTable
ALTER TABLE "studio_presentations" ADD COLUMN     "paletteId" TEXT,
ADD COLUMN     "readiness" JSONB,
ADD COLUMN     "storySpec" JSONB;
