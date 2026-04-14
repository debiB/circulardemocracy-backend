#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

interface JmapSessionResponse {
  apiUrl: string;
  primaryAccounts?: Record<string, string>;
  accounts?: Record<string, unknown>;
}

async function jmapCall(
  apiUrl: string,
  authHeader: string,
  methodCalls: unknown[],
): Promise<any[][]> {
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

  const json = await response.json() as { methodResponses?: any[][] };
  if (!json.methodResponses) {
    throw new Error("Invalid JMAP response: missing methodResponses");
  }

  return json.methodResponses;
}

function getMethodResponse(
  methodResponses: any[][],
  methodName: string,
  callId: string,
): any {
  const response = methodResponses.find(
    (entry) => entry[0] === methodName && entry[2] === callId,
  );

  if (!response) {
    throw new Error(`JMAP response missing ${methodName} for callId=${callId}`);
  }

  return response[1];
}

function generateFolderPath(campaignName: string | null): string {
  if (!campaignName || campaignName === "Uncategorized") {
    return "Uncategorized";
  }

  const campaignFolder = campaignName
    .replace(/[^a-zA-Z0-9\-_\s]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50);

  return campaignFolder;
}

async function ensureMailboxExists(
  apiUrl: string,
  authHeader: string,
  accountId: string,
  folderName: string,
): Promise<string> {
  // Check if mailbox already exists
  const queryResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Mailbox/query",
      {
        accountId,
        filter: {
          name: folderName,
        },
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
      },
      "getMailbox",
    ],
  ]);

  const getData = getMethodResponse(queryResponses, "Mailbox/get", "getMailbox");

  if (Array.isArray(getData.list) && getData.list.length > 0) {
    return getData.list[0].id;
  }

  // Create new mailbox if it doesn't exist
  const createResponses = await jmapCall(apiUrl, authHeader, [
    [
      "Mailbox/set",
      {
        accountId,
        create: {
          newMailbox: {
            name: folderName,
          },
        },
      },
      "createMailbox",
    ],
  ]);

  const setData = getMethodResponse(createResponses, "Mailbox/set", "createMailbox");
  if (setData.created?.newMailbox?.id) {
    return setData.created.newMailbox.id;
  } else {
    throw new Error(`Failed to create mailbox: ${folderName}`);
  }
}

async function moveEmailToMailbox(
  apiUrl: string,
  authHeader: string,
  accountId: string,
  emailId: string,
  targetMailboxId: string,
): Promise<void> {
  await jmapCall(apiUrl, authHeader, [
    [
      "Email/set",
      {
        accountId,
        update: {
          [emailId]: {
            mailboxIds: {
              [targetMailboxId]: true,
            },
          },
        },
      },
      "moveEmail",
    ],
  ]);
}

async function main() {
  const campaignId = 472; // Only process campaign 472 as requested

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

  console.log(`Finding messages for campaign ${campaignId}...`);

  const { data: messages, error } = await supabase
    .from('messages')
    .select('id, external_id, stalwart_message_id, campaign_id')
    .eq('campaign_id', campaignId);

  if (error) {
    console.error('Error fetching messages:', error);
    process.exit(1);
  }
  console.log(`Found ${messages.length} messages to move to folders`);

  const username = process.env.STALWART_USERNAME || "politician-1@circulardemocracy.org";
  const password = process.env.STALWART_APP_PASSWORD || "";
  const jmapEndpoint = process.env.STALWART_JMAP_ENDPOINT || "https://mail.circulardemocracy.org/.well-known/jmap";

  // Authenticate with JMAP
  const authResponse = await fetch(`${jmapEndpoint}/session`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    },
  });

  if (!authResponse.ok) {
    throw new Error('JMAP authentication failed');
  }

  const session: JmapSessionResponse = await authResponse.json();
  const jmapUrl = session.apiUrl;
  const jmapAccountId = session.primaryAccounts?.['urn:ietf:params:jmap:mail'] || '';

  if (!jmapAccountId) {
    throw new Error('No mail account found in JMAP session');
  }

  const jmapAuthHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  console.log('Connected to Stalwart JMAP');

  let movedCount = 0;
  let errorCount = 0;

  // Cache for mailbox IDs to avoid repeated lookups
  const mailboxCache = new Map<string, string>();

  for (const message of messages) {
    if (!message.stalwart_message_id) {
      console.log(`Skipping message ${message.id} - no Stalwart ID`);
      continue;
    }

    try {
      const folderPath = 'Uncategorized'; // Campaign 472 is Uncategorized

      // Check cache first
      let mailboxId = mailboxCache.get(folderPath);
      if (!mailboxId) {
        mailboxId = await ensureMailboxExists(
          jmapUrl,
          jmapAuthHeader,
          jmapAccountId,
          folderPath,
        );
        mailboxCache.set(folderPath, mailboxId);
      }

      await moveEmailToMailbox(
        jmapUrl,
        jmapAuthHeader,
        jmapAccountId,
        message.stalwart_message_id,
        mailboxId,
      );

      console.log(`Moved message ${message.id} to folder: ${folderPath}`);
      movedCount++;
    } catch (error) {
      console.error(`Failed to move message ${message.id}:`, error instanceof Error ? error.message : 'Unknown error');
      errorCount++;
    }
  }

  console.log(`\nSummary:`);
  console.log(`Moved: ${movedCount}`);
  console.log(`Errors: ${errorCount}`);
}

main().catch(console.error);
