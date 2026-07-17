import type { Logger } from 'pino';
import { CallbackClient } from './callback.js';
import { launchBrowser, joinMeet, leaveMeet, type BrowserSession } from './joiner.js';
import { Transcriber } from './transcriber.js';
import type { JoinRequest } from './config.js';

/**
 * One capture session per meeting: launch → join → (admitted) → transcribe →
 * leave. Owns the browser + transcriber lifecycle and reports every state
 * transition back to the API. Idempotent stop so /leave and natural end
 * converge on a single clean teardown.
 */
export class MeetingSession {
  private browser: BrowserSession | null = null;
  private transcriber: Transcriber | null = null;
  private finished = false;
  private readonly callback: CallbackClient;

  constructor(
    readonly job: JoinRequest,
    private readonly logger: Logger,
    private readonly onDone: (meetingId: string) => void,
  ) {
    this.callback = new CallbackClient(job.callbackUrl, job.callbackToken, logger);
  }

  /** Runs the full lifecycle; resolves when the session has fully ended. */
  async run(): Promise<void> {
    try {
      await this.callback.status('joining');
      this.browser = await launchBrowser();

      const admission = await joinMeet(
        this.browser.page,
        {
          meetUrl: this.job.meetUrl,
          displayName: this.job.displayName,
          admissionTimeoutSeconds: this.job.admissionTimeoutSeconds,
        },
        this.logger,
      );

      if (admission !== 'admitted') {
        await this.callback.status('error', `admission ${admission}`);
        await this.teardown();
        return;
      }

      await this.callback.status('admitted');

      this.transcriber = new Transcriber(
        {
          model: this.job.whisperModel,
          sampleRate: this.job.sampleRate,
          silenceTimeoutSeconds: this.job.silenceTimeoutSeconds,
          maxMeetingSeconds: this.job.maxMeetingSeconds,
        },
        this.callback,
        this.logger,
        () => {
          void this.finish('silence/max-duration');
        },
      );
      await this.transcriber.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ error: message }, 'session failed');
      await this.callback.status('error', message).catch(() => undefined);
      await this.teardown();
    }
  }

  /** External /leave request. */
  async stop(): Promise<void> {
    await this.finish('leave-requested');
  }

  private async finish(reason: string): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.logger.info({ meetingId: this.job.meetingId, reason }, 'finishing session');

    if (this.transcriber) await this.transcriber.stop().catch(() => undefined);
    if (this.browser) await leaveMeet(this.browser.page, this.logger).catch(() => undefined);
    await this.callback.status('ended').catch(() => undefined);
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    if (this.browser) {
      await this.browser.context.close().catch(() => undefined);
      await this.browser.browser.close().catch(() => undefined);
      this.browser = null;
    }
    this.onDone(this.job.meetingId);
  }
}
