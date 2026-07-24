import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, normalize, resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import { createWebSearchProvider } from '@company-brain/retrieval';
import { config } from '../../../config/index.js';
import { GoogleWriteError } from './google-client.js';
import { fail, ok, type ToolContext, type ToolHandler, type ToolResult } from './types.js';

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
  if (!path) return fail('files.read requires a "path" parameter');
  try {
    const target = safeWorkspacePath(ctx.workspaceDir, path);
    const content = await readFile(target, 'utf8');
    return ok({ path, bytes: Buffer.byteLength(content), content: content.slice(0, 20_000) }, [
      { level: 'info', message: `Read ${Buffer.byteLength(content)} bytes from ${path}` },
    ]);
  } catch (e) {
    return fail(`files.read failed: ${(e as Error).message}`);
  }
};

// ── Document generation (real Document stored + shown under Documents) ─────────

const docGenerate: ToolHandler = async (params, ctx) => {
  const title = str(params, 'title', 'topic', 'name') ?? ctx.goal.slice(0, 120);
  let content = str(params, 'content', 'body');

  if (!content && ctx.llmAvailable) {
    const brief = str(params, 'prompt', 'instructions', 'description') ?? ctx.request;
    try {
      content = await ctx.llm.complete({
        system:
          'You are a professional writer. Produce a well-structured Markdown document. Output only the document.',
        prompt: `Title: ${title}\n\nWrite the document for this request:\n${brief}`,
      });
    } catch {
      /* fall through to a stub below */
    }
  }
  content ??= `# ${title}\n\n${str(params, 'description') ?? ctx.request}\n`;

  const documentId = randomUUID();
  const fileName = `${slug(title)}.md`;
  const buffer = Buffer.from(content, 'utf8');
  const storageKey = `documents/${ctx.organizationId}/${documentId}/v1/${fileName}`;
  const checksum = createHash('sha256').update(buffer).digest('hex');

  try {
    await ctx.storage.upload(storageKey, buffer, { contentType: 'text/markdown' });
    await ctx.prisma.document.create({
      data: {
        id: documentId,
        title,
        description: 'Generated by the Action Layer',
        fileName,
        mimeType: 'text/markdown',
        fileSizeBytes: buffer.length,
        storageBucket: 'company-brain',
        storageKey,
        checksum,
        status: 'READY',
        currentVersion: 1,
        organizationId: ctx.organizationId,
        ownerId: ctx.userId,
        metadata: { generatedByAction: ctx.actionId } as Prisma.InputJsonValue,
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
    return ok(
      {
        documentId,
        title,
        fileName,
        bytes: buffer.length,
        url: `/knowledge/documents/${documentId}`,
      },
      [
        {
          level: 'info',
          message: `Generated document "${title}" (${buffer.length} bytes) — available under Documents.`,
        },
      ],
    );
  } catch (e) {
    return fail(`doc.generate failed to store the document: ${(e as Error).message}`);
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
    try {
      body = await ctx.llm.complete({
        system: 'You write concise, professional emails. Output only the email body.',
        prompt: `Write an email for: ${ctx.request}\nRecipients: ${to.join(', ') || 'the meeting attendees'}\nSubject: ${subject}`,
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
