/** Google Workspace OAuth + service configuration. Least privilege only. */

export const GOOGLE_PROVIDER = 'google-workspace';

export const GOOGLE_OAUTH_ENDPOINTS = {
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revocationUrl: 'https://oauth2.googleapis.com/revoke',
} as const;

/**
 * Read-only, least-privilege scopes. Additional scopes are requested
 * incrementally (include_granted_scopes) only when a service needs them.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/presentations.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  // Write scopes for the Action Layer — the Brain can create calendar events
  // (incl. Meet links) and send email once the user re-consents. Still
  // least-privilege: calendar.events (not full calendar) and gmail.send (send
  // only, no read of the whole mailbox beyond the readonly scope above).
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

/** The subset of scopes required to perform Action-Layer side effects. */
export const GOOGLE_WRITE_SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar.events',
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
} as const;

/**
 * Offline access (refresh token) + forced consent so a refresh token is
 * issued on every connect, + incremental authorization.
 */
export const GOOGLE_AUTH_PARAMS = {
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: 'true',
} as const;

export const GOOGLE_SERVICES = [
  'drive',
  'docs',
  'sheets',
  'slides',
  'gmail',
  'calendar',
  'permissions',
] as const;
export type GoogleService = (typeof GOOGLE_SERVICES)[number];

export const GOOGLE_MIME = {
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
  slides: 'application/vnd.google-apps.presentation',
  folder: 'application/vnd.google-apps.folder',
  pdf: 'application/pdf',
} as const;
