import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDescriptor,
  type DiscoveryResult,
  type HealthResult,
  type IncrementalSyncResult,
  type ResourceContent,
  type SyncPage,
} from '@company-brain/connector-core';
import { GOOGLE_MIME, GOOGLE_PROVIDER, GOOGLE_SCOPES, GOOGLE_SERVICES } from './config.js';
import { googleGet } from './http.js';
import {
  driveAbout,
  driveFetchContent,
  driveIncrementalSync,
  driveSyncPage,
} from './services/drive.js';
import { gmailIncrementalSync, gmailSyncPage } from './services/gmail.js';
import { calendarIncrementalSync, calendarSyncPage } from './services/calendar.js';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

interface WorksheetProps {
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
      gridProperties?: { rowCount?: number; columnCount?: number };
    };
  }>;
}

/**
 * Google Workspace connector: Drive, Docs, Sheets, Slides, Gmail and
 * Calendar metadata synchronization over least-privilege read-only scopes.
 *
 * Sync model:
 * - drive        → shared drives + all files (with permissions), Changes API cursor
 * - docs/sheets/slides → mime-filtered Drive views (Sheets enriched with
 *                  worksheet metadata); share the drive change feed
 * - gmail        → message metadata, History API cursor
 * - calendar     → calendars + events, per-calendar syncToken cursor
 * - permissions  → permission-bearing file pages from Drive
 */
export class GoogleWorkspaceConnector extends BaseConnector {
  readonly descriptor: ConnectorDescriptor = {
    provider: GOOGLE_PROVIDER,
    displayName: 'Google Workspace',
    authType: 'oauth2',
    scopes: [...GOOGLE_SCOPES],
    services: [...GOOGLE_SERVICES],
  };

  async validate(ctx: ConnectorContext): Promise<boolean> {
    try {
      await googleGet(ctx, 'https://openidconnect.googleapis.com/v1/userinfo');
      return true;
    } catch {
      return false;
    }
  }

  async discover(ctx: ConnectorContext): Promise<DiscoveryResult> {
    const identity = await driveAbout(ctx);
    const services: DiscoveryResult['services'] = {};

    const probes: Array<[string, () => Promise<unknown>]> = [
      [
        'drive',
        () => googleGet(ctx, 'https://www.googleapis.com/drive/v3/about', { fields: 'user' }),
      ],
      ['gmail', () => googleGet(ctx, 'https://gmail.googleapis.com/gmail/v1/users/me/profile')],
      [
        'calendar',
        () =>
          googleGet(ctx, 'https://www.googleapis.com/calendar/v3/users/me/calendarList', {
            maxResults: 1,
          }),
      ],
    ];
    for (const [service, probe] of probes) {
      try {
        await probe();
        services[service] = { available: true };
      } catch (error) {
        services[service] = { available: false, detail: (error as Error).message };
      }
    }
    // Docs/Sheets/Slides/permissions ride on Drive access.
    for (const derived of ['docs', 'sheets', 'slides', 'permissions']) {
      services[derived] = services.drive ?? { available: false };
    }

    return {
      workspace: {
        externalId: identity.email,
        domain: identity.domain,
        name: identity.domain ? `Google Workspace (${identity.domain})` : 'Google Workspace',
        adminEmail: identity.email,
        metadata: { displayName: identity.name },
      },
      services,
    };
  }

  override async health(ctx: ConnectorContext): Promise<HealthResult> {
    const discovery = await this.discover(ctx).catch(() => null);
    if (!discovery) {
      return {
        healthy: false,
        services: Object.fromEntries(this.descriptor.services.map((s) => [s, 'unauthorized'])),
        checkedAt: new Date().toISOString(),
      };
    }
    const services = Object.fromEntries(
      this.descriptor.services.map((s) => [
        s,
        discovery.services[s]?.available ? ('up' as const) : ('down' as const),
      ]),
    );
    return {
      healthy: Object.values(services).every((s) => s === 'up'),
      services,
      checkedAt: new Date().toISOString(),
    };
  }

  async sync(
    ctx: ConnectorContext,
    service: string,
    pageCursor?: string | null,
  ): Promise<SyncPage> {
    switch (service) {
      case 'drive':
        return driveSyncPage(ctx, pageCursor);
      case 'docs':
        return driveSyncPage(ctx, pageCursor ?? 'files|', GOOGLE_MIME.doc);
      case 'slides':
        return driveSyncPage(ctx, pageCursor ?? 'files|', GOOGLE_MIME.slides);
      case 'permissions':
        // Permission data rides on the file pages themselves.
        return driveSyncPage(ctx, pageCursor ?? 'files|');
      case 'sheets': {
        const page = await driveSyncPage(ctx, pageCursor ?? 'files|', GOOGLE_MIME.sheet);
        // Enrich with worksheet structure (metadata only).
        for (const resource of page.resources) {
          try {
            const detail = await googleGet<WorksheetProps>(
              ctx,
              `${SHEETS_API}/${resource.externalId}`,
              { fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))' },
            );
            resource.metadata = {
              ...resource.metadata,
              worksheets: (detail.sheets ?? []).map((s) => ({
                id: s.properties?.sheetId,
                title: s.properties?.title,
                rows: s.properties?.gridProperties?.rowCount,
                columns: s.properties?.gridProperties?.columnCount,
              })),
            };
          } catch {
            // Worksheet enrichment is best-effort; Drive metadata stands.
          }
        }
        return page;
      }
      case 'gmail':
        return gmailSyncPage(ctx, pageCursor);
      case 'calendar':
        return calendarSyncPage(ctx, pageCursor);
      default:
        throw new Error(`Unknown Google service: ${service}`);
    }
  }

  async incrementalSync(
    ctx: ConnectorContext,
    service: string,
    cursor: string,
  ): Promise<IncrementalSyncResult> {
    switch (service) {
      case 'drive':
      case 'docs':
      case 'sheets':
      case 'slides':
      case 'permissions':
        // One Drive change feed covers every drive-derived view.
        return driveIncrementalSync(ctx, cursor);
      case 'gmail':
        return gmailIncrementalSync(ctx, cursor);
      case 'calendar':
        return calendarIncrementalSync(ctx, cursor);
      default:
        throw new Error(`Unknown Google service: ${service}`);
    }
  }

  /** Content export for knowledge ingestion — Drive-backed resources only. */
  async fetchContent(
    ctx: ConnectorContext,
    resource: { externalId: string; type: string; mimeType?: string | null; title?: string | null },
  ): Promise<ResourceContent | null> {
    switch (resource.type) {
      case 'GOOGLE_DOC':
      case 'GOOGLE_SHEET':
      case 'GOOGLE_SLIDES':
      case 'PDF':
      case 'DRIVE_FILE':
        return driveFetchContent(ctx, resource);
      default:
        return null;
    }
  }
}
