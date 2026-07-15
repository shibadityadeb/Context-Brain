import type { LLMConfig, LLMProvider } from './types.js';

/**
 * Deterministic rule-based "extraction" for tests and offline development.
 * Scans the prompt's chunk text for simple signals (emails → PERSON,
 * bug/task/decision keywords → typed objects) and emits schema-valid JSON.
 * Never call an external service.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock';
  readonly model: string;

  constructor(config?: Partial<LLMConfig>) {
    this.model = config?.model ?? 'mock-extractor';
  }

  complete(input: { system: string; prompt: string }): Promise<string> {
    const text = input.prompt;
    const objects: Array<Record<string, unknown>> = [];
    const relationships: Array<Record<string, unknown>> = [];
    let counter = 0;
    const nextRef = () => `obj_${(counter += 1)}`;

    const seen = new Set<string>();
    const push = (obj: Record<string, unknown>): string => {
      const key = `${obj.type as string}|${(obj.title as string).toLowerCase()}`;
      if (seen.has(key)) {
        const existing = objects.find(
          (o) => `${o.type as string}|${(o.title as string).toLowerCase()}` === key,
        );
        return existing!.ref as string;
      }
      seen.add(key);
      objects.push(obj);
      return obj.ref as string;
    };

    // People from email addresses.
    for (const match of text.matchAll(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
      const name = match[1]!.replace(/[._]/g, ' ').trim();
      push({
        ref: nextRef(),
        type: 'PERSON',
        title: name.replace(/\b\w/g, (c) => c.toUpperCase()),
        summary: `Mentioned via email address ${match[0]}`,
        status: 'ACTIVE',
        priority: 'NONE',
        confidence: 0.8,
        aliases: [match[0]!],
        evidence: match[0],
        metadata: { email: match[0] },
      });
    }

    // Typed lines: "bug: ...", "task: ...", "decision: ...", "risk: ..." etc.
    const lineTypes: Array<[RegExp, string, string]> = [
      [/^\s*(?:-\s*)?bug[:\s-]+(.{4,120})/gim, 'BUG', 'OPEN'],
      [/^\s*(?:-\s*)?task[:\s-]+(.{4,120})/gim, 'TASK', 'OPEN'],
      [/^\s*(?:-\s*)?(?:action item|todo)[:\s-]+(.{4,120})/gim, 'ACTION_ITEM', 'OPEN'],
      [/^\s*(?:-\s*)?decision[:\s-]+(.{4,120})/gim, 'DECISION', 'COMPLETED'],
      [/^\s*(?:-\s*)?risk[:\s-]+(.{4,120})/gim, 'RISK', 'OPEN'],
      [/^\s*(?:-\s*)?project[:\s-]+(.{3,120})/gim, 'PROJECT', 'ACTIVE'],
    ];
    for (const [regex, type, status] of lineTypes) {
      for (const match of text.matchAll(regex)) {
        const title = match[1]!.trim().replace(/[.\s]+$/, '');
        if (!title) continue;
        push({
          ref: nextRef(),
          type,
          title,
          summary: null,
          status,
          priority: 'MEDIUM',
          confidence: 0.7,
          aliases: [],
          evidence: match[0]!.trim().slice(0, 200),
          metadata: {},
        });
      }
    }

    // Relationship heuristic: first PERSON reported the first BUG and is
    // assigned the first TASK — enough to exercise the graph end-to-end.
    const firstOf = (type: string) => objects.find((o) => o.type === type);
    const person = firstOf('PERSON');
    const bug = firstOf('BUG');
    const task = firstOf('TASK');
    const project = firstOf('PROJECT');
    if (person && bug) {
      relationships.push({ from: person.ref, to: bug.ref, type: 'REPORTED', confidence: 0.6 });
    }
    if (person && task) {
      relationships.push({ from: person.ref, to: task.ref, type: 'ASSIGNED_TO', confidence: 0.6 });
    }
    if (bug && project) {
      relationships.push({ from: bug.ref, to: project.ref, type: 'BELONGS_TO', confidence: 0.6 });
    }

    return Promise.resolve(JSON.stringify({ objects, relationships }));
  }
}
