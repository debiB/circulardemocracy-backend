// Acknowledgment Email Service
// Sends acknowledgment emails for low-confidence message classifications

import { JMAPClient, type EmailMessage } from "./jmap_client.js";
import { DatabaseClient } from "./database.js";

const DEFAULT_JMAP_ENDPOINT = "https://mail.circulardemocracy.org/.well-known/jmap";

export interface AcknowledgmentResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Checks if a message should receive an acknowledgment email
 * Only messages with confidence < 0.3 should be acknowledged
 */
export function shouldSendAcknowledgment(confidence: number): boolean {
  return confidence < 0.3;
}

/**
 * Checks if an incoming message is an auto-reply to prevent loops
 */
export function isAutoReply(headers: Record<string, string | string[]>): boolean {
  const autoSubmitted = getHeaderValue(headers, "auto-submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") {
    return true;
  }

  const autoResponseSuppress = getHeaderValue(headers, "x-auto-response-suppress");
  if (autoResponseSuppress) {
    return true;
  }

  const precedence = getHeaderValue(headers, "precedence");
  if (precedence && ["bulk", "junk", "list"].includes(precedence.toLowerCase())) {
    return true;
  }

  return false;
}

/**
 * Gets the original sender email from JMAP message headers
 */
async function getOriginalSenderEmail(
  jmapClient: JMAPClient,
  stalwartMessageId: string,
  stalwartAccountId: string,
): Promise<string | null> {
  try {
    const authHeader = `Basic ${btoa(`${jmapClient["config"].username}:${jmapClient["config"].password}`)}`;
    
    const response = await fetch(jmapClient["config"].apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        methodCalls: [
          [
            "Email/get",
            {
              accountId: stalwartAccountId,
              ids: [stalwartMessageId],
              properties: ["from", "replyTo", "headers"],
            },
            "0",
          ],
        ],
      }),
    });

    if (!response.ok) {
      console.error("Failed to fetch original message from JMAP");
      return null;
    }

    const result = await response.json();
    const emailData = result.methodResponses?.[0]?.[1]?.list?.[0];

    if (!emailData) {
      return null;
    }

    const replyTo = emailData.replyTo?.[0]?.email;
    if (replyTo) {
      return replyTo;
    }

    const from = emailData.from?.[0]?.email;
    return from || null;
  } catch (error) {
    console.error("Error fetching original sender email:", error);
    return null;
  }
}

/**
 * Sends an acknowledgment email for a low-confidence message
 */
export async function sendAcknowledgmentEmail(
  db: DatabaseClient,
  messageId: number,
): Promise<AcknowledgmentResult> {
  try {
    const message = await db.getMessageById(messageId);
    if (!message) {
      return {
        success: false,
        error: "Message not found",
      };
    }

    if (!shouldSendAcknowledgment(message.classification_confidence)) {
      return {
        success: false,
        error: `Message confidence ${message.classification_confidence} does not require acknowledgment`,
      };
    }

    if (!message.stalwart_message_id || !message.stalwart_account_id) {
      return {
        success: false,
        error: "Message does not have Stalwart references (not from email channel)",
      };
    }

    const politician = await db.getPoliticianById(message.politician_id);
    if (!politician) {
      return {
        success: false,
        error: "Politician not found",
      };
    }

    if (!politician.stalwart_username || !politician.stalwart_app_password) {
      return {
        success: false,
        error: "Politician missing JMAP credentials",
      };
    }

    const campaign = await db.getCampaignById(message.campaign_id);
    if (!campaign) {
      return {
        success: false,
        error: "Campaign not found",
      };
    }

    const jmapClient = new JMAPClient({
      apiUrl: politician.stalwart_jmap_endpoint || DEFAULT_JMAP_ENDPOINT,
      accountId: politician.stalwart_username,
      username: politician.stalwart_username,
      password: politician.stalwart_app_password,
    });

    const senderEmail = await getOriginalSenderEmail(
      jmapClient,
      message.stalwart_message_id,
      message.stalwart_account_id,
    );

    if (!senderEmail) {
      return {
        success: false,
        error: "Could not retrieve original sender email",
      };
    }

    const email: EmailMessage = {
      from: politician.email,
      to: [senderEmail],
      subject: "Thank you for your message",
      textBody: buildAcknowledgmentTextBody(politician.name, campaign.name),
      htmlBody: buildAcknowledgmentHtmlBody(politician.name, campaign.name),
      headers: {
        "Auto-Submitted": "auto-replied",
        "X-Auto-Response-Suppress": "All",
        "Precedence": "bulk",
        "X-CircularDemocracy-Acknowledgment": "true",
        "X-CircularDemocracy-Message-ID": message.id.toString(),
        "X-CircularDemocracy-Confidence": message.classification_confidence.toString(),
      },
    };

    const result = await jmapClient.sendEmail(email);

    if (result.success) {
      console.log(
        `[Acknowledgment] Sent acknowledgment for message ${messageId} to ${senderEmail}`,
      );
    }

    return result;
  } catch (error) {
    console.error("Error sending acknowledgment email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function buildAcknowledgmentTextBody(politicianName: string, campaignName: string): string {
  return `Dear Constituent,

Thank you for contacting ${politicianName}.

We have received your message regarding "${campaignName}" and it has been recorded. Due to the high volume of messages we receive, we are currently reviewing your submission to ensure it is properly categorized.

Your voice matters, and we appreciate you taking the time to reach out.

Best regards,
${politicianName}'s Office

---
This is an automated acknowledgment. Please do not reply to this email.`;
}

function buildAcknowledgmentHtmlBody(politicianName: string, campaignName: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f8f9fa; border-left: 4px solid #007bff; padding: 20px; margin-bottom: 20px;">
    <h2 style="margin-top: 0; color: #007bff;">Thank You for Your Message</h2>
  </div>
  
  <p>Dear Constituent,</p>
  
  <p>Thank you for contacting <strong>${politicianName}</strong>.</p>
  
  <p>We have received your message regarding <strong>"${campaignName}"</strong> and it has been recorded. Due to the high volume of messages we receive, we are currently reviewing your submission to ensure it is properly categorized.</p>
  
  <p>Your voice matters, and we appreciate you taking the time to reach out.</p>
  
  <p>Best regards,<br>
  <strong>${politicianName}'s Office</strong></p>
  
  <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
  
  <p style="font-size: 12px; color: #666;">
    This is an automated acknowledgment. Please do not reply to this email.
  </p>
</body>
</html>`;
}

function getHeaderValue(headers: Record<string, string | string[]>, name: string): string | null {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || null : value || null;
}
