import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Logger } from 'pino';
import { config } from './config.js';

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export type AdmissionResult = 'admitted' | 'denied' | 'timeout';

/**
 * Launch Chromium wired for meeting capture: headful under Xvfb (so the tab's
 * audio actually renders to the PulseAudio sink), autoplay allowed, and mic +
 * camera denied — the bot is a silent, muted, camera-off notetaker.
 */
export async function launchBrowser(): Promise<BrowserSession> {
  const browser = await chromium.launch({
    headless: config.browser.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  // No microphone/camera permission → Meet joins without publishing media.
  const context = await browser.newContext({
    permissions: [],
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  return { browser, context, page };
}

/**
 * Join a Google Meet anonymously: set the display name, ensure mic + camera
 * are off, and ask to join. Google's DOM changes often, so every step is
 * best-effort with multiple selector fallbacks and never throws on a missing
 * control — it drives toward the "ask to join" action and then waits for the
 * host to admit the bot.
 */
export async function joinMeet(
  page: Page,
  params: { meetUrl: string; displayName: string; admissionTimeoutSeconds: number },
  logger: Logger,
): Promise<AdmissionResult> {
  await page.goto(params.meetUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2500);

  await dismissDialogs(page, logger);
  await setDisplayName(page, params.displayName, logger);
  await ensureDevicesOff(page, logger);
  await clickJoin(page, logger);

  return waitForAdmission(page, params.admissionTimeoutSeconds, logger);
}

async function clickFirst(page: Page, selectors: string[], logger: Logger): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) {
        await locator.click({ timeout: 3000 });
        return true;
      }
    } catch (error) {
      logger.debug({ selector, error: String(error) }, 'selector click skipped');
    }
  }
  return false;
}

async function dismissDialogs(page: Page, logger: Logger): Promise<void> {
  // "Continue without microphone and camera", cookie / account prompts.
  await clickFirst(
    page,
    [
      'button:has-text("Continue without microphone and camera")',
      'button:has-text("Continue without microphone")',
      'button:has-text("Dismiss")',
      'button:has-text("Got it")',
      'button[aria-label="Close"]',
    ],
    logger,
  );
}

async function setDisplayName(page: Page, name: string, logger: Logger): Promise<void> {
  for (const selector of [
    'input[aria-label="Your name"]',
    'input[placeholder="Your name"]',
    'input[type="text"]',
  ]) {
    try {
      const input = page.locator(selector).first();
      if (await input.isVisible({ timeout: 1500 }).catch(() => false)) {
        await input.fill(name, { timeout: 3000 });
        logger.info({ name }, 'display name set');
        return;
      }
    } catch {
      /* try next */
    }
  }
  logger.debug('no name field found (likely a signed-in profile)');
}

async function ensureDevicesOff(page: Page, logger: Logger): Promise<void> {
  // The pre-join toggles are aria-labelled "Turn off microphone/camera" when ON.
  await clickFirst(
    page,
    ['button[aria-label="Turn off microphone"]', 'div[aria-label="Turn off microphone"]'],
    logger,
  );
  await clickFirst(
    page,
    ['button[aria-label="Turn off camera"]', 'div[aria-label="Turn off camera"]'],
    logger,
  );
}

async function clickJoin(page: Page, logger: Logger): Promise<void> {
  const clicked = await clickFirst(
    page,
    [
      'button:has-text("Ask to join")',
      'button:has-text("Join now")',
      'span:has-text("Ask to join")',
      'span:has-text("Join now")',
      '[jsname="Qx7uuf"]',
    ],
    logger,
  );
  logger.info({ clicked }, 'join requested');
}

async function waitForAdmission(
  page: Page,
  timeoutSeconds: number,
  logger: Logger,
): Promise<AdmissionResult> {
  const deadline = Date.now() + timeoutSeconds * 1000;

  // In-call once the meeting toolbar (Leave call) is present.
  const admittedSelectors = [
    'button[aria-label="Leave call"]',
    'button[aria-label*="Leave call"]',
    '[aria-label="Chat with everyone"]',
    'button[aria-label="Show everyone"]',
  ];
  const deniedSelectors = [
    "text=You can't join this call",
    'text=Someone in the call denied your request',
    'text=No one responded to your request',
    'text=You have been removed',
  ];

  while (Date.now() < deadline) {
    for (const selector of admittedSelectors) {
      if (
        await page
          .locator(selector)
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false)
      ) {
        logger.info('admitted into meeting');
        return 'admitted';
      }
    }
    for (const selector of deniedSelectors) {
      if (
        await page
          .locator(selector)
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false)
      ) {
        logger.warn('admission denied');
        return 'denied';
      }
    }
    await page.waitForTimeout(config.browser.admissionPollMs);
  }
  logger.warn('admission timed out');
  return 'timeout';
}

/** Best-effort hang up so the meeting shows the bot leaving. */
export async function leaveMeet(page: Page, logger: Logger): Promise<void> {
  await clickFirst(
    page,
    ['button[aria-label="Leave call"]', 'button[aria-label*="Leave call"]'],
    logger,
  );
}
