import type { DocumentSpec, DocumentType, Law, Region } from './types.js';

/**
 * The governance knowledge base, expressed as data. Adding a jurisdiction or
 * framework means adding a `Law` here — the inference/scoring engine never
 * changes. Triggers are declarative: a law applies when ANY of its triggers is
 * fully satisfied by the product profile (see `inference.ts`).
 *
 * This registry is deliberately representative, not exhaustive legal advice; it
 * covers the frameworks in the product spec with clear extension points.
 */

// ── ISO-3166 country → coarse region(s). A country can map to several. ────────

const EU_COUNTRIES = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
]);
const EEA_EXTRA = new Set(['IS', 'LI', 'NO']);

/** Map an ISO country code to the regions whose laws it triggers. */
export function regionsForCountry(country: string): Region[] {
  const c = country.trim().toUpperCase();
  const regions: Region[] = ['GLOBAL'];
  if (EU_COUNTRIES.has(c)) regions.push('EU', 'EEA');
  else if (EEA_EXTRA.has(c)) regions.push('EEA');
  if (c === 'GB' || c === 'UK') regions.push('UK');
  if (c === 'US') regions.push('US', 'US_CA', 'US_IL');
  if (c === 'IN') regions.push('IN');
  if (c === 'CA') regions.push('CA');
  if (c === 'AU') regions.push('AU');
  if (c === 'SG') regions.push('SG');
  if (c === 'BR') regions.push('BR');
  return regions;
}

// ── Laws & frameworks ────────────────────────────────────────────────────────

