/**
 * Environment / Worker bindings for Stalwart JMAP outbound mail.
 * Uses only STALWART_* and optional Supabase relay token credentials.
 */
export type MailSendBindings = {
  STALWART_JMAP_ENDPOINT?: string;
  STALWART_JMAP_ACCOUNT_ID?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  STALWART_SUPABASE_RELAY_EMAIL?: string;
  STALWART_SUPABASE_RELAY_PASSWORD?: string;
  /**
   * When set (e.g. `circulardemocracy.org`), outbound mail uses Stalwart Basic-auth
   * impersonation (`STALWART_USERNAME%fromAddress`) instead of the Supabase relay Bearer.
   */
  ALL_DOMAIN?: string;
  STALWART_USERNAME?: string;
  STALWART_APP_PASSWORD?: string;
  STALWART_PASSWORD?: string;
};

export interface StalwartImpersonationConfig {
  /** Lowercase domain without leading `@`, e.g. `circulardemocracy.org`. */
  allDomainLower: string;
  serviceUsername: string;
  servicePassword: string;
}

export interface WorkerConfig {
  jmapApiUrl: string;
  jmapAccountId: string;
  jmapBearerToken: string;
  stalwartImpersonation?: StalwartImpersonationConfig;
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

/**
 * Returns WorkerConfig when all required values are present, else null.
 */
export function resolveStalwartJmapWorkerConfig(
  env: MailSendBindings,
): WorkerConfig | null {
  const jmapApiUrl = (env.STALWART_JMAP_ENDPOINT?.trim() || "").trim();
  const allDomainRaw = (env.ALL_DOMAIN || "").trim();

  if (allDomainRaw) {
    if (!jmapApiUrl) {
      return null;
    }
    const serviceUsername = (env.STALWART_USERNAME || "").trim();
    const servicePassword = (
      env.STALWART_APP_PASSWORD ||
      env.STALWART_PASSWORD ||
      ""
    ).trim();
    if (!serviceUsername || !servicePassword) {
      return null;
    }
    return {
      jmapApiUrl,
      jmapAccountId: "",
      jmapBearerToken: "",
      stalwartImpersonation: {
        allDomainLower: normalizeMailDomain(allDomainRaw),
        serviceUsername,
        servicePassword,
      },
    };
  }

  const jmapAccountId = (env.STALWART_JMAP_ACCOUNT_ID?.trim() || "").trim();

  if (!jmapApiUrl || !jmapAccountId) {
    return null;
  }

  return {
    jmapApiUrl,
    jmapAccountId,
    jmapBearerToken: "",
  };
}
