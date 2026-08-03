import type { PrismaClient } from '@prisma/client';

/**
 * "Internal directory" — the set of people who belong to the organization,
 * derived from company-domain identities. There's no internal/external flag on
 * knowledge entities, so we build the directory from the signals that DO carry
 * emails — synced Gmail (from/to), Calendar attendees, and the org's own
 * accounts — keep only addresses on a company domain, and match extracted
 * PERSON/TEAM nodes against it by name. This powers the People tab's
 * "team members only" view (excludes customers/partners/contacts).
 *
 * Cached per organization (short TTL) so the People list doesn't rescan the
 * mailbox on every request.
 */

export interface InternalDirectory {
  /** Company email domains (e.g. "gotoretreats.com"). */
  domains: Set<string>;
  /** Normalized full display names seen on company-domain addresses. */
  names: Set<string>;
  /** Name tokens (email local-parts + first names) for first-name matching. */
  tokens: Set<string>;
}

const TTL_MS = 5 * 60_000;
const SCAN_LIMIT = 2000;
const cache = new Map<string, { at: number; dir: InternalDirectory }>();

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

const domainOf = (email: string): string | null => {
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
};

/** Split an email local-part / display name into lowercase alpha tokens. */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 3);
}

/** Pull `Name <email>` and bare-email pairs out of a metadata blob. */
function extractIdentities(blob: string): Array<{ name?: string; email: string }> {
  const out: Array<{ name?: string; email: string }> = [];
  const re = /(?:"?([^"<>\n,]+?)"?\s*)?<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob))) {
    out.push({ name: m[1]?.trim() || undefined, email: m[2]!.toLowerCase() });
  }
  return out;
}

async function build(prisma: PrismaClient, organizationId: string): Promise<InternalDirectory> {
  const domains = new Set<string>();
  const names = new Set<string>();
  const tokens = new Set<string>();

  // 1. Company domains: the connected Workspace + the org's own account emails.
  const workspace = await prisma.workspace.findFirst({
    where: { organizationId, deletedAt: null },
    select: { domain: true },
  });
  if (workspace?.domain) domains.add(workspace.domain.toLowerCase());

  const members = await prisma.membership.findMany({
    where: { organizationId, deletedAt: null },
    select: { user: { select: { name: true, email: true } } },
  });
  for (const m of members) {
    const email = m.user?.email?.toLowerCase();
    if (email) {
      const d = domainOf(email);
      if (d) domains.add(d);
    }
  }
  // A member is always internal regardless of which domain matching finds.
  for (const m of members) {
    if (m.user?.name) {
      names.add(norm(m.user.name));
      for (const t of tokenize(m.user.name)) tokens.add(t);
    }
    if (m.user?.email) {
      const local = m.user.email.split('@')[0] ?? '';
      for (const t of tokenize(local)) tokens.add(t);
    }
  }

  if (domains.size === 0) return { domains, names, tokens };

  // 2. Company-domain identities from synced Gmail + Calendar metadata.
  const resources = await prisma.externalResource.findMany({
    where: {
      organizationId,
      deletedAt: null,
      type: { in: ['EMAIL', 'EMAIL_THREAD', 'CALENDAR_EVENT'] as never },
    },
    select: { metadata: true },
    take: SCAN_LIMIT,
    orderBy: { externalUpdatedAt: 'desc' },
  });

  for (const r of resources) {
    if (!r.metadata) continue;
    for (const id of extractIdentities(JSON.stringify(r.metadata))) {
      const d = domainOf(id.email);
      if (!d || !domains.has(d)) continue;
      const local = id.email.split('@')[0] ?? '';
      // Skip opaque/system addresses (uuid-like local parts).
      if (/^[0-9a-f]{8}-/.test(local)) continue;
      for (const t of tokenize(local)) tokens.add(t);
      if (id.name && /[a-z]/i.test(id.name)) {
        names.add(norm(id.name));
        for (const t of tokenize(id.name)) tokens.add(t);
      }
    }
  }

  return { domains, names, tokens };
}

export async function getInternalDirectory(
  prisma: PrismaClient,
  organizationId: string,
): Promise<InternalDirectory> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.dir;
  const dir = await build(prisma, organizationId);
  cache.set(organizationId, { at: Date.now(), dir });
  return dir;
}

/**
 * Whether an extracted PERSON/TEAM title belongs to the organization. A person
 * matches on a full-name hit or a first-name token; a team is kept only when it
 * reads as an internal group (company token or a member name), so external
 * "Partner"/customer groups drop out.
 */
export function isInternal(dir: InternalDirectory, type: string, title: string): boolean {
  const t = norm(title);
  if (!t) return false;
  const titleTokens = new Set(t.split(' '));

  if (type === 'TEAM') {
    if (/\b(gtr|gotoretreats|internal)\b/.test(t)) return true;
    for (const tok of titleTokens) if (dir.tokens.has(tok)) return true;
    return false;
  }

  // PERSON: full-name or first-name/token match against company-domain identities.
  if (dir.names.has(t)) return true;
  for (const tok of titleTokens) if (dir.tokens.has(tok)) return true;
  return false;
}
