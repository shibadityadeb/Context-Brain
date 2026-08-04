-- CreateEnum
CREATE TYPE "GovernanceDocumentStatus" AS ENUM ('DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "governance_profiles" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productEntityId" UUID,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "assessment" JSONB,
    "overallScore" INTEGER,
    "launchReadiness" INTEGER,
    "riskScore" INTEGER,
    "assessedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "governance_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_documents" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "GovernanceDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "content" TEXT NOT NULL,
    "drivenBy" JSONB,
    "model" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "governance_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "governance_profiles_organizationId_updatedAt_idx" ON "governance_profiles"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "governance_profiles_organizationId_productEntityId_idx" ON "governance_profiles"("organizationId", "productEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "governance_profiles_organizationId_normalizedName_key" ON "governance_profiles"("organizationId", "normalizedName");

-- CreateIndex
CREATE INDEX "governance_documents_organizationId_profileId_idx" ON "governance_documents"("organizationId", "profileId");

-- CreateIndex
CREATE INDEX "governance_documents_profileId_type_idx" ON "governance_documents"("profileId", "type");

-- AddForeignKey
ALTER TABLE "governance_documents" ADD CONSTRAINT "governance_documents_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "governance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
