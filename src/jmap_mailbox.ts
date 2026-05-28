/**
 * JMAP mailbox helpers for campaign folder creation.
 * Twake Mail (and many JMAP clients) only show mailboxes where isSubscribed is true.
 */

import {
  jmapWellKnownSessionUrl,
  resolveMailAccountIdFromSession,
} from "./jmap_client";
import {
  buildStalwartImpersonationLogin,
  emailHostedOnDomain,
  encodeBasicAuth,
  normalizeMailDomain,
  resolveRelayImpersonationCredentials,
} from "./stalwart_jmap";

export interface HookFolderSubscription {
  mailboxEmail: string;
  folderName: string;
}

export type HookFolderVisibilityBindings = {
  JMAP_URL?: string;
  ALL_DOMAIN?: string;
  RELAY_SERVICE_ACCOUNT_EMAIL?: string;
  RELAY_SERVICE_ACCOUNT_PASSWORD?: string;
  JMAP_SERVICE_ACCOUNT_EMAIL?: string;
  JMAP_SERVICE_ACCOUNT_PASSWORD?: string;
};

interface JmapSessionResponse {
  apiUrl: string;
  primaryAccounts?: Record<string, string>;
  accounts?: Record<string, unknown>;
}

export async function jmapMailCall(
  apiUrl: string,
  authHeader: string,
  methodCalls: unknown[],
): Promise<unknown[][]> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `JMAP API request failed (${response.status}): ${body || "No response body"}`,
    );
  }

  const json = (await response.json()) as { methodResponses?: unknown[][] };
  if (!json.methodResponses) {
    throw new Error("Invalid JMAP response: missing methodResponses");
  }

  return json.methodResponses;
}

function getMethodResponse(
  methodResponses: unknown[][],
  methodName: string,
  callId: string,
): Record<string, unknown> {
  const response = methodResponses.find(
    (entry) =>
      Array.isArray(entry) && entry[0] === methodName && entry[2] === callId,
  );

  if (!response || !Array.isArray(response)) {
    throw new Error(`JMAP response missing ${methodName} for callId=${callId}`);
  }

  return response[1] as Record<string, unknown>;
}

interface JmapMailboxRecord {
  id: string;
  isSubscribed?: boolean;
}

async function ensureMailboxSubscribed(
  apiUrl: string,
  authHeader: string,
  accountId: string,
  mailboxId: string,
): Promise<void> {
  await jmapMailCall(apiUrl, authHeader, [
    [
      "Mailbox/set",
      {
        accountId,
        update: {
          [mailboxId]: { isSubscribed: true },
        },
      },
      "subscribeMailbox",
    ],
  ]);
}

/**
 * Returns the mailbox id for {@link folderName}, creating it when missing.
 * Ensures the mailbox is subscribed so it appears in Twake Mail and similar clients.
 */
export async function ensureMailboxExists(
  apiUrl: string,
  authHeader: string,
  accountId: string,
  folderName: string,
): Promise<string> {
  const queryResponses = await jmapMailCall(apiUrl, authHeader, [
    [
      "Mailbox/query",
      {
        accountId,
        filter: { name: folderName },
      },
      "queryMailbox",
    ],
    [
      "Mailbox/get",
      {
        accountId,
        "#ids": {
          resultOf: "queryMailbox",
          name: "Mailbox/query",
          path: "/ids",
        },
        properties: ["id", "isSubscribed"],
      },
      "getMailbox",
    ],
  ]);

  const getData = getMethodResponse(queryResponses, "Mailbox/get", "getMailbox");
  const existing = Array.isArray(getData.list)
    ? (getData.list[0] as JmapMailboxRecord | undefined)
    : undefined;

  if (existing?.id) {
    if (existing.isSubscribed === false) {
      await ensureMailboxSubscribed(apiUrl, authHeader, accountId, existing.id);
    }
    return existing.id;
  }

  const createResponses = await jmapMailCall(apiUrl, authHeader, [
    [
      "Mailbox/set",
      {
        accountId,
        create: {
          newMailbox: {
            name: folderName,
            isSubscribed: true,
          },
        },
      },
      "createMailbox",
    ],
  ]);

  const setData = getMethodResponse(createResponses, "Mailbox/set", "createMailbox");
  const created = setData.created as
    | { newMailbox?: { id?: string } }
    | undefined;
  if (created?.newMailbox?.id) {
    return created.newMailbox.id;
  }

  throw new Error(`Failed to create mailbox: ${folderName}`);
}

