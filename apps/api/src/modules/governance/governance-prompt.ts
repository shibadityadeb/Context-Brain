import type { DocumentSpec, GovernanceAssessment, ProductProfile } from '@company-brain/governance';
import type { RetrievedItem } from '@company-brain/retrieval';

/**
 * Governance prompt builders — pure, provider-agnostic. The engine has already
 * decided which laws apply, the gaps and the missing information; these prompts
 * ask the model to REASON and WRITE over that structured ground truth (plus
 * retrieved org context), never to invent the law. The persona is a panel — GC,
 * CPO, Compliance, Security, AI-governance and PM — so answers are decisive and
 * cite their basis.
 */

export interface GovernanceTurn {
  role: 'user' | 'assistant';
  content: string;
}

const PANEL =
  'You are the AI Launch & Governance Copilot for this organization — a panel of a General Counsel, ' +
  'Chief Privacy Officer, Compliance Officer, Security Architect, AI Governance expert and Product Manager.';

/** Compact, deterministic serialization of a profile for prompt grounding. */
export function summarizeProfile(profile: ProductProfile): string {
  const lines: string[] = [`Product: ${profile.name}`];
  const add = (label: string, v: unknown) => {
    if (Array.isArray(v) ? v.length : v)
      lines.push(`${label}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
  };
  add('Company', profile.company);
  add('Industry', profile.industry);
  add('Business model', profile.businessModel);
  add('Countries', profile.countries);
  add('Data collected', profile.dataCategories);
  add('Capabilities', profile.flags);
  add('Authentication', profile.authentication);
  add('Payment providers', profile.paymentProviders);
  add('Third-party APIs', profile.thirdPartyApis);
  add('Cloud', profile.cloudProvider);
  add('AI models', profile.aiModels);
  add('Data retention', profile.dataRetention);
  return lines.join('\n');
}

function summarizeAssessment(a: GovernanceAssessment): string {
  const laws = a.applicableLaws
    .map(
      (l) =>
        `- ${l.shortName}${l.recommended ? ' (recommended)' : ''} — ${l.reasons.join('; ')} [${l.severity}]`,
    )
    .join('\n');
  const gaps = a.gaps.length
    ? a.gaps.map((g) => `- MISSING: ${g.title} (required by ${g.requiredBy.join(', ')})`).join('\n')
    : '- none';
  const missing = a.missingInfo.length
    ? a.missingInfo.map((m) => `- ${String(m.field)}: ${m.question}`).join('\n')
    : '- none';
  const blockers = a.launchBlockers.length
    ? a.launchBlockers.map((b) => `- [${b.severity}] ${b.title}: ${b.detail}`).join('\n')
    : '- none';
  return [
    `APPLICABLE LAWS & FRAMEWORKS:\n${laws || '- none inferred'}`,
    `DOCUMENT/CONTROL GAPS:\n${gaps}`,
    `MISSING INFORMATION (ask before assuming):\n${missing}`,
    `LAUNCH BLOCKERS:\n${blockers}`,
    `SCORES: overall ${a.scores.overall}, launch-readiness ${a.scores.launchReadiness}, risk ${a.scores.risk}, privacy ${a.scores.privacy}, security ${a.scores.security}, compliance ${a.scores.compliance}, AI ${a.scores.aiGovernance}.`,
  ].join('\n\n');
}

function formatContext(items: RetrievedItem[]): string {
  if (items.length === 0) return '(no additional org context retrieved)';
  return items
    .map(
      (it, i) =>
        `[${i + 1}] (${it.kind}/${it.type}) ${it.title}${it.summary ? ` — ${it.summary}` : ''}`,
    )
    .join('\n');
}

export interface BuildAnswerInput {
  profile: ProductProfile;
  assessment: GovernanceAssessment;
  question: string;
  history: GovernanceTurn[];
  context: RetrievedItem[];
}

export function buildGovernanceAnswerPrompt(input: BuildAnswerInput): {
  system: string;
  prompt: string;
} {
  const system = [
    PANEL,
    '',
    'GROUND RULES:',
    '- The ASSESSMENT below is authoritative ground truth computed by the governance engine. Rely on it.',
    '- Do NOT invent laws, obligations or thresholds beyond the ASSESSMENT; you may add well-known context but never contradict it.',
    '- Frame the response as constructive guidance for a compliant launch — "here is what to keep in mind" —',
    '  NOT as a gatekeeping verdict. Do NOT open with "NO"/"YES"/"not ready". Lead with what applies and what to do next.',
    '- Structure it as: what laws & frameworks apply and why → what documents/controls to put in place →',
    '  what still needs deciding. Keep it practical and encouraging, like a checklist a colleague hands you.',
    '- Only if the user EXPLICITLY asks "can we launch in X" may you give a direct answer, and still frame it as',
    '  "you can, provided you …" rather than a blunt refusal.',
    '- Cite the applicable laws by short name (e.g. GDPR, DPDP, PCI DSS) when you rely on them.',
    '- If MISSING INFORMATION would change the guidance, note what to confirm and offer the choices — never assume.',
    '- Reference retrieved org context by [n] when used.',
  ].join('\n');

  const history = input.history
    .map((h) => `${h.role === 'user' ? 'Q' : 'A'}: ${h.content}`)
    .join('\n');

  const prompt = [
    `PRODUCT PROFILE:\n${summarizeProfile(input.profile)}`,
    `\nASSESSMENT:\n${summarizeAssessment(input.assessment)}`,
    `\nORG CONTEXT:\n${formatContext(input.context)}`,
    history ? `\nConversation so far:\n${history}` : '',
    `\nQuestion: ${input.question}`,
    '\nAnswer:',
  ].join('\n');

  return { system, prompt };
}

export interface BuildDocumentInput {
  profile: ProductProfile;
  assessment: GovernanceAssessment;
  spec: DocumentSpec;
  company?: string;
}

export function buildDocumentPrompt(input: BuildDocumentInput): { system: string; prompt: string } {
  const system = [
    PANEL,
    '',
    'You are drafting a production-ready legal/policy document. Requirements:',
    '- Follow the SECTION OUTLINE exactly, as Markdown headings.',
    '- Ground every clause in the PRODUCT PROFILE and the APPLICABLE LAWS provided — reference the specific laws where relevant.',
    '- Use the company name for branding. Use clear, professional legal English.',
    '- Where a detail is unknown, insert a clearly-marked [PLACEHOLDER: …] rather than inventing specifics.',
    '- Output ONLY the document in Markdown. No preamble or commentary.',
  ].join('\n');

  const laws =
    input.assessment.applicableLaws.map((l) => `${l.shortName} (${l.name})`).join(', ') ||
    'general best practice';

  const prompt = [
    `DOCUMENT: ${input.spec.title}`,
    `COMPANY: ${input.company ?? input.profile.company ?? input.profile.name}`,
    `APPLICABLE LAWS: ${laws}`,
    `DRIVEN BY: ${input.spec.drivenBy.join(', ') || 'baseline requirements'}`,
    `\nPRODUCT PROFILE:\n${summarizeProfile(input.profile)}`,
    `\nSECTION OUTLINE:\n${input.spec.sections.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    `\nDraft the ${input.spec.title} now:`,
  ].join('\n');

  return { system, prompt };
}
