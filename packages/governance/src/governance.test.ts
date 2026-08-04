import { describe, expect, it } from 'vitest';
import { assess } from './engine.js';
import { documentSpecFor } from './documents.js';
import type { ProductProfile } from './types.js';

function profile(over: Partial<ProductProfile> = {}): ProductProfile {
  return { name: 'Product Alpha', countries: [], dataCategories: [], flags: [], ...over };
}

const shortNames = (a: { shortName: string }[]) => a.map((x) => x.shortName);

describe('applicable-law inference', () => {
  it('EU launch pulls in GDPR and (with AI + cookies) the AI Act and ePrivacy', () => {
    const a = assess({
      profile: profile({ countries: ['DE'], dataCategories: ['PII'], flags: ['ai', 'cookies'] }),
    });
    const names = shortNames(a.applicableLaws);
    expect(names).toContain('GDPR');
    expect(names).toContain('EU AI Act');
    expect(names).toContain('ePrivacy');
  });

  it('detects biometric data → BIPA in the US (Illinois)', () => {
    const a = assess({ profile: profile({ countries: ['US'], dataCategories: ['BIOMETRIC'] }) });
    expect(shortNames(a.applicableLaws)).toContain('BIPA');
    // and surfaces a DPIA recommendation for sensitive-data processing
    expect(a.recommendedActions.some((x) => /DPIA/.test(x))).toBe(true);
  });

  it('India launch → DPDP; adding payments → PCI DSS and RBI', () => {
    const a = assess({
      profile: profile({ countries: ['IN'], dataCategories: ['PII'], flags: ['payments'] }),
    });
    const names = shortNames(a.applicableLaws);
    expect(names).toContain('DPDP');
    expect(names).toContain('PCI DSS');
    expect(names).toContain('RBI');
  });

  it('does not apply EU law to a US-only product', () => {
    const a = assess({ profile: profile({ countries: ['US'], dataCategories: ['PII'] }) });
    expect(shortNames(a.applicableLaws)).not.toContain('GDPR');
    expect(shortNames(a.applicableLaws)).toContain('CCPA/CPRA');
  });

  it('records WHY each law applies', () => {
    const a = assess({ profile: profile({ countries: ['DE'], dataCategories: ['HEALTH'] }) });
    const gdpr = a.applicableLaws.find((l) => l.shortName === 'GDPR')!;
    expect(gdpr.reasons.join(' ')).toMatch(/EU/);
  });
});

describe('missing information (ask, do not hallucinate)', () => {
  it('flags unknown countries and data as critical, not an assumption', () => {
    const a = assess({ profile: profile({ name: 'Alpha' }) });
    const fields = a.missingInfo.map((m) => m.field);
    expect(fields).toContain('countries');
    expect(fields).toContain('dataCategories');
    expect(a.missingInfo.find((m) => m.field === 'countries')!.options.length).toBeGreaterThan(0);
    // Unknown jurisdiction blocks launch.
    expect(a.launchBlockers.some((b) => /countries/.test(b.title))).toBe(true);
    expect(a.confidence).toBeLessThan(1);
  });

  it('a fully-specified profile has no critical missing info', () => {
    const a = assess({
      profile: profile({
        countries: ['US'],
        dataCategories: ['PII'],
        industry: 'GENERIC',
        authentication: 'OAuth',
        cloudProvider: 'AWS',
      }),
    });
    expect(a.missingInfo.filter((m) => m.severity === 'CRITICAL')).toHaveLength(0);
    expect(a.confidence).toBe(1);
  });
});

describe('gaps, scores and launch readiness', () => {
  it('missing required documents are gaps; supplying them raises documentation + launch readiness', () => {
    const p = profile({
      countries: ['DE'],
      dataCategories: ['PII'],
      industry: 'GENERIC',
      authentication: 'OAuth',
      cloudProvider: 'AWS',
    });
    const without = assess({ profile: p });
    const withDocs = assess({
      profile: p,
      existingDocuments: without.requirements.map((r) => r.documentType!).filter(Boolean),
    });

    expect(without.gaps.length).toBeGreaterThan(0);
    expect(withDocs.gaps.length).toBe(0);
    expect(withDocs.scores.documentation).toBeGreaterThan(without.scores.documentation);
    expect(withDocs.scores.launchReadiness).toBeGreaterThanOrEqual(without.scores.launchReadiness);
    expect(withDocs.scores.overall).toBeGreaterThan(without.scores.overall);
  });

  it('all scores stay within 0..100', () => {
    const a = assess({
      profile: profile({
        countries: ['DE', 'US', 'IN'],
        dataCategories: ['BIOMETRIC', 'HEALTH', 'CHILDREN'],
        flags: ['ai', 'payments', 'cookies'],
        industry: 'HEALTHCARE',
      }),
    });
    for (const v of Object.values(a.scores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('document specs', () => {
  it('annotates a Privacy Policy with the laws that drive it', () => {
    const a = assess({ profile: profile({ countries: ['DE'], dataCategories: ['PII'] }) });
    const spec = documentSpecFor('PRIVACY_POLICY', a.applicableLaws);
    expect(spec.title).toBe('Privacy Policy');
    expect(spec.drivenBy).toContain('GDPR');
    expect(spec.sections.length).toBeGreaterThan(0);
  });
});
