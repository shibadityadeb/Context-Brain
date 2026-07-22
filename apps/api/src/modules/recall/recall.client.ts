/**
 * Thin Recall.ai HTTP client.
 *
 * Responsibilities: creating / updating / deleting bots (capture side) and
 * fetching the async transcript document when a `transcript.done` webhook
 * arrives (Recall webhooks announce the transcript but don't inline the text).
 * Auth is the bare API key in the Authorization header; the base URL is
 * region-derived. Bot creation retries transient failures with exponential
 * backoff and logs every request + response.
 */

import type { RecallTranscriptDocument, RecallTranscriptRef } from './recall.types.js';

/** Structural logger — Fastify's `request.log` / `app.log` and pino satisfy it. */
export interface RecallLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

const noopLogger: RecallLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export interface RecallRetryOptions {
  attempts: number;
  backoffMs: number;
}

export interface RecallClientOptions {
  apiKey: string;
  baseUrl: string;
  logger?: RecallLogger;
  retry?: RecallRetryOptions;
  fetchImpl?: typeof fetch;
  /** Injectable sleep so backoff is instant in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface CreateBotInput {
  meetingUrl: string;
  botName?: string;
  /** ISO time for a scheduled join; omit to join immediately. */
  joinAt?: string;
  transcriptProvider?: string;
  /** Echoed back on every webhook as `bot.metadata` — carries our correlation ids. */
  metadata?: Record<string, string>;
}

export interface CreateBotResult {
  id: string;
  [key: string]: unknown;
}

export class RecallApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'RecallApiError';
  }
}

const DEFAULT_RETRY: RecallRetryOptions = { attempts: 3, backoffMs: 500 };
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class RecallClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly logger: RecallLogger;
  private readonly retry: RecallRetryOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: RecallClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.logger = opts.logger ?? noopLogger;
    this.retry = opts.retry ?? DEFAULT_RETRY;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /**
   * POST /api/v1/bot/ — dispatch a bot to a meeting (scheduled when joinAt set).
   * Retries transient failures (5xx / network) with exponential backoff; 4xx is
   * treated as permanent and thrown immediately.
   */
  async createBot(input: CreateBotInput): Promise<CreateBotResult> {
    const body: Record<string, unknown> = {
      meeting_url: input.meetingUrl,
      bot_name: input.botName,
      recording_config: {
        transcript: { provider: { [input.transcriptProvider ?? 'meeting_captions']: {} } },
      },
    };
    if (input.joinAt) body.join_at = input.joinAt;
    if (input.metadata) body.metadata = input.metadata;

    this.logger.info(
      { meetingUrl: input.meetingUrl, joinAt: input.joinAt ?? 'now', metadata: input.metadata },
      'recall createBot request',
    );

    const result = await this.withRetry('createBot', () =>
      this.requestJson<CreateBotResult>('POST', `${this.baseUrl}/api/v1/bot/`, body),
    );
    this.logger.info({ botId: result.id }, 'recall createBot response');
    return result;
  }

  /** PATCH /api/v1/bot/{id}/ — reschedule a not-yet-joined bot's join_at. */
  async updateScheduledBot(botId: string, joinAt: string): Promise<void> {
    this.logger.info({ botId, joinAt }, 'recall updateScheduledBot request');
    await this.withRetry('updateScheduledBot', () =>
      this.requestJson('PATCH', `${this.baseUrl}/api/v1/bot/${botId}/`, { join_at: joinAt }),
    );
    this.logger.info({ botId }, 'recall updateScheduledBot ok');
  }

  /** DELETE /api/v1/bot/{id}/ — cancel a scheduled bot that hasn't joined yet. */
  async deleteScheduledBot(botId: string): Promise<void> {
    this.logger.info({ botId }, 'recall deleteScheduledBot request');
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/bot/${botId}/`, {
      method: 'DELETE',
      headers: { Authorization: this.apiKey },
    });
    if (!res.ok && res.status !== 404) {
      throw new RecallApiError(
        `Recall deleteBot failed: ${res.status}`,
        res.status,
        res.status >= 500,
      );
    }
    this.logger.info({ botId, status: res.status }, 'recall deleteScheduledBot ok');
  }

  /**
   * Resolve a transcript.done reference into the actual transcript document.
   * Prefers an inlined document, then a signed `download_url`, then the bot's
   * transcript endpoint — whichever the payload gives us.
   */
  async fetchTranscriptDocument(
    ref: RecallTranscriptRef | null | undefined,
  ): Promise<RecallTranscriptDocument> {
    if (ref?.data && Array.isArray(ref.data)) return ref.data as RecallTranscriptDocument;

    if (ref?.download_url) {
      // Signed URL — no auth header needed (and sending one can break S3).
      return this.getJson<RecallTranscriptDocument>(ref.download_url, false);
    }
    // Resolve the transcript resource → its signed download URL (Recall v1).
    // The `transcript.done` webhook carries only the transcript id.
    if (ref?.id) {
      const resource = await this.getJson<{ data?: { download_url?: string | null } }>(
        `${this.baseUrl}/api/v1/transcript/${ref.id}/`,
        true,
      );
      const url = resource.data?.download_url;
      if (url) return this.getJson<RecallTranscriptDocument>(url, false);
    }
    throw new RecallApiError(
      'transcript.done had no data, download_url, or resolvable transcript id',
    );
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private async withRetry<T>(op: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retry.attempts + 1; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const retryable = err instanceof RecallApiError ? err.retryable : true; // network error
        if (!retryable || attempt > this.retry.attempts) break;
        const delay = this.retry.backoffMs * 2 ** (attempt - 1);
        this.logger.warn(
          { op, attempt, delay, err: String(err) },
          'recall request failed — retrying',
        );
        await this.sleep(delay);
      }
    }
    throw lastError instanceof Error ? lastError : new RecallApiError(String(lastError));
  }

  private async requestJson<T>(method: string, url: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: { Authorization: this.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network / DNS / socket errors are transient.
      throw new RecallApiError(
        `Recall ${method} ${url} network error: ${String(err)}`,
        undefined,
        true,
      );
    }
    if (!res.ok) {
      throw new RecallApiError(
        `Recall ${method} ${url} failed: ${res.status} ${await safeText(res)}`,
        res.status,
        res.status >= 500 || res.status === 429,
      );
    }
    return (await res.json()) as T;
  }

  private async getJson<T>(url: string, authed: boolean): Promise<T> {
    const res = await this.fetchImpl(url, {
      headers: authed ? { Authorization: this.apiKey } : {},
    });
    if (!res.ok) {
      throw new RecallApiError(
        `Recall GET ${url} failed: ${res.status}`,
        res.status,
        res.status >= 500,
      );
    }
    return (await res.json()) as T;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}
