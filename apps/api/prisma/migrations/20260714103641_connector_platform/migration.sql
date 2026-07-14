-- CreateEnum
CREATE TYPE "ConnectorProvider" AS ENUM ('GOOGLE_WORKSPACE', 'SLACK', 'GITHUB', 'NOTION', 'CONFLUENCE', 'MICROSOFT_365', 'DROPBOX', 'JIRA', 'LINEAR', 'SALESFORCE');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('PENDING', 'CONNECTED', 'SYNCING', 'ERROR', 'DISCONNECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SyncJobType" AS ENUM ('INITIAL', 'INCREMENTAL', 'DISCOVERY', 'PERMISSION', 'MANUAL');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExternalResourceType" AS ENUM ('GOOGLE_DOC', 'GOOGLE_SHEET', 'GOOGLE_SLIDES', 'PDF', 'FOLDER', 'DRIVE_FILE', 'SHARED_DRIVE', 'EMAIL', 'EMAIL_THREAD', 'CALENDAR', 'CALENDAR_EVENT', 'ATTACHMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ExternalResourceStatus" AS ENUM ('ACTIVE', 'TRASHED', 'DELETED');

-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('CREATED', 'UPDATED', 'DELETED', 'PERMISSION_CHANGED');

-- CreateEnum
CREATE TYPE "PermissionRole" AS ENUM ('OWNER', 'EDITOR', 'COMMENTER', 'VIEWER');

-- CreateEnum
CREATE TYPE "PrincipalType" AS ENUM ('USER', 'GROUP', 'DOMAIN', 'ANYONE');

-- CreateEnum
CREATE TYPE "ConnectorLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "connectors" (
    "id" UUID NOT NULL,
    "provider" "ConnectorProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'PENDING',
    "config" JSONB,
    "error" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "nextSyncAt" TIMESTAMP(3),
    "organizationId" UUID NOT NULL,
    "ownerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_connectors" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "connectorId" UUID NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "organization_connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "connectorId" UUID NOT NULL,
    "externalId" TEXT,
    "domain" TEXT,
    "name" TEXT,
    "adminEmail" TEXT,
    "metadata" JSONB,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'CONNECTED',
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_credentials" (
    "id" UUID NOT NULL,
    "connectorId" UUID NOT NULL,
    "userEmail" TEXT,
    "scopes" TEXT[],
    "encryptedRefreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "tokenType" TEXT NOT NULL DEFAULT 'Bearer',
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastRefreshedAt" TIMESTAMP(3),
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "oauth_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" UUID NOT NULL,
    "connectorId" UUID NOT NULL,
    "type" "SyncJobType" NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "service" TEXT,
    "workflowId" TEXT NOT NULL,
    "runId" TEXT,
    "stats" JSONB,
    "error" TEXT,
    "organizationId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_cursors" (
    "id" UUID NOT NULL,
    "connectorId" UUID NOT NULL,
    "service" TEXT NOT NULL,
    "resourceScope" TEXT NOT NULL DEFAULT '',
    "cursor" TEXT NOT NULL,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'CONNECTED',
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sync_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_resources" (
    "id" UUID NOT NULL,
    "connectorId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" "ExternalResourceType" NOT NULL,
    "status" "ExternalResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT,
    "mimeType" TEXT,
    "url" TEXT,
    "ownerEmail" TEXT,
    "parentExternalId" TEXT,
    "driveId" TEXT,
    "sizeBytes" BIGINT,
    "checksum" TEXT,
    "version" TEXT,
    "externalCreatedAt" TIMESTAMP(3),
    "externalUpdatedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "external_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_changes" (
    "id" UUID NOT NULL,
    "connectorId" UUID NOT NULL,
    "resourceId" UUID,
    "externalId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "changeType" "ChangeType" NOT NULL,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "external_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_permissions" (
    "id" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "externalPermissionId" TEXT,
    "principalType" "PrincipalType" NOT NULL,
    "principalEmail" TEXT,
    "domain" TEXT,
    "role" "PermissionRole" NOT NULL,
    "status" "ExternalResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "resource_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_versions" (
    "id" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "checksum" TEXT,
    "sizeBytes" BIGINT,
    "modifiedByEmail" TEXT,
    "externalModifiedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "status" "ExternalResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "resource_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_logs" (
    "id" UUID NOT NULL,
    "connectorId" UUID NOT NULL,
    "level" "ConnectorLogLevel" NOT NULL DEFAULT 'INFO',
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "status" "ConnectorStatus",
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "connector_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connectors_organizationId_provider_idx" ON "connectors"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "connectors_organizationId_status_idx" ON "connectors"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_connectors_organizationId_connectorId_key" ON "organization_connectors"("organizationId", "connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_connectorId_key" ON "workspaces"("connectorId");

-- CreateIndex
CREATE INDEX "workspaces_organizationId_idx" ON "workspaces"("organizationId");

-- CreateIndex
CREATE INDEX "workspaces_domain_idx" ON "workspaces"("domain");

-- CreateIndex
CREATE INDEX "oauth_credentials_connectorId_idx" ON "oauth_credentials"("connectorId");

-- CreateIndex
CREATE INDEX "oauth_credentials_organizationId_idx" ON "oauth_credentials"("organizationId");

-- CreateIndex
CREATE INDEX "sync_jobs_connectorId_status_idx" ON "sync_jobs"("connectorId", "status");

-- CreateIndex
CREATE INDEX "sync_jobs_organizationId_createdAt_idx" ON "sync_jobs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "sync_jobs_workflowId_idx" ON "sync_jobs"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "sync_cursors_connectorId_service_resourceScope_key" ON "sync_cursors"("connectorId", "service", "resourceScope");

-- CreateIndex
CREATE INDEX "external_resources_organizationId_type_idx" ON "external_resources"("organizationId", "type");

-- CreateIndex
CREATE INDEX "external_resources_connectorId_type_idx" ON "external_resources"("connectorId", "type");

-- CreateIndex
CREATE INDEX "external_resources_parentExternalId_idx" ON "external_resources"("parentExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "external_resources_connectorId_externalId_key" ON "external_resources"("connectorId", "externalId");

-- CreateIndex
CREATE INDEX "external_changes_connectorId_occurredAt_idx" ON "external_changes"("connectorId", "occurredAt");

-- CreateIndex
CREATE INDEX "external_changes_organizationId_changeType_idx" ON "external_changes"("organizationId", "changeType");

-- CreateIndex
CREATE INDEX "resource_permissions_resourceId_idx" ON "resource_permissions"("resourceId");

-- CreateIndex
CREATE INDEX "resource_permissions_organizationId_principalEmail_idx" ON "resource_permissions"("organizationId", "principalEmail");

-- CreateIndex
CREATE UNIQUE INDEX "resource_versions_resourceId_version_key" ON "resource_versions"("resourceId", "version");

-- CreateIndex
CREATE INDEX "connector_logs_connectorId_createdAt_idx" ON "connector_logs"("connectorId", "createdAt");

-- CreateIndex
CREATE INDEX "connector_logs_organizationId_level_idx" ON "connector_logs"("organizationId", "level");

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_connectors" ADD CONSTRAINT "organization_connectors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_connectors" ADD CONSTRAINT "organization_connectors_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_credentials" ADD CONSTRAINT "oauth_credentials_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_resources" ADD CONSTRAINT "external_resources_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_changes" ADD CONSTRAINT "external_changes_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_changes" ADD CONSTRAINT "external_changes_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "external_resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_permissions" ADD CONSTRAINT "resource_permissions_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "external_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_versions" ADD CONSTRAINT "resource_versions_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "external_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_logs" ADD CONSTRAINT "connector_logs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
