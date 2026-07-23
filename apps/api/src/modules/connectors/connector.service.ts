import type { Prisma, PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { encryptSecret, decryptSecret, revokeToken } from '@company-brain/auth';
import { GOOGLE_PROVIDER, GOOGLE_SCOPES } from '@company-brain/connector-google';
import { EventBus } from '@company-brain/events';
import { TASK_QUEUES, WORKFLOW_TYPES } from '@company-brain/workflows';
import type { TemporalService } from '../../services/temporal.service.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { config } from '../../config/index.js';
import { connectorEncryptionKey, googleOAuthConfig } from './google-oauth.js';

/** Cron for the continuous incremental change-detection sync (configurable). */
const INCREMENTAL_CRON = `*/${config.connectors.incrementalSyncMinutes} * * * *`;

/** Stable per-connector workflow id for its incremental cron. */
const incrementalWorkflowId = (connectorId: string): string =>
  `connector-incremental-${connectorId}`;

interface Deps {
  prisma: PrismaClient;
  temporal: TemporalService;
  redis: Redis;
}

/** JSON-safe view of an ExternalResource (BigInt → number). */
function serializeResource<T extends { sizeBytes: bigint | null }>(row: T) {
  return { ...row, sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes) };
}

export class ConnectorApiService {
  private readonly events: EventBus;

  constructor(private readonly deps: Deps) {
    this.events = new EventBus(deps.redis);
  }

