import { ApplicationFailure } from '@temporalio/activity';
import type { Prisma } from '@prisma/client';
import {
  ConnectorError,
  CursorExpiredError,
  type ResourceChange,
  type SyncedResource,
} from '@company-brain/connector-core';
import type { EventType } from '@company-brain/events';
import type {
  CompleteSyncJobInput,
  ConnectorActivitiesContract,
  DiscoverWorkspaceOutput,
  IncrementalSyncInput,
  IncrementalSyncOutput,
  StartSyncJobInput,
  SyncPageInput,
  SyncPageOutput,
} from '@company-brain/workflows';
import { PROVIDER_IDS, type WorkerContext } from './context.js';

/** Services that own an incremental cursor (drive feed covers doc views). */
const CURSOR_SERVICES = new Set(['drive', 'gmail', 'calendar']);

function eventTypeFor(resourceType: string, kind: ResourceChange['changeType']): EventType {
  if (kind === 'permission_changed') return 'resource.permission.changed';
  if (resourceType === 'EMAIL' || resourceType === 'EMAIL_THREAD') return 'resource.email.received';
  if (resourceType === 'CALENDAR' || resourceType === 'CALENDAR_EVENT')
    return 'resource.calendar.updated';
  if (resourceType === 'GOOGLE_SHEET' && kind === 'updated') return 'resource.sheet.updated';
  if (resourceType === 'GOOGLE_SLIDES' && kind === 'updated') return 'resource.slides.updated';
  if (resourceType === 'GOOGLE_DOC') {
    return kind === 'created'
      ? 'resource.document.created'
      : kind === 'deleted'
        ? 'resource.document.deleted'
        : 'resource.document.updated';
  }
  return kind === 'created'
    ? 'resource.file.created'
    : kind === 'deleted'
      ? 'resource.file.deleted'
      : 'resource.file.updated';
}

/** Map SDK errors onto Temporal failures with the right retry semantics. */
function toTemporalFailure(error: unknown): never {
  if (error instanceof ConnectorError && !error.retryable) {
    throw ApplicationFailure.nonRetryable(error.message, error.code);
  }
  throw error;
}

