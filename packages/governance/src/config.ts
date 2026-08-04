import type { DocumentType, ProfileField, Severity } from './types.js';

/**
 * Tunable governance parameters. Every weight/threshold the engine uses lives
 * here as data (not inline magic numbers), so scoring can be re-calibrated
 * without touching logic. Callers may pass a partial override.
 */
export interface GovernanceConfig {
  /** Relative penalty per unmet requirement, by severity, in score points. */
  severityPenalty: Record<Severity, number>;
  /** A launch is blocked when an unmet requirement is at/above this severity. */
  launchBlockingSeverity: Severity;
  /** Profile fields that materially change the legal surface if unknown. */
  criticalFields: ProfileField[];
  /** Documents considered table-stakes for almost any launch. */
  baselineDocuments: DocumentType[];
  /** Weights for the overall score (must sum to 1 after normalization). */
  overallWeights: {
    privacy: number;
    security: number;
    compliance: number;
    aiGovernance: number;
    legalReadiness: number;
    documentation: number;
    accessibility: number;
  };
}

export const SEVERITY_RANK: Record<Severity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  severityPenalty: { CRITICAL: 34, HIGH: 20, MEDIUM: 10, LOW: 4 },
  launchBlockingSeverity: 'CRITICAL',
  criticalFields: ['countries', 'dataCategories', 'industry', 'authentication', 'cloudProvider'],
  baselineDocuments: ['PRIVACY_POLICY', 'TERMS_OF_SERVICE'],
  overallWeights: {
    privacy: 0.2,
    security: 0.18,
    compliance: 0.22,
    aiGovernance: 0.12,
    legalReadiness: 0.14,
    documentation: 0.1,
    accessibility: 0.04,
  },
};

export function resolveGovernanceConfig(
  override: Partial<GovernanceConfig> = {},
): GovernanceConfig {
  return { ...DEFAULT_GOVERNANCE_CONFIG, ...override };
}
