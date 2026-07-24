import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { decryptSecret, refreshAccessToken } from '@company-brain/auth';
import { GOOGLE_WRITE_SCOPES } from '@company-brain/connector-google';
import { connectorEncryptionKey, googleOAuthConfig } from '../../connectors/google-oauth.js';

/**
 * Real Google side effects for the Action Layer — create Calendar events (with
 * Meet links) and send Gmail. It resolves the acting user's own Google
 * connector, decrypts + refreshes their OAuth credential, and calls the Google
 * REST APIs directly. Requires the write scopes (calendar.events / gmail.send),
 * so if the user connected before those were requested it raises a clear
 * "reconnect Google" error rather than failing opaquely.
 */
export class GoogleWriteError extends Error {}

interface CalendarEventInput {
  title: string;
  description?: string;
  start: string; // ISO
  end?: string; // ISO
  attendees?: string[];
  timeZone?: string;
  withMeet?: boolean;
}

interface EmailInput {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}

export class GoogleActionClient {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly organizationId: string,
    private readonly userId: string,
  ) {}

  /** Create a real Calendar event on the user's primary calendar. */
  async createCalendarEvent(input: CalendarEventInput): Promise<{
    eventId: string;
    htmlLink: string | null;
    meetUrl: string | null;
    start: string;
    end: string;
    /** The user's Google connector — used to register the event locally. */
    connectorId: string;
    organizerEmail: string | null;
  }> {
    const { accessToken, connectorId, email } = await this.authorize(
      GOOGLE_WRITE_SCOPES.calendar,
      'calendar',
    );

    const end = input.end ?? new Date(new Date(input.start).getTime() + 30 * 60_000).toISOString();
    const body: Record<string, unknown> = {
      summary: input.title,
      description: input.description,
      start: { dateTime: input.start, timeZone: input.timeZone ?? 'UTC' },
      end: { dateTime: end, timeZone: input.timeZone ?? 'UTC' },
      attendees: (input.attendees ?? []).map((email) => ({ email })),
    };
    if (input.withMeet !== false) {
      body.conferenceData = {
        createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
      };
    }

    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      htmlLink?: string;
      hangoutLink?: string;
      start?: { dateTime?: string };
      end?: { dateTime?: string };
      error?: { message?: string };
    };
    if (!res.ok || !json.id) {
      throw new GoogleWriteError(json.error?.message ?? `Calendar API error ${res.status}`);
    }
    return {
      eventId: json.id,
      htmlLink: json.htmlLink ?? null,
      meetUrl: json.hangoutLink ?? null,
      start: json.start?.dateTime ?? input.start,
      end: json.end?.dateTime ?? end,
      connectorId,
      organizerEmail: email,
    };
  }

  /** Send a real email as the user via Gmail. */
  async sendEmail(input: EmailInput): Promise<{ messageId: string; threadId: string | null }> {
    const { accessToken, email } = await this.authorize(GOOGLE_WRITE_SCOPES.gmailSend, 'gmail');

    const headers = [
      `From: ${email ?? 'me'}`,
      `To: ${input.to.join(', ')}`,
      ...(input.cc?.length ? [`Cc: ${input.cc.join(', ')}`] : []),
      `Subject: ${input.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
    ].join('\r\n');
    const raw = Buffer.from(`${headers}\r\n\r\n${input.body}`).toString('base64url');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      threadId?: string;
      error?: { message?: string };
    };
    if (!res.ok || !json.id) {
      throw new GoogleWriteError(json.error?.message ?? `Gmail API error ${res.status}`);
    }
    return { messageId: json.id, threadId: json.threadId ?? null };
  }

  /**
   * Resolve the acting user's Google credential, verify it carries the required
   * write scope, and mint a fresh access token from the stored refresh token.
   */
  private async authorize(
    requiredScope: string,
    label: 'calendar' | 'gmail',
  ): Promise<{ accessToken: string; email: string | null; connectorId: string }> {
    const credential = await this.prisma.oAuthCredential.findFirst({
      where: {
        organizationId: this.organizationId,
        status: 'ACTIVE',
        deletedAt: null,
        connector: {
          is: { provider: 'GOOGLE_WORKSPACE', ownerId: this.userId, deletedAt: null },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!credential) {
      throw new GoogleWriteError(
        'No connected Google account for you. Connect Google under Integrations first.',
      );
    }
    if (!credential.scopes.includes(requiredScope)) {
      throw new GoogleWriteError(
        `Your Google connection lacks ${label} write access. Reconnect Google under Integrations to grant it.`,
      );
    }

    const refreshToken = decryptSecret(credential.encryptedRefreshToken, connectorEncryptionKey());
    const token = await refreshAccessToken(googleOAuthConfig(), refreshToken);
    return {
      accessToken: token.accessToken,
      email: credential.userEmail,
      connectorId: credential.connectorId,
    };
  }
}