export function createConnectorActivities(ctx: WorkerContext) {
  const { prisma, events, registry, tokens } = ctx;

  async function requireConnector(connectorId: string) {
    const connector = await prisma.connector.findFirst({
      where: { id: connectorId, deletedAt: null },
    });
    if (!connector) {
      throw ApplicationFailure.nonRetryable(`Connector ${connectorId} not found`, 'NotFound');
    }
    return connector;
  }

  function providerConnector(providerEnum: string) {
    const providerId = PROVIDER_IDS[providerEnum];
    if (!providerId) {
      throw ApplicationFailure.nonRetryable(`No implementation for ${providerEnum}`, 'NotFound');
    }
    return registry.get(providerId);
  }

  async function logEvent(
    connectorId: string,
    organizationId: string,
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
    event: string,
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    await prisma.connectorLog.create({
      data: {
        connectorId,
        organizationId,
        level,
        event,
        message,
        context: (context ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  interface PersistCounts {
    created: number;
    updated: number;
    permissionChanges: number;
    unchanged: number;
  }

  /** Idempotent metadata upsert + permission diff + version + events. */
  async function persistResource(
    connector: { id: string; organizationId: string; provider: string },
    service: string,
    resource: SyncedResource,
    counts: PersistCounts,
    emitEvents: boolean,
  ): Promise<void> {
    const providerId = PROVIDER_IDS[connector.provider] ?? connector.provider;
    const existing = await prisma.externalResource.findUnique({
      where: {
        connectorId_externalId: { connectorId: connector.id, externalId: resource.externalId },
      },
      include: { permissions: { where: { deletedAt: null } } },
    });

    const data = {
      type: resource.type as never,
      status: (resource.trashed ? 'TRASHED' : 'ACTIVE') as never,
      title: resource.title ?? null,
      mimeType: resource.mimeType ?? null,
      url: resource.url ?? null,
      ownerEmail: resource.ownerEmail ?? null,
      parentExternalId: resource.parentExternalId ?? null,
      driveId: resource.driveId ?? null,
      sizeBytes: resource.sizeBytes != null ? BigInt(resource.sizeBytes) : null,
      checksum: resource.checksum ?? null,
      version: resource.version ?? null,
      externalCreatedAt: resource.externalCreatedAt ? new Date(resource.externalCreatedAt) : null,
      externalUpdatedAt: resource.externalUpdatedAt ? new Date(resource.externalUpdatedAt) : null,
      metadata: (resource.metadata ?? {}) as Prisma.InputJsonValue,
      deletedAt: null,
    };

    let row = existing;
    let changeKind: ResourceChange['changeType'] | null = null;

    if (!existing) {
      row = await prisma.externalResource.create({
        data: {
          ...data,
          connectorId: connector.id,
          externalId: resource.externalId,
          organizationId: connector.organizationId,
        },
        include: { permissions: true },
      });
      changeKind = 'created';
      counts.created += 1;
    } else {
      const changed =
        existing.version !== data.version ||
        existing.checksum !== data.checksum ||
        existing.title !== data.title ||
        existing.status !== data.status ||
        (existing.externalUpdatedAt?.getTime() ?? 0) !== (data.externalUpdatedAt?.getTime() ?? 0);
      if (changed) {
        row = await prisma.externalResource.update({
          where: { id: existing.id },
          data,
          include: { permissions: { where: { deletedAt: null } } },
        });
        changeKind = 'updated';
        counts.updated += 1;
      } else {
        counts.unchanged += 1;
      }
    }

    // Version history.
    if (resource.version && row) {
      await prisma.resourceVersion.upsert({
        where: { resourceId_version: { resourceId: row.id, version: resource.version } },
        create: {
          resourceId: row.id,
          version: resource.version,
          checksum: resource.checksum ?? null,
          sizeBytes: resource.sizeBytes != null ? BigInt(resource.sizeBytes) : null,
          modifiedByEmail: (resource.metadata?.lastModifiedBy as string | undefined) ?? null,
          externalModifiedAt: resource.externalUpdatedAt
            ? new Date(resource.externalUpdatedAt)
            : null,
          organizationId: connector.organizationId,
        },
        update: {},
      });
    }

    // Permission diff (only when the connector supplied permissions).
    if (resource.permissions && row) {
      const nextKeys = new Set(
        resource.permissions.map(
          (p) =>
            `${p.externalPermissionId ?? ''}|${p.principalType}|${p.principalEmail ?? p.domain ?? ''}|${p.role}`,
        ),
      );
      const currentKeys = new Set(
        (existing?.permissions ?? []).map(
          (p) =>
            `${p.externalPermissionId ?? ''}|${p.principalType}|${p.principalEmail ?? p.domain ?? ''}|${p.role}`,
        ),
      );
      const differs =
        nextKeys.size !== currentKeys.size || [...nextKeys].some((k) => !currentKeys.has(k));
      if (differs) {
        await prisma.$transaction([
          prisma.resourcePermission.deleteMany({ where: { resourceId: row.id } }),
          prisma.resourcePermission.createMany({
            data: resource.permissions.map((p) => ({
              resourceId: row!.id,
              externalPermissionId: p.externalPermissionId ?? null,
              principalType: p.principalType,
              principalEmail: p.principalEmail ?? null,
              domain: p.domain ?? null,
              role: p.role,
              organizationId: connector.organizationId,
            })),
          }),
        ]);
        if (existing) {
          counts.permissionChanges += 1;
          if (!changeKind) changeKind = 'permission_changed';
        }
      }
    }

    if (changeKind && row) {
      await prisma.externalChange.create({
        data: {
          connectorId: connector.id,
          resourceId: row.id,
          externalId: resource.externalId,
          service,
          changeType: (changeKind === 'permission_changed'
            ? 'PERMISSION_CHANGED'
            : changeKind.toUpperCase()) as never,
          organizationId: connector.organizationId,
          payload: { title: resource.title, type: resource.type } as Prisma.InputJsonValue,
        },
      });
      if (emitEvents) {
        await events.publish({
          type: eventTypeFor(resource.type, changeKind),
          organizationId: connector.organizationId,
          connectorId: connector.id,
          provider: providerId,
          resource: { externalId: resource.externalId, type: resource.type, title: resource.title },
        });
      }
    }
  }

  async function markResourceDeleted(
    connector: { id: string; organizationId: string; provider: string },
    service: string,
    externalId: string,
  ): Promise<void> {
    const existing = await prisma.externalResource.findUnique({
      where: { connectorId_externalId: { connectorId: connector.id, externalId } },
    });
    if (!existing || existing.status === 'DELETED') return;
    await prisma.externalResource.update({
      where: { id: existing.id },
      data: { status: 'DELETED', deletedAt: new Date() },
    });
    await prisma.externalChange.create({
      data: {
        connectorId: connector.id,
        resourceId: existing.id,
        externalId,
        service,
        changeType: 'DELETED',
        organizationId: connector.organizationId,
      },
    });
    await events.publish({
      type: eventTypeFor(existing.type, 'deleted'),
      organizationId: connector.organizationId,
      connectorId: connector.id,
      provider: PROVIDER_IDS[connector.provider] ?? connector.provider,
      resource: { externalId, type: existing.type, title: existing.title },
    });
  }

  const activities = {
    async discoverWorkspace(input: { connectorId: string }): Promise<DiscoverWorkspaceOutput> {
      const connector = await requireConnector(input.connectorId);
      const impl = providerConnector(connector.provider);
      const cctx = ctx.connectorContext(connector.id, connector.organizationId);

      try {
        const discovery = await impl.discover(cctx);
        await prisma.workspace.upsert({
          where: { connectorId: connector.id },
          create: {
            connectorId: connector.id,
            organizationId: connector.organizationId,
            externalId: discovery.workspace.externalId ?? null,
            domain: discovery.workspace.domain ?? null,
            name: discovery.workspace.name ?? null,
            adminEmail: discovery.workspace.adminEmail ?? null,
            metadata: (discovery.workspace.metadata ?? {}) as Prisma.InputJsonValue,
          },
          update: {
            externalId: discovery.workspace.externalId ?? null,
            domain: discovery.workspace.domain ?? null,
            name: discovery.workspace.name ?? null,
            adminEmail: discovery.workspace.adminEmail ?? null,
            metadata: (discovery.workspace.metadata ?? {}) as Prisma.InputJsonValue,
          },
        });
        await prisma.connector.update({
          where: { id: connector.id },
          data: { status: 'SYNCING', error: null },
        });
        await logEvent(
          connector.id,
          connector.organizationId,
          'INFO',
          'discovery.completed',
          `workspace discovered: ${discovery.workspace.domain ?? 'unknown domain'}`,
          { services: discovery.services },
        );
        return {
          domain: discovery.workspace.domain ?? null,
          adminEmail: discovery.workspace.adminEmail ?? null,
          services: Object.fromEntries(
            Object.entries(discovery.services).map(([k, v]) => [k, v.available]),
          ),
        };
      } catch (error) {
        await logEvent(
          connector.id,
          connector.organizationId,
          'ERROR',
          'discovery.failed',
          (error as Error).message,
        );
        toTemporalFailure(error);
      }
    },

    async startSyncJob(input: StartSyncJobInput): Promise<{ jobId: string }> {
      const connector = await requireConnector(input.connectorId);
      const job = await prisma.syncJob.create({
        data: {
          connectorId: connector.id,
          organizationId: connector.organizationId,
          type: input.type,
          service: input.service,
          status: 'RUNNING',
          workflowId: input.workflowId,
          startedAt: new Date(),
          stats: { discovered: 0, created: 0, updated: 0, deleted: 0, permissionChanges: 0 },
        },
      });
      await events.publish({
        type: 'sync.started',
        organizationId: connector.organizationId,
        connectorId: connector.id,
        provider: PROVIDER_IDS[connector.provider] ?? connector.provider,
        payload: { service: input.service, jobType: input.type, jobId: job.id },
      });
      return { jobId: job.id };
    },

    async syncServicePage(input: SyncPageInput): Promise<SyncPageOutput> {
      const connector = await requireConnector(input.connectorId);
      const impl = providerConnector(connector.provider);
      const cctx = ctx.connectorContext(connector.id, connector.organizationId);

      try {
        const page = await impl.sync(cctx, input.service, input.pageCursor);
        const counts = { created: 0, updated: 0, permissionChanges: 0, unchanged: 0 };
        for (const resource of page.resources) {
          await persistResource(connector, input.service, resource, counts, true);
        }

        // Store the incremental anchor delivered with the last page.
        if (page.incrementalCursor && CURSOR_SERVICES.has(input.service)) {
          await prisma.syncCursor.upsert({
            where: {
              connectorId_service_resourceScope: {
                connectorId: connector.id,
                service: input.service,
                resourceScope: '',
              },
            },
            create: {
              connectorId: connector.id,
              organizationId: connector.organizationId,
              service: input.service,
              resourceScope: '',
              cursor: page.incrementalCursor,
            },
            update: { cursor: page.incrementalCursor },
          });
        }

        // Accumulate job stats.
        const job = await prisma.syncJob.findUnique({ where: { id: input.jobId } });
        const stats = (job?.stats ?? {}) as Record<string, number>;
        await prisma.syncJob.update({
          where: { id: input.jobId },
          data: {
            stats: {
              discovered: (stats.discovered ?? 0) + page.resources.length,
              created: (stats.created ?? 0) + counts.created,
              updated: (stats.updated ?? 0) + counts.updated,
              deleted: stats.deleted ?? 0,
              permissionChanges: (stats.permissionChanges ?? 0) + counts.permissionChanges,
            } as Prisma.InputJsonValue,
          },
        });

        return { nextPageCursor: page.nextPageCursor, resourceCount: page.resources.length };
      } catch (error) {
        await logEvent(
          connector.id,
          connector.organizationId,
          'ERROR',
          `sync.${input.service}.page_failed`,
          (error as Error).message,
          { pageCursor: input.pageCursor },
        );
        toTemporalFailure(error);
      }
    },

    async completeSyncJob(input: CompleteSyncJobInput): Promise<void> {
      const connector = await requireConnector(input.connectorId);
      const job = await prisma.syncJob.update({
        where: { id: input.jobId },
        data: { status: input.status, error: input.error ?? null, completedAt: new Date() },
      });
      await logEvent(
        connector.id,
        connector.organizationId,
        input.status === 'COMPLETED' ? 'INFO' : 'WARN',
        `sync.${job.service ?? 'unknown'}.${input.status.toLowerCase()}`,
        input.error ?? `${job.service} sync ${input.status.toLowerCase()}`,
        { stats: job.stats, jobId: job.id },
      );
      await events.publish({
        type: input.status === 'COMPLETED' ? 'sync.completed' : 'sync.failed',
        organizationId: connector.organizationId,
        connectorId: connector.id,
        provider: PROVIDER_IDS[connector.provider] ?? connector.provider,
        payload: { service: job.service, jobId: job.id, stats: job.stats, error: input.error },
      });
    },

    async runIncrementalSync(input: IncrementalSyncInput): Promise<IncrementalSyncOutput> {
      const connector = await requireConnector(input.connectorId);
      const impl = providerConnector(connector.provider);
      const cctx = ctx.connectorContext(connector.id, connector.organizationId);

      const cursorRow = await prisma.syncCursor.findUnique({
        where: {
          connectorId_service_resourceScope: {
            connectorId: connector.id,
            service: input.service,
            resourceScope: '',
          },
        },
      });
      if (!cursorRow) return { changeCount: 0, cursorMissing: true };

      try {
        const result = await impl.incrementalSync(cctx, input.service, cursorRow.cursor);
        const counts = { created: 0, updated: 0, permissionChanges: 0, unchanged: 0 };
        let deleted = 0;

        for (const change of result.changes) {
          if (change.changeType === 'deleted') {
            await markResourceDeleted(connector, change.service, change.externalId);
            deleted += 1;
          } else if (change.resource) {
            await persistResource(connector, change.service, change.resource, counts, true);
          }
        }

        await prisma.syncCursor.update({
          where: { id: cursorRow.id },
          data: { cursor: result.nextCursor },
        });
        await prisma.syncJob.update({
          where: { id: input.jobId },
          data: {
            stats: {
              discovered: result.changes.length,
              created: counts.created,
              updated: counts.updated,
              deleted,
              permissionChanges: counts.permissionChanges,
            } as Prisma.InputJsonValue,
          },
        });
        return { changeCount: result.changes.length };
      } catch (error) {
        if (error instanceof CursorExpiredError) {
          await prisma.syncCursor.delete({ where: { id: cursorRow.id } });
          await logEvent(
            connector.id,
            connector.organizationId,
            'WARN',
            `sync.${input.service}.cursor_expired`,
            'provider invalidated the sync cursor — full resync required',
          );
          return { changeCount: 0, cursorExpired: true };
        }
        toTemporalFailure(error);
      }
    },

    async markConnectorSynced(input: {
      connectorId: string;
      nextSyncInMinutes: number;
    }): Promise<void> {
      const connector = await requireConnector(input.connectorId);
      if (connector.status === 'REVOKED' || connector.status === 'DISCONNECTED') return;
      await prisma.connector.update({
        where: { id: input.connectorId },
        data: {
          status: 'CONNECTED',
          lastSyncAt: new Date(),
          nextSyncAt: new Date(Date.now() + input.nextSyncInMinutes * 60_000),
        },
      });
    },
  } satisfies ConnectorActivitiesContract & Record<string, (...args: never[]) => unknown>;

  void tokens; // token manager is reached through connectorContext
  return activities;
}

export type ConnectorActivities = ReturnType<typeof createConnectorActivities>;
