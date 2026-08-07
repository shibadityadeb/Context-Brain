import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, normalize, resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import { createWebSearchProvider, ScopedRetrievalService } from '@company-brain/retrieval';
import { config } from '../../../config/index.js';
import {
  isRenderableAsPdf,
  markdownToPdf,
  parseDocumentFormat,
  type DocumentFormat,
} from '../../../services/document-pdf.service.js';
import type { OpenClawLogLine } from '../openclaw/types.js';
import { GoogleWriteError } from './google-client.js';
import { fail, ok, type ToolContext, type ToolHandler, type ToolResult } from './types.js';

// ── company-context grounding ─────────────────────────────────────────────────

/**
 * Pull the most relevant organizational knowledge for a brief so deliverables
 * (documents, emails) are grounded in the real Company Brain — specific
 * projects, decisions, meetings and facts — instead of generic AI boilerplate.
 * Runs org-wide (team scope) across every knowledge source; failures degrade to
 * an empty context rather than blocking the action.
 */
async function gatherCompanyContext(ctx: ToolContext, brief: string, limit = 30): Promise<string> {
  try {
    const retrieval = new ScopedRetrievalService(ctx.prisma);
    const items = await retrieval.retrieve(ctx.organizationId, brief, { scope: 'team', limit });
    return items
      .map((i, n) => `${n + 1}. [${i.type}] ${i.title}${i.summary ? ` — ${i.summary}` : ''}`)
      .join('\n');
  } catch {
    return '';
  }
}

/**
 * Generate a business-grade Markdown document grounded in the Company Brain.
 * Shared by `doc.generate` (stores in the Brain) and `drive.write` (saves to
 * Google Drive) so both produce the same specific, non-generic deliverable.
 *
 * When the request is about one particular document — "a one-pager on the 24
 * July meeting notes" — that document's own text is passed in as the primary
 * source, and org-wide retrieval only supplements it. Summarising a named
 * document from keyword retrieval alone produces something adjacent to, but not
 * actually about, the thing that was asked for.
 */
async function generateGroundedDocument(
  ctx: ToolContext,
  title: string,
  brief: string,
  sourceDocument?: { name: string; text: string } | null,
): Promise<string | null> {
  if (!ctx.llmAvailable) return null;
  const context = await gatherCompanyContext(ctx, `${title}\n${brief}`, 40);
  const source = sourceDocument?.text.trim()
    ? `SOURCE DOCUMENT — "${sourceDocument.name}". This is the subject of the request; base the deliverable on it:\n${sourceDocument.text.slice(0, 60_000)}\n\n`
    : '';
  try {
    return await ctx.llm.complete({
      system: [
        'You are a senior business consultant producing a polished internal deliverable for this company.',
        source
          ? 'A SOURCE DOCUMENT is provided: it is the subject of the request. Draw the substance from it — its specifics, names, numbers and decisions — and use COMPANY CONTEXT only to add surrounding detail.'
          : 'Ground every claim in the COMPANY CONTEXT: use its specific projects, decisions, meetings, people and facts by name — never generic placeholders.',
        'Write a business-grade Markdown document: a brief executive summary, clearly titled sections, concrete findings, specific and actionable recommendations, risks, and next steps (with owners where the context implies them).',
        'Respect any length the request asks for — a "one-pager" or "one-page summary" means roughly 400-600 words, tightly edited, and nothing longer.',
        'Be detailed and decision-useful. Do NOT produce generic filler, hedging, or AI boilerplate. Where the context is silent, state the assumption explicitly instead of padding.',
        'Output only the document (Markdown).',
      ].join(' '),
      prompt:
        `Title: ${title}\n\nRequest:\n${brief}\n\n` +
        source +
        `COMPANY CONTEXT (the organization's own knowledge — cite items by name):\n` +
        `${context || '(no specific context matched; rely on the request and be explicit about assumptions)'}`,
    });
  } catch {
    return null;
  }
}

// ── param helpers ─────────────────────────────────────────────────────────────

