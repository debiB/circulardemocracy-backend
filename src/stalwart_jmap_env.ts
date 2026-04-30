import type { WorkerConfig } from "./reply_worker";

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
};

/**
 * Returns WorkerConfig when all required values are present, else null.
 */
export function resolveStalwartJmapWorkerConfig(
  env: MailSendBindings,
): WorkerConfig | null {
  const jmapApiUrl = (env.STALWART_JMAP_ENDPOINT?.trim() || "").trim();
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
