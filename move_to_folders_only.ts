#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

interface JmapSessionResponse {
  apiUrl: string;
  primaryAccounts?: Record<string, string>;
  accounts?: Record<string, unknown>;
}

interface JmapEmail {
  id: string;
  subject?: string;
  textBody?: any[];
  htmlBody?: any[];
  bodyValues?: Record<string, any>;
}

interface JmapMailboxResponse {
  data: {
    id: string;
    name: string;
    role?: string;
  }[];
}

interface JmapSetMailboxResponse {
  accountId: string;
  newState: string;
  created: Record<string, any>;
  updated: Record<string, any>;
  destroyed: string[];
}

function generateFolderPath(campaignName: string): string {
  return campaignName.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
}

async function ensureMailboxExists(
  jmapUrl: string,
  authHeader: string,
  accountId: string,
  folderPath: string
): Promise<string> {
  // First, try to find existing mailbox
  const mailboxesResponse = await fetch(`${jmapUrl}/mailboxes/get`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountId,
      ids: null,
    }),
  });

  const mailboxesData = await mailboxesResponse.json();
  console.log('Mailboxes data:', JSON.stringify(mailboxesData, null, 2));

  if (!mailboxesData || !mailboxesData.data) {
    console.error('Invalid mailboxes response');
    throw new Error('Invalid mailboxes response');
  }

  const existingMailbox = mailboxesData.data.find((mb: any) => mb.name === folderPath);

  if (existingMailbox) {
    console.log('Found existing mailbox:', existingMailbox.id);
    return existingMailbox.id;
  }

  // Create new mailbox if it doesn't exist
  const createResponse = await fetch(`${jmapUrl}/mailboxes/set`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountId,
      create: {
        [`mailbox-${Date.now()}`]: {
          name: folderPath,
        },
      },
    }),
  });

  const createData: JmapSetMailboxResponse = await createResponse.json();
  const createdIds = Object.keys(createData.created);

  if (createdIds.length === 0) {
    throw new Error('Failed to create mailbox');
  }

  return createdIds[0];
}

async function moveMessageToFolder(
  jmapUrl: string,
  authHeader: string,
  accountId: string,
  messageId: string,
  targetMailboxId: string
): Promise<void> {
  const response = await fetch(`${jmapUrl}/email/set`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountId,
      update: {
        [messageId]: {
          mailboxIds: [targetMailboxId],
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to move message: ${response.statusText}`);
  }
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

  for (const message of messages) {
    if (!message.stalwart_message_id) {
      console.log(`Skipping message ${message.id} - no Stalwart ID`);
      continue;
    }

    try {
      const folderPath = 'Uncategorized'; // Campaign 472 is Uncategorized
      const mailboxId = await ensureMailboxExists(jmapUrl, jmapAuthHeader, jmapAccountId, folderPath);

      await moveMessageToFolder(jmapUrl, jmapAuthHeader, jmapAccountId, message.stalwart_message_id, mailboxId);

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
