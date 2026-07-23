import type { RetrievalScope, RetrievedItem } from '@company-brain/retrieval';

/**
 * Response Formatter — turns raw model output into the API answer + cited
 * sources, and owns the "not enough information" path so the assistant never
 * hallucinates when retrieval came back empty. Pure and provider-agnostic.
 */

export interface AskSource {
  id: string;
  kind: RetrievedItem['kind'];
  type: string;
  title: string;
  /** External link for web sources (null for internal items). */
  url?: string | null;
}

const MAX_SOURCES = 6;

export function toSources(items: RetrievedItem[]): AskSource[] {
  return items
    .slice(0, MAX_SOURCES)
    .map((i) => ({ id: i.id, kind: i.kind, type: i.type, title: i.title, url: i.url ?? null }));
}

/**
 * Some providers return the answer wrapped in a JSON object or a ```fence.
 * Extract the human text; plain prose passes straight through.
 */
export function unwrapText(raw: string): string {
  let t = raw.trim();
  const fence = t.match(/^```(?:json|markdown)?\s*([\s\S]*?)\s*```$/i);
  if (fence?.[1]) t = fence[1].trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const text = pickText(JSON.parse(t));
      if (text) return text.trim();
    } catch {
      /* not JSON — keep the raw text */
    }
  }
  return t;
}

function pickText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value.map((v) => pickText(v)).filter(Boolean) as string[];
    return parts.length ? parts.join('\n\n') : null;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of [
      'reply',
      'answer',
      'summary',
      'text',
      'content',
      'response',
      'message',
      'result',
    ]) {
      if (typeof obj[key] === 'string' && (obj[key] as string).trim()) return obj[key] as string;
    }
    const strings = Object.values(obj).filter(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    );
    if (strings.length) return strings.sort((a, b) => b.length - a.length)[0]!;
    for (const v of Object.values(obj)) {
      const nested = pickText(v);
      if (nested) return nested;
    }
  }
  return null;
}

/** Honest "I don't have that" reply used when retrieval found nothing. */
export function insufficientInfo(scope: RetrievalScope): string {
  return scope === 'personal'
    ? "I couldn't find anything about that in your personal knowledge yet — your documents, emails, calendar or meetings. Try rephrasing, or connect the source that would have it."
    : "I couldn't find anything about that in the team's shared knowledge yet. Try rephrasing, or point me at the document, project or meeting where it lives.";
}

/** Deterministic fallback when the model is unavailable but we have hits. */
export function summariseHits(items: RetrievedItem[]): string {
  const names = items.slice(0, 3).map((i) => i.title);
  return `Here's what I found related to your question: ${names.join(', ')}. Open any of the sources below for the full picture.`;
}

/**
 * Final answer text. When no context was retrieved we return an explicit
 * "not enough information" message rather than letting the model guess.
 */
export function finalizeAnswer(
  rawModelText: string | null,
  items: RetrievedItem[],
  scope: RetrievalScope,
): string {
  if (rawModelText !== null) {
    const text = unwrapText(rawModelText);
    if (text.length > 0) return text;
  }
  if (items.length === 0) return insufficientInfo(scope);
  return summariseHits(items);
}
