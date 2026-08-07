import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  isRenderableAsPdf,
  markdownToPdf,
  parseDocumentFormat,
} from '../src/services/document-pdf.service.js';
import { downloadDocumentQuerySchema } from '../src/modules/knowledge/knowledge.schemas.js';
import { parsePlan, fallbackPlan } from '../src/modules/actions/planning-prompt.js';
import { TOOL_HANDLERS } from '../src/modules/actions/tools/handlers.js';
import type { ToolContext } from '../src/modules/actions/tools/types.js';

describe('parseDocumentFormat', () => {
  it('reads the aliases models and users actually write', () => {
    expect(parseDocumentFormat('pdf', 'markdown')).toBe('pdf');
    expect(parseDocumentFormat('PDF', 'markdown')).toBe('pdf');
    expect(parseDocumentFormat('.pdf', 'markdown')).toBe('pdf');
    expect(parseDocumentFormat('a PDF file', 'markdown')).toBe('pdf');
    expect(parseDocumentFormat('md', 'pdf')).toBe('markdown');
    expect(parseDocumentFormat('markdown', 'pdf')).toBe('markdown');
  });

  it('falls back when nothing usable was given', () => {
    expect(parseDocumentFormat(undefined, 'markdown')).toBe('markdown');
    expect(parseDocumentFormat('', 'pdf')).toBe('pdf');
    expect(parseDocumentFormat('docx', 'markdown')).toBe('markdown');
    expect(parseDocumentFormat(42, 'pdf')).toBe('pdf');
  });
});

describe('isRenderableAsPdf', () => {
  it('accepts text formats and rejects binaries', () => {
    expect(isRenderableAsPdf('text/markdown')).toBe(true);
    expect(isRenderableAsPdf('text/plain')).toBe(true);
    expect(isRenderableAsPdf('application/json')).toBe(true);
    expect(isRenderableAsPdf('application/pdf')).toBe(false);
    expect(isRenderableAsPdf('image/png')).toBe(false);
  });
});

describe('markdownToPdf', () => {
  it('renders a real PDF buffer from a deliverable', async () => {
    const markdown = [
      '# Vendor Review',
      '',
      'The **renewal** lands in Q4 → decide by 30 September.',
      '',
      '| Vendor | Spend |',
      '| --- | --- |',
      '| Acme | $40k |',
    ].join('\n');
    const buffer = await markdownToPdf(markdown, { title: 'Vendor Review' });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.subarray(-6).toString()).toContain('%%EOF');
  });

  it('grows with the content rather than truncating it', async () => {
    const short = await markdownToPdf('# A\n\nOne line.');
    const long = await markdownToPdf(
      ['# A', '', ...Array.from({ length: 300 }, (_, i) => `Paragraph ${i}.`)].join('\n\n'),
    );
    expect(long.length).toBeGreaterThan(short.length * 2);
  });
});

describe('document download contract', () => {
  it('defaults to the stored bytes and accepts pdf', () => {
    expect(downloadDocumentQuerySchema.parse({})).toEqual({ format: 'original' });
    expect(downloadDocumentQuerySchema.parse({ format: 'pdf' })).toEqual({ format: 'pdf' });
    expect(() => downloadDocumentQuerySchema.parse({ format: 'docx' })).toThrow();
  });
});

/** The document fields the document tools actually read and write. */
interface FakeDoc {
  id?: string;
  title: string;
  description?: string | null;
  fileName: string;
  mimeType: string;
  storageKey: string;
  metadata: Record<string, unknown>;
}

interface FakeContains {
  contains?: string;
}

interface FakeWhere {
  id?: string;
  title?: FakeContains;
  fileName?: FakeContains;
  OR?: FakeWhere[];
}

/** The subset of Prisma's where semantics the document tools rely on. */
function whereMatches(doc: FakeDoc, where: FakeWhere): boolean {
  if (where.OR) return where.OR.some((clause) => whereMatches(doc, clause));
  if (where.id !== undefined && doc.id !== where.id) return false;
  const like = (value: string, clause?: FakeContains): boolean =>
    !clause?.contains || value.toLowerCase().includes(clause.contains.toLowerCase());
  return like(doc.title, where.title) && like(doc.fileName, where.fileName);
}

