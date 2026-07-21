import type { Logger } from './logger.js';

/**
 * Narrow structural interfaces over just the Playwright surface the bot uses.
 * The real `Page`/`Locator` satisfy these, so production passes real objects
 * while tests pass lightweight fakes — no Playwright, no live Meet required.
 */
export interface LocatorLike {
  first(): LocatorLike;
  isVisible(options?: { timeout?: number }): Promise<boolean>;
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  count(): Promise<number>;
  allInnerTexts(): Promise<string[]>;
}

export interface PageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  locator(selector: string): LocatorLike;
  waitForTimeout(timeout: number): Promise<void>;
}

const DEFAULT_PROBE_MS = 1500;

/** True if any of the selectors is currently visible (short probe each). */
export async function isAnyVisible(
  page: PageLike,
  selectors: readonly string[],
  timeoutMs = 500,
): Promise<boolean> {
  for (const selector of selectors) {
    const visible = await page
      .locator(selector)
      .first()
      .isVisible({ timeout: timeoutMs })
      .catch(() => false);
    if (visible) return true;
  }
  return false;
}

/**
 * Click the first visible selector from a resilience list and report success.
 * Google's DOM shifts constantly, so callers pass several fallbacks and we
 * never throw on a missing control — the flow drives toward its goal.
 */
export async function clickFirst(
  page: PageLike,
  selectors: readonly string[],
  logger: Logger,
  timeoutMs = DEFAULT_PROBE_MS,
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: timeoutMs }).catch(() => false)) {
        await locator.click({ timeout: 3000 });
        return true;
      }
    } catch (error) {
      logger.debug({ selector, error: String(error) }, 'selector click skipped');
    }
  }
  return false;
}

/** Fill the first visible input from a resilience list; reports success. */
export async function fillFirst(
  page: PageLike,
  selectors: readonly string[],
  value: string,
  timeoutMs = DEFAULT_PROBE_MS,
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const input = page.locator(selector).first();
      if (await input.isVisible({ timeout: timeoutMs }).catch(() => false)) {
        await input.fill(value, { timeout: 3000 });
        return true;
      }
    } catch {
      /* try next candidate */
    }
  }
  return false;
}