  async resolveOrganization(userId: string): Promise<string> {
    const membership = await this.deps.prisma.membership.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) {
      throw new ForbiddenError('You must belong to an organization to manage connectors');
    }
    return membership.organizationId;
  }

  private async requireConnector(organizationId: string, connectorId: string) {
    const connector = await this.deps.prisma.connector.findFirst({
      where: { id: connectorId, organizationId, deletedAt: null },
    });
    if (!connector) throw new NotFoundError('Connector not found');
    return connector;
  }

  // ── Connection provisioning / disconnect ──────────────────────

  /**
   * Called from the Google sign-in callback: every OAuth sign-in also
   * (re)establishes the organization's workspace connection and starts
   * syncing — there is no separate manual connect step.
   */
  async establishGoogleConnection(input: {
    organizationId: string;
    userId: string;
    refreshToken: string;
    accessTokenExpiresAt: Date;
    tokenType: string;
    scope?: string;
    profile: { email?: string; hd?: string; name?: string };
  }): Promise<{ connectorId: string }> {
    const { organizationId, userId, profile } = input;
    const { prisma } = this.deps;
    const domain = profile.hd ?? profile.email?.split('@')[1] ?? null;

    // Re-auth flow: reuse the org's existing Google connector row.
    let connector = await prisma.connector.findFirst({
      where: {
        organizationId,
        provider: 'GOOGLE_WORKSPACE',
        deletedAt: null,
      },
    });
    if (connector) {
      connector = await prisma.connector.update({
        where: { id: connector.id },
        data: { status: 'PENDING', error: null },
      });
      await prisma.oAuthCredential.updateMany({
        where: { connectorId: connector.id, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
    } else {
      connector = await prisma.connector.create({
        data: {
          provider: 'GOOGLE_WORKSPACE',
          name: domain ? `Google Workspace (${domain})` : 'Google Workspace',
          status: 'PENDING',
          organizationId,
          ownerId: userId,
        },
      });
      await prisma.organizationConnector.create({
        data: {
          organizationId,
          connectorId: connector.id,
          status: 'PENDING',
        },
      });
    }

    await prisma.oAuthCredential.create({
      data: {
        connectorId: connector.id,
        organizationId,
        userEmail: profile.email ?? null,
        scopes: input.scope?.split(' ') ?? [...GOOGLE_SCOPES],
        encryptedRefreshToken: encryptSecret(input.refreshToken, connectorEncryptionKey()),
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        tokenType: input.tokenType,
        status: 'ACTIVE',
      },
    });

    await prisma.connectorLog.create({
      data: {
        connectorId: connector.id,
        organizationId,
        level: 'INFO',
        event: 'oauth.connected',
        message: `Google Workspace connected by ${profile.email ?? 'unknown'}`,
        context: { domain, scopes: input.scope } as Prisma.InputJsonValue,
      },
    });
    await this.events.publish({
      type: 'connector.connected',
      organizationId,
      connectorId: connector.id,
      provider: GOOGLE_PROVIDER,
      payload: { domain, adminEmail: profile.email },
    });

    // Kick off the initial full sync + the continuous incremental cron.
    await this.deps.temporal.start(WORKFLOW_TYPES.workspaceInitialSync, {
      workflowId: `workspace-initial-${connector.id}-${Date.now()}`,
      taskQueue: TASK_QUEUES.connectors,
      args: [{ connectorId: connector.id }],
    });
    // Reschedule from scratch so a reconnect always adopts the current cadence
    // (a previously-scheduled cron keeps its old interval otherwise).
    await this.rescheduleIncrementalSync(connector.id);

    return { connectorId: connector.id };
  }

  /**
   * Ensure a connector's incremental cron exists, without disturbing a running
   * one (start-if-missing). Safe to call on every API boot — self-heals a lost
   * schedule so calendar/drive/gmail keep syncing without a reconnect.
   */
  async ensureIncrementalSchedule(connectorId: string): Promise<void> {
    try {
      await this.deps.temporal.start(WORKFLOW_TYPES.incrementalSync, {
        workflowId: incrementalWorkflowId(connectorId),
        taskQueue: TASK_QUEUES.connectors,
        args: [{ connectorId }],
        cronSchedule: INCREMENTAL_CRON,
      });
    } catch {
      // Already scheduled — leave the running cron in place.
    }
  }

  /**
   * Force the incremental cron to (re)start at the current interval, replacing
   * any existing schedule. Used on connect and when the cadence changes.
   */
  async rescheduleIncrementalSync(connectorId: string): Promise<void> {
    try {
      await this.deps.temporal.terminate(
        incrementalWorkflowId(connectorId),
        'rescheduling incremental sync',
      );
    } catch {
      // No existing schedule to replace — fine.
    }
    await this.ensureIncrementalSchedule(connectorId);
  }

  /**
   * On boot, make sure every connected connector has its incremental cron
   * running (start-if-missing). Keeps sync continuous across restarts without
   * the user reconnecting.
   */
  async reconcileIncrementalSchedules(): Promise<number> {
    const connectors = await this.deps.prisma.connector.findMany({
      where: { status: { notIn: ['DISCONNECTED', 'REVOKED'] }, deletedAt: null },
      select: { id: true },
    });
    for (const c of connectors) {
      await this.ensureIncrementalSchedule(c.id);
    }
    return connectors.length;
  }

  async disconnect(organizationId: string, connectorId: string) {
    const connector = await this.requireConnector(organizationId, connectorId);
    const { prisma } = this.deps;

    const credential = await prisma.oAuthCredential.findFirst({
      where: { connectorId, status: 'ACTIVE', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (credential) {
      try {
        const refreshToken = decryptSecret(
          credential.encryptedRefreshToken,
          connectorEncryptionKey(),
        );
        await revokeToken(googleOAuthConfig(), refreshToken);
      } catch {
        // Provider-side revocation is best effort; local state is truth.
      }
      await prisma.oAuthCredential.update({
        where: { id: credential.id },
        data: { status: 'REVOKED' },
      });
    }

    await prisma.connector.update({
      where: { id: connectorId },
      data: { status: 'DISCONNECTED', error: null },
    });
    try {
      await this.deps.temporal.terminate(
        `connector-incremental-${connectorId}`,
        'connector disconnected',
      );
    } catch {
      // Cron workflow may not exist anymore.
    }

    await prisma.connectorLog.create({
      data: {
        connectorId,
        organizationId,
        level: 'INFO',
        event: 'oauth.disconnected',
        message: 'Connector disconnected and tokens revoked',
      },
    });
    await this.events.publish({
      type: 'connector.disconnected',
      organizationId,
      connectorId,
      provider: GOOGLE_PROVIDER,
    });
    return { disconnected: true, connectorId: connector.id };
  }

  // ── Read APIs ─────────────────────────────────────────────────

  async list(organizationId: string) {
    const connectors = await this.deps.prisma.connector.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        workspace: true,
        _count: { select: { resources: { where: { deletedAt: null } } } },
      },
    });
    return connectors;
  }

  async get(organizationId: string, connectorId: string) {
    const connector = await this.deps.prisma.connector.findFirst({
      where: { id: connectorId, organizationId, deletedAt: null },
      include: {
        workspace: true,
        syncCursors: { where: { deletedAt: null } },
        credentials: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          // Never expose token material — selected fields only.
          select: {
            id: true,
            userEmail: true,
            scopes: true,
            status: true,
            lastRefreshedAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!connector) throw new NotFoundError('Connector not found');

    const resourceCounts = await this.deps.prisma.externalResource.groupBy({
      by: ['type'],
      where: { connectorId, deletedAt: null },
      _count: { _all: true },
    });
    return {
      ...connector,
      resourceCounts: Object.fromEntries(resourceCounts.map((r) => [r.type, r._count._all])),
    };
  }

  async triggerSync(organizationId: string, connectorId: string) {
    const connector = await this.requireConnector(organizationId, connectorId);
    if (connector.status === 'REVOKED' || connector.status === 'DISCONNECTED') {
      throw new BadRequestError('Connector is not connected — reconnect first');
    }
    const workflowId = `workspace-manual-${connectorId}-${Date.now()}`;
    await this.deps.temporal.start(WORKFLOW_TYPES.workspaceInitialSync, {
      workflowId,
      taskQueue: TASK_QUEUES.connectors,
      args: [{ connectorId }],
    });
    return { workflowId };
  }

  async status(organizationId: string, connectorId: string) {
    const connector = await this.requireConnector(organizationId, connectorId);
    const [runningJobs, recentJobs] = await Promise.all([
      this.deps.prisma.syncJob.findMany({
        where: { connectorId, status: 'RUNNING', deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      this.deps.prisma.syncJob.findMany({
        where: { connectorId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
    ]);

    let worker: unknown = { reachable: false };
    try {
      const response = await fetch(config.connectors.workerHealthUrl, {
        signal: AbortSignal.timeout(2000),
      });
      worker = { reachable: true, ...((await response.json()) as Record<string, unknown>) };
    } catch {
      // worker offline
    }

    return {
      connector: {
        id: connector.id,
        status: connector.status,
        error: connector.error,
        lastSyncAt: connector.lastSyncAt,
        nextSyncAt: connector.nextSyncAt,
      },
      runningJobs,
      recentJobs,
      worker,
    };
  }

  async resources(
    organizationId: string,
    connectorId: string,
    query: { page: number; limit: number; type?: string; search?: string },
  ) {
    await this.requireConnector(organizationId, connectorId);
    const where: Prisma.ExternalResourceWhereInput = {
      connectorId,
      organizationId,
      deletedAt: null,
      ...(query.type ? { type: query.type as never } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.deps.prisma.$transaction([
      this.deps.prisma.externalResource.findMany({
        where,
        orderBy: { externalUpdatedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { _count: { select: { permissions: { where: { deletedAt: null } } } } },
      }),
      this.deps.prisma.externalResource.count({ where }),
    ]);
    const counts = await this.deps.prisma.externalResource.groupBy({
      by: ['type'],
      where: { connectorId, organizationId, deletedAt: null },
      _count: { _all: true },
    });
    return {
      items: items.map(serializeResource),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit) || 1,
      typeCounts: Object.fromEntries(counts.map((c) => [c.type, c._count._all])),
    };
  }

  async logs(
    organizationId: string,
    connectorId: string,
    query: { page: number; limit: number; level?: string },
  ) {
    await this.requireConnector(organizationId, connectorId);
    const where: Prisma.ConnectorLogWhereInput = {
      connectorId,
      organizationId,
      deletedAt: null,
      ...(query.level ? { level: query.level as never } : {}),
    };
    const [items, total] = await this.deps.prisma.$transaction([
      this.deps.prisma.connectorLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.deps.prisma.connectorLog.count({ where }),
    ]);
    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit) || 1,
    };
  }
}
