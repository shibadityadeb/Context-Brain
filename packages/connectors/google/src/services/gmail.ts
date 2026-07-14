import type {
  ConnectorContext,
  IncrementalSyncResult,
  ResourceChange,
  SyncPage,
} from '@company-brain/connector-core';
import { googleGet } from '../http.js';
import { mapGmailMessage, type GmailMessageMeta } from '../mappers.js';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const METADATA_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID'];

interface MessageListResponse {
  messages?: Array<{ id: string; threadId?: string }>;
  nextPageToken?: string;
}
interface HistoryResponse {
  history?: Array<{
    messagesAdded?: Array<{ message?: { id?: string } }>;
    messagesDeleted?: Array<{ message?: { id?: string } }>;
    labelsAdded?: Array<{ message?: { id?: string } }>;
    labelsRemoved?: Array<{ message?: { id?: string } }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
}

async function getMessageMeta(ctx: ConnectorContext, id: string): Promise<GmailMessageMeta> {
  const params = new URLSearchParams({ format: 'metadata' });
  for (const h of METADATA_HEADERS) params.append('metadataHeaders', h);
  return googleGet<GmailMessageMeta>(ctx, `${GMAIL}/messages/${id}?${params.toString()}`);
}

/** Full sync: pages of message metadata (never bodies). */
export async function gmailSyncPage(
  ctx: ConnectorContext,
  pageCursor?: string | null,
): Promise<SyncPage> {
  const list = await googleGet<MessageListResponse>(ctx, `${GMAIL}/messages`, {
    maxResults: 50,
    pageToken: pageCursor || undefined,
  });

  const resources = [];
  for (const stub of list.messages ?? []) {
    resources.push(mapGmailMessage(await getMessageMeta(ctx, stub.id)));
  }

  if (list.nextPageToken) {
    return { resources, nextPageCursor: list.nextPageToken };
  }
  // Anchor incremental sync at the mailbox's current historyId.
  const profile = await googleGet<{ historyId?: string }>(ctx, `${GMAIL}/profile`);
  return { resources, nextPageCursor: null, incrementalCursor: profile.historyId ?? null };
}

/** Incremental sync via the Gmail History API (historyId cursor). */
export async function gmailIncrementalSync(
  ctx: ConnectorContext,
  cursor: string,
): Promise<IncrementalSyncResult> {
  const changes: ResourceChange[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId = cursor;

  for (let page = 0; page < 10; page += 1) {
    const response = await googleGet<HistoryResponse>(ctx, `${GMAIL}/history`, {
      startHistoryId: cursor,
      pageToken,
      maxResults: 100,
    });
    if (response.historyId) latestHistoryId = response.historyId;

    for (const entry of response.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const id = added.message?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        try {
          changes.push({
            externalId: id,
            service: 'gmail',
            changeType: 'created',
            resource: mapGmailMessage(await getMessageMeta(ctx, id)),
          });
        } catch {
          // Message may already be gone (spam purge) — skip.
        }
      }
      for (const deleted of entry.messagesDeleted ?? []) {
        const id = deleted.message?.id;
        if (!id || seen.has(`del:${id}`)) continue;
        seen.add(`del:${id}`);
        changes.push({ externalId: id, service: 'gmail', changeType: 'deleted' });
      }
      for (const relabeled of [...(entry.labelsAdded ?? []), ...(entry.labelsRemoved ?? [])]) {
        const id = relabeled.message?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        try {
          changes.push({
            externalId: id,
            service: 'gmail',
            changeType: 'updated',
            resource: mapGmailMessage(await getMessageMeta(ctx, id)),
          });
        } catch {
          // ignore vanished messages
        }
      }
    }
    if (!response.nextPageToken) break;
    pageToken = response.nextPageToken;
  }

  return { changes, nextCursor: latestHistoryId };
}
