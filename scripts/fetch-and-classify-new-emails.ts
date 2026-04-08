#!/usr/bin/env tsx

import { config } from 'dotenv';
config();

interface Email {
  id: string;
  subject: string;
  from: any[];
  to: any[];
  receivedAt: string;
  textBody: string;
  htmlBody: string;
  headers: Record<string, string>;
}

async function fetchAndClassifyEmails() {
  const username = process.env.STALWART_USERNAME!;
  const password = process.env.STALWART_APP_PASSWORD!;
  const jmapSessionUrl = process.env.STALWART_JMAP_ENDPOINT!;
  const mtaHookUrl = process.env.MTA_HOOK_URL || 'http://localhost:3000/stalwart/mta-hook';
  const apiKey = process.env.API_KEY!;

  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  console.log("🔄 Fetching new emails from Stalwart inbox...\n");

  // Get JMAP session
  const sessionResponse = await fetch(jmapSessionUrl, {
    method: "GET",
    headers: { "Authorization": authHeader }
  });

  const session = await sessionResponse.json();
  const accountId = Object.keys(session.accounts)[0];
  const jmapEndpoint = session.apiUrl;

  console.log(`Account ID: ${accountId}`);
  console.log(`JMAP API: ${jmapEndpoint}\n`);

  // Get Inbox mailbox ID
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

  if (!inbox) {
    console.error("❌ Inbox not found");
    return;
  }

  console.log(`📥 Inbox ID: ${inbox.id}, Total emails: ${inbox.totalEmails}\n`);

  // Query emails in inbox
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
          sort: [{ property: "receivedAt", isAscending: false }],
          limit: 100
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
          properties: ["id", "subject", "from", "to", "receivedAt", "bodyStructure", "bodyValues", "headers"]
        },
        "1"
      ]]
    })
  });

  const queryResult = await queryResponse.json();
  const emails = queryResult.methodResponses[1][1].list;

  console.log(`✅ Found ${emails.length} emails in inbox\n`);

  if (emails.length === 0) {
    console.log("No new emails to process");
    return;
  }

  // Process each email through MTA hook
  console.log("📧 Processing emails through MTA hook...\n");

  const results = {
    total: emails.length,
    processed: 0,
    failed: 0,
    classified: 0,
    uncategorized: 0,
    duplicates: 0,
    byConfidence: {} as Record<string, number>,
    byCampaign: {} as Record<string, number>
  };

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];

    console.log(`\n[${i + 1}/${emails.length}] Processing: ${email.subject?.substring(0, 60) || '(no subject)'}...`);

    // Extract body
    let textBody = '';
    let htmlBody = '';

    if (email.bodyStructure) {
      const findTextPart = (part: any): any => {
        if (part.type === 'text/plain') return part;
        if (part.subParts) {
          for (const sub of part.subParts) {
            const found = findTextPart(sub);
            if (found) return found;
          }
        }
        return null;
      };

      const findHtmlPart = (part: any): any => {
        if (part.type === 'text/html') return part;
        if (part.subParts) {
          for (const sub of part.subParts) {
            const found = findHtmlPart(sub);
            if (found) return found;
          }
        }
        return null;
      };

      const textPart = findTextPart(email.bodyStructure);
      const htmlPart = findHtmlPart(email.bodyStructure);

      if (textPart && email.bodyValues?.[textPart.partId]) {
        textBody = email.bodyValues[textPart.partId].value;
      }
      if (htmlPart && email.bodyValues?.[htmlPart.partId]) {
        htmlBody = email.bodyValues[htmlPart.partId].value;
      }
    }

    // Extract sender email
    let senderEmail = email.from?.[0]?.email || 'unknown@example.com';

    // Check for PROCA format (both CF and CG variants)
    if (senderEmail.includes('PROCA=') && senderEmail.includes('@circulardemocracy.org')) {
      const match = senderEmail.match(/PROCA=[A-F0-9]+=C[FG]=([^=@]+)=([^@]+)@/);
      if (match) {
        const domain = match[1];
        const username = match[2];
        senderEmail = `${username}@${domain}`;
      }
    }

    // Validate email format - if invalid, use a default
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(senderEmail)) {
      senderEmail = 'unknown@example.com';
    }

    // Convert headers array to object if needed
    let headersObj: Record<string, string> = {};
    if (email.headers) {
      if (Array.isArray(email.headers)) {
        // Convert array of header objects to key-value object
        email.headers.forEach((header: any) => {
          if (header.name && header.value) {
            headersObj[header.name] = header.value.trim();
          }
        });
      } else {
        headersObj = email.headers;
      }
    }

    // Build MTA hook payload
    const payload = {
      messageId: email.id,
      queueId: `queue-${Date.now()}-${i}`,
      sender: senderEmail,
      recipients: email.to?.map((r: any) => r.email) || [],
      subject: email.subject || '',
      headers: headersObj,
      body: {
        text: textBody,
        html: htmlBody
      },
      size: (textBody.length + htmlBody.length) || 1000,
      timestamp: Math.floor(new Date(email.receivedAt).getTime() / 1000)
    };

    // Debug: verify headers is object
    if (i === 0) {
      console.log(`  Debug - Headers type: ${Array.isArray(payload.headers) ? 'array' : typeof payload.headers}`);
      console.log(`  Debug - Sender: ${payload.sender}`);
    }

    // Send to MTA hook
    try {
      const hookResponse = await fetch(mtaHookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'X-API-KEY': apiKey
        },
        body: JSON.stringify(payload)
      });

      if (!hookResponse.ok) {
        const errorText = await hookResponse.text();
        console.log(`  ❌ MTA hook failed: ${hookResponse.status}`);
        console.log(`  Error: ${errorText.substring(0, 200)}`);
        results.failed++;
        continue;
      }

      const hookResult = await hookResponse.json();
      results.processed++;

      // Parse result
      const campaign = hookResult.modifications?.headers?.['X-CircularDemocracy-Campaign'] || 'Uncategorized';
      const confidence = hookResult.confidence || 0;
      const folder = hookResult.modifications?.folder || 'Inbox';

      console.log(`  ✅ Campaign: ${campaign}`);
      console.log(`  📊 Confidence: ${(confidence * 100).toFixed(1)}%`);
      console.log(`  📁 Folder: ${folder}`);

      // Track stats
      results.byCampaign[campaign] = (results.byCampaign[campaign] || 0) + 1;

      const confBucket = confidence === 1.0 ? 'duplicate' :
        confidence >= 0.9 ? '90-100%' :
          confidence >= 0.8 ? '80-90%' :
            confidence >= 0.5 ? '50-80%' : 'low';
      results.byConfidence[confBucket] = (results.byConfidence[confBucket] || 0) + 1;

      if (confidence === 1.0) {
        results.duplicates++;
      } else if (campaign === 'Uncategorized') {
        results.uncategorized++;
      } else {
        results.classified++;
      }

    } catch (error) {
      console.log(`  ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      results.failed++;
    }

    // Small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Print summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 CLASSIFICATION SUMMARY");
  console.log("=".repeat(80));
  console.log(`\n✅ Total emails processed: ${results.processed}/${results.total}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`\n📈 Classification Results:`);
  console.log(`   Classified to campaigns: ${results.classified}`);
  console.log(`   Uncategorized: ${results.uncategorized}`);
  console.log(`   Duplicates: ${results.duplicates}`);

  console.log(`\n📊 By Campaign:`);
  Object.entries(results.byCampaign)
    .sort(([, a], [, b]) => b - a)
    .forEach(([campaign, count]) => {
      console.log(`   ${campaign}: ${count}`);
    });

  console.log(`\n📊 By Confidence:`);
  Object.entries(results.byConfidence)
    .forEach(([bucket, count]) => {
      console.log(`   ${bucket}: ${count}`);
    });

  console.log("\n✅ Done! Check Twake Mail to see emails in their classified folders.");
}

fetchAndClassifyEmails();
