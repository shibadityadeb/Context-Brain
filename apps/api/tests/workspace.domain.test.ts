import { describe, expect, it } from 'vitest';
import {
  extractDomain,
  isConsumerDomain,
  resolveWorkspaceDomain,
  suggestWorkspaceName,
} from '../src/modules/workspace/domain.js';

// A representative denylist; the real one comes from config.workspace.consumerDomains.
const CONSUMER = ['gmail.com', 'yahoo.com', 'outlook.com'];

describe('extractDomain', () => {
  it('returns the lowercased domain part', () => {
    expect(extractDomain('Shibaditya@GoToRetreats.com')).toBe('gotoretreats.com');
  });

  it('rejects missing, malformed, or dotless domains', () => {
    expect(extractDomain(null)).toBeNull();
    expect(extractDomain(undefined)).toBeNull();
    expect(extractDomain('no-at-sign')).toBeNull();
    expect(extractDomain('user@localhost')).toBeNull();
  });

  it('uses the last @ so plus/quoted local parts do not confuse it', () => {
    expect(extractDomain('a@b@acme.com')).toBe('acme.com');
  });
});

describe('isConsumerDomain', () => {
  it('is case/whitespace insensitive', () => {
    expect(isConsumerDomain(' Gmail.com ', CONSUMER)).toBe(true);
    expect(isConsumerDomain('acme.com', CONSUMER)).toBe(false);
  });
});

describe('resolveWorkspaceDomain', () => {
  it('prefers the verified hosted domain (hd) over the email domain', () => {
    expect(resolveWorkspaceDomain({ email: 'user@alias.com', hd: 'acme.com' }, CONSUMER)).toBe(
      'acme.com',
    );
  });

  it('falls back to the email domain when hd is absent', () => {
    expect(resolveWorkspaceDomain({ email: 'user@acme.com' }, CONSUMER)).toBe('acme.com');
  });

  // Safety-critical: consumer accounts must NEVER discover a shared workspace.
  it('returns null for consumer email domains', () => {
    expect(resolveWorkspaceDomain({ email: 'someone@gmail.com' }, CONSUMER)).toBeNull();
  });

  it('returns null when a consumer domain sneaks in via hd', () => {
    expect(
      resolveWorkspaceDomain({ email: 'someone@gmail.com', hd: 'yahoo.com' }, CONSUMER),
    ).toBeNull();
  });

  it('returns null when nothing resolves', () => {
    expect(resolveWorkspaceDomain({ email: null, hd: null }, CONSUMER)).toBeNull();
  });
});

describe('suggestWorkspaceName', () => {
  it('title-cases the first label and splits on separators', () => {
    expect(suggestWorkspaceName('acme-inc.com')).toBe('Acme Inc');
    expect(suggestWorkspaceName('gotoretreats.com')).toBe('Gotoretreats');
    expect(suggestWorkspaceName('ai_bridge.io')).toBe('Ai Bridge');
  });
});
