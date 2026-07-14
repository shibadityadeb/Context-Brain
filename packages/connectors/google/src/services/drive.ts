import type {
  ConnectorContext,
  IncrementalSyncResult,
  ResourceChange,
  SyncPage,
} from '@company-brain/connector-core';
import { googleGet } from '../http.js';
import {
  mapDriveFile,
  mapSharedDrive,
  type GoogleDriveFile,
  type GoogleSharedDrive,
} from '../mappers.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const FILE_FIELDS =
  'id,name,mimeType,webViewLink,parents,driveId,size,md5Checksum,version,headRevisionId,createdTime,modifiedTime,trashed,owners(emailAddress),lastModifyingUser(emailAddress),permissions(id,type,emailAddress,domain,role)';

interface FileListResponse {
  files?: GoogleDriveFile[];
  nextPageToken?: string;
}
interface DriveListResponse {
  drives?: GoogleSharedDrive[];
  nextPageToken?: string;
}
interface StartPageTokenResponse {
  startPageToken: string;
}
interface ChangesResponse {
  changes?: Array<{
    fileId?: string;
    removed?: boolean;
    time?: string;
    file?: GoogleDriveFile;
  }>;
  nextPageToken?: string;
  newStartPageToken?: string;
}

/**
 * Full-sync page cursor: `drives` page(s) first, then `files` pages.
 * Encoded as `<phase>:<pageToken>` so a single opaque string round-trips
 * through the SyncCursor table.
 */
export async function driveSyncPage(
  ctx: ConnectorContext,
  pageCursor?: string | null,
  mimeFilter?: string,
): Promise<SyncPage> {
  const [phase, token] = pageCursor ? pageCursor.split('|', 2) : ['drives', ''];

  if (phase === 'drives' && !mimeFilter) {
    const response = await googleGet<DriveListResponse>(ctx, `${DRIVE}/drives`, {
      pageSize: 100,
      pageToken: token || undefined,
    });
    const resources = (response.drives ?? []).map(mapSharedDrive);
    return {
      resources,
      nextPageCursor: response.nextPageToken ? `drives|${response.nextPageToken}` : 'files|',
    };
  }

  const response = await googleGet<FileListResponse>(ctx, `${DRIVE}/files`, {
    pageSize: 100,
    pageToken: token || undefined,
    fields: `nextPageToken, files(${FILE_FIELDS})`,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: mimeFilter ? `mimeType='${mimeFilter}' and trashed=false` : 'trashed=false',
  });
  const resources = (response.files ?? []).map(mapDriveFile);

  if (response.nextPageToken) {
    return { resources, nextPageCursor: `files|${response.nextPageToken}` };
  }
  // Last page: hand back the change-feed anchor for incremental sync.
  const start = await googleGet<StartPageTokenResponse>(ctx, `${DRIVE}/changes/startPageToken`, {
    supportsAllDrives: true,
  });
  return { resources, nextPageCursor: null, incrementalCursor: start.startPageToken };
}

/** Incremental sync via the Drive Changes API. */
export async function driveIncrementalSync(
  ctx: ConnectorContext,
  cursor: string,
): Promise<IncrementalSyncResult> {
  const changes: ResourceChange[] = [];
  let pageToken = cursor;
  let newStartPageToken = cursor;

  for (let page = 0; page < 20; page += 1) {
    const response = await googleGet<ChangesResponse>(ctx, `${DRIVE}/changes`, {
      pageToken,
      pageSize: 100,
      fields: `nextPageToken,newStartPageToken,changes(fileId,removed,time,file(${FILE_FIELDS}))`,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    for (const change of response.changes ?? []) {
      if (!change.fileId) continue;
      if (change.removed || change.file?.trashed) {
        changes.push({
          externalId: change.fileId,
          service: 'drive',
          changeType: 'deleted',
          occurredAt: change.time,
        });
      } else if (change.file) {
        changes.push({
          externalId: change.fileId,
          service: 'drive',
          changeType: 'updated',
          resource: mapDriveFile(change.file),
          occurredAt: change.time,
        });
      }
    }
    if (response.newStartPageToken) newStartPageToken = response.newStartPageToken;
    if (!response.nextPageToken) break;
    pageToken = response.nextPageToken;
  }

  return { changes, nextCursor: newStartPageToken };
}

/** Drive "about" — identifies the account/workspace behind the grant. */
export async function driveAbout(ctx: ConnectorContext): Promise<{
  email: string | null;
  domain: string | null;
  name: string | null;
}> {
  const about = await googleGet<{ user?: { emailAddress?: string; displayName?: string } }>(
    ctx,
    `${DRIVE}/about`,
    { fields: 'user(emailAddress,displayName)' },
  );
  const email = about.user?.emailAddress ?? null;
  return {
    email,
    domain: email?.includes('@') ? email.split('@')[1]! : null,
    name: about.user?.displayName ?? null,
  };
}
