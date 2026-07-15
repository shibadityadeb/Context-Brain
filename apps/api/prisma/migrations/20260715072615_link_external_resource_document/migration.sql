-- AlterTable
ALTER TABLE "external_resources" ADD COLUMN     "documentId" UUID;

-- AddForeignKey
ALTER TABLE "external_resources" ADD CONSTRAINT "external_resources_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
