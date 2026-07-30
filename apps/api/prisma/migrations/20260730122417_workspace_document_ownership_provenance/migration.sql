-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "provenance" JSONB;

-- AlterTable
ALTER TABLE "folders" ADD COLUMN     "connectorId" UUID,
ADD COLUMN     "sourceExternalId" TEXT;

-- CreateIndex
CREATE INDEX "folders_ownerId_idx" ON "folders"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "folders_connectorId_sourceExternalId_key" ON "folders"("connectorId", "sourceExternalId");

