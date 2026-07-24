import type { ActionType } from '@prisma/client';
import type { RetrievedItem } from '@company-brain/retrieval';
import type { ActionPlanDraft, Clarification, PlannedStep } from './action.types.js';

/**
 * Planning prompt + parser. Codex is the ONLY reasoning engine: given the user
 * request and retrieved context, it returns a structured Action Plan (goal +
 * ordered steps). OpenClaw never sees this — planning belongs entirely to Codex.
 *
 * A deterministic heuristic {@link fallbackPlan} covers the case where the model
 * is unavailable (e.g. `mock` provider) so the pipeline stays demonstrable.
 */

const ACTION_TYPES: ActionType[] = [
  'CALENDAR_MANAGEMENT',
  'EMAIL_DRAFT',
  'EMAIL_SEND',
  'MEETING_SCHEDULE',
  'BROWSER_AUTOMATION',
  'WEB_RESEARCH',
  'FORM_FILLING',
  'FILE_MANAGEMENT',
  'DOCUMENT_GENERATION',
  'TASK_CREATION',
  'FOLLOW_UP_REMINDER',
  'OTHER',
];

/** The catalogue of OpenClaw tools Codex may reference in a plan. */
const TOOL_CATALOGUE = [
  'calendar.read',
  'calendar.write',
  'email.draft',
  'email.send',
  'contacts.lookup',
  'browser.navigate',
  'browser.fill_form',
  'web.search',
  'files.read',
  'files.write',
  'doc.generate',
  'task.create',
  'reminder.create',
];

export function buildPlanningPrompt(input: {
  request: string;
  items: RetrievedItem[];
  /** Answers the user already gave to earlier clarifications. */
  knownDetails?: Array<{ question: string; value: string }>;
}): {
  system: string;
  prompt: string;
} {
  const system = [
    'You are Codex, the reasoning engine of a Company Brain. You DECOMPOSE a',
    "user's request into a concrete, ordered execution plan that a separate",
    'execution engine (OpenClaw) will carry out. You plan only — you never',
    'execute. Ground the plan in the provided context when relevant.',
    '',
    'Return STRICT JSON (no markdown fence) with this exact shape:',
    '{',
    '  "title": string,                // short imperative summary',
    `  "type": one of ${ACTION_TYPES.join(' | ')},`,
    '  "goal": string,                 // one sentence restating the objective',
    '  "reasoning": string,            // brief why/how, 1-3 sentences',
    '  "estimatedImpact": string,      // what changes in the real world',
    '  "estimatedTools": string[],     // subset of the tool catalogue',
    '  "steps": [                      // 1-12 ordered steps',
    '    { "title": string, "description": string,',
    '      "tool": string|null,        // a tool from the catalogue',
    '      "params": object,           // concrete inputs the tool runs with',
    '      "requiresApproval": boolean // true for irreversible/outbound steps',
    '    }',
    '  ],',
    '  "clarifications": [             // questions to ask BEFORE assuming anything',
    '    { "field": string,           // stable key, e.g. "attendeeEmail"',
    '      "question": string,        // what to ask the user',
    '      "hint": string|null }      // optional example',
    '  ]',
    '}',
    '',
    `Tool catalogue: ${TOOL_CATALOGUE.join(', ')}.`,
    'Fill "params" with the actual values so the step can execute after approval:',
    '  • task.create/reminder.create → { title, description?, priority?, assignee?, due? }',
    '  • calendar.write → { title, start (ISO 8601), end?, attendees?[], description? }',
    '  • email.draft/email.send → { to[], subject, body }',
    '  • doc.generate → { title, prompt }',
    '  • files.write → { path, content }   files.read → { path }',
    '  • web.search → { query }   contacts.lookup → { name }',
    '',
    'CRITICAL: Do NOT invent or assume details you were not given. If a required',
    'input is missing or ambiguous — a specific date/time, a recipient email, who',
    '"Rahul" is, a file path, an amount — DO NOT guess it. Instead add a question',
    'to "clarifications" and leave that param empty. Only ask about things you',
    "genuinely cannot determine from the request or context; don't ask about",
    'things you can reasonably infer. Return an empty clarifications array when the',
    'plan is fully specified.',
    'Mark any step that sends, publishes, or externally changes state',
    '(email.send, calendar.write, browser.fill_form) as requiresApproval=true.',
  ].join('\n');

  const context = input.items.length
    ? input.items
        .slice(0, 8)
        .map(
          (i, n) =>
            `[${n + 1}] (${i.kind}/${i.type}) ${i.title}${i.summary ? ` — ${i.summary}` : ''}`,
        )
        .join('\n')
    : '(no specific company context retrieved)';

  const known = input.knownDetails?.length
    ? input.knownDetails.map((d) => `- ${d.question} → ${d.value}`).join('\n')
    : null;

  const prompt = [
    `USER REQUEST:\n${input.request}`,
    '',
    `RETRIEVED CONTEXT:\n${context}`,
    ...(known ? ['', `DETAILS THE USER JUST PROVIDED (use these, don't re-ask):\n${known}`] : []),
    '',
    'Produce the JSON plan now.',
  ].join('\n');

  return { system, prompt };
}