// A ToolContext just real enough to run the document tools: an in-memory
// document table and object store, so what the handlers actually persist can be
// asserted without a database.
function toolContext(seed: { documents?: FakeDoc[]; chunks?: string[] } = {}) {
  const documents = [...(seed.documents ?? [])];
  const objects = new Map<string, { buffer: Buffer; contentType: string }>();
  const created: FakeDoc[] = [];

  const ctx = {
    prisma: {
      document: {
        create: async ({ data }: { data: FakeDoc }) => {
          created.push(data);
          documents.push(data);
          return data;
        },
        findFirst: async ({ where }: { where: FakeWhere }) =>
          documents.find((d) => whereMatches(d, where)) ?? null,
        findMany: async ({ where, take }: { where: FakeWhere; take?: number }) => {
          const rows = documents.filter((d) => whereMatches(d, where));
          return take ? rows.slice(0, take) : rows;
        },
      },
      chunk: {
        findMany: async () =>
          (seed.chunks ?? []).map((content, index) => ({ content, heading: null, index })),
      },
    },
    organizationId: 'org-1',
    userId: 'user-1',
    llm: { complete: async () => '' },
    llmAvailable: false,
    storage: {
      upload: async (key: string, buffer: Buffer, opts: { contentType: string }) => {
        objects.set(key, { buffer, contentType: opts.contentType });
      },
      download: async (key: string) => {
        const object = objects.get(key);
        if (!object) throw new Error('not found');
        return Readable.from([object.buffer]);
      },
    },
    workspaceDir: '/tmp/does-not-matter',
    google: () => {
      throw new Error('google should not be called');
    },
    actionId: 'action-1',
    goal: 'produce a deliverable',
    request: 'produce a deliverable',
    priorOutputs: {},
  } as unknown as ToolContext;

  return { ctx, created, objects };
}

describe('doc.generate', () => {
  it('stores a PDF when the step asks for one, keeping the markdown source', async () => {
    const { ctx, created, objects } = toolContext();
    const result = await TOOL_HANDLERS['doc.generate']!(
      { title: 'Q3 Review', content: '# Q3 Review\n\nAll good.', format: 'pdf' },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ format: 'pdf', mimeType: 'application/pdf' });
    expect(String(result.output.fileName)).toMatch(/\.pdf$/);
    expect(String(result.output.downloadUrl)).toContain('/download');

    const row = created[0]!;
    expect(row.mimeType).toBe('application/pdf');
    expect(String(row.metadata.sourceMarkdown)).toContain('All good.');
    expect([...objects.values()][0]!.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('still stores markdown by default', async () => {
    const { ctx, created } = toolContext();
    const result = await TOOL_HANDLERS['doc.generate']!(
      { title: 'Notes', content: '# Notes' },
      ctx,
    );
    expect(result.output).toMatchObject({ format: 'markdown', mimeType: 'text/markdown' });
    expect(created[0]!.fileName).toMatch(/\.md$/);
  });
});

describe('doc.pdf', () => {
  it('converts a stored text document by re-rendering its bytes', async () => {
    const { ctx, objects, created } = toolContext({
      documents: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Onboarding Guide',
          description: null,
          fileName: 'onboarding.md',
          mimeType: 'text/markdown',
          storageKey: 'documents/org-1/onboarding/v1/onboarding.md',
          metadata: {},
        },
      ],
    });
    objects.set('documents/org-1/onboarding/v1/onboarding.md', {
      buffer: Buffer.from('# Onboarding\n\nDay one: laptop, badge, buddy.'),
      contentType: 'text/markdown',
    });

    const result = await TOOL_HANDLERS['doc.pdf']!({ title: 'onboarding' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      format: 'pdf',
      sourceDocumentId: '11111111-1111-4111-8111-111111111111',
    });
    expect(created[0]!.mimeType).toBe('application/pdf');
  });

  it('falls back to extracted chunks for a document it cannot read directly', async () => {
    const { ctx, created } = toolContext({
      documents: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Board Deck',
          description: null,
          fileName: 'board.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          storageKey: 'documents/org-1/board/v1/board.pptx',
          metadata: {},
        },
      ],
      chunks: ['Revenue is up 18%.', 'Hiring pauses in Q4.'],
    });

    const result = await TOOL_HANDLERS['doc.pdf']!(
      { documentId: '22222222-2222-4222-8222-222222222222' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(String(created[0]!.metadata.sourceMarkdown)).toContain('Revenue is up 18%.');
  });

  it('reports an existing PDF instead of re-rendering it', async () => {
    const { ctx, created } = toolContext({
      documents: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          title: 'Signed Contract',
          fileName: 'contract.pdf',
          mimeType: 'application/pdf',
          storageKey: 'k',
          metadata: {},
        },
      ],
    });
    const result = await TOOL_HANDLERS['doc.pdf']!(
      { documentId: '33333333-3333-4333-8333-333333333333' },
      ctx,
    );
    expect(result.output).toMatchObject({
      alreadyPdf: true,
      documentId: '33333333-3333-4333-8333-333333333333',
    });
    expect(created).toHaveLength(0);
  });

  it('fails clearly when there is nothing to convert', async () => {
    const { ctx } = toolContext();
    const missing = await TOOL_HANDLERS['doc.pdf']!({ documentId: 'nope' }, ctx);
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('could not find');

    const unnamed = await TOOL_HANDLERS['doc.pdf']!({}, ctx);
    expect(unnamed.ok).toBe(false);
    expect(unnamed.error).toContain('needs a documentId');
  });
});

