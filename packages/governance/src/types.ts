/**
 * Governance domain model. This package is the *brain* of the AI Launch &
 * Governance Copilot: pure, deterministic logic that turns a structured Product
 * Profile into applicable laws, gaps, scores, missing-information questions and
 * document specs. It performs NO I/O and holds NO secrets — the API layer owns
 * persistence, retrieval and the LLM, and consumes these functions.
 *
 * Every rule is expressed as DATA (see `registry.ts`), never as branching magic
 * constants, so laws/frameworks are added by editing the registry — the engine
 * never changes.
 */

// ── Vocabulary (controlled, extensible) ──────────────────────────────────────

/** Coarse jurisdiction regions a law can attach to. `GLOBAL` always matches. */
export type Region =
  'GLOBAL' | 'EU' | 'EEA' | 'UK' | 'US' | 'US_CA' | 'US_IL' | 'IN' | 'CA' | 'AU' | 'SG' | 'BR';

/** Categories of data whose presence changes the legal surface. */
export const DATA_CATEGORIES = [
  'PII',
  'SENSITIVE_PII',
  'BIOMETRIC',
  'HEALTH',
  'FINANCIAL',
  'LOCATION',
  'CHILDREN',
  'IP_ADDRESS',
  'USER_CONTENT',
  'DEVICE',
  'COOKIES',
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

/** Product/industry classifications that pull in sector rules. */
export const INDUSTRIES = [
  'GENERIC',
  'FINTECH',
  'HEALTHCARE',
  'EDUCATION',
  'GOVERNMENT',
  'ECOMMERCE',
  'ADTECH',
  'SOCIAL',
  'AI',
] as const;
export type Industry = (typeof INDUSTRIES)[number];

/** Boolean capability/behaviour flags a law rule can key on. */
export const PRODUCT_FLAGS = [
  'ai',
  'generative_ai',
  'high_risk_ai',
  'payments',
  'marketing_email',
  'user_generated_content',
  'tracking',
  'cookies',
  'third_party_data_sharing',
  'international_data_transfer',
  'public_api',
  'mobile_app',
  'children_directed',
] as const;
export type ProductFlag = (typeof PRODUCT_FLAGS)[number];

// ── Product Profile — the continuously evolving structured knowledge ─────────

/**
 * The structured profile the system maintains per product. Fields are
 * intentionally optional: an unknown field is a signal for the Missing
 * Information Engine, never an assumption. Free-form extras from extraction
 * live in `attributes`.
 */
export interface ProductProfile {
  name: string;
  domain?: string;
  company?: string;
  description?: string;
  industry?: Industry;
  businessModel?: string;

  /** Where the product operates — ISO-3166 alpha-2 codes (e.g. "DE", "IN"). */
  countries: string[];
  languages?: string[];

  dataCategories: DataCategory[];
  flags: ProductFlag[];

  authentication?: string;
  paymentProviders?: string[];
  thirdPartyApis?: string[];
  cloudProvider?: string;
  cloudRegions?: string[];
  aiModels?: string[];
  analyticsTools?: string[];
  subprocessors?: string[];

  dataRetention?: string;

  /** Free-form extracted attributes not yet promoted to typed fields. */
  attributes?: Record<string, unknown>;
}

/** Which typed profile fields are considered known (for missing-info checks). */
export type ProfileField = keyof ProductProfile;

// ── Laws & frameworks (registry entries) ─────────────────────────────────────

export type LawKind =
  'PRIVACY' | 'AI' | 'SECURITY' | 'PAYMENTS' | 'SECTOR' | 'ACCESSIBILITY' | 'FRAMEWORK';

/** The condition under which a law/framework applies. All present clauses must
 * be satisfiable; within a clause, ANY value matches (OR). Empty clause = ignored. */
export interface LawTrigger {
  regions?: Region[];
  dataCategories?: DataCategory[];
  industries?: Industry[];
  flags?: ProductFlag[];
  /** When true, the law is a recommended baseline framework, not jurisdiction-forced. */
  recommended?: boolean;
}

export interface Law {
  id: string;
  name: string;
  shortName: string;
  kind: LawKind;
  region: Region;
  /** Any trigger matching ⇒ the law applies. */
  triggers: LawTrigger[];
  /** Document types this law expects to exist. */
  requiredDocuments: DocumentType[];
  /** Human obligations, surfaced as controls/checklist items. */
  obligations: string[];
  url?: string;
  /** Base severity when this law is unmet (drives risk + launch blocking). */
  severity: Severity;
}

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

// ── Generated documents ──────────────────────────────────────────────────────

export type DocumentType =
  | 'PRIVACY_POLICY'
  | 'TERMS_OF_SERVICE'
  | 'COOKIE_POLICY'
  | 'COOKIE_CONSENT'
  | 'DPA'
  | 'AI_TRANSPARENCY'
  | 'ACCEPTABLE_USE'
  | 'SECURITY_POLICY'
  | 'INFOSEC_POLICY'
  | 'INCIDENT_RESPONSE'
  | 'RESPONSIBLE_AI'
  | 'VENDOR_RISK'
  | 'PRIVACY_NOTICE'
  | 'DATA_RETENTION'
  | 'SUBPROCESSORS'
  | 'ACCESSIBILITY_STATEMENT'
  | 'EXPORT_COMPLIANCE'
  | 'CHILDRENS_PRIVACY'
  | 'DPIA';

export interface DocumentSpec {
  type: DocumentType;
  title: string;
  /** Section headings the drafter should produce. */
  sections: string[];
  /** Laws that make this document relevant, for grounding + citation. */
  drivenBy: string[];
}

// ── Assessment output ────────────────────────────────────────────────────────

export interface ApplicableLaw {
  lawId: string;
  name: string;
  shortName: string;
  kind: LawKind;
  region: Region;
  severity: Severity;
  /** Why it applies — the concrete profile signals that matched. */
  reasons: string[];
  recommended: boolean;
  url?: string;
}

/** A required document or control, and whether the product satisfies it. */
export interface Requirement {
  id: string;
  kind: 'DOCUMENT' | 'CONTROL';
  title: string;
  documentType?: DocumentType;
  status: 'SATISFIED' | 'MISSING' | 'UNKNOWN';
  severity: Severity;
  /** Law short-names that require this. */
  requiredBy: string[];
}

export interface MissingInfo {
  field: ProfileField;
  question: string;
  /** Suggested answers the UI can present as choices (user may free-type). */
  options: string[];
  severity: Severity;
}

export interface GovernanceScores {
  privacy: number;
  security: number;
  compliance: number;
  aiGovernance: number;
  legalReadiness: number;
  documentation: number;
  accessibility: number;
  risk: number;
  launchReadiness: number;
  overall: number;
}

export interface LaunchBlocker {
  title: string;
  severity: Severity;
  detail: string;
}

export interface GovernanceAssessment {
  applicableLaws: ApplicableLaw[];
  requirements: Requirement[];
  gaps: Requirement[];
  missingInfo: MissingInfo[];
  scores: GovernanceScores;
  launchBlockers: LaunchBlocker[];
  recommendedActions: string[];
  /** Confidence in the assessment given how complete the profile is (0..1). */
  confidence: number;
}
