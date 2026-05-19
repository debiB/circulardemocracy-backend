import { createClient } from "@supabase/supabase-js";
import type { RealtimeClientOptions } from "@supabase/realtime-js";
import ws from "ws";

type ClientOptions = NonNullable<Parameters<typeof createClient>[2]>;

function resolveRealtimeOptions(): RealtimeClientOptions | undefined {
  if (typeof WebSocket !== "undefined") {
    return undefined;
  }

  return {
    transport: ws as NonNullable<RealtimeClientOptions["transport"]>,
  };
}

export function buildSupabaseClientOptions(
  options: ClientOptions = {},
): ClientOptions {
  const realtime = resolveRealtimeOptions();
  if (!realtime) {
    return options;
  }

  return {
    ...options,
    realtime: {
      ...options.realtime,
      ...realtime,
    },
  };
}
