import type { Page } from 'playwright';
import type { MeetingBotConfig } from '../config/index.js';
import type { Logger } from '../utils/logger.js';
import { clickFirst, fillFirst, isAnyVisible } from '../utils/dom.js';

export type AuthResult = 'anonymous' | 'authenticated';

/** Thrown when interactive intervention (2FA / captcha) blocks a login. */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

const ACCOUNT_URL = 'https://myaccount.google.com/';

/**
 * Ensures the persistent Chrome profile is signed into the dedicated Google
 * account — but only if it isn't already. Because the profile is persistent
 * ({@link BrowserManager}), this is a no-op on every run after the first, so
 * the bot does not log in before each meeting.
 *
 * With no credentials configured the bot stays anonymous and joins via
 * "ask to join". 2FA / captcha challenges are surfaced as
 * {@link AuthenticationError} rather than hanging.
 */
export class GoogleAuth {
  constructor(
    private readonly config: MeetingBotConfig,
    private readonly logger: Logger,
  ) {}

  async ensureAuthenticated(page: Page): Promise<AuthResult> {
    const { email, password } = this.config.credentials;
    if (!email || !password) {
      this.logger.info('no Google credentials configured — joining anonymously');
      return 'anonymous';
    }

    await page.goto(ACCOUNT_URL, {
      waitUntil: 'networkidle',
      timeout: this.config.meeting.pageLoadTimeoutMs,
    });

    if (await this.isSignedIn(page)) {
      this.logger.info('existing Google session restored from profile');
      return 'authenticated';
    }

    this.logger.info({ email }, 'signing into Google');
    await this.performLogin(page, email, password);

    if (!(await this.isSignedIn(page))) {
      throw new AuthenticationError('login did not reach a signed-in state');
    }
    this.logger.info('Google sign-in complete');
    return 'authenticated';
  }

  /** Signed in when we land on the account page rather than a sign-in page. */
  private async isSignedIn(page: Page): Promise<boolean> {
    const url = page.url();
    return url.startsWith(ACCOUNT_URL) && !url.includes('signin') && !url.includes('ServiceLogin');
  }

  private async performLogin(page: Page, email: string, password: string): Promise<void> {
    const emailFilled = await fillFirst(page, ['input[type="email"]', 'input#identifierId'], email);
    if (!emailFilled) throw new AuthenticationError('email field not found on sign-in page');
    await clickFirst(page, ['#identifierNext button', 'button:has-text("Next")'], this.logger);
    await page.waitForTimeout(2500);

    const passwordFilled = await fillFirst(
      page,
      ['input[type="password"]', 'input[name="Passwd"]'],
      password,
    );
    if (!passwordFilled) throw new AuthenticationError('password field not found on sign-in page');
    await clickFirst(page, ['#passwordNext button', 'button:has-text("Next")'], this.logger);
    await page.waitForTimeout(4000);

    // A challenge page means we need a human — fail loudly instead of hanging.
    const challenged = await isAnyVisible(
      page,
      [
        'text=2-Step Verification',
        'text=Verify it’s you',
        'text=Enter the code',
        'input[name="totpPin"]',
        'text=Try another way',
      ],
      1000,
    );
    if (challenged) {
      throw new AuthenticationError('2FA / verification challenge requires manual sign-in once');
    }
  }
}