export const LAWS: Law[] = [
  // ── European Union ──
  {
    id: 'gdpr',
    name: 'General Data Protection Regulation',
    shortName: 'GDPR',
    kind: 'PRIVACY',
    region: 'EU',
    triggers: [{ regions: ['EU', 'EEA'] }],
    requiredDocuments: [
      'PRIVACY_POLICY',
      'PRIVACY_NOTICE',
      'DPA',
      'DATA_RETENTION',
      'SUBPROCESSORS',
    ],
    obligations: [
      'Lawful basis for processing',
      'Data subject rights (access/erasure)',
      'DPIA for high-risk processing',
      'Records of processing activities',
    ],
    url: 'https://gdpr-info.eu/',
    severity: 'CRITICAL',
  },
  {
    id: 'eu_ai_act',
    name: 'EU Artificial Intelligence Act',
    shortName: 'EU AI Act',
    kind: 'AI',
    region: 'EU',
    triggers: [{ regions: ['EU', 'EEA'], flags: ['ai', 'generative_ai', 'high_risk_ai'] }],
    requiredDocuments: ['AI_TRANSPARENCY', 'RESPONSIBLE_AI'],
    obligations: [
      'Risk classification of AI system',
      'Transparency to users interacting with AI',
      'Technical documentation & logging',
      'Human oversight for high-risk systems',
    ],
    url: 'https://artificialintelligenceact.eu/',
    severity: 'HIGH',
  },
  {
    id: 'eprivacy',
    name: 'ePrivacy Directive (Cookies)',
    shortName: 'ePrivacy',
    kind: 'PRIVACY',
    region: 'EU',
    triggers: [{ regions: ['EU', 'EEA'], flags: ['cookies', 'tracking'] }],
    requiredDocuments: ['COOKIE_POLICY', 'COOKIE_CONSENT'],
    obligations: ['Prior consent for non-essential cookies', 'Granular cookie controls'],
    severity: 'HIGH',
  },
  {
    id: 'nis2',
    name: 'NIS2 Directive',
    shortName: 'NIS2',
    kind: 'SECURITY',
    region: 'EU',
    triggers: [{ regions: ['EU'], industries: ['FINTECH', 'HEALTHCARE', 'GOVERNMENT'] }],
    requiredDocuments: ['INFOSEC_POLICY', 'INCIDENT_RESPONSE'],
    obligations: ['Incident reporting within 24/72h', 'Supply-chain security measures'],
    severity: 'HIGH',
  },
  // ── United Kingdom ──
  {
    id: 'uk_gdpr',
    name: 'UK GDPR & Data Protection Act',
    shortName: 'UK GDPR',
    kind: 'PRIVACY',
    region: 'UK',
    triggers: [{ regions: ['UK'] }],
    requiredDocuments: ['PRIVACY_POLICY', 'PRIVACY_NOTICE', 'DPA'],
    obligations: ['ICO registration', 'Data subject rights', 'International transfer safeguards'],
    severity: 'CRITICAL',
  },
  {
    id: 'pecr',
    name: 'Privacy and Electronic Communications Regulations',
    shortName: 'PECR',
    kind: 'PRIVACY',
    region: 'UK',
    triggers: [{ regions: ['UK'], flags: ['cookies', 'marketing_email'] }],
    requiredDocuments: ['COOKIE_POLICY', 'COOKIE_CONSENT'],
    obligations: ['Consent for marketing', 'Cookie consent'],
    severity: 'MEDIUM',
  },
  // ── United States ──
  {
    id: 'ccpa',
    name: 'California Consumer Privacy Act / CPRA',
    shortName: 'CCPA/CPRA',
    kind: 'PRIVACY',
    region: 'US_CA',
    triggers: [{ regions: ['US_CA'] }],
    requiredDocuments: ['PRIVACY_POLICY', 'PRIVACY_NOTICE'],
    obligations: [
      '"Do Not Sell/Share" mechanism',
      'Consumer rights to know/delete',
      'Notice at collection',
    ],
    severity: 'HIGH',
  },
  {
    id: 'coppa',
    name: "Children's Online Privacy Protection Act",
    shortName: 'COPPA',
    kind: 'SECTOR',
    region: 'US',
    triggers: [
      { regions: ['US'], dataCategories: ['CHILDREN'] },
      { regions: ['US'], flags: ['children_directed'] },
    ],
    requiredDocuments: ['CHILDRENS_PRIVACY', 'PRIVACY_POLICY'],
    obligations: ['Verifiable parental consent', 'No behavioral ads to children'],
    severity: 'CRITICAL',
  },
  {
    id: 'hipaa',
    name: 'Health Insurance Portability and Accountability Act',
    shortName: 'HIPAA',
    kind: 'SECTOR',
    region: 'US',
    triggers: [
      { regions: ['US'], dataCategories: ['HEALTH'] },
      { regions: ['US'], industries: ['HEALTHCARE'] },
    ],
    requiredDocuments: ['INFOSEC_POLICY', 'INCIDENT_RESPONSE', 'DPA'],
    obligations: [
      'Business Associate Agreements',
      'PHI safeguards (administrative/physical/technical)',
      'Breach notification',
    ],
    severity: 'CRITICAL',
  },
  {
    id: 'bipa',
    name: 'Illinois Biometric Information Privacy Act',
    shortName: 'BIPA',
    kind: 'PRIVACY',
    region: 'US_IL',
    triggers: [{ regions: ['US_IL'], dataCategories: ['BIOMETRIC'] }],
    requiredDocuments: ['PRIVACY_POLICY', 'DATA_RETENTION'],
    obligations: [
      'Written consent before biometric collection',
      'Public retention/destruction schedule',
    ],
    severity: 'CRITICAL',
  },
  // ── India ──
  {
    id: 'dpdp',
    name: 'Digital Personal Data Protection Act',
    shortName: 'DPDP',
    kind: 'PRIVACY',
    region: 'IN',
    triggers: [{ regions: ['IN'] }],
    requiredDocuments: ['PRIVACY_POLICY', 'PRIVACY_NOTICE'],
    obligations: [
      'Consent notice in plain language',
      'Consent manager support',
      'Data principal rights',
    ],
    severity: 'CRITICAL',
  },
  {
    id: 'certin',
    name: 'CERT-In Directions',
    shortName: 'CERT-In',
    kind: 'SECURITY',
    region: 'IN',
    triggers: [{ regions: ['IN'] }],
    requiredDocuments: ['INCIDENT_RESPONSE'],
    obligations: ['Report incidents within 6 hours', 'Retain logs for 180 days'],
    severity: 'MEDIUM',
  },
  {
    id: 'rbi',
    name: 'RBI Data Localization & Payment Regulations',
    shortName: 'RBI',
    kind: 'SECTOR',
    region: 'IN',
    triggers: [
      { regions: ['IN'], industries: ['FINTECH'] },
      { regions: ['IN'], flags: ['payments'] },
    ],
    requiredDocuments: ['INFOSEC_POLICY', 'DATA_RETENTION'],
    obligations: ['Payment data localization in India', 'System audit reports'],
    severity: 'HIGH',
  },
  // ── Canada / Australia / Singapore ──
  {
    id: 'pipeda',
    name: 'Personal Information Protection and Electronic Documents Act',
    shortName: 'PIPEDA',
    kind: 'PRIVACY',
    region: 'CA',
    triggers: [{ regions: ['CA'] }],
    requiredDocuments: ['PRIVACY_POLICY', 'PRIVACY_NOTICE'],
    obligations: ['Meaningful consent', 'Breach reporting to OPC'],
    severity: 'HIGH',
  },
  {
    id: 'au_privacy',
    name: 'Australia Privacy Act (APPs)',
    shortName: 'AU Privacy Act',
    kind: 'PRIVACY',
    region: 'AU',
    triggers: [{ regions: ['AU'] }],
    requiredDocuments: ['PRIVACY_POLICY'],
    obligations: ['Australian Privacy Principles', 'Notifiable data breaches scheme'],
    severity: 'HIGH',
  },
  {
    id: 'pdpa_sg',
    name: 'Singapore Personal Data Protection Act',
    shortName: 'PDPA',
    kind: 'PRIVACY',
    region: 'SG',
    triggers: [{ regions: ['SG'] }],
    requiredDocuments: ['PRIVACY_POLICY'],
    obligations: ['Consent obligation', 'Data breach notification', 'DPO appointment'],
    severity: 'HIGH',
  },
  // ── Payments ──
  {
    id: 'pci_dss',
    name: 'PCI DSS',
    shortName: 'PCI DSS',
    kind: 'PAYMENTS',
    region: 'GLOBAL',
    triggers: [{ flags: ['payments'] }],
    requiredDocuments: ['INFOSEC_POLICY', 'SECURITY_POLICY', 'VENDOR_RISK'],
    obligations: ['Do not store raw PAN/CVV', 'Network segmentation', 'Quarterly scans'],
    severity: 'HIGH',
  },
  // ── Accessibility ──
  {
    id: 'wcag',
    name: 'Web Content Accessibility Guidelines 2.2 AA',
    shortName: 'WCAG 2.2 AA',
    kind: 'ACCESSIBILITY',
    region: 'GLOBAL',
    triggers: [
      { regions: ['EU', 'US'], recommended: true },
      { industries: ['GOVERNMENT', 'EDUCATION'] },
    ],
    requiredDocuments: ['ACCESSIBILITY_STATEMENT'],
    obligations: [
      'Perceivable/Operable/Understandable/Robust criteria',
      'Keyboard navigation',
      'Contrast & alt text',
    ],
    severity: 'MEDIUM',
  },
  // ── Recommended baseline frameworks ──
  {
    id: 'soc2',
    name: 'SOC 2 (Trust Services Criteria)',
    shortName: 'SOC 2',
    kind: 'FRAMEWORK',
    region: 'GLOBAL',
    triggers: [{ recommended: true }],
    requiredDocuments: ['INFOSEC_POLICY', 'INCIDENT_RESPONSE', 'VENDOR_RISK', 'ACCEPTABLE_USE'],
    obligations: ['Security/Availability/Confidentiality controls', 'Continuous monitoring'],
    severity: 'MEDIUM',
  },
  {
    id: 'iso27001',
    name: 'ISO/IEC 27001',
    shortName: 'ISO 27001',
    kind: 'FRAMEWORK',
    region: 'GLOBAL',
    triggers: [{ recommended: true }],
    requiredDocuments: ['INFOSEC_POLICY', 'INCIDENT_RESPONSE'],
    obligations: ['ISMS', 'Statement of Applicability', 'Risk treatment plan'],
    severity: 'MEDIUM',
  },
  {
    id: 'iso42001',
    name: 'ISO/IEC 42001 (AI Management System)',
    shortName: 'ISO 42001',
    kind: 'FRAMEWORK',
    region: 'GLOBAL',
    triggers: [{ flags: ['ai'], recommended: true }],
    requiredDocuments: ['RESPONSIBLE_AI', 'AI_TRANSPARENCY'],
    obligations: ['AI management system', 'AI impact assessments'],
    severity: 'MEDIUM',
  },
];

