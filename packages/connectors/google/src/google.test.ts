import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CursorExpiredError,
  RateLimitError,
  TokenExpiredError,
  type ConnectorContext,
} from '@company-brain/connector-core';
import {
  mapCalendarEvent,
  mapDriveFile,
  mapGmailMessage,
  mapPermission,
  resourceTypeForMime,
} from './mappers.js';
import { googleGet } from './http.js';
import { GoogleWorkspaceConnector } from './connector.js';
import { driveSyncPage } from './services/drive.js';

const ctx: ConnectorContext = {
  connectorId: 'c1',
  organizationId: 'o1',
  getAccessToken: async () => 'test-access-token',
};

function mockFetchOnce(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('resource type mapping', () => {
  it('maps Google mime types to platform types', () => {
    expect(resourceTypeForMime('application/vnd.google-apps.document')).toBe('GOOGLE_DOC');
    expect(resourceTypeForMime('application/vnd.google-apps.spreadsheet')).toBe('GOOGLE_SHEET');
    expect(resourceTypeForMime('application/vnd.google-apps.presentation')).toBe('GOOGLE_SLIDES');
    expect(resourceTypeForMime('application/vnd.google-apps.folder')).toBe('FOLDER');
    expect(resourceTypeForMime('application/pdf')).toBe('PDF');
    expect(resourceTypeForMime('image/png')).toBe('DRIVE_FILE');
  });
});

describe('drive file mapper', () => {
  it('maps a full drive file with permissions', () => {
    const resource = mapDriveFile({
      id: 'f1',
      name: 'Q3 Plan',
      mimeType: 'application/vnd.google-apps.document',
      webViewLink: 'https://docs.google.com/document/d/f1',
      parents: ['folder9'],
      version: '42',
      headRevisionId: 'rev-9',
      createdTime: '2026-01-01T00:00:00Z',
      modifiedTime: '2026-06-01T00:00:00Z',
      owners: [{ emailAddress: 'ada@acme.test' }],
      permissions: [
        { id: 'p1', type: 'user', emailAddress: 'ada@acme.test', role: 'owner' },
        { id: 'p2', type: 'domain', domain: 'acme.test', role: 'reader' },
        { id: 'p3', type: 'user', emailAddress: 'bob@acme.test', role: 'writer' },
      ],
    });
    expect(resource).toMatchObject({
      externalId: 'f1',
      type: 'GOOGLE_DOC',
      title: 'Q3 Plan',
      ownerEmail: 'ada@acme.test',
      parentExternalId: 'folder9',
      version: 'rev-9',
    });
    expect(resource.permissions).toHaveLength(3);
    expect(resource.permissions![0]).toMatchObject({ role: 'OWNER', principalType: 'USER' });
    expect(resource.permissions![1]).toMatchObject({ role: 'VIEWER', principalType: 'DOMAIN' });
    expect(resource.permissions![2]).toMatchObject({ role: 'EDITOR' });
  });

  it('drops unknown permission roles', () => {
    expect(mapPermission({ role: 'published_reader' })).toBeNull();
  });
});

describe('gmail mapper', () => {
  it('extracts headers, labels and attachment metadata', () => {
    const resource = mapGmailMessage({
      id: 'm1',
      threadId: 't1',
      labelIds: ['INBOX', 'IMPORTANT'],
      internalDate: '1770000000000',
      sizeEstimate: 2048,
      historyId: 'h77',
      payload: {
        headers: [
          { name: 'Subject', value: 'Quarterly numbers' },
          { name: 'From', value: 'cfo@acme.test' },
          { name: 'To', value: 'team@acme.test' },
        ],
        parts: [{ filename: 'report.pdf', mimeType: 'application/pdf', body: { size: 9000 } }],
      },
    });
    expect(resource).toMatchObject({
      externalId: 'm1',
      type: 'EMAIL',
      title: 'Quarterly numbers',
      ownerEmail: 'cfo@acme.test',
      parentExternalId: 't1',
      version: 'h77',
    });
    const meta = resource.metadata as { labels: string[]; attachments: unknown[] };
    expect(meta.labels).toContain('INBOX');
    expect(meta.attachments).toHaveLength(1);
  });
});

describe('calendar event mapper', () => {
  it('maps attendees, meeting link and cancellation', () => {
    const resource = mapCalendarEvent(
      {
        id: 'e1',
        status: 'cancelled',
        summary: 'Weekly sync',
        hangoutLink: 'https://meet.google.com/xyz',
        organizer: { email: 'pm@acme.test' },
        attendees: [{ email: 'dev@acme.test', responseStatus: 'accepted' }],
        start: { dateTime: '2026-07-15T10:00:00Z' },
        end: { dateTime: '2026-07-15T10:30:00Z' },
        recurringEventId: 'recur-1',
      },
      'primary',
    );
    expect(resource).toMatchObject({
      externalId: 'primary:e1',
      type: 'CALENDAR_EVENT',
      parentExternalId: 'primary',
      trashed: true, // cancelled
      ownerEmail: 'pm@acme.test',
    });
    const meta = resource.metadata as { meetingLink: string; attendees: unknown[] };
    expect(meta.meetingLink).toBe('https://meet.google.com/xyz');
    expect(meta.attendees).toHaveLength(1);
  });
});

describe('google HTTP error mapping', () => {
  it('maps 401 to TokenExpiredError', async () => {
    mockFetchOnce(401, { error: { message: 'Invalid Credentials' } });
    await expect(googleGet(ctx, 'https://example.googleapis.com/x')).rejects.toBeInstanceOf(
      TokenExpiredError,
    );
  });

  it('maps 429 to RateLimitError with retry-after', async () => {
    mockFetchOnce(429, { error: { message: 'Rate limit' } }, { 'retry-after': '7' });
    const error = await googleGet(ctx, 'https://example.googleapis.com/x').catch((e) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterMs).toBe(7000);
  });

  it('maps 410 to CursorExpiredError (expired sync tokens)', async () => {
    mockFetchOnce(410, { error: { message: 'Sync token is no longer valid' } });
    await expect(googleGet(ctx, 'https://example.googleapis.com/x')).rejects.toBeInstanceOf(
      CursorExpiredError,
    );
  });

  it('sends the bearer token and query params', async () => {
    const spy = mockFetchOnce(200, { ok: true });
    await googleGet(ctx, 'https://example.googleapis.com/x', { pageSize: 5 });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toContain('pageSize=5');
    expect((init!.headers as Record<string, string>).authorization).toBe(
      'Bearer test-access-token',
    );
  });
});

describe('drive full sync paging (mocked API)', () => {
  it('walks shared drives, then files, then returns the change cursor', async () => {
    // Page 1: shared drives.
    mockFetchOnce(200, { drives: [{ id: 'sd1', name: 'Team Drive' }] });
    const page1 = await driveSyncPage(ctx, null);
    expect(page1.resources[0]).toMatchObject({ externalId: 'sd1', type: 'SHARED_DRIVE' });
    expect(page1.nextPageCursor).toBe('files|');

    // Page 2: files with a next page token.
    mockFetchOnce(200, {
      files: [{ id: 'f1', name: 'Doc', mimeType: 'application/vnd.google-apps.document' }],
      nextPageToken: 'tok2',
    });
    const page2 = await driveSyncPage(ctx, page1.nextPageCursor);
    expect(page2.resources[0]!.externalId).toBe('f1');
    expect(page2.nextPageCursor).toBe('files|tok2');

    // Page 3: last file page → startPageToken fetched for incremental sync.
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(new Response(JSON.stringify({ files: [] }), { status: 200 }));
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ startPageToken: 'start-42' }), { status: 200 }),
    );
    const page3 = await driveSyncPage(ctx, page2.nextPageCursor);
    expect(page3.nextPageCursor).toBeNull();
    expect(page3.incrementalCursor).toBe('start-42');
  });
});

describe('connector descriptor', () => {
  it('declares least-privilege scopes and all services', () => {
    const connector = new GoogleWorkspaceConnector();
    expect(connector.descriptor.provider).toBe('google-workspace');
    expect(connector.descriptor.scopes).toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(connector.descriptor.scopes.every((s) => !s.includes('write'))).toBe(true);
    expect(connector.descriptor.services).toEqual(
      expect.arrayContaining(['drive', 'docs', 'sheets', 'slides', 'gmail', 'calendar']),
    );
  });
});
