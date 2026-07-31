import type { McpApiKey, McpServer, PrismaClient, Prisma } from '@prisma/client';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { generateKey, hashKey } from './mcp.keys.js';
import { ALL_TOOL_NAMES, TOOL_CATALOG } from './mcp.tools.js';
import type { CreateKeyInput, CreateServerInput, UpdateServerInput } from './mcp.schemas.js';

interface Deps {
  prisma: PrismaClient;
}

/** Public-safe shape of a key — never exposes `keyHash`. */
function sanitizeKey(k: McpApiKey) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    readOnly: k.readOnly,
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
    createdAt: k.createdAt,
  };
}

/**
 * MCP server management — CRUD over an organization's MCP servers plus their
 * hashed API keys. Also the authentication entry point used by the protocol
 * endpoint (`authenticateKey`). All reads/writes are org-scoped.
 */
export class McpService {
  constructor(private readonly deps: Deps) {}

  /** The org the acting user belongs to (first membership). */
  async resolveOrganization(userId: string): Promise<string> {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership)
      throw new ForbiddenError('You must belong to an organization to manage MCP servers');
    return membership.organizationId;
  }

  toolCatalog() {
    return TOOL_CATALOG.map((t) => ({ name: t.name, description: t.description }));
  }

  async list(organizationId: string) {
    const servers = await this.deps.prisma.mcpServer.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { connections: true, apiKeys: true } },
      },
    });
    return servers.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      scopeConfig: s.scopeConfig,
      tools: s.tools,
      visibility: s.visibility,
      status: s.status,
      createdById: s.createdById,
      ownerId: s.ownerId,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      connectionCount: s._count.connections,
      keyCount: s._count.apiKeys,
    }));
  }

  private async getOrThrow(organizationId: string, id: string): Promise<McpServer> {
    const server = await this.deps.prisma.mcpServer.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!server) throw new NotFoundError('MCP server not found');
    return server;
  }

  async get(organizationId: string, id: string) {
    const server = await this.getOrThrow(organizationId, id);
    const [keys, connections] = await Promise.all([
      this.deps.prisma.mcpApiKey.findMany({
        where: { mcpServerId: id },
        orderBy: { createdAt: 'desc' },
      }),
      this.deps.prisma.mcpConnection.findMany({
        where: { mcpServerId: id },
        orderBy: { lastSeenAt: 'desc' },
        take: 50,
      }),
    ]);
    return {
      ...server,
      keys: keys.map(sanitizeKey),
      connections: connections.map((c) => ({
        id: c.id,
        clientName: c.clientName,
        clientVersion: c.clientVersion,
        lastSeenAt: c.lastSeenAt,
      })),
    };
  }

  async create(organizationId: string, userId: string, body: CreateServerInput) {
    const tools = body.tools?.length
      ? body.tools.filter((t) => ALL_TOOL_NAMES.includes(t))
      : ALL_TOOL_NAMES;
    const server = await this.deps.prisma.mcpServer.create({
      data: {
        organizationId,
        name: body.name,
        description: body.description ?? null,
        scopeConfig: (body.scopeConfig ?? { mode: 'workspace' }) as Prisma.InputJsonValue,
        tools,
        prompt: body.prompt ?? null,
        createdById: userId,
        ownerId: userId,
        lastModifiedById: userId,
      },
    });
    return server;
  }

  async update(organizationId: string, userId: string, id: string, body: UpdateServerInput) {
    await this.getOrThrow(organizationId, id);
    const data: Prisma.McpServerUpdateInput = { lastModifiedById: userId };
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.prompt !== undefined) data.prompt = body.prompt;
    if (body.status !== undefined) data.status = body.status;
    if (body.scopeConfig !== undefined)
      data.scopeConfig = body.scopeConfig as Prisma.InputJsonValue;
    if (body.tools !== undefined) data.tools = body.tools.filter((t) => ALL_TOOL_NAMES.includes(t));
    return this.deps.prisma.mcpServer.update({ where: { id }, data });
  }

  async remove(organizationId: string, id: string) {
    await this.getOrThrow(organizationId, id);
    await this.deps.prisma.mcpServer.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DISABLED' },
    });
  }

  // ── Keys ────────────────────────────────────────────────────────────────────

  async issueKey(organizationId: string, id: string, userId: string, body: CreateKeyInput) {
    await this.getOrThrow(organizationId, id);
    const gen = generateKey();
    const key = await this.deps.prisma.mcpApiKey.create({
      data: {
        mcpServerId: id,
        name: body.name,
        prefix: gen.prefix,
        keyHash: gen.keyHash,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        createdById: userId,
      },
    });
    // The plaintext secret is returned exactly once.
    return { secret: gen.secret, key: sanitizeKey(key) };
  }

  async rotateKey(organizationId: string, id: string, keyId: string, userId: string) {
    await this.getOrThrow(organizationId, id);
    const existing = await this.deps.prisma.mcpApiKey.findFirst({
      where: { id: keyId, mcpServerId: id },
    });
    if (!existing) throw new NotFoundError('Key not found');
    await this.deps.prisma.mcpApiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
    return this.issueKey(organizationId, id, userId, {
      name: `${existing.name} (rotated)`,
      expiresAt: existing.expiresAt?.toISOString(),
    });
  }

  async revokeKey(organizationId: string, id: string, keyId: string) {
    await this.getOrThrow(organizationId, id);
    const existing = await this.deps.prisma.mcpApiKey.findFirst({
      where: { id: keyId, mcpServerId: id },
    });
    if (!existing) throw new NotFoundError('Key not found');
    await this.deps.prisma.mcpApiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
  }

  // ── Protocol-endpoint auth ────────────────────────────────────────────────────

  /**
   * Resolve a presented Bearer secret to its server. Returns null for any
   * invalid/revoked/expired key or a disabled/deleted server. Bumps
   * `lastUsedAt` on success (fire-and-forget).
   */
  async authenticateKey(secret: string): Promise<{ server: McpServer; key: McpApiKey } | null> {
    const key = await this.deps.prisma.mcpApiKey.findUnique({
      where: { keyHash: hashKey(secret) },
      include: { mcpServer: true },
    });
    if (!key || key.revokedAt) return null;
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;
    const server = key.mcpServer;
    if (!server || server.deletedAt || server.status !== 'ACTIVE') return null;
    void this.deps.prisma.mcpApiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return { server, key };
  }

  /** Record/refresh a connected client for status + connection-count display. */
  async recordConnection(
    mcpServerId: string,
    clientName: string | null,
    clientVersion: string | null,
  ) {
    const name = clientName ?? 'unknown';
    await this.deps.prisma.mcpConnection
      .upsert({
        where: { mcpServerId_clientName: { mcpServerId, clientName: name } },
        create: { mcpServerId, clientName: name, clientVersion },
        update: { lastSeenAt: new Date(), clientVersion },
      })
      .catch(() => undefined);
  }
}