// ── Document specs (what the generator produces) ─────────────────────────────

export const DOCUMENT_SPECS: Record<DocumentType, DocumentSpec> = {
  PRIVACY_POLICY: {
    type: 'PRIVACY_POLICY',
    title: 'Privacy Policy',
    drivenBy: [],
    sections: [
      'Introduction',
      'Data We Collect',
      'How We Use Data',
      'Legal Bases',
      'Sharing & Subprocessors',
      'International Transfers',
      'Your Rights',
      'Retention',
      'Contact',
    ],
  },
  TERMS_OF_SERVICE: {
    type: 'TERMS_OF_SERVICE',
    title: 'Terms of Service',
    drivenBy: [],
    sections: [
      'Acceptance',
      'The Service',
      'Accounts',
      'Acceptable Use',
      'Payment Terms',
      'Intellectual Property',
      'Disclaimers',
      'Limitation of Liability',
      'Termination',
      'Governing Law',
    ],
  },
  COOKIE_POLICY: {
    type: 'COOKIE_POLICY',
    title: 'Cookie Policy',
    drivenBy: [],
    sections: ['What Are Cookies', 'Categories We Use', 'Third-Party Cookies', 'Managing Consent'],
  },
  COOKIE_CONSENT: {
    type: 'COOKIE_CONSENT',
    title: 'Cookie Consent Banner Text',
    drivenBy: [],
    sections: ['Banner Copy', 'Accept/Reject/Manage Options', 'Category Descriptions'],
  },
  DPA: {
    type: 'DPA',
    title: 'Data Processing Agreement',
    drivenBy: [],
    sections: [
      'Definitions',
      'Processing Details',
      'Subprocessors',
      'Security Measures',
      'Data Subject Requests',
      'International Transfers',
      'Audit',
      'Deletion',
    ],
  },
  AI_TRANSPARENCY: {
    type: 'AI_TRANSPARENCY',
    title: 'AI Transparency Statement',
    drivenBy: [],
    sections: [
      'AI Features',
      'Models Used',
      'Human Oversight',
      'Limitations',
      'Data Usage for AI',
      'User Controls',
    ],
  },
  ACCEPTABLE_USE: {
    type: 'ACCEPTABLE_USE',
    title: 'Acceptable Use Policy',
    drivenBy: [],
    sections: ['Prohibited Conduct', 'Content Standards', 'Enforcement'],
  },
  SECURITY_POLICY: {
    type: 'SECURITY_POLICY',
    title: 'Security Policy',
    drivenBy: [],
    sections: ['Scope', 'Access Control', 'Encryption', 'Vulnerability Management', 'Reporting'],
  },
  INFOSEC_POLICY: {
    type: 'INFOSEC_POLICY',
    title: 'Information Security Policy',
    drivenBy: [],
    sections: [
      'Governance',
      'Asset Management',
      'Access Control',
      'Cryptography',
      'Operations Security',
      'Incident Management',
      'Compliance',
    ],
  },
  INCIDENT_RESPONSE: {
    type: 'INCIDENT_RESPONSE',
    title: 'Incident Response Plan',
    drivenBy: [],
    sections: [
      'Roles',
      'Detection',
      'Containment',
      'Eradication',
      'Recovery',
      'Notification Timelines',
      'Post-Incident Review',
    ],
  },
  RESPONSIBLE_AI: {
    type: 'RESPONSIBLE_AI',
    title: 'Responsible AI Policy',
    drivenBy: [],
    sections: [
      'Principles',
      'Risk Assessment',
      'Bias & Fairness',
      'Human Oversight',
      'Monitoring',
      'Accountability',
    ],
  },
  VENDOR_RISK: {
    type: 'VENDOR_RISK',
    title: 'Vendor Risk Assessment',
    drivenBy: [],
    sections: ['Vendor Inventory', 'Data Shared', 'Security Posture', 'Risk Rating', 'Mitigations'],
  },
  PRIVACY_NOTICE: {
    type: 'PRIVACY_NOTICE',
    title: 'Privacy Notice',
    drivenBy: [],
    sections: ['Who We Are', 'What We Collect', 'Why', 'Your Rights', 'Contact'],
  },
  DATA_RETENTION: {
    type: 'DATA_RETENTION',
    title: 'Data Retention Policy',
    drivenBy: [],
    sections: [
      'Retention Principles',
      'Retention Schedule by Category',
      'Deletion Process',
      'Legal Holds',
    ],
  },
  SUBPROCESSORS: {
    type: 'SUBPROCESSORS',
    title: 'Subprocessor List',
    drivenBy: [],
    sections: ['Subprocessor', 'Purpose', 'Location', 'Safeguards'],
  },
  ACCESSIBILITY_STATEMENT: {
    type: 'ACCESSIBILITY_STATEMENT',
    title: 'Accessibility Statement',
    drivenBy: [],
    sections: ['Commitment', 'Conformance Level', 'Known Limitations', 'Feedback'],
  },
  EXPORT_COMPLIANCE: {
    type: 'EXPORT_COMPLIANCE',
    title: 'Export Compliance Statement',
    drivenBy: [],
    sections: ['Scope', 'Restricted Parties', 'Encryption Notice', 'Prohibited Destinations'],
  },
  CHILDRENS_PRIVACY: {
    type: 'CHILDRENS_PRIVACY',
    title: "Children's Privacy Policy",
    drivenBy: [],
    sections: [
      'Age Requirements',
      'Parental Consent',
      'Data We Collect from Children',
      'Parental Controls',
    ],
  },
  DPIA: {
    type: 'DPIA',
    title: 'Data Protection Impact Assessment',
    drivenBy: [],
    sections: [
      'Processing Description',
      'Necessity & Proportionality',
      'Risks to Rights',
      'Mitigations',
      'Sign-off',
    ],
  },
};

export const DOCUMENT_TYPES = Object.keys(DOCUMENT_SPECS) as DocumentType[];

export function documentTitle(type: DocumentType): string {
  return DOCUMENT_SPECS[type]?.title ?? type;
}
