import type { Logger } from 'pino';

export interface Segment {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
}

export type BotState = 'joining' | 'waiting' | 'admitted' | 'ended' | 'error';

/**
 * Posts transcript segments and lifecycle status back to the API's internal
 * meeting routes. Best-effort with a short timeout — a dropped callback never
 * crashes the capture; the workflow tolerates gaps and finalizes on end.
 */
export class CallbackClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly logger: Logger,
  ) {}

  async segments(segments: Segment[], final: boolean): Promise<void> {
    if (segments.length === 0 && !final) return;
    await this.post('/segments', { segments, final });
  }

  async status(state: BotState, error?: string): Promise<void> {
    await this.post('/status', { state, ...(error ? { error } : {}) });
  }

  private async post(path: string, body: unknown): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bot-token': this.token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.logger.warn(
          { path, status: response.status, text: text.slice(0, 200) },
          'callback rejected',
        );
      }
    } catch (error) {
      this.logger.warn(
        { path, error: error instanceof Error ? error.message : String(error) },
        'callback failed',
      );
    }
  }
}
