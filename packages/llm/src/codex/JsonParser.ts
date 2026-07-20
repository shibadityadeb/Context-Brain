import { JsonParseError } from './errors.js';

/**
 * Coerces messy LLM output into a JSON value. LLMs (and CLIs that wrap them)
 * routinely wrap JSON in prose, ```json fences, or smart quotes, and leave
 * trailing commas. This parser cleans those up deterministically and fails
 * loudly — it never returns a partially-parsed or silently-empty result.
 */

/** Strip ```json / ``` fences, keeping the fenced body when present. */
function stripCodeFences(text: string): string {
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/m.exec(text);
  return fence?.[1] !== undefined ? fence[1] : text;
}

/**
 * Extract the outermost balanced JSON object or array. Scans for the first
 * `{`/`[`, then matches its partner while ignoring braces inside strings.
 */
function extractJsonSpan(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Repair the formatting quirks that JSON.parse rejects but humans ignore. */
function repair(json: string): string {
  return json
    .replace(/[“”]/g, '"') // curly double quotes → "
    .replace(/[‘’]/g, "'") // curly single quotes → '
    .replace(/,\s*([}\]])/g, '$1'); // trailing commas before } or ]
}

/**
 * Parse raw model text into a JSON value.
 * @throws {JsonParseError} when no valid JSON can be recovered.
 */
export function parseJson<T = unknown>(raw: string): T {
  if (raw.trim().length === 0) {
    throw new JsonParseError('response was empty', raw.length);
  }

  const unfenced = stripCodeFences(raw);
  const span = extractJsonSpan(unfenced);
  if (span === null) {
    throw new JsonParseError('no JSON object or array found in output', raw.length);
  }

  // Prefer the raw span; fall back to the repaired form only if needed so we
  // never mangle already-valid JSON.
  for (const candidate of [span, repair(span)]) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* try the next candidate */
    }
  }
  throw new JsonParseError('output was not valid JSON after repair', raw.length);
}