// An ingested document's `title` is whatever heading the parser found first,
// while the name shown in the UI (and used by the model) is the file name.
// Every case here is one that used to resolve to "could not find".
describe('doc.pdf resolves the name people actually use', () => {
  const ingested = {
    id: 'b191e6b2-2ce4-4212-bf94-8d486b9b7bd1',
    title: '1. One commission record per booking',
    description: null,
    fileName: 'Meeting Summary — 24 July 2026, 20:34:33.txt',
    mimeType: 'text/plain',
    storageKey: 'documents/org-1/meeting/v1/summary.txt',
    metadata: {},
  };

  function seeded() {
    const made = toolContext({
      documents: [
        ingested,
        {
          id: '44444444-4444-4444-8444-444444444444',
          title: 'Global Retreat Booking Competitive Brief',
          fileName: 'global-retreat-booking-competitive-brief.md',
          mimeType: 'text/markdown',
          storageKey: 'k2',
          metadata: {},
        },
      ],
    });
    made.objects.set(ingested.storageKey, {
      buffer: Buffer.from('Commission is recorded once per booking.'),
      contentType: 'text/plain',
    });
    return made;
  }

  it('matches the file name, not just the parsed title', async () => {
    const { ctx, created } = seeded();
    const result = await TOOL_HANDLERS['doc.pdf']!(
      { title: 'Meeting Summary — 24 July 2026, 20:34:33' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.output.sourceDocumentId).toBe(ingested.id);
    // The PDF takes the name the request used, not the parser's heading.
    expect(created[0]!.title).toBe('Meeting Summary — 24 July 2026, 20:34:33');
  });

  it('tolerates a hyphen where the file has an em dash, and a missing extension', async () => {
    const { ctx } = seeded();
    const result = await TOOL_HANDLERS['doc.pdf']!(
      { title: 'Meeting Summary - 24 July 2026, 20:34:33.txt' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.output.sourceDocumentId).toBe(ingested.id);
  });

  it('accepts a name passed in documentId, as models do when they have no id', async () => {
    const { ctx } = seeded();
    const result = await TOOL_HANDLERS['doc.pdf']!(
      { documentId: 'Meeting Summary — 24 July 2026, 20:34:33' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.output.sourceDocumentId).toBe(ingested.id);
  });

  it('still resolves by the parsed title when that is what was given', async () => {
    const { ctx } = seeded();
    const result = await TOOL_HANDLERS['doc.pdf']!(
      { title: 'One commission record per booking' },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.output.sourceDocumentId).toBe(ingested.id);
  });

  it('names the closest documents when nothing matches', async () => {
    const { ctx } = seeded();
    const result = await TOOL_HANDLERS['doc.pdf']!({ title: 'Quarterly Tax Filing' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Closest documents');
    expect(result.error).toContain('Meeting Summary');
  });
});

describe('doc.generate grounds on a named source document', () => {
  it('reads the source and hands its text to the model', async () => {
    const { ctx, objects } = toolContext({
      documents: [
        {
          id: '99999999-9999-4999-8999-999999999999',
          title: '1. One commission record per booking',
          fileName: 'Meeting Summary — 24 July 2026, 20:34:33.txt',
          mimeType: 'text/plain',
          storageKey: 'k9',
          metadata: {},
        },
      ],
    });
    objects.set('k9', {
      buffer: Buffer.from('Decision: one commission record per booking, effective Q4.'),
      contentType: 'text/plain',
    });

    let prompted = '';
    const withLlm = {
      ...ctx,
      llmAvailable: true,
      llm: {
        complete: async ({ prompt }: { prompt: string }) => {
          prompted = prompt;
          return '# One-pager\n\nOne commission record per booking, effective Q4.';
        },
      },
    } as unknown as ToolContext;

    const result = await TOOL_HANDLERS['doc.generate']!(
      {
        title: 'Meeting one-pager',
        prompt: 'One-page summary of the 24 July meeting',
        format: 'pdf',
        sourceDocument: 'Meeting Summary — 24 July 2026, 20:34:33',
      },
      withLlm,
    );

    expect(result.ok).toBe(true);
    expect(prompted).toContain('SOURCE DOCUMENT');
    expect(prompted).toContain('effective Q4');
    expect(result.output.format).toBe('pdf');
    expect(result.logs.some((l) => l.message.includes('Grounded in'))).toBe(true);
  });

  it('warns and falls back when the named source cannot be found', async () => {
    const { ctx } = toolContext();
    const result = await TOOL_HANDLERS['doc.generate']!(
      { title: 'Brief', content: '# Brief', sourceDocument: 'Nothing Like This' },
      ctx,
    );
    // Explicit content short-circuits generation, so no lookup warning is due.
    expect(result.ok).toBe(true);

    const generated = await TOOL_HANDLERS['doc.generate']!(
      { title: 'Brief', prompt: 'summarise it', sourceDocument: 'Nothing Like This' },
      ctx,
    );
    expect(generated.ok).toBe(true);
    expect(
      generated.logs.some((l) => l.level === 'warn' && l.message.includes('falling back')),
    ).toBe(true);
  });
});

describe('action planning knows about PDFs', () => {
  it('exposes doc.pdf as a real tool handler', () => {
    expect(Object.keys(TOOL_HANDLERS)).toContain('doc.pdf');
    expect(Object.keys(TOOL_HANDLERS)).toContain('doc.generate');
  });

  it('keeps a planned format param through parsing', () => {
    const plan = parsePlan(
      JSON.stringify({
        title: 'Write the review',
        type: 'DOCUMENT_GENERATION',
        goal: 'g',
        steps: [
          {
            title: 'Generate',
            tool: 'doc.generate',
            params: { title: 'Q3', prompt: 'summarise', format: 'pdf' },
            requiresApproval: false,
          },
        ],
      }),
    );
    expect(plan?.steps[0]?.params).toMatchObject({ format: 'pdf' });
  });

  it('routes a PDF request to document generation without the model', () => {
    const plan = fallbackPlan('Make the onboarding guide a PDF');
    expect(plan.type).toBe('DOCUMENT_GENERATION');
    expect(plan.estimatedTools).toContain('doc.generate');
  });
});
