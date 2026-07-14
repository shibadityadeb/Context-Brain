import { proxyActivities, setHandler, workflowInfo, log } from '@temporalio/workflow';
import type { KnowledgeActivities } from '@company-brain/activities';
import { DEFAULT_RETRY_POLICY } from '../retry-policies.js';
import { getIngestionProgressQuery, type IngestionProgress } from '../definitions.js';

// Parsing can be CPU-heavy on large files; embedding may call slow external
// APIs — give the pipeline generous per-attempt budgets and let Temporal
// retry transient failures with backoff.
const pipeline = proxyActivities<KnowledgeActivities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    ...DEFAULT_RETRY_POLICY,
    nonRetryableErrorTypes: [
      'NotFound',
      'NoVersion',
      'UnsupportedType',
      'EmptyFile',
      'EmptyText',
      'NoChunks',
    ],
  },
});

const finalize = proxyActivities<KnowledgeActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { ...DEFAULT_RETRY_POLICY, maximumAttempts: 8 },
});

export interface DocumentIngestionInput {
  documentId: string;
}

export interface DocumentIngestionResult {
  documentId: string;
  status: 'READY' | 'FAILED';
  chunkCount: number;
  embeddingCount: number;
  collection: string | null;
  error: string | null;
}

/**
 * Ingestion pipeline:
 * VALIDATE → PARSE → CLEAN → CHUNK → METADATA → EMBED → INDEX → PERSIST → COMPLETE.
 *
 * Every stage is a retryable activity; the workflow itself only sequences
 * them and records progress (queryable via getIngestionProgress). A failed
 * stage — after retries exhaust — still runs finalizeIngestion so the
 * document and its ProcessingJob always land in a terminal state.
 */
export async function documentIngestionWorkflow(
  input: DocumentIngestionInput,
): Promise<DocumentIngestionResult> {
  const { workflowId } = workflowInfo();
  const io = { documentId: input.documentId, workflowId };

  const progress: IngestionProgress = {
    documentId: input.documentId,
    stage: 'VALIDATE',
    chunkCount: 0,
    embeddingCount: 0,
    error: null,
  };
  setHandler(getIngestionProgressQuery, () => progress);

  try {
    await pipeline.validateDocument(io);

    progress.stage = 'PARSE';
    const extracted = await pipeline.extractText(io);

    progress.stage = 'CHUNK';
    const { chunkCount } = await pipeline.chunkText({
      ...io,
      textKey: extracted.textKey,
      sectionsKey: extracted.sectionsKey,
    });
    progress.chunkCount = chunkCount;

    progress.stage = 'EMBED';
    const { embeddingCount, collection } = await pipeline.embedAndIndexChunks(io);
    progress.embeddingCount = embeddingCount;

    progress.stage = 'COMPLETE';
    await finalize.finalizeIngestion({ ...io, success: true, chunkCount, embeddingCount });

    return {
      documentId: input.documentId,
      status: 'READY',
      chunkCount,
      embeddingCount,
      collection,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    progress.error = message;
    log.error('document ingestion failed', { documentId: input.documentId, error: message });
    await finalize.finalizeIngestion({ ...io, success: false, error: message });
    return {
      documentId: input.documentId,
      status: 'FAILED',
      chunkCount: progress.chunkCount,
      embeddingCount: progress.embeddingCount,
      collection: null,
      error: message,
    };
  }
}
