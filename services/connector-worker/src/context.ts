import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { EventBus } from '@company-brain/events';
import { ConnectorRegistry, type ConnectorContext } from '@company-brain/connector-core';
import { GoogleWorkspaceConnector, GOOGLE_PROVIDER } from '@company-brain/connector-google';
import { config } from './config.js';
import { TokenManager } from './token-manager.js';

/** Prisma provider enum → registry provider id. */
export const PROVIDER_IDS: Record<string, string> = {
  GOOGLE_WORKSPACE: GOOGLE_PROVIDER,
};

export interface WorkerContext {
  prisma: PrismaClient;
  redis: Redis;
  events: EventBus;
  registry: ConnectorRegistry;
  tokens: TokenManager;
  connectorContext(connectorId: string, organizationId: string): ConnectorContext;
  close(): Promise<void>;
}

export function createWorkerContext(): WorkerContext {
  const prisma = new PrismaClient();
  const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
  redis.on('error', () => {});

  const registry = new ConnectorRegistry();
  registry.register(GOOGLE_PROVIDER, () => new GoogleWorkspaceConnector());

  const tokens = new TokenManager(prisma);

  return {
    prisma,
    redis,
    events: new EventBus(redis),
    registry,
    tokens,
    connectorContext: (connectorId, organizationId) => ({
      connectorId,
      organizationId,
      getAccessToken: () => tokens.getAccessToken(connectorId),
    }),
    close: async () => {
      redis.disconnect();
      await prisma.$disconnect();
    },
  };
}
