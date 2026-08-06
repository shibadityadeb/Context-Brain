-- CreateEnum
CREATE TYPE "StudioStatus" AS ENUM ('GENERATING', 'READY', 'FAILED', 'DRAFT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StudioAssetSource" AS ENUM ('UPLOAD', 'BRAIN', 'GENERATED');

-- CreateTable
CREATE TABLE "studio_presentations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "themeId" TEXT NOT NULL DEFAULT 'modern',
    "status" "StudioStatus" NOT NULL DEFAULT 'GENERATING',
    "intent" JSONB,
    "clarifications" JSONB,
    "sourceRefs" JSONB,
    "coverAssetId" UUID,
    "generationProgress" INTEGER,
    "generationError" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "studio_presentations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_slides" (
    "id" UUID NOT NULL,
    "presentationId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "layout" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "notes" TEXT,
    "sources" JSONB,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_slides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_assets" (
    "id" UUID NOT NULL,
    "presentationId" UUID,
    "organizationId" UUID NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "caption" TEXT,
    "source" "StudioAssetSource" NOT NULL DEFAULT 'UPLOAD',
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_versions" (
    "id" UUID NOT NULL,
    "presentationId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeType" TEXT NOT NULL DEFAULT 'edit',
    "changedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "studio_presentations_organizationId_status_idx" ON "studio_presentations"("organizationId", "status");

-- CreateIndex
CREATE INDEX "studio_presentations_createdBy_idx" ON "studio_presentations"("createdBy");

-- CreateIndex
CREATE INDEX "studio_slides_presentationId_idx" ON "studio_slides"("presentationId");

-- CreateIndex
CREATE UNIQUE INDEX "studio_slides_presentationId_index_key" ON "studio_slides"("presentationId", "index");

-- CreateIndex
CREATE INDEX "studio_assets_presentationId_idx" ON "studio_assets"("presentationId");

-- CreateIndex
CREATE INDEX "studio_assets_organizationId_idx" ON "studio_assets"("organizationId");

-- CreateIndex
CREATE INDEX "studio_versions_presentationId_idx" ON "studio_versions"("presentationId");

-- CreateIndex
CREATE UNIQUE INDEX "studio_versions_presentationId_version_key" ON "studio_versions"("presentationId", "version");

-- AddForeignKey
ALTER TABLE "studio_presentations" ADD CONSTRAINT "studio_presentations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_presentations" ADD CONSTRAINT "studio_presentations_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_slides" ADD CONSTRAINT "studio_slides_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "studio_presentations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_assets" ADD CONSTRAINT "studio_assets_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "studio_presentations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_versions" ADD CONSTRAINT "studio_versions_presentationId_fkey" FOREIGN KEY ("presentationId") REFERENCES "studio_presentations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
