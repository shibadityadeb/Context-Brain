import type {
  PermissionRole,
  PrincipalType,
  SyncedPermission,
  SyncedResource,
} from '@company-brain/connector-core';
import { GOOGLE_MIME } from './config.js';

// ── Raw Google payload shapes (only the fields we request) ──────

export interface GoogleDriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  parents?: string[];
  driveId?: string;
  size?: string;
  md5Checksum?: string;
  version?: string;
  createdTime?: string;
  modifiedTime?: string;
  trashed?: boolean;
  owners?: Array<{ emailAddress?: string }>;
  lastModifyingUser?: { emailAddress?: string };
  permissions?: GoogleDrivePermission[];
  headRevisionId?: string;
}

export interface GoogleDrivePermission {
  id?: string;
  type?: string; // user | group | domain | anyone
  emailAddress?: string;
  domain?: string;
  role?: string; // owner | organizer | fileOrganizer | writer | commenter | reader
}

export interface GoogleSharedDrive {
  id: string;
  name?: string;
  createdTime?: string;
}

export interface GmailMessageMeta {
  id: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  sizeEstimate?: number;
  historyId?: string;
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
    parts?: Array<{ filename?: string; mimeType?: string; body?: { size?: number } }>;
  };
}

export interface GoogleCalendarEntry {
  id: string;
  summary?: string;
  description?: string;
  timeZone?: string;
  primary?: boolean;
  accessRole?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  status?: string; // confirmed | tentative | cancelled
  summary?: string;
  htmlLink?: string;
  location?: string;
  hangoutLink?: string;
  created?: string;
  updated?: string;
  recurringEventId?: string;
  recurrence?: string[];
  organizer?: { email?: string };
  attendees?: Array<{ email?: string; responseStatus?: string; organizer?: boolean }>;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  conferenceData?: { entryPoints?: Array<{ uri?: string; entryPointType?: string }> };
}

// ── Mapping to platform resources ───────────────────────────────

export function resourceTypeForMime(mimeType: string | undefined): string {
  switch (mimeType) {
    case GOOGLE_MIME.doc:
      return 'GOOGLE_DOC';
    case GOOGLE_MIME.sheet:
      return 'GOOGLE_SHEET';
    case GOOGLE_MIME.slides:
      return 'GOOGLE_SLIDES';
    case GOOGLE_MIME.folder:
      return 'FOLDER';
    case GOOGLE_MIME.pdf:
      return 'PDF';
    default:
      return 'DRIVE_FILE';
  }
}

const ROLE_MAP: Record<string, PermissionRole> = {
  owner: 'OWNER',
  organizer: 'OWNER',
  fileOrganizer: 'EDITOR',
  writer: 'EDITOR',
  commenter: 'COMMENTER',
  reader: 'VIEWER',
};

export function mapPermission(p: GoogleDrivePermission): SyncedPermission | null {
  const role = ROLE_MAP[p.role ?? ''];
  if (!role) return null;
  const type = (p.type ?? 'user').toUpperCase();
  const principalType: PrincipalType =
    type === 'GROUP' || type === 'DOMAIN' || type === 'ANYONE' ? (type as PrincipalType) : 'USER';
  return {
    externalPermissionId: p.id,
    principalType,
    principalEmail: p.emailAddress ?? null,
    domain: p.domain ?? null,
    role,
  };
}

export function mapDriveFile(file: GoogleDriveFile): SyncedResource {
  return {
    externalId: file.id,
    type: resourceTypeForMime(file.mimeType),
    title: file.name ?? null,
    mimeType: file.mimeType ?? null,
    url: file.webViewLink ?? null,
    ownerEmail: file.owners?.[0]?.emailAddress ?? null,
    parentExternalId: file.parents?.[0] ?? null,
    driveId: file.driveId ?? null,
    sizeBytes: file.size ? Number(file.size) : null,
    checksum: file.md5Checksum ?? null,
    version: file.headRevisionId ?? file.version ?? null,
    externalCreatedAt: file.createdTime ?? null,
    externalUpdatedAt: file.modifiedTime ?? null,
    trashed: file.trashed ?? false,
    permissions: (file.permissions ?? [])
      .map(mapPermission)
      .filter((p): p is SyncedPermission => p !== null),
    metadata: {
      lastModifiedBy: file.lastModifyingUser?.emailAddress,
    },
  };
}

export function mapSharedDrive(drive: GoogleSharedDrive): SyncedResource {
  return {
    externalId: drive.id,
    type: 'SHARED_DRIVE',
    title: drive.name ?? null,
    url: `https://drive.google.com/drive/folders/${drive.id}`,
    externalCreatedAt: drive.createdTime ?? null,
    metadata: {},
  };
}

function header(message: GmailMessageMeta, name: string): string | undefined {
  return message.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;
}

export function mapGmailMessage(message: GmailMessageMeta): SyncedResource {
  const attachments = (message.payload?.parts ?? [])
    .filter((part) => part.filename)
    .map((part) => ({
      filename: part.filename,
      mimeType: part.mimeType,
      sizeBytes: part.body?.size,
    }));
  const internal = message.internalDate ? new Date(Number(message.internalDate)) : null;
  return {
    externalId: message.id,
    type: 'EMAIL',
    title: header(message, 'Subject') ?? '(no subject)',
    url: `https://mail.google.com/mail/u/0/#all/${message.id}`,
    ownerEmail: header(message, 'From') ?? null,
    parentExternalId: message.threadId ?? null,
    sizeBytes: message.sizeEstimate ?? null,
    version: message.historyId ?? null,
    externalCreatedAt: internal?.toISOString() ?? null,
    externalUpdatedAt: internal?.toISOString() ?? null,
    metadata: {
      threadId: message.threadId,
      labels: message.labelIds ?? [],
      from: header(message, 'From'),
      to: header(message, 'To'),
      cc: header(message, 'Cc'),
      date: header(message, 'Date'),
      messageIdHeader: header(message, 'Message-ID'),
      attachments,
    },
  };
}

export function mapCalendar(calendar: GoogleCalendarEntry): SyncedResource {
  return {
    externalId: calendar.id,
    type: 'CALENDAR',
    title: calendar.summary ?? calendar.id,
    metadata: {
      description: calendar.description,
      timeZone: calendar.timeZone,
      primary: calendar.primary ?? false,
      accessRole: calendar.accessRole,
    },
  };
}

export function mapCalendarEvent(event: GoogleCalendarEvent, calendarId: string): SyncedResource {
  const meetingLink =
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;
  return {
    externalId: `${calendarId}:${event.id}`,
    type: 'CALENDAR_EVENT',
    title: event.summary ?? '(no title)',
    url: event.htmlLink ?? null,
    ownerEmail: event.organizer?.email ?? null,
    parentExternalId: calendarId,
    externalCreatedAt: event.created ?? null,
    externalUpdatedAt: event.updated ?? null,
    trashed: event.status === 'cancelled',
    metadata: {
      status: event.status,
      location: event.location,
      meetingLink,
      start: event.start?.dateTime ?? event.start?.date,
      end: event.end?.dateTime ?? event.end?.date,
      recurringEventId: event.recurringEventId,
      recurrence: event.recurrence,
      attendees: (event.attendees ?? []).map((a) => ({
        email: a.email,
        responseStatus: a.responseStatus,
        organizer: a.organizer ?? false,
      })),
    },
  };
}
