import { describe, expect, it } from 'vitest';
import { loadConfig } from './index.js';

describe('loadConfig', () => {
  it('applies config-driven defaults with no env set', () => {
    const config = loadConfig({});
    expect(config.env).toBe('development');
    expect(config.browser.headless).toBe(false);
    expect(config.meeting.displayName).toBe('Company Brain Notetaker');
    expect(config.meeting.admissionTimeoutSeconds).toBe(300);
    expect(config.resilience.joinRetryAttempts).toBe(3);
    expect(config.credentials.email).toBeUndefined();
  });

  it('coerces and overrides values from the environment', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      HEADLESS: 'true',
      GOOGLE_EMAIL: 'bot@example.com',
      GOOGLE_PASSWORD: 'secret',
      ADMISSION_TIMEOUT_SECONDS: '42',
      JOIN_RETRY_ATTEMPTS: '5',
    });
    expect(config.isProduction).toBe(true);
    expect(config.browser.headless).toBe(true);
    expect(config.credentials).toEqual({ email: 'bot@example.com', password: 'secret' });
    expect(config.meeting.admissionTimeoutSeconds).toBe(42);
    expect(config.resilience.joinRetryAttempts).toBe(5);
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({ ADMISSION_TIMEOUT_SECONDS: '-1' })).toThrow(/Invalid meeting-bot/);
    expect(() => loadConfig({ LOG_LEVEL: 'chatty' })).toThrow(/Invalid meeting-bot/);
  });
});
