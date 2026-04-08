#!/usr/bin/env tsx

import { config } from 'dotenv';
config();

async function debugEmailStructure() {
  const username = process.env.STALWART_USERNAME!;
  const password = process.env.STALWART_APP_PASSWORD!;
  const jmapSessionUrl = process.env.STALWART_JMAP_ENDPOINT!;
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  const sessionResponse = await fetch(jmapSessionUrl, {
    method: "GET",
    headers: { "Authorization": authHeader }
  });

  const session = await sessionResponse.json();
  const accountId = Object.keys(session.accounts)[0];
  const jmapEndpoint = session.apiUrl;

  const mbResponse = await fetch(jmapEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader,
    },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls: [["Mailbox/get", { accountId }, "0"]]
    })
  });

  const mbResult = await mbResponse.json();
  const mailboxes = mbResult.methodResponses[0][1].list;
  const inbox = mailboxes.find((m: any) => m.role === 'inbox' || m.name === 'Inbox');

  const queryResponse = await fetch(jmapEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader,
    },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls: [[
        "Email/query",
        {
          accountId,
          filter: { inMailbox: inbox.id },
          limit: 1
        },
        "0"
      ], [
        "Email/get",
        {
          accountId,
          "#ids": {
            resultOf: "0",
            name: "Email/query",
            path: "/ids"
          },
          properties: ["id", "subject", "from", "headers"]
        },
        "1"
      ]]
    })
  });

  const queryResult = await queryResponse.json();
  const email = queryResult.methodResponses[1][1].list[0];

  console.log("Email structure:");
  console.log("From:", JSON.stringify(email.from, null, 2));
  console.log("\nHeaders type:", Array.isArray(email.headers) ? 'array' : typeof email.headers);
  console.log("Headers:", JSON.stringify(email.headers, null, 2));
}

debugEmailStructure();
