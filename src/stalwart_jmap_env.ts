/**
 * Helpers for Stalwart ALL_DOMAIN impersonation (per-mailbox Basic auth).
 */

export interface StalwartImpersonationConfig {
  /** Lowercase domain without leading `@`, e.g. `circulardemocracy.org`. */
  allDomainLower: string;
  serviceUsername: string;
  servicePassword: string;
}

export function normalizeMailDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, "");
}

export function emailHostedOnDomain(
  email: string,
  domainLower: string,
): boolean {
  const e = email.trim().toLowerCase();
  return e.endsWith(`@${domainLower}`);
}
