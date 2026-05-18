/**
 * Environment / Worker bindings for Stalwart JMAP outbound mail.
 * Mail account id is derived from the JMAP session (see `fetchMailAccountIdFromSession`).
 */
export type MailSendBindings = {
  STALWART_JMAP_ENDPOINT?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  STALWART_SUPABASE_RELAY_EMAIL?: string;
  STALWART_SUPABASE_RELAY_PASSWORD?: string;
};

/**
 * Returns partial WorkerConfig when session URL is present; `jmapAccountId` is filled after session GET.
 */
export function resolveStalwartJmapWorkerConfig(env: MailSendBindings): {
  jmapApiUrl: string;
  jmapAccountId: string;
  jmapBearerToken: string;
} | null {
  const jmapApiUrl = (env.STALWART_JMAP_ENDPOINT?.trim() || "").trim();

  if (!jmapApiUrl) {
    return null;
  }

  return {
    jmapApiUrl,
    jmapAccountId: "",
    jmapBearerToken: "",
  };
}
