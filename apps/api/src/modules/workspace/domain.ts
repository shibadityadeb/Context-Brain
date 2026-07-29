/**
 * Pure helpers for domain-based workspace detection. No I/O — unit-testable.
 * The guard here is safety-critical: consumer email domains (gmail, yahoo, …)
 * must NEVER group strangers into one shared workspace.
 */

/** Lowercased domain part of an email, or null when absent/malformed. */
export function extractDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return domain.includes('.') ? domain : null;
}

export function isConsumerDomain(domain: string, consumerDomains: string[]): boolean {
  return consumerDomains.includes(domain.trim().toLowerCase());
}

/**
 * The company domain used to discover a shared workspace, or null when the
 * account is personal (a consumer domain) and must get its own workspace.
 * Prefers Google's verified hosted domain (`hd`) when present, falling back to
 * the email domain — both filtered through the consumer denylist.
 */
export function resolveWorkspaceDomain(
  input: { email?: string | null; hd?: string | null },
  consumerDomains: string[],
): string | null {
  const hd = input.hd?.trim().toLowerCase();
  if (hd && hd.includes('.') && !isConsumerDomain(hd, consumerDomains)) return hd;
  const domain = extractDomain(input.email);
  if (domain && !isConsumerDomain(domain, consumerDomains)) return domain;
  return null;
}

/** Friendly workspace name from a domain ("acme-inc.com" → "Acme Inc"). */
export function suggestWorkspaceName(domain: string): string {
  const label = domain.split('.')[0] ?? domain;
  const pretty = label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return pretty || domain;
}
