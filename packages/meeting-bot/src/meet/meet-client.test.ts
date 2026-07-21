import { describe, expect, it } from 'vitest';
import { MeetClient } from './meet-client.js';
import { MeetSelectors } from './selectors.js';
import { loadConfig } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { LocatorLike, PageLike } from '../utils/dom.js';

const logger = createLogger({ level: 'silent', pretty: false });
const config = loadConfig({ ADMISSION_POLL_MS: '1' });

/**
 * A fake Playwright page driven entirely by a set of "visible" selectors — no
 * browser, no Google Meet. Records clicks and fills so the test can assert the
 * bot muted, killed the camera, and asked to join.
 */
function fakePage(
  visibleSelectors: string[],
): PageLike & { clicks: string[]; fills: Record<string, string> } {
  const visible = new Set(visibleSelectors);
  const clicks: string[] = [];
  const fills: Record<string, string> = {};

  const makeLocator = (selector: string): LocatorLike => ({
    first: () => makeLocator(selector),
    isVisible: async () => visible.has(selector),
    click: async () => {
      clicks.push(selector);
    },
    fill: async (value: string) => {
      fills[selector] = value;
    },
    count: async () => (visible.has(selector) ? 1 : 0),
    allInnerTexts: async () => [],
  });

  return {
    goto: async () => null,
    locator: (selector: string) => makeLocator(selector),
    waitForTimeout: async () => undefined,
    clicks,
    fills,
  };
}

describe('MeetClient.join', () => {
  it('mutes, disables camera, asks to join, and reports admission', async () => {
    const page = fakePage([
      MeetSelectors.nameInput[2], // 'input[type="text"]'
      MeetSelectors.micOff[0],
      MeetSelectors.cameraOff[0],
      MeetSelectors.join[0],
      MeetSelectors.inCall[0], // Leave call present ⇒ admitted
    ]);
    const client = new MeetClient(config, logger);

    const result = await client.join(page, {
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      displayName: 'Notetaker',
    });

    expect(result).toBe('admitted');
    expect(page.fills[MeetSelectors.nameInput[2]!]).toBe('Notetaker');
    expect(page.clicks).toContain(MeetSelectors.micOff[0]);
    expect(page.clicks).toContain(MeetSelectors.cameraOff[0]);
    expect(page.clicks).toContain(MeetSelectors.join[0]);
  });

  it('reports a denied admission', async () => {
    const page = fakePage([MeetSelectors.join[0], MeetSelectors.denied[0]]);
    const client = new MeetClient(config, logger);
    const result = await client.join(page, {
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      displayName: 'Notetaker',
    });
    expect(result).toBe('denied');
  });

  it('emits waiting callbacks while in the lobby, then admits', async () => {
    // Not admitted or denied on the first probe → one waiting tick, then admit.
    // The host admits only once the admission loop has waited at least once
    // (the 2nd waitForTimeout: the 1st is join()'s initial settle delay).
    let ticks = 0;
    let waits = 0;
    const visible = new Set<string>();
    const page: PageLike = {
      goto: async () => null,
      waitForTimeout: async () => {
        if (++waits >= 2) visible.add(MeetSelectors.inCall[0]!);
      },
      locator: (selector: string) => ({
        first() {
          return this;
        },
        isVisible: async () => visible.has(selector),
        click: async () => undefined,
        fill: async () => undefined,
        count: async () => 0,
        allInnerTexts: async () => [],
      }),
    };
    const client = new MeetClient(config, logger);
    const result = await client.join(page, {
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      displayName: 'Notetaker',
      onWaiting: () => {
        ticks += 1;
      },
    });
    expect(result).toBe('admitted');
    expect(ticks).toBeGreaterThanOrEqual(1);
  });

  it('detects the meeting is over', async () => {
    const page = fakePage([MeetSelectors.removedOrEnded[0]]);
    const client = new MeetClient(config, logger);
    await expect(client.isMeetingOver(page)).resolves.toBe(true);
  });
});