function str(params: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = params[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function list(params: Record<string, unknown>, ...keys: string[]): string[] {
  for (const k of keys) {
    const v = params[k];
    if (Array.isArray(v))
      return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    if (typeof v === 'string' && v.trim()) {
      return v
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'untitled'
  );
}

/** The next weekday at 10:00 UTC — a sane default when Codex omits a time. */
function defaultStart(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 2);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(10, 0, 0, 0);
  return d.toISOString();
}

/** Confine a user-supplied path to the workspace sandbox (blocks ../ escapes). */
function safeWorkspacePath(workspaceDir: string, path: string): string {
  const root = resolve(workspaceDir);
  const target = resolve(root, normalize(path).replace(/^(\.\.(\/|\\|$))+/, ''));
  if (target !== root && !target.startsWith(root + '/')) {
    throw new Error('path escapes the action workspace');
  }
  return target;
}

// ── Tasks (surface in the Tasks tab as TASK/ACTION_ITEM knowledge objects) ─────

async function createKnowledgeTask(
  params: Record<string, unknown>,
  ctx: ToolContext,
  type: 'TASK' | 'ACTION_ITEM',
): Promise<ToolResult> {
  const title = str(params, 'title', 'task', 'summary') ?? ctx.goal.slice(0, 120);
  const priorityRaw = (str(params, 'priority') ?? '').toUpperCase();
  const priority = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).includes(
    priorityRaw as 'CRITICAL',
  )
    ? (priorityRaw as Prisma.KnowledgeObjectCreateInput['priority'])
    : 'MEDIUM';

  const obj = await ctx.prisma.knowledgeObject.create({
    data: {
      type,
      title,
      normalizedTitle: title
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
      summary: str(params, 'description', 'detail', 'notes'),
      status: 'OPEN',
      priority,
      confidence: 1,
      createdBy: `action:${ctx.actionId}`,
      organizationId: ctx.organizationId,
      metadata: {
        assignee: str(params, 'assignee', 'owner'),
        dueDate: str(params, 'due', 'dueDate'),
        reminder: type === 'ACTION_ITEM',
        sourceActionId: ctx.actionId,
      } as Prisma.InputJsonValue,
    },
  });

  return ok({ taskId: obj.id, title, url: `/brain/entity/${obj.id}`, shownIn: '/tasks' }, [
    {
      level: 'info',
      message: `Created ${type === 'TASK' ? 'task' : 'reminder'} "${title}" — visible in the Tasks tab.`,
    },
  ]);
}

const taskCreate: ToolHandler = (params, ctx) => createKnowledgeTask(params, ctx, 'TASK');
const reminderCreate: ToolHandler = (params, ctx) =>
  createKnowledgeTask(params, ctx, 'ACTION_ITEM');

// ── File management (sandboxed to the workspace dir) ───────────────────────────

const filesWrite: ToolHandler = async (params, ctx) => {
  const path = str(params, 'path', 'file', 'filename') ?? `${slug(ctx.goal)}.txt`;
  const content = str(params, 'content', 'text', 'body') ?? '';
  try {
    const target = safeWorkspacePath(ctx.workspaceDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    return ok({ path, bytes: Buffer.byteLength(content), absolutePath: target }, [
      { level: 'info', message: `Wrote ${Buffer.byteLength(content)} bytes to ${path}` },
    ]);
  } catch (e) {
    return fail(`files.write failed: ${(e as Error).message}`);
  }
};

const filesRead: ToolHandler = async (params, ctx) => {
  const path = str(params, 'path', 'file', 'filename');
  // A read is non-destructive, and models often add a speculative "check if it
  // already exists" step. Degrade gracefully (skip) instead of hard-failing so
  // one such step can't abort the whole action before the real deliverable.
  if (!path) {
    return ok({ skipped: true, reason: 'no path provided' }, [
      { level: 'warn', message: 'files.read had no path; skipped (nothing to read).' },
    ]);
  }
  try {
    const target = safeWorkspacePath(ctx.workspaceDir, path);
    const content = await readFile(target, 'utf8');
    return ok({ path, bytes: Buffer.byteLength(content), content: content.slice(0, 20_000) }, [
      { level: 'info', message: `Read ${Buffer.byteLength(content)} bytes from ${path}` },
    ]);
  } catch {
    return ok({ skipped: true, path, found: false }, [
      { level: 'warn', message: `files.read: "${path}" not found; skipped.` },
    ]);
  }
};

// ── Document generation (real Document stored + shown under Documents) ─────────

interface StoredDocument {
  documentId: string;
  title: string;
  fileName: string;
  bytes: number;
  format: DocumentFormat;
  mimeType: string;
  url: string;
  downloadUrl: string;
}

/**
 * Persist a deliverable as a first-class Document — bytes in object storage,
 * a row (plus v1) in the Brain — in either format. Markdown keeps the document
 * editable and indexable; PDF renders the same Markdown to a laid-out,
 * shareable file. The source Markdown is kept on the row either way so the
 * document can be re-rendered or re-formatted later without regenerating it.
 */
async function storeDocument(
  ctx: ToolContext,
  input: {
    title: string;
    markdown: string;
    format: DocumentFormat;
    description: string;
    subtitle?: string | null;
    meta?: string[];
    extraMetadata?: Record<string, unknown>;
  },
): Promise<StoredDocument> {
  const documentId = randomUUID();
  const pdf = input.format === 'pdf';
  const fileName = `${slug(input.title)}.${pdf ? 'pdf' : 'md'}`;
  const mimeType = pdf ? 'application/pdf' : 'text/markdown';
  const buffer = pdf
    ? await markdownToPdf(input.markdown, {
        title: input.title,
        subtitle: input.subtitle ?? null,
        meta: input.meta ?? [],
      })
    : Buffer.from(input.markdown, 'utf8');

  const storageKey = `documents/${ctx.organizationId}/${documentId}/v1/${fileName}`;
  const checksum = createHash('sha256').update(buffer).digest('hex');

  await ctx.storage.upload(storageKey, buffer, { contentType: mimeType });
  await ctx.prisma.document.create({
    data: {
      id: documentId,
      title: input.title,
      description: input.description,
      fileName,
      mimeType,
      fileSizeBytes: buffer.length,
      storageBucket: 'company-brain',
      storageKey,
      checksum,
      status: 'READY',
      currentVersion: 1,
      organizationId: ctx.organizationId,
      ownerId: ctx.userId,
      metadata: {
        generatedByAction: ctx.actionId,
        format: input.format,
        // Keeping the Markdown means a PDF can be re-rendered (or turned back
        // into an editable document) without asking the model to write it again.
        sourceMarkdown: input.markdown,
        ...input.extraMetadata,
      } as Prisma.InputJsonValue,
      versions: {
        create: {
          version: 1,
          storageKey,
          fileSizeBytes: buffer.length,
          checksum,
          organizationId: ctx.organizationId,
        },
      },
    },
  });

  return {
    documentId,
    title: input.title,
    fileName,
    bytes: buffer.length,
    format: input.format,
    mimeType,
    url: `/knowledge/documents/${documentId}`,
    downloadUrl: `/api/v1/knowledge/documents/${documentId}/download`,
  };
}

const docGenerate: ToolHandler = async (params, ctx) => {
  const title = str(params, 'title', 'topic', 'name') ?? ctx.goal.slice(0, 120);
  const format = parseDocumentFormat(
    str(params, 'format', 'fileType', 'as', 'output'),
    // Fall back to the configured house format, then let an explicit "as a PDF"
    // anywhere in the request win — users say it in the prompt, not in a param.
    /\bpdf\b/i.test(`${ctx.request} ${ctx.goal}`) ? 'pdf' : config.openclaw.documentFormat,
  );
  let content = str(params, 'content', 'body');
  const logs: OpenClawLogLine[] = [];

  if (!content) {
    const brief = str(params, 'prompt', 'instructions', 'description') ?? ctx.request;
    // A named source ("summarise the 24 July notes") is read in full and given
    // to the model, rather than hoping keyword retrieval surfaces it.
    const sourceRef = str(
      params,
      'sourceDocumentId',
      'sourceDocument',
      'fromDocument',
      'documentId',
      'source',
    );
    let sourceDocument: { name: string; text: string } | null = null;
    if (sourceRef) {
      const { match } = await resolveDocument(ctx, sourceRef);
      if (match) {
        const text = await readDocumentText(ctx, match.id);
        if (text.trim()) {
          sourceDocument = { name: documentLabel(match), text };
          logs.push({
            level: 'info',
            message: `Grounded in "${documentLabel(match)}" (${text.length} characters).`,
          });
        }
      }
      if (!sourceDocument) {
        logs.push({
          level: 'warn',
          message: `Could not read a source document matching "${sourceRef}"; falling back to org-wide context.`,
        });
      }
    }
    content = await generateGroundedDocument(ctx, title, brief, sourceDocument);
  }
  content ??= `# ${title}\n\n${str(params, 'description') ?? ctx.request}\n`;

  try {
    const stored = await storeDocument(ctx, {
      title,
      markdown: content,
      format,
      description: 'Generated by the Action Layer',
      subtitle: str(params, 'subtitle') ?? null,
    });
    return ok({ ...stored, content }, [
      ...logs,
      {
        level: 'info',
        message: `Generated ${format === 'pdf' ? 'PDF' : 'Markdown'} document "${title}" (${stored.bytes} bytes) — available under Documents.`,
      },
    ]);
  } catch (e) {
    return fail(`doc.generate failed to store the document: ${(e as Error).message}`);
  }
};

// ── Convert an existing document to PDF ───────────────────────────────────────

async function readStorageText(ctx: ToolContext, key: string): Promise<string> {
  const stream = await ctx.storage.download(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Recover a document's text without its original bytes. Ingestion already
 * extracted and chunked every supported format (PDF, DOCX, slides, HTML), so
 * the chunks are a faithful text of the document — which is what makes
 * "turn *that* doc into a PDF" work for files the Brain never authored.
 */
async function documentTextFromChunks(ctx: ToolContext, documentId: string): Promise<string> {
  const chunks = await ctx.prisma.chunk.findMany({
    where: { documentId, organizationId: ctx.organizationId, deletedAt: null },
    orderBy: { index: 'asc' },
    select: { content: true, heading: true },
  });
  const parts: string[] = [];
  let lastHeading: string | null = null;
  for (const chunk of chunks) {
    if (chunk.heading && chunk.heading !== lastHeading) {
      parts.push(`## ${chunk.heading}`);
      lastHeading = chunk.heading;
    }
    parts.push(chunk.content.trim());
  }
  return parts.join('\n\n');
}

/**
 * A document's text, in order of fidelity: the Markdown it was generated from,
 * then the stored file when it is text, then the extracted chunks. Every
 * ingested document has chunks, so this returns something for anything the
 * Brain has finished processing.
 */
async function readDocumentText(ctx: ToolContext, documentId: string): Promise<string> {
  const doc = await ctx.prisma.document.findFirst({
    where: { id: documentId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, mimeType: true, storageKey: true, metadata: true },
  });
  if (!doc) return '';

  const metadata = (doc.metadata ?? {}) as { sourceMarkdown?: unknown };
  if (typeof metadata.sourceMarkdown === 'string' && metadata.sourceMarkdown.trim()) {
    return metadata.sourceMarkdown;
  }
  if (isRenderableAsPdf(doc.mimeType)) {
    const text = await readStorageText(ctx, doc.storageKey).catch(() => '');
    if (text.trim()) return text;
  }
  return documentTextFromChunks(ctx, doc.id);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A punctuation-insensitive comparison key. Document names travel through
 * Drive exports, model paraphrase and the UI, so em dashes become hyphens,
 * curly quotes become straight ones, and the extension may or may not survive.
 * Comparing on `"meeting summary 24 july 2026 20 34 33"` sidesteps all of it.
 */
function documentKey(value: string): string {
  return value
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** How well a candidate's name answers to `key`; 0 means "not this one". */
function nameScore(candidateKey: string, key: string): number {
  if (!candidateKey || !key) return 0;
  if (candidateKey === key) return 4;
  if (candidateKey.includes(key)) return 3;
  if (key.includes(candidateKey)) return 2;
  const wanted = new Set(key.split(' '));
  const got = candidateKey.split(' ');
  const hits = got.filter((t) => wanted.has(t)).length;
  const overlap = hits / Math.max(wanted.size, got.length);
  return overlap >= 0.6 ? 1 : 0;
}

interface DocumentMatch {
  id: string;
  title: string;
  fileName: string;
}

/**
 * Find the document a step is talking about.
 *
 * Matching on `title` alone is not enough: for anything the Brain ingested,
 * `title` is whatever heading the parser found first ("1. One commission record
 * per booking") while the name people actually use — the one shown in the
 * knowledge sources and in Drive — is the `fileName`. Both are searched, exactly
 * first and then on a punctuation-insensitive key, so a reference copied out of
 * the UI resolves even when its dashes or extension differ.
 */
async function resolveDocument(
  ctx: ToolContext,
  reference: string,
): Promise<{ match: DocumentMatch | null; candidates: DocumentMatch[] }> {
  const where = { organizationId: ctx.organizationId, deletedAt: null } as const;
  const select = { id: true, title: true, fileName: true };

  if (UUID.test(reference)) {
    const byId = await ctx.prisma.document.findFirst({
      where: { ...where, id: reference },
      select,
    });
    if (byId) return { match: byId, candidates: [] };
  }

  const direct = await ctx.prisma.document.findMany({
    where: {
      ...where,
      OR: [
        { title: { contains: reference, mode: 'insensitive' } },
        { fileName: { contains: reference, mode: 'insensitive' } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: 5,
    select,
  });
  if (direct.length > 0) {
    // Prefer a name that matches outright over one that merely contains it.
    const key = documentKey(reference);
    const best = [...direct].sort(
      (a, b) =>
        Math.max(nameScore(documentKey(b.fileName), key), nameScore(documentKey(b.title), key)) -
        Math.max(nameScore(documentKey(a.fileName), key), nameScore(documentKey(a.title), key)),
    );
    return { match: best[0]!, candidates: [] };
  }

  // Nothing contained the reference verbatim — compare on the normalised key.
  const key = documentKey(reference);
  const pool = await ctx.prisma.document.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select,
  });
  const scored = pool
    .map((doc) => ({
      doc,
      score: Math.max(
        nameScore(documentKey(doc.fileName), key),
        nameScore(documentKey(doc.title), key),
      ),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    match: scored[0]?.doc ?? null,
    // Recent documents make a far more useful error than "not found".
    candidates: scored.length ? scored.slice(0, 5).map((s) => s.doc) : pool.slice(0, 5),
  };
}

/** How a document is named in an error, preferring the name people recognise. */
const documentLabel = (doc: DocumentMatch): string =>
  doc.fileName && documentKey(doc.fileName) !== documentKey(doc.title)
    ? `${doc.title} (${doc.fileName})`
    : doc.title;

/**
 * `doc.pdf` — turn any document the Brain holds into a PDF. It prefers the
 * Markdown a generated document was written from, falls back to the stored file
 * for text formats, and finally to the extracted chunks, so a document that
 * arrived as a Drive export or an upload converts just as well as one the
 * Action Layer wrote itself. An already-PDF document is reported, not re-rendered.
 */
const docToPdf: ToolHandler = async (params, ctx) => {
  // Any of these may carry the reference, and a model that has no id often puts
  // the document's name in `documentId` — so all of them are treated the same.
  const reference = str(
    params,
    'documentId',
    'id',
    'document',
    'title',
    'name',
    'fileName',
    'file',
    'topic',
  );
  if (!reference) {
    return fail('doc.pdf needs a documentId or a document name to convert.');
  }

  const { match, candidates } = await resolveDocument(ctx, reference);
  if (!match) {
    const suggestions = candidates.length
      ? ` Closest documents: ${candidates.map((c) => `"${documentLabel(c)}"`).join(', ')}.`
      : '';
    return fail(`doc.pdf could not find a document matching "${reference}".${suggestions}`);
  }

  const source = await ctx.prisma.document.findFirst({
    where: { id: match.id, organizationId: ctx.organizationId, deletedAt: null },
  });
  if (!source) return fail(`doc.pdf could not read the document "${documentLabel(match)}".`);

  if (source.mimeType === 'application/pdf') {
    return ok(
      {
        documentId: source.id,
        title: source.title,
        fileName: source.fileName,
        format: 'pdf',
        mimeType: source.mimeType,
        alreadyPdf: true,
        url: `/knowledge/documents/${source.id}`,
        downloadUrl: `/api/v1/knowledge/documents/${source.id}/download`,
      },
      [{ level: 'info', message: `"${source.title}" is already a PDF — nothing to convert.` }],
    );
  }

  const markdown = await readDocumentText(ctx, source.id);
  if (!markdown.trim()) {
    return fail(
      `"${documentLabel(source)}" has no extractable text yet — it may still be processing. Try again once it is READY.`,
    );
  }

  // An ingested document's `title` is often the parser's first heading, so when
  // the request named the file, that name is what the PDF should be called.
  const fileBase = source.fileName.replace(/\.[^.]+$/, '').trim();
  const key = documentKey(reference);
  const title =
    fileBase && nameScore(documentKey(fileBase), key) > nameScore(documentKey(source.title), key)
      ? fileBase
      : source.title;

  try {
    const stored = await storeDocument(ctx, {
      title,
      markdown,
      format: 'pdf',
      description: `PDF of "${documentLabel(source)}", produced by the Action Layer`,
      subtitle: source.description,
      meta: [`Converted from ${source.fileName}`],
      extraMetadata: { sourceDocumentId: source.id },
    });
    return ok({ ...stored, sourceDocumentId: source.id, sourceTitle: source.title }, [
      {
        level: 'info',
        message: `Converted "${documentLabel(source)}" to PDF (${stored.bytes} bytes) — available under Documents.`,
      },
    ]);
  } catch (e) {
    return fail(`doc.pdf failed to render "${documentLabel(source)}": ${(e as Error).message}`);
  }
};

// ── Web research ──────────────────────────────────────────────────────────────

const webSearch: ToolHandler = async (params, ctx) => {
  const query = str(params, 'query', 'q', 'topic') ?? ctx.goal;
  const provider = createWebSearchProvider({
    provider: config.webSearch.provider,
    apiKey: config.webSearch.apiKey,
    maxResults: config.webSearch.maxResults,
  });
  if (provider.name === 'none') {
    return ok({ query, results: [], note: 'Web search is disabled (WEB_SEARCH_PROVIDER=none).' }, [
      { level: 'warn', message: 'Web search disabled; no results.' },
    ]);
  }
  try {
    const results = await provider.search(query, config.webSearch.maxResults);
    return ok(
      { query, results: results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })) },
      [{ level: 'info', message: `Web search "${query}" → ${results.length} result(s).` }],
    );
  } catch (e) {
    return fail(`web.search failed: ${(e as Error).message}`);
  }
};

// ── Contacts + calendar reads ─────────────────────────────────────────────────

const contactsLookup: ToolHandler = async (params, ctx) => {
  const term = str(params, 'name', 'query', 'person') ?? '';
  const people = await ctx.prisma.knowledgeObject.findMany({
    where: {
      organizationId: ctx.organizationId,
      type: 'PERSON',
      deletedAt: null,
      ...(term ? { title: { contains: term, mode: 'insensitive' } } : {}),
    },
    take: 5,
    select: { id: true, title: true, metadata: true },
  });
  const matches = people.map((p) => ({
    name: p.title,
    email: (p.metadata as { email?: string } | null)?.email ?? null,
    entityUrl: `/brain/entity/${p.id}`,
  }));
  return ok({ term, matches }, [
    { level: 'info', message: `Contacts lookup "${term}" → ${matches.length} match(es).` },
  ]);
};

const calendarRead: ToolHandler = async (_params, ctx) => {
  const events = await ctx.prisma.externalResource.findMany({
    where: {
      organizationId: ctx.organizationId,
      type: { in: ['CALENDAR_EVENT'] },
      deletedAt: null,
      connector: { is: { ownerId: ctx.userId } },
      externalUpdatedAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) },
    },
    orderBy: { externalUpdatedAt: 'desc' },
    take: 10,
    select: { title: true, externalUpdatedAt: true },
  });
  return ok(
    {
      events: events.map((e) => ({
        title: e.title,
        at: e.externalUpdatedAt?.toISOString() ?? null,
      })),
    },
    [{ level: 'info', message: `Read ${events.length} recent calendar event(s).` }],
  );
};

// ── Google calendar write + gmail send (real side effects) ─────────────────────

const calendarWrite: ToolHandler = async (params, ctx) => {
  const title = str(params, 'title', 'summary', 'subject') ?? ctx.goal.slice(0, 120);
  const attendees = list(params, 'attendees', 'guests', 'to');
  try {
    const event = await ctx.google().createCalendarEvent({
      title,
      description: str(params, 'description', 'agenda') ?? undefined,
      start: str(params, 'start', 'startTime') ?? defaultStart(),
      end: str(params, 'end', 'endTime') ?? undefined,
      attendees,
    });

    // Register the event locally so it shows in the Meetings tab immediately —
    // upsert so the connector's later calendar sync reconciles the same row.
    if (event.meetUrl) {
      const metadata = {
        meetingLink: event.meetUrl,
        start: event.start,
        end: event.end,
        status: 'confirmed',
        attendees: attendees.map((email) => ({ email })),
        createdByAction: ctx.actionId,
      } as Prisma.InputJsonValue;
      await ctx.prisma.externalResource.upsert({
        where: {
          connectorId_externalId: { connectorId: event.connectorId, externalId: event.eventId },
        },
        create: {
          connectorId: event.connectorId,
          externalId: event.eventId,
          type: 'CALENDAR_EVENT',
          status: 'ACTIVE',
          title,
          ownerEmail: event.organizerEmail,
          parentExternalId: 'primary',
          externalUpdatedAt: new Date(),
          organizationId: ctx.organizationId,
          metadata,
        },
        update: { title, externalUpdatedAt: new Date(), metadata },
      });
    }

    return ok(
      {
        eventId: event.eventId,
        htmlLink: event.htmlLink,
        meetUrl: event.meetUrl,
        start: event.start,
        url: event.htmlLink,
        shownIn: '/meetings',
      },
      [
        { level: 'info', message: `Created calendar event "${title}" for ${event.start}.` },
        ...(event.meetUrl
          ? [{ level: 'info' as const, message: `Google Meet: ${event.meetUrl}` }]
          : []),
        {
          level: event.meetUrl ? ('info' as const) : ('warn' as const),
          message: event.meetUrl
            ? 'Added to the Meetings tab; a notetaker bot will be scheduled automatically.'
            : 'No Google Meet link created, so it will not appear in the Meetings tab.',
        },
      ],
    );
  } catch (e) {
    if (e instanceof GoogleWriteError) return fail(e.message);
    return fail(`calendar.write failed: ${(e as Error).message}`);
  }
};

const emailDraft: ToolHandler = async (params, ctx) => {
  const to = list(params, 'to', 'recipients');
  const subject = str(params, 'subject', 'title') ?? `Re: ${ctx.goal.slice(0, 80)}`;
  let body = str(params, 'body', 'content', 'message');
  if (!body && ctx.llmAvailable) {
    const context = await gatherCompanyContext(ctx, `${subject}\n${ctx.request}`, 25);
    try {
      body = await ctx.llm.complete({
        system: [
          'You write detailed, persuasive, business-grade emails on behalf of the company — the calibre of a senior partner writing to a client or stakeholder.',
          'Ground the email in the COMPANY CONTEXT: reference the specific situation, findings and proposed resolution from it, with concrete details — never generic claims.',
          'Structure it well: a strong opening that frames the issue, the key findings/analysis, a clear proposed resolution, concrete next steps, and a confident close (add a short, persuasive P.S. when it strengthens the ask).',
          'Professional, specific, and compelling. No generic filler or AI boilerplate. Output only the email body.',
        ].join(' '),
        prompt:
          `Write the email for this request:\n${ctx.request}\n` +
          `Recipients: ${to.join(', ') || 'the intended recipient'}\nSubject: ${subject}\n\n` +
          `COMPANY CONTEXT (ground the email in this — reference specifics):\n` +
          `${context || '(no specific context matched; be explicit and avoid generic claims)'}`,
      });
    } catch {
      /* leave body null */
    }
  }
  body ??= str(params, 'description') ?? ctx.request;
  return ok({ to, subject, body, drafted: true }, [
    {
      level: 'info',
      message: `Drafted email "${subject}"${to.length ? ` to ${to.join(', ')}` : ''}.`,
    },
  ]);
};

const emailSend: ToolHandler = async (params, ctx) => {
  // Reuse an upstream email.draft output when this step doesn't carry fields.
  const prior = Object.values(ctx.priorOutputs).find(
    (o): o is { to?: string[]; subject?: string; body?: string } =>
      !!o && typeof o === 'object' && 'drafted' in (o as object),
  );
  const to = list(params, 'to', 'recipients');
  const recipients = to.length ? to : (prior?.to ?? []);
  const subject = str(params, 'subject') ?? prior?.subject ?? `Re: ${ctx.goal.slice(0, 80)}`;
  const body = str(params, 'body', 'content', 'message') ?? prior?.body ?? '';

  if (recipients.length === 0) return fail('email.send requires at least one recipient ("to").');
  try {
    const sent = await ctx.google().sendEmail({ to: recipients, subject, body });
    return ok({ messageId: sent.messageId, to: recipients, subject }, [
      {
        level: 'info',
        message: `Sent email "${subject}" to ${recipients.join(', ')} (id ${sent.messageId}).`,
      },
    ]);
  } catch (e) {
    if (e instanceof GoogleWriteError) return fail(e.message);
    return fail(`email.send failed: ${(e as Error).message}`);
  }
};

// ── Google Drive (real file saved to the user's Drive) ───────────────────────

const driveWrite: ToolHandler = async (params, ctx) => {
  const title = str(params, 'title', 'name', 'topic') ?? ctx.goal.slice(0, 120);
  const format = parseDocumentFormat(
    str(params, 'format', 'fileType', 'as', 'output'),
    /\bpdf\b/i.test(`${ctx.request} ${ctx.goal}`) ? 'pdf' : 'markdown',
  );
  let content = str(params, 'content', 'body');
  // Reuse a prior grounded/doc.generate output if this step doesn't carry content.
  if (!content) {
    const prior = Object.values(ctx.priorOutputs).find(
      (o): o is { content?: string } => !!o && typeof o === 'object' && 'content' in (o as object),
    );
    content = prior?.content ?? null;
  }
  if (!content) {
    const brief = str(params, 'prompt', 'instructions', 'description') ?? ctx.request;
    content = await generateGroundedDocument(ctx, title, brief);
  }
  content ??= `# ${title}\n\n${str(params, 'description') ?? ctx.request}\n`;

  try {
    // A PDF is uploaded as the finished file; Markdown is converted by Drive
    // into an editable Google Doc.
    const res =
      format === 'pdf'
        ? await ctx.google().uploadDriveBinary({
            title: `${title}.pdf`,
            bytes: await markdownToPdf(content, { title }),
            mimeType: 'application/pdf',
          })
        : await ctx.google().createDriveDocument({ title, content });
    return ok({ driveFileId: res.fileId, webViewLink: res.webViewLink, title, format, content }, [
      {
        level: 'info',
        message: `Saved "${title}" to Google Drive as ${format === 'pdf' ? 'a PDF' : 'a Google Doc'}${
          res.webViewLink ? ` — ${res.webViewLink}` : ''
        }.`,
      },
    ]);
  } catch (e) {
    if (e instanceof GoogleWriteError) return fail(e.message);
    return fail(`drive.write failed: ${(e as Error).message}`);
  }
};

// ── Browser (no driver in this environment — recorded honestly) ───────────────

const browserRecord: ToolHandler = async (params) =>
  ok({ recorded: true, params }, [
    {
      level: 'warn',
      message:
        'Browser automation needs a configured driver; recorded the intended action instead of executing it.',
    },
  ]);

// ── Registry ──────────────────────────────────────────────────────────────────

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  'task.create': taskCreate,
  'reminder.create': reminderCreate,
  'files.write': filesWrite,
  'files.read': filesRead,
  'doc.generate': docGenerate,
  'doc.pdf': docToPdf,
  'drive.write': driveWrite,
  'web.search': webSearch,
  'contacts.lookup': contactsLookup,
  'calendar.read': calendarRead,
  'calendar.write': calendarWrite,
  'email.draft': emailDraft,
  'email.send': emailSend,
  'browser.navigate': browserRecord,
  'browser.fill_form': browserRecord,
};

/** Fallback for a tool with no built-in handler: record the intent honestly. */
export const fallbackHandler: ToolHandler = async (params, ctx) =>
  ok({ recorded: true, note: 'No built-in handler for this tool; recorded intent.', params }, [
    {
      level: 'warn',
      message: `No built-in handler for this step; recorded intent for "${ctx.goal.slice(0, 60)}".`,
    },
  ]);