function coerceType(value: unknown): ActionType {
  const upper = String(value ?? '')
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return (ACTION_TYPES as string[]).includes(upper) ? (upper as ActionType) : 'OTHER';
}

function coerceClarification(raw: unknown): Clarification | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const question = typeof obj.question === 'string' ? obj.question.trim() : '';
  if (!question) return null;
  const field =
    typeof obj.field === 'string' && obj.field.trim()
      ? obj.field.trim().slice(0, 60)
      : question
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 60);
  return {
    field,
    question: question.slice(0, 300),
    hint: typeof obj.hint === 'string' && obj.hint.trim() ? obj.hint.trim().slice(0, 200) : null,
  };
}

function coerceStep(raw: unknown): PlannedStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  if (!title) return null;
  return {
    title: title.slice(0, 300),
    description: typeof obj.description === 'string' ? obj.description.trim().slice(0, 4000) : null,
    tool: typeof obj.tool === 'string' && obj.tool.trim() ? obj.tool.trim().slice(0, 120) : null,
    params:
      obj.params && typeof obj.params === 'object' && !Array.isArray(obj.params)
        ? (obj.params as Record<string, unknown>)
        : null,
    requiresApproval: obj.requiresApproval === true,
  };
}

/**
 * Parse Codex's raw output into a validated plan draft. Tolerant of a ```json
 * fence or leading prose; returns null when nothing usable is found so the
 * caller can fall back.
 */
export function parsePlan(raw: string | null): ActionPlanDraft | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const steps = Array.isArray(parsed.steps)
    ? parsed.steps.map(coerceStep).filter((s): s is PlannedStep => s !== null)
    : [];
  if (steps.length === 0) return null;

  const estimatedTools = Array.isArray(parsed.estimatedTools)
    ? parsed.estimatedTools.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : [...new Set(steps.map((s) => s.tool).filter((t): t is string => t !== null))];

  const clarifications = Array.isArray(parsed.clarifications)
    ? parsed.clarifications
        .map(coerceClarification)
        .filter((c): c is Clarification => c !== null)
        .slice(0, 6)
    : [];

  return {
    title:
      typeof parsed.title === 'string' && parsed.title.trim()
        ? parsed.title.trim().slice(0, 300)
        : 'Untitled action',
    type: coerceType(parsed.type),
    goal: typeof parsed.goal === 'string' ? parsed.goal.trim().slice(0, 2000) : '',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim().slice(0, 2000) : '',
    estimatedImpact:
      typeof parsed.estimatedImpact === 'string'
        ? parsed.estimatedImpact.trim().slice(0, 2000)
        : '',
    estimatedTools,
    steps,
    clarifications,
  };
}

// ── Heuristic fallback (model unavailable) ────────────────────────────────────

