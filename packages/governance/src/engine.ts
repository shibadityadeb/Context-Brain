import { resolveGovernanceConfig, SEVERITY_RANK, type GovernanceConfig } from './config.js';
import { documentTitle, LAWS, regionsForCountry } from './registry.js';
import type {
  ApplicableLaw,
  DocumentType,
  GovernanceAssessment,
  GovernanceScores,
  LaunchBlocker,
  LawKind,
  LawTrigger,
  MissingInfo,
  ProductProfile,
  Region,
  Requirement,
  Severity,
} from './types.js';

/**
 * The deterministic governance engine. Given a Product Profile it infers
 * applicable laws, the documents/controls they require, the gaps, launch
 * blockers, scores and — crucially — what information is missing (so callers ask
 * rather than hallucinate). Pure: same profile in ⇒ same assessment out.
 */

export interface AssessInput {
  profile: ProductProfile;
  /** Document types already produced/approved for the product. */
  existingDocuments?: DocumentType[];
  config?: Partial<GovernanceConfig>;
}

// ── Regions ──────────────────────────────────────────────────────────────────

/** The union of regions a product's target countries pull in. */
export function inferRegions(profile: ProductProfile): Region[] {
  const set = new Set<Region>(['GLOBAL']);
  for (const country of profile.countries ?? []) {
    for (const r of regionsForCountry(country)) set.add(r);
  }
  return [...set];
}

// ── Applicable-law inference ─────────────────────────────────────────────────

function triggerMatch(profile: ProductProfile, regions: Region[], t: LawTrigger): string[] | null {
  const reasons: string[] = [];
  if (t.regions?.length) {
    const hit = t.regions.filter((r) => regions.includes(r));
    if (hit.length === 0) return null;
    if (!hit.every((r) => r === 'GLOBAL'))
      reasons.push(`operates in ${hit.filter((r) => r !== 'GLOBAL').join(', ')}`);
  }
  if (t.dataCategories?.length) {
    const hit = t.dataCategories.filter((d) => profile.dataCategories?.includes(d));
    if (hit.length === 0) return null;
    reasons.push(`collects ${hit.join(', ')} data`);
  }
  if (t.industries?.length) {
    if (!profile.industry || !t.industries.includes(profile.industry)) return null;
    reasons.push(`industry: ${profile.industry}`);
  }
  if (t.flags?.length) {
    const hit = t.flags.filter((f) => profile.flags?.includes(f));
    if (hit.length === 0) return null;
    reasons.push(`capability: ${hit.join(', ')}`);
  }
  // A GLOBAL-only recommended framework with no other clause still matches.
  return reasons;
}

/** Every law/framework whose triggers the profile satisfies, with the reasons. */
export function inferApplicableLaws(profile: ProductProfile): ApplicableLaw[] {
  const regions = inferRegions(profile);
  const out: ApplicableLaw[] = [];
  for (const law of LAWS) {
    let matched: string[] | null = null;
    let recommended = false;
    for (const t of law.triggers) {
      const reasons = triggerMatch(profile, regions, t);
      if (reasons) {
        matched = reasons;
        recommended = Boolean(t.recommended);
        break;
      }
    }
    if (matched === null) continue;
    out.push({
      lawId: law.id,
      name: law.name,
      shortName: law.shortName,
      kind: law.kind,
      region: law.region,
      severity: law.severity,
      reasons: matched.length ? matched : ['recommended baseline'],
      recommended,
      url: law.url,
    });
  }
  // Forced obligations first, then recommended, each by severity.
  return out.sort(
    (a, b) =>
      Number(a.recommended) - Number(b.recommended) ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );
}

// ── Requirements & gaps ──────────────────────────────────────────────────────

