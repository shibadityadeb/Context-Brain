import type { MeetingEventBus } from '../events/event-bus.js';
import { MeetingBotEvents } from '../types/events.js';
import type { ParticipantRecord } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import { isAnyVisible, type PageLike } from '../utils/dom.js';
import { MeetSelectors } from './selectors.js';

interface Reconciliation {
  joined: ParticipantRecord[];
  left: ParticipantRecord[];
}

/**
 * Tracks who is in the call by diffing the People panel on each poll. The diff
 * itself ({@link reconcile}) is pure and unit-tested without a browser; the
 * browser-facing {@link poll} just feeds it observed names and emits events.
 *
 * No identity resolution or LLM analysis — names are taken verbatim from Meet.
 */
export class ParticipantTracker {
  /** Currently-present people, keyed by display name (leftAt === null). */
  private readonly active = new Map<string, ParticipantRecord>();
  /** Closed presence windows (people who have left). */
  private readonly finished: ParticipantRecord[] = [];
  private peoplePanelOpened = false;

  constructor(
    private readonly meetingId: string,
    private readonly events: MeetingEventBus,
    private readonly logger: Logger,
  ) {}

  /** Number of people (other than the bot) currently detected in the call. */
  get presentCount(): number {
    return this.active.size;
  }

  /**
   * Pure diff of an observed name set against known state. Returns the newly
   * joined and newly departed records and mutates internal state accordingly.
   */
  reconcile(observedNames: string[], now: Date): Reconciliation {
    const iso = now.toISOString();
    const current = new Set(normalizeNames(observedNames));

    const joined: ParticipantRecord[] = [];
    for (const name of current) {
      if (!this.active.has(name)) {
        const record: ParticipantRecord = { name, joinedAt: iso, leftAt: null };
        this.active.set(name, record);
        joined.push(record);
      }
    }

    const left: ParticipantRecord[] = [];
    for (const [name, record] of this.active) {
      if (!current.has(name)) {
        record.leftAt = iso;
        this.active.delete(name);
        this.finished.push(record);
        left.push({ ...record });
      }
    }

    return { joined, left };
  }

  /** Read the People panel, reconcile, and emit join/leave events. */
  async poll(page: PageLike): Promise<void> {
    const names = await this.readNames(page);
    // A transient empty read (panel re-rendering) shouldn't evict everyone.
    if (names.length === 0 && this.active.size > 0) return;

    const { joined, left } = this.reconcile(names, new Date());
    for (const participant of joined) {
      this.logger.info({ name: participant.name }, 'participant joined');
      this.events.emit(MeetingBotEvents.ParticipantJoined, {
        meetingId: this.meetingId,
        timestamp: participant.joinedAt,
        participant,
      });
    }
    for (const participant of left) {
      this.logger.info({ name: participant.name }, 'participant left');
      this.events.emit(MeetingBotEvents.ParticipantLeft, {
        meetingId: this.meetingId,
        timestamp: participant.leftAt ?? new Date().toISOString(),
        participant,
      });
    }
  }

  /** Close every open presence window; called when the meeting ends. */
  finalize(now: Date = new Date()): void {
    const iso = now.toISOString();
    for (const [name, record] of this.active) {
      record.leftAt = iso;
      this.finished.push(record);
      this.active.delete(name);
    }
  }

  /** All presence records observed, ordered by join time. */
  records(): ParticipantRecord[] {
    return [...this.finished, ...this.active.values()].sort((a, b) =>
      a.joinedAt.localeCompare(b.joinedAt),
    );
  }

  private async readNames(page: PageLike): Promise<string[]> {
    // Open the People panel once so the rows are mounted in the DOM.
    if (!this.peoplePanelOpened) {
      const opened = await isAnyVisible(page, MeetSelectors.participantRows, 500);
      if (!opened) {
        for (const selector of MeetSelectors.peopleButton) {
          const clicked = await page
            .locator(selector)
            .first()
            .click({ timeout: 1500 })
            .then(() => true)
            .catch(() => false);
          if (clicked) break;
        }
      }
      this.peoplePanelOpened = true;
      await page.waitForTimeout(500);
    }

    for (const selector of MeetSelectors.participantRows) {
      const rows = page.locator(selector);
      const count = await rows.count().catch(() => 0);
      if (count === 0) continue;
      const texts = await rows.allInnerTexts().catch(() => [] as string[]);
      if (texts.length > 0) return texts;
    }
    return [];
  }
}

/** Take the first non-empty line of each row and dedupe. */
export function normalizeNames(rawTexts: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of rawTexts) {
    const name = raw
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!name) continue;
    // Skip obvious non-name chrome that can appear in rows.
    if (/^(you|presentation|meeting host)$/i.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}