const TYPE_HINTS: Array<{ type: ActionType; tool: string; keywords: RegExp }> = [
  {
    type: 'MEETING_SCHEDULE',
    tool: 'calendar.write',
    keywords: /\b(schedul|meeting|invite|call|sync)\b/i,
  },
  {
    type: 'CALENDAR_MANAGEMENT',
    tool: 'calendar.write',
    keywords: /\b(calendar|reschedul|availab|slot)\b/i,
  },
  { type: 'EMAIL_SEND', tool: 'email.send', keywords: /\bsend\b.*\bemail\b|\bemail\b.*\bsend\b/i },
  { type: 'EMAIL_DRAFT', tool: 'email.draft', keywords: /\b(email|draft|reply|message)\b/i },
  {
    type: 'WEB_RESEARCH',
    tool: 'web.search',
    keywords: /\b(research|find out|look up|search|investigat)\b/i,
  },
  {
    type: 'BROWSER_AUTOMATION',
    tool: 'browser.navigate',
    keywords: /\b(browser|website|navigate|click|scrape)\b/i,
  },
  { type: 'FORM_FILLING', tool: 'browser.fill_form', keywords: /\b(form|fill|submit|apply)\b/i },
  {
    type: 'DOCUMENT_GENERATION',
    tool: 'doc.generate',
    keywords: /\b(document|report|summary|generate|write up)\b/i,
  },
  {
    type: 'FILE_MANAGEMENT',
    tool: 'files.write',
    keywords: /\b(file|folder|upload|organi[sz]e|rename)\b/i,
  },
  {
    type: 'FOLLOW_UP_REMINDER',
    tool: 'reminder.create',
    keywords: /\b(remind|follow[- ]?up|nudge)\b/i,
  },
  { type: 'TASK_CREATION', tool: 'task.create', keywords: /\b(task|todo|ticket|assign)\b/i },
];

/**
 * A deterministic plan used only when Codex is unavailable — it infers a type
 * from keywords and emits a minimal, sensible skeleton so the flow (approval →
 * execution → memory) can still be exercised end to end.
 */
export function fallbackPlan(request: string): ActionPlanDraft {
  const hint = TYPE_HINTS.find((h) => h.keywords.test(request)) ?? {
    type: 'OTHER' as ActionType,
    tool: 'openclaw.generic',
  };
  const outbound = hint.type === 'EMAIL_SEND' || hint.type === 'MEETING_SCHEDULE';
  const steps: PlannedStep[] = [
    {
      title: 'Prepare the action',
      description: request.slice(0, 300),
      tool: hint.tool,
      params: { title: request.trim().slice(0, 120), description: request.trim() },
      requiresApproval: false,
    },
    {
      title: outbound ? 'Execute (creates/sends externally)' : 'Execute the action',
      description: 'Carry out the prepared action.',
      tool: hint.tool,
      params: { title: request.trim().slice(0, 120), description: request.trim() },
      requiresApproval: outbound,
    },
  ];
  return {
    title: request.trim().replace(/\s+/g, ' ').slice(0, 80),
    type: hint.type,
    goal: request.trim().slice(0, 300),
    reasoning: 'Heuristic plan (reasoning engine unavailable). Review the steps before approving.',
    estimatedImpact: outbound
      ? 'May create or send items in connected tools once executed.'
      : 'Prepares the requested work; no external changes until executed.',
    estimatedTools: [...new Set(steps.map((s) => s.tool).filter((t): t is string => t !== null))],
    steps,
    clarifications: heuristicClarifications(hint.type, request),
  };
}

/** Detect obviously-missing details for the heuristic (model-down) planner. */
function heuristicClarifications(type: ActionType, request: string): Clarification[] {
  const out: Clarification[] = [];
  const hasEmail = /[\w.+-]+@[\w-]+\.[\w.-]+/.test(request);
  const hasWhen =
    /\b(today|tomorrow|next|on|at|\d{1,2}(:\d{2})?\s*(am|pm)?|\d{4}-\d{2}-\d{2}|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      request,
    );

  if ((type === 'EMAIL_SEND' || type === 'EMAIL_DRAFT') && !hasEmail) {
    out.push({
      field: 'recipientEmail',
      question: "What's the recipient's email address?",
      hint: 'name@example.com',
    });
  }
  if ((type === 'MEETING_SCHEDULE' || type === 'CALENDAR_MANAGEMENT') && !hasWhen) {
    out.push({
      field: 'startTime',
      question: 'When should the meeting be? (date and time)',
      hint: 'e.g. 31 July at 7:00 PM',
    });
  }
  if ((type === 'MEETING_SCHEDULE' || type === 'CALENDAR_MANAGEMENT') && !hasEmail) {
    out.push({
      field: 'attendeeEmail',
      question: 'Who should be invited? (email addresses)',
      hint: 'name@example.com',
    });
  }
  return out;
}
