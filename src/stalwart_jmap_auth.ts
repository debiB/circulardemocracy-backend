/**
 * HTTP Basic auth helpers for Stalwart JMAP (including `service%target` impersonation).
 */

export function encodeBasicAuth(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${token}`;
}

/**
 * Stalwart impersonation: authenticate as {@link serviceUsername} on behalf of
 * {@link targetMailbox} (full mailbox address or account name, per server config).
 */
export function buildStalwartImpersonationLogin(
  serviceUsername: string,
  targetMailbox: string,
): string {
  return `${serviceUsername.trim()}%${targetMailbox.trim()}`;
}