/** The documents required across all applicable laws, and whether each exists. */
export function buildRequirements(
  applicable: ApplicableLaw[],
  existingDocuments: DocumentType[],
  config: GovernanceConfig,
): Requirement[] {
  const lawById = new Map(LAWS.map((l) => [l.id, l]));
  const byDoc = new Map<DocumentType, { requiredBy: Set<string>; severity: Severity }>();

  const consider = (doc: DocumentType, requiredBy: string, severity: Severity) => {
    const entry = byDoc.get(doc) ?? { requiredBy: new Set<string>(), severity: 'LOW' as Severity };
    entry.requiredBy.add(requiredBy);
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[entry.severity]) entry.severity = severity;
    byDoc.set(doc, entry);
  };

  for (const doc of config.baselineDocuments) consider(doc, 'baseline', 'MEDIUM');
  for (const app of applicable) {
    const law = lawById.get(app.lawId);
    if (!law) continue;
    for (const doc of law.requiredDocuments) consider(doc, law.shortName, law.severity);
  }

  const existing = new Set(existingDocuments);
  return [...byDoc.entries()]
    .map(([doc, meta]) => ({
      id: `doc:${doc}`,
      kind: 'DOCUMENT' as const,
      title: documentTitle(doc),
      documentType: doc,
      status: (existing.has(doc) ? 'SATISFIED' : 'MISSING') as Requirement['status'],
      severity: meta.severity,
      requiredBy: [...meta.requiredBy],
    }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

// ── Missing information (ask, don't hallucinate) ─────────────────────────────

const MISSING_PROMPTS: Partial<
  Record<
    keyof ProductProfile,
    { question: (n: string) => string; options: string[]; severity: Severity }
  >
> = {
  countries: {
    question: (n) => `Which countries will ${n} launch in? Applicable law depends on it.`,
    options: [
      'European Union',
      'United Kingdom',
      'United States',
      'India',
      'Canada',
      'Australia',
      'Singapore',
      'Global',
    ],
    severity: 'CRITICAL',
  },
  dataCategories: {
    question: (n) => `What categories of personal data does ${n} collect?`,
    options: [
      'Basic PII (name/email)',
      'Sensitive PII',
      'Biometric',
      'Health',
      'Financial',
      "Children's data",
      'Location',
      'None',
    ],
    severity: 'CRITICAL',
  },
  industry: {
    question: (n) => `What industry does ${n} operate in?`,
    options: [
      'Generic SaaS',
      'Fintech',
      'Healthcare',
      'Education',
      'Government',
      'E-commerce',
      'AdTech',
      'Social',
      'AI',
    ],
    severity: 'HIGH',
  },
  authentication: {
    question: (n) => `How do users authenticate to ${n}?`,
    options: ['Email/password', 'OAuth / SSO', 'Passwordless / magic link', 'No accounts'],
    severity: 'MEDIUM',
  },
  cloudProvider: {
    question: (n) => `Where is ${n} hosted?`,
    options: ['AWS', 'Google Cloud', 'Azure', 'On-premise', 'Other'],
    severity: 'MEDIUM',
  },
};

function isKnown(profile: ProductProfile, field: keyof ProductProfile): boolean {
  const v = profile[field];
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== '';
}

/** Critical unknowns the engine needs answered before it can be confident. */
export function detectMissingInfo(
  profile: ProductProfile,
  config: GovernanceConfig,
): MissingInfo[] {
  const out: MissingInfo[] = [];
  for (const field of config.criticalFields) {
    const prompt = MISSING_PROMPTS[field];
    if (!prompt || isKnown(profile, field)) continue;
    out.push({
      field,
      question: prompt.question(profile.name),
      options: prompt.options,
      severity: prompt.severity,
    });
  }
  return out.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/** Which penalty dimension a law kind dents when its documents are missing.
 * Sector-privacy laws (HIPAA/COPPA) fold into the privacy dimension. */
const KIND_PENALTY_DIM: Record<
  LawKind,
  'privacy' | 'security' | 'aiGovernance' | 'accessibility' | 'documentation'
> = {
  PRIVACY: 'privacy',
  AI: 'aiGovernance',
  SECURITY: 'security',
  PAYMENTS: 'security',
  SECTOR: 'privacy',
  ACCESSIBILITY: 'accessibility',
  FRAMEWORK: 'documentation',
};

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function scoreGovernance(
  profile: ProductProfile,
  applicable: ApplicableLaw[],
  requirements: Requirement[],
  missingInfo: MissingInfo[],
  config: GovernanceConfig,
): GovernanceScores {
  const gaps = requirements.filter((r) => r.status === 'MISSING');
  const lawById = new Map(LAWS.map((l) => [l.id, l]));

  // Per-dimension penalties from missing documents, attributed to the kinds of
  // the laws that require them.
  const penalty = { privacy: 0, security: 0, aiGovernance: 0, accessibility: 0, documentation: 0 };
  for (const gap of gaps) {
    const kinds = new Set<LawKind>();
    for (const shortName of gap.requiredBy) {
      const law = applicable.find((a) => a.shortName === shortName);
      if (law) kinds.add(law.kind);
    }
    const p = config.severityPenalty[gap.severity];
    for (const kind of kinds) {
      penalty[KIND_PENALTY_DIM[kind]] += p;
    }
    penalty.documentation += p; // every missing doc dents documentation
  }

  const aiApplies = applicable.some((a) => a.kind === 'AI');
  const a11yApplies = applicable.some((a) => a.kind === 'ACCESSIBILITY');

  const privacy = clamp(100 - penalty.privacy);
  const security = clamp(100 - penalty.security);
  const aiGovernance = aiApplies ? clamp(100 - penalty.aiGovernance) : 100;
  const accessibility = a11yApplies ? clamp(100 - penalty.accessibility) : 100;

  // Documentation: share of required documents satisfied.
  const required = requirements.length;
  const satisfied = requirements.filter((r) => r.status === 'SATISFIED').length;
  const documentation = required === 0 ? 100 : clamp((satisfied / required) * 100);

  // Compliance: share of FORCED (non-recommended) laws fully covered.
  const forced = applicable.filter((a) => !a.recommended);
  const coveredForced = forced.filter((a) => {
    const law = lawById.get(a.lawId);
    return law
      ? law.requiredDocuments.every(
          (d) => requirements.find((r) => r.documentType === d)?.status !== 'MISSING',
        )
      : true;
  }).length;
  const compliance = forced.length === 0 ? 100 : clamp((coveredForced / forced.length) * 100);

  const criticalMissingInfo = missingInfo.filter((m) => m.severity === 'CRITICAL').length;
  const legalReadiness = clamp((privacy + compliance) / 2 - criticalMissingInfo * 20);

  const totalGapPenalty = gaps.reduce((s, g) => s + config.severityPenalty[g.severity], 0);
  const criticalBlockers = gaps.filter(
    (g) => SEVERITY_RANK[g.severity] >= SEVERITY_RANK[config.launchBlockingSeverity],
  ).length;
  const risk = clamp(totalGapPenalty + criticalBlockers * 15 + criticalMissingInfo * 15);
  const launchReadiness = clamp(100 - risk - criticalMissingInfo * 10);

  const w = config.overallWeights;
  const wsum =
    w.privacy +
    w.security +
    w.compliance +
    w.aiGovernance +
    w.legalReadiness +
    w.documentation +
    w.accessibility;
  const overall = clamp(
    (privacy * w.privacy +
      security * w.security +
      compliance * w.compliance +
      aiGovernance * w.aiGovernance +
      legalReadiness * w.legalReadiness +
      documentation * w.documentation +
      accessibility * w.accessibility) /
      wsum,
  );

  return {
    privacy,
    security,
    compliance,
    aiGovernance,
    legalReadiness,
    documentation,
    accessibility,
    risk,
    launchReadiness,
    overall,
  };
}

// ── Launch blockers & actions ────────────────────────────────────────────────

function deriveLaunchBlockers(
  gaps: Requirement[],
  missingInfo: MissingInfo[],
  config: GovernanceConfig,
): LaunchBlocker[] {
  const blockers: LaunchBlocker[] = [];
  for (const g of gaps) {
    if (SEVERITY_RANK[g.severity] >= SEVERITY_RANK[config.launchBlockingSeverity]) {
      blockers.push({
        title: `Missing ${g.title}`,
        severity: g.severity,
        detail: `Required by ${g.requiredBy.join(', ')}.`,
      });
    }
  }
  for (const m of missingInfo) {
    if (m.severity === 'CRITICAL') {
      blockers.push({
        title: `Unknown: ${String(m.field)}`,
        severity: 'CRITICAL',
        detail: 'Applicable law cannot be determined until this is known.',
      });
    }
  }
  return blockers;
}

function recommendActions(
  applicable: ApplicableLaw[],
  gaps: Requirement[],
  missingInfo: MissingInfo[],
): string[] {
  const actions: string[] = [];
  for (const m of missingInfo.slice(0, 3)) actions.push(`Answer: ${m.question}`);
  for (const g of gaps.slice(0, 6)) actions.push(`Generate ${g.title}`);
  const sensitive = applicable.find((a) => a.reasons.some((r) => /BIOMETRIC|HEALTH/.test(r)));
  if (sensitive)
    actions.push(
      'Perform a Data Protection Impact Assessment (DPIA) for sensitive-data processing',
    );
  if (applicable.some((a) => a.kind === 'AI'))
    actions.push('Publish an AI Transparency Statement and enable human oversight');
  return [...new Set(actions)];
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/** Run a full governance assessment over a Product Profile. */
export function assess(input: AssessInput): GovernanceAssessment {
  const config = resolveGovernanceConfig(input.config);
  const profile = input.profile;
  const existing = input.existingDocuments ?? [];

  const applicableLaws = inferApplicableLaws(profile);
  const requirements = buildRequirements(applicableLaws, existing, config);
  const missingInfo = detectMissingInfo(profile, config);
  const scores = scoreGovernance(profile, applicableLaws, requirements, missingInfo, config);
  const gaps = requirements.filter((r) => r.status === 'MISSING');
  const launchBlockers = deriveLaunchBlockers(gaps, missingInfo, config);
  const recommendedActions = recommendActions(applicableLaws, gaps, missingInfo);

  const knownCritical = config.criticalFields.filter((f) => isKnown(profile, f)).length;
  const confidence =
    config.criticalFields.length === 0
      ? 1
      : Math.round((knownCritical / config.criticalFields.length) * 100) / 100;

  return {
    applicableLaws,
    requirements,
    gaps,
    missingInfo,
    scores,
    launchBlockers,
    recommendedActions,
    confidence,
  };
}
