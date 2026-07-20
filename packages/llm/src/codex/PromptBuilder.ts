/**
 * Reusable prompt templates. Each JSON-producing template ends with an
 * explicit "return only JSON" directive plus the target shape, so callers get
 * consistent, parseable output regardless of backend.
 */

/** Instruction appended whenever JSON output is expected. */
const JSON_DIRECTIVE =
  'Return ONLY valid JSON. Do not include markdown, code fences, or any prose ' +
  'before or after the JSON.';

/** Render a JSON template: task description, shape hint, then the payload. */
function jsonTemplate(instruction: string, shape: string, payload: string): string {
  return [
    instruction,
    '',
    'Respond with JSON matching this shape:',
    shape,
    '',
    JSON_DIRECTIVE,
    '',
    '--- INPUT ---',
    payload,
  ].join('\n');
}

/**
 * Builds prompts for the supported analysis tasks. Stateless — one instance
 * can be shared across calls.
 */
export class PromptBuilder {
  /** Append the JSON directive to an arbitrary prompt. */
  forJson(prompt: string): string {
    return `${prompt}\n\n${JSON_DIRECTIVE}`;
  }

  /** Free-form chat/completion with no structural constraints. */
  genericChat(prompt: string): string {
    return prompt;
  }

  /** Concise prose summary of arbitrary text (also used for chunk merging). */
  summarize(text: string): string {
    return [
      'Summarize the following text. Capture the key points, outcomes, and',
      'context faithfully in a few clear sentences. Return plain prose only.',
      '',
      '--- TEXT ---',
      text,
    ].join('\n');
  }

  /** Back-compat alias for {@link summarize}. */
  meetingSummary(transcript: string): string {
    return this.summarize(transcript);
  }

  /**
   * Generic structured extraction. Callers supply the instruction and target
   * JSON shape; the directive and payload framing are added automatically.
   */
  extraction(instruction: string, shape: string, text: string): string {
    return jsonTemplate(instruction, shape, text);
  }

  /** Extract actionable tasks / commitments. */
  taskExtraction(text: string): string {
    return jsonTemplate(
      'Extract every actionable task or commitment from the input.',
      '{ "tasks": [{ "title": string, "owner": string | null, "due": string | null }] }',
      text,
    );
  }

  /** Extract decisions the group reached. */
  decisionExtraction(text: string): string {
    return jsonTemplate(
      'Extract every decision the group reached in the input.',
      '{ "decisions": [{ "decision": string, "rationale": string | null }] }',
      text,
    );
  }

  /** Extract risks and their severity. */
  riskExtraction(text: string): string {
    return jsonTemplate(
      'Extract every risk or concern raised in the input.',
      '{ "risks": [{ "risk": string, "severity": "low" | "medium" | "high" }] }',
      text,
    );
  }

  /** Extract durable knowledge / facts worth remembering. */
  knowledgeExtraction(text: string): string {
    return jsonTemplate(
      'Extract durable facts and knowledge worth remembering from the input.',
      '{ "facts": [{ "fact": string, "topic": string | null }] }',
      text,
    );
  }

  /** Extract named entities (people, orgs, projects, systems, …). */
  entityExtraction(text: string): string {
    return jsonTemplate(
      'Extract the named entities from the input. Use an uppercase type such ' +
        'as PERSON, ORG, PROJECT, SYSTEM, PRODUCT, or LOCATION.',
      '{ "entities": [{ "name": string, "type": string, "mentions": [string] }] }',
      text,
    );
  }

  /**
   * Classify text into exactly one of the allowed labels.
   * @param labels Permitted output labels.
   */
  classification(text: string, labels: readonly string[]): string {
    return jsonTemplate(
      `Classify the input into exactly one of these labels: ${labels.join(', ')}. ` +
        'Include a confidence in [0,1] and a short rationale.',
      '{ "label": string, "confidence": number, "rationale": string | null }',
      text,
    );
  }

  /**
   * RAG answer generation: answer a question grounded ONLY in the provided
   * context. Prose output (not JSON).
   */
  ragAnswer(question: string, context: string): string {
    return [
      'Answer the question using ONLY the context below. If the context does',
      'not contain the answer, say you do not have enough information. Do not',
      'invent facts. Return plain prose.',
      '',
      '--- CONTEXT ---',
      context,
      '',
      '--- QUESTION ---',
      question,
    ].join('\n');
  }

  /**
   * RAG map step: pull just the facts from one context chunk that are relevant
   * to the question, so many chunks can be reduced into a final answer.
   */
  ragNotes(question: string, contextChunk: string): string {
    return [
      'From the context below, extract only the facts relevant to answering the',
      'question. If nothing is relevant, reply with "NONE". Return plain prose.',
      '',
      '--- CONTEXT ---',
      contextChunk,
      '',
      '--- QUESTION ---',
      question,
    ].join('\n');
  }

  /** One-shot, full meeting analysis into the {@link MeetingAnalysis} shape. */
  meetingAnalysis(text: string): string {
    return jsonTemplate(
      'Analyze the following meeting content end to end.',
      [
        '{',
        '  "summary": string,',
        '  "decisions": [{ "decision": string, "rationale": string | null }],',
        '  "tasks": [{ "title": string, "owner": string | null, "due": string | null }],',
        '  "risks": [{ "risk": string, "severity": "low" | "medium" | "high" }],',
        '  "blockers": [string],',
        '  "followUps": [string]',
        '}',
      ].join('\n'),
      text,
    );
  }
}
