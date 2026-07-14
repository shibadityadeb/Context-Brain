import { PrismaClient } from '@prisma/client';
import { QdrantClient } from '@qdrant/js-client-rest';
import {
  createEmbeddingProvider,
  type ChunkOptions,
  type EmbeddingConfig,
  type EmbeddingProvider,
} from '@company-brain/knowledge';
import type { ActivityContext } from './context.js';

export interface KnowledgeConfig {
  embedding: EmbeddingConfig;
  chunking: Partial<ChunkOptions>;
}

/**
 * Extended context for knowledge-pipeline activities: adds the database,
 * the vector store and the embedding provider on top of the base clients.
 */
export interface KnowledgeActivityContext extends ActivityContext {
  prisma: PrismaClient;
  qdrant: QdrantClient;
  embeddings: EmbeddingProvider;
  knowledge: KnowledgeConfig;
}

export function createKnowledgeActivityContext(
  base: ActivityContext,
  knowledge: KnowledgeConfig,
): KnowledgeActivityContext {
  const prisma = new PrismaClient();
  const qdrant = new QdrantClient({ url: base.config.qdrantUrl });
  const embeddings = createEmbeddingProvider(knowledge.embedding);

  return {
    ...base,
    prisma,
    qdrant,
    embeddings,
    knowledge,
    close: async () => {
      await base.close();
      await prisma.$disconnect();
    },
  };
}