async function fetchJmapSession(
  endpoint: string,
  authHeader: string,
): Promise<JmapSessionResponse> {
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to connect to JMAP endpoint (${response.status}): ${body || "No response body"}`,
    );
  }

  return (await response.json()) as JmapSessionResponse;
}

function resolveJmapAuthForMailbox(
  env: HookFolderVisibilityBindings,
  mailboxEmail: string,
): { wellKnownUrl: string; authHeader: string } | null {
  const wellKnownUrl = jmapWellKnownSessionUrl(
    env as Record<string, string | undefined | null>,
  );
  if (!wellKnownUrl) {
    return null;
  }

  const allDomainRaw = (env.ALL_DOMAIN || "").trim();
  if (allDomainRaw) {
    const relay = resolveRelayImpersonationCredentials(
      env as Record<string, string | undefined | null>,
    );
    if (!relay) {
      return null;
    }
    const domainLower = normalizeMailDomain(allDomainRaw);
    if (!emailHostedOnDomain(mailboxEmail, domainLower)) {
      return null;
    }
    const login = buildStalwartImpersonationLogin(
      relay.relayEmail,
      mailboxEmail,
    );
    return {
      wellKnownUrl,
      authHeader: encodeBasicAuth(login, relay.relayPassword),
    };
  }

  const serviceEmail = (env.JMAP_SERVICE_ACCOUNT_EMAIL || "").trim();
  const servicePassword = (env.JMAP_SERVICE_ACCOUNT_PASSWORD || "").trim();
  if (
    serviceEmail &&
    servicePassword &&
    mailboxEmail.trim().toLowerCase() === serviceEmail.toLowerCase()
  ) {
    return {
      wellKnownUrl,
      authHeader: encodeBasicAuth(serviceEmail, servicePassword),
    };
  }

  return null;
}

/**
 * Ensures {@link folderName} exists and is subscribed for {@link mailboxEmail}.
 * Fail-open: logs and returns on error so MTA hook delivery is never blocked.
 */
export async function ensureFolderVisibleForMailbox(
  env: HookFolderVisibilityBindings,
  mailboxEmail: string,
  folderName: string,
): Promise<void> {
  const trimmedFolder = folderName.trim();
  if (!trimmedFolder) {
    return;
  }

  const auth = resolveJmapAuthForMailbox(env, mailboxEmail);
  if (!auth) {
    return;
  }

  const session = await fetchJmapSession(auth.wellKnownUrl, auth.authHeader);
  const accountId = resolveMailAccountIdFromSession(session);
  await ensureMailboxExists(
    session.apiUrl,
    auth.authHeader,
    accountId,
    trimmedFolder,
  );
}

/**
 * After the MTA hook assigns folders, subscribe them via JMAP so Twake Mail shows them.
 * Requires JMAP_URL and ALL_DOMAIN impersonation (or a matching JMAP service account).
 */
export async function ensureHookCampaignFoldersVisible(
  env: HookFolderVisibilityBindings,
  subscriptions: HookFolderSubscription[],
): Promise<void> {
  const seen = new Set<string>();
  for (const { mailboxEmail, folderName } of subscriptions) {
    const mailbox = mailboxEmail.trim();
    const folder = folderName.trim();
    if (!mailbox || !folder) {
      continue;
    }

    const key = `${mailbox.toLowerCase()}\0${folder}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    try {
      await ensureFolderVisibleForMailbox(env, mailbox, folder);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `Failed to subscribe folder "${folder}" for ${mailbox}: ${reason}`,
      );
    }
  }
}
