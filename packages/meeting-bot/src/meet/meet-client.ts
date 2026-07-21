import type { MeetingBotConfig } from '../config/index.js';
import type { AdmissionResult } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { clickFirst, fillFirst, isAnyVisible, type PageLike } from '../utils/dom.js';
import { MeetSelectors } from './selectors.js';

export interface JoinParams {
  meetingUrl: string;
  displayName: string;
  /** Invoked while waiting in the lobby with elapsed wait time (ms). */
  onWaiting?: (waitedMs: number) => void;
}

/**
 * Drives the Google Meet UI: open the URL, ensure mic + camera are off, ask to
 * join, wait for admission, then later detect removal / meeting end and leave.
 * Every DOM interaction is best-effort through the resilient selector catalog —
 * a missing control never throws; the flow drives toward its goal.
 *
 * Knows nothing about audio, transcription, or downstream services.
 */
export class MeetClient {
  constructor(
    private readonly config: MeetingBotConfig,
    private readonly logger: Logger,
  ) {}

  /** Open the meeting and ask to join; resolves with the admission outcome. */
  async join(page: PageLike, params: JoinParams): Promise<AdmissionResult> {
    await page.goto(params.meetingUrl, {
      waitUntil: 'networkidle',
      timeout: this.config.meeting.pageLoadTimeoutMs,
    });
    await page.waitForTimeout(2500);

    await clickFirst(page, MeetSelectors.dismissDialogs, this.logger);
    await this.setDisplayName(page, params.displayName);
    await this.ensureDevicesOff(page);

    const clicked = await clickFirst(page, MeetSelectors.join, this.logger);
    this.logger.info({ clicked }, 'join requested');

    return this.waitForAdmission(page, params.onWaiting);
  }

  /** Best-effort hang up. */
  async leave(page: PageLike): Promise<void> {
    await clickFirst(page, MeetSelectors.leave, this.logger);
  }

  /** True once the meeting toolbar is present (the bot is in the call). */
  isInCall(page: PageLike): Promise<boolean> {
    return isAnyVisible(page, MeetSelectors.inCall, 500);
  }

  /** True if the bot was removed or the whole meeting ended. */
  isMeetingOver(page: PageLike): Promise<boolean> {
    return isAnyVisible(page, MeetSelectors.removedOrEnded, 500);
  }

  private async setDisplayName(page: PageLike, name: string): Promise<void> {
    const filled = await fillFirst(page, MeetSelectors.nameInput, name);
    if (filled) this.logger.info({ name }, 'display name set');
    else this.logger.debug('no name field (likely a signed-in profile)');
  }

  private async ensureDevicesOff(page: PageLike): Promise<void> {
    // The toggles are labelled "Turn off …" only while the device is ON, so a
    // click here is idempotent — it fires exactly when the device needs muting.
    await clickFirst(page, MeetSelectors.micOff, this.logger);
    await clickFirst(page, MeetSelectors.cameraOff, this.logger);
  }

  private async waitForAdmission(
    page: PageLike,
    onWaiting?: (waitedMs: number) => void,
  ): Promise<AdmissionResult> {
    const start = Date.now();
    const deadline = start + this.config.meeting.admissionTimeoutSeconds * 1000;

    while (Date.now() < deadline) {
      if (await isAnyVisible(page, MeetSelectors.inCall, 500)) {
        this.logger.info({ waitedMs: Date.now() - start }, 'admitted into meeting');
        return 'admitted';
      }
      if (await isAnyVisible(page, MeetSelectors.denied, 500)) {
        this.logger.warn('admission denied');
        return 'denied';
      }
      onWaiting?.(Date.now() - start);
      await page.waitForTimeout(this.config.meeting.admissionPollMs);
    }
    this.logger.warn('admission timed out');
    return 'timeout';
  }
}
