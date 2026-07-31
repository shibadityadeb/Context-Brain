-- CreateEnum
CREATE TYPE "McpServerStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "McpVisibility" AS ENUM ('WORKSPACE', 'PRIVATE', 'SHARED', 'PUBLIC');

-- CreateTable
CREATE TABLE "mcp_servers" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scopeConfig" JSONB NOT NULL DEFAULT '{"mode":"workspace"}',
    "tools" TEXT[],
    "prompt" TEXT,
    "visibility" "McpVisibility" NOT NULL DEFAULT 'WORKSPACE',
    "status" "McpServerStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" UUID,
    "ownerId" UUID,
    "lastModifiedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_api_keys" (
    "id" UUID NOT NULL,
    "mcpServerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "readOnly" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_connections" (
    "id" UUID NOT NULL,
    "mcpServerId" UUID NOT NULL,
    "clientName" TEXT,
    "clientVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mcp_servers_organizationId_idx" ON "mcp_servers"("organizationId");

-- CreateIndex
CREATE INDEX "mcp_servers_organizationId_status_idx" ON "mcp_servers"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_api_keys_prefix_key" ON "mcp_api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_api_keys_keyHash_key" ON "mcp_api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "mcp_api_keys_mcpServerId_idx" ON "mcp_api_keys"("mcpServerId");

-- CreateIndex
CREATE INDEX "mcp_connections_mcpServerId_idx" ON "mcp_connections"("mcpServerId");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_connections_mcpServerId_clientName_key" ON "mcp_connections"("mcpServerId", "clientName");

-- AddForeignKey
ALTER TABLE "mcp_api_keys" ADD CONSTRAINT "mcp_api_keys_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
