// src/stalwart.ts - Stalwart MTA Hook Worker
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { DatabaseClient, type MessageInsert, hashEmail } from "./database";
import type { Ai } from "./message_processor";
import TurndownService from "turndown";

// Environment variables interface
interface Env {
  AI: Ai;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  API_KEY: string;
}

interface Variables {
  db: DatabaseClient;
}

// =============================================================================
// STALWART MTA HOOK SCHEMAS
// =============================================================================

const StalwartHookSchema = z.object({
  messageId: z.string().describe("Stalwart internal message ID"),
  queueId: z.string().optional().describe("Queue ID for tracking"),
  sender: z.string().email().describe("Envelope sender"),
  recipients: z.array(z.string().email()).describe("All envelope recipients"),
  headers: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .describe("All email headers"),
  subject: z.string().optional(),
  body: z
    .object({
      text: z.string().optional().describe("Plain text body"),
      html: z.string().optional().describe("HTML body"),
    })
    .optional(),
  size: z.number().describe("Message size in bytes"),
  timestamp: z.number().describe("Unix timestamp when received"),
  spf: z
    .object({
      result: z.enum([
        "pass",
        "fail",
        "softfail",
        "neutral",
        "temperror",
        "permerror",
        "none",
      ]),
      domain: z.string().optional(),
    })
    .optional(),
  dkim: z
    .array(
      z.object({
        result: z.enum([
          "pass",
          "fail",
          "temperror",
          "permerror",
          "neutral",
          "none",
        ]),
        domain: z.string().optional(),
        selector: z.string().optional(),
      }),
    )
    .optional(),
  dmarc: z
    .object({
      result: z.enum(["pass", "fail", "temperror", "permerror", "none"]),
      policy: z.enum(["none", "quarantine", "reject"]).optional(),
    })
    .optional(),
});

const ErrorResponseSchema = z.object({
  action: z.literal("accept"),
  error: z.string(),
});

type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

const StalwartResponseSchema = z.object({
  action: z.enum(["accept", "reject", "quarantine", "discard"]),
  modifications: z
    .object({
      folder: z.string().optional().describe("IMAP folder to store message"),
      headers: z.record(z.string(), z.string()).optional(),
      subject: z.string().optional(),
    })
    .optional(),
  reject_reason: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

type StalwartResponse = z.infer<typeof StalwartResponseSchema>;

// =============================================================================
// STALWART WORKER APP
// =============================================================================

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// CORS middleware
app.use(
  "/*",
  cors({
    origin: ["https://*.circulardemocracy.org", "http://localhost:*"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
  }),
);

// Database client middleware
app.use("*", async (c, next) => {
  c.set(
    "db",
    new DatabaseClient({
      url: c.env.SUPABASE_URL,
      key: c.env.SUPABASE_KEY,
    }),
  );
  await next();
});

// =============================================================================
// MTA HOOK ROUTE
// =============================================================================

const mtaHookRoute = createRoute({
  method: "post",
  path: "/mta-hook",
  request: {
    body: {
      content: {
        "application/json": {
          schema: StalwartHookSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: StalwartResponseSchema,
        },
      },
      description: "Instructions for message handling",
    },
    500: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Error - default to accept",
    },
  },
  tags: ["Stalwart"],
  summary: "/mta-hook",
  description: "Processes incoming emails and provides routing instructions",
});

app.openapi(mtaHookRoute, async (c) => {
  // Authentication check
  const apiKey = c.req.header("X-API-KEY");
  if (!apiKey || apiKey !== c.env.API_KEY) {
    return c.json(
      {
        action: "reject" as const,
        reject_reason: "Unauthorized: Invalid or missing API key",
      },
      401,
    );
  }

  const db = c.get("db");

  try {
    const hookData = c.req.valid("json");

    console.log(
      `Processing email: ${hookData.messageId} from ${hookData.sender}`,
    );

    // Extract actual sender from headers (considering SPF/DKIM)
    const senderResult = extractSenderEmail(hookData);
    const senderEmail = senderResult.email;
    const senderFlag = senderResult.flag;
    const senderName = extractSenderName(hookData);

    // Process all recipients and ensure they get the same campaign folder
    // First, classify the message once to determine the campaign
    const messageContent = extractMessageContent(hookData);
    let sharedCampaignClassification: { campaign_name: string; confidence: number; campaign_id: number } | null = null;

    if (messageContent.length >= 10) {
      try {
        const embedding = await generateEmbedding(c.env.AI, messageContent);
        sharedCampaignClassification = await db.classifyMessage(embedding);
      } catch (error) {
        console.error("Failed to classify message:", error);
      }
    }

    // Process each recipient with the shared campaign classification
    const results = await Promise.all(
      hookData.recipients.map(async (recipientEmail) => {
        return await processEmailForRecipient(
          db,
          c.env.AI,
          hookData,
          senderEmail,
          senderName,
          recipientEmail,
          sharedCampaignClassification,
          senderFlag,
        );
      }),
    );

    if (results.length === 0) {
      const emptyRes: StalwartResponse = {
        action: "accept",
        confidence: 0,
        reject_reason: "No recipients",
      };
      return c.json<StalwartResponse>(emptyRes);
    }

    // Use the result with highest confidence (they should all have same folder now)
    const bestResult: StalwartResponse = results.reduce((best, current) =>
      (current.confidence || 0) > (best.confidence || 0) ? current : best,
    );

    console.log(
      `Email processed: campaign=${bestResult.modifications?.headers?.["X-CircularDemocracy-Campaign"]}, confidence=${bestResult.confidence}`,
    );

    return c.json<StalwartResponse>(bestResult);
  } catch (error) {
    console.error("MTA Hook processing error:", error);

    // Always accept on error to avoid email loss, route to unprocessed
    const errorRes: ErrorResponse = {
      action: "accept",
      error: error instanceof Error ? error.message : "Unknown error",
    };

    // Return with folder assignment for fallback
    return c.json({
      ...errorRes,
      modifications: {
        folder: "unprocessed",
        headers: {
          "X-CircularDemocracy-Status": "backend-error",
          "X-CircularDemocracy-Error": error instanceof Error ? error.message : "Unknown error",
        },
      },
    }, 500);
  }
});

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "stalwart-hook",
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// EMAIL PROCESSING LOGIC
// =============================================================================

async function processEmailForRecipient(
  db: DatabaseClient,
  ai: Ai,
  hookData: z.infer<typeof StalwartHookSchema>,
  senderEmail: string,
  _senderName: string,
  recipientEmail: string,
  sharedCampaignClassification: { campaign_name: string; confidence: number; campaign_id: number } | null,
  senderFlag?: string,
): Promise<StalwartResponse> {
  try {
    // Step 1: Check for duplicate message
    const isDuplicate = await db.checkExternalIdExists(
      hookData.messageId,
      "stalwart",
    );
    if (isDuplicate) {
      if (sharedCampaignClassification) {
        const campaignFolder = sharedCampaignClassification.campaign_name
          .replace(/[^a-zA-Z0-9\-_\s]/g, "")
          .replace(/\s+/g, "-")
          .substring(0, 50);
        return {
          action: "accept" as const,
          confidence: 1.0,
          modifications: {
            folder: `${campaignFolder}/Duplicates`,
            headers: { "X-CircularDemocracy-Status": "duplicate" },
          },
        };
      }
      return {
        action: "accept" as const,
        confidence: 1.0,
        modifications: {
          folder: "System/Duplicates",
          headers: { "X-CircularDemocracy-Status": "duplicate" },
        },
      };
    }

    // Step 2: Find target politician
    const politician = await db.findPoliticianByEmail(recipientEmail);
    if (!politician) {
      return {
        action: "accept" as const,
        confidence: 0.0,
        modifications: {
          folder: "System/Unknown",
          headers: { "X-CircularDemocracy-Status": "politician-not-found" },
        },
      };
    }

    // Step 3: Extract and validate message content
    const messageContent = extractMessageContent(hookData);
    if (messageContent.length < 10) {
      return {
        action: "accept" as const,
        confidence: 0.1,
        modifications: {
          folder: "System/TooShort",
          headers: { "X-CircularDemocracy-Status": "message-too-short" },
        },
      };
    }

    // Step 4: Use shared classification or classify if not available
    let classification: { campaign_name: string; confidence: number; campaign_id: number };
    let embedding: number[];
    if (sharedCampaignClassification) {
      classification = sharedCampaignClassification;
      embedding = await generateEmbedding(ai, messageContent);
    } else {
      embedding = await generateEmbedding(ai, messageContent);
      classification = await db.classifyMessage(embedding);
    }

    // Step 5: Check for logical duplicates
    const senderHash = await hashEmail(senderEmail);
    const duplicateRank = await db.getDuplicateRank(
      senderHash,
      politician.id,
      classification.campaign_id,
    );

    // Step 6: Store message metadata
    const messageData: MessageInsert = {
      external_id: hookData.messageId,
      channel: "email",
      channel_source: "stalwart",
      politician_id: politician.id,
      sender_hash: senderHash,
      campaign_id: classification.campaign_id,
      classification_confidence: classification.confidence,
      message_embedding: embedding,
      language: "auto", // TODO: detect language
      received_at: new Date(hookData.timestamp * 1000).toISOString(),
      duplicate_rank: duplicateRank,
      processing_status: "processed",
      sender_flag: senderFlag,
      is_reply: detectIfReply(hookData),
    };

    await db.insertMessage(messageData);

    // Step 7: Generate folder and response
    const isReply = detectIfReply(hookData);
    const folderName = generateFolderName(classification, duplicateRank, isReply);

    return {
      action: "accept" as const,
      confidence: classification.confidence,
      modifications: {
        folder: folderName,
        headers: {
          "X-CircularDemocracy-Campaign": classification.campaign_name,
          "X-CircularDemocracy-Confidence":
            classification.confidence.toString(),
          "X-CircularDemocracy-Duplicate-Rank": duplicateRank.toString(),
          "X-CircularDemocracy-Message-ID": hookData.messageId,
          "X-CircularDemocracy-Politician": politician.name,
          "X-CircularDemocracy-Status": "processed",
        },
      },
    };
  } catch (error) {
    console.error(`Error processing email for ${recipientEmail}:`, error);
    return {
      action: "accept" as const,
      confidence: 0.0,
      modifications: {
        folder: "unprocessed",
        headers: {
          "X-CircularDemocracy-Status": "error",
          "X-CircularDemocracy-Error":
            error instanceof Error ? error.message : "unknown",
        },
      },
    };
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function extractSenderEmail(
  hookData: z.infer<typeof StalwartHookSchema>,
): { email: string; flag?: string } {
  // Priority: Reply-To > From > envelope sender (SPF considerations)
  const replyTo = getHeader(hookData.headers, "reply-to");
  const from = getHeader(hookData.headers, "from");
  const envelopeSender = hookData.sender;

  let senderEmail = envelopeSender;
  let flag: string | undefined;

  // Check for Reply-To vs From/Envelope discrepancies
  if (replyTo && isValidEmail(replyTo)) {
    senderEmail = replyTo;

    // Flag if Reply-To differs from From or Envelope
    const fromEmail = extractEmailFromHeader(from);
    if (fromEmail && fromEmail !== replyTo) {
      flag = "reply_to_mismatch_from";
      console.log(`Sender flag: Reply-To (${replyTo}) differs from From (${fromEmail})`);
    }
    if (envelopeSender && envelopeSender !== replyTo) {
      flag = "reply_to_mismatch_envelope";
      console.log(`Sender flag: Reply-To (${replyTo}) differs from envelope (${envelopeSender})`);
    }
  } else if (from) {
    const emailMatch = from.match(/<([^>]+)>/) || [null, from];
    const email = emailMatch[1]?.trim();
    if (email && isValidEmail(email)) {
      senderEmail = email;

      // Flag if From differs from Envelope
      if (envelopeSender && envelopeSender !== email) {
        flag = "from_mismatch_envelope";
        console.log(`Sender flag: From (${email}) differs from envelope (${envelopeSender})`);
      }
    }
  }

  return { email: senderEmail, flag };
}

function extractEmailFromHeader(header: string | null): string | null {
  if (!header) return null;
  const emailMatch = header.match(/<([^>]+)>/) || [null, header];
  const email = emailMatch[1]?.trim();
  return email && isValidEmail(email) ? email : null;
}

function extractSenderName(
  hookData: z.infer<typeof StalwartHookSchema>,
): string {
  const from = getHeader(hookData.headers, "from");
  if (from) {
    const nameMatch = from.match(/^([^<]+)</);
    if (nameMatch) {
      return nameMatch[1].trim().replace(/^["']|["']$/g, "");
    }
  }

  const senderResult = extractSenderEmail(hookData);
  const email = senderResult.email;
  return email.split("@")[0];
}

function extractMessageContent(
  hookData: z.infer<typeof StalwartHookSchema>,
): string {
  // Prefer plain text over HTML
  const textContent = hookData.body?.text;
  if (textContent && textContent.trim().length > 0) {
    return cleanTextContent(textContent);
  }

  const htmlContent = hookData.body?.html;
  if (htmlContent) {
    return cleanHtmlContent(htmlContent);
  }

  return hookData.subject || "";
}

function cleanTextContent(text: string): string {
  return text
    .replace(/^>.*$/gm, "") // Remove quoted lines
    .replace(/^\s*On .* wrote:\s*$/gm, "") // Remove reply headers
    .replace(/\n{3,}/g, "\n\n") // Normalize newlines
    .trim();
}

function cleanHtmlContent(html: string): string {
  try {
    // Create turndown instance with options for better conversion
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      fence: '```',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
      linkReferenceStyle: 'full'
    });

    // Convert HTML to Markdown
    const markdown = turndownService.turndown(html);

    // Clean up the markdown result
    return markdown
      .replace(/\n{3,}/g, "\n\n") // Normalize excessive newlines
      .replace(/\s+$/gm, "") // Remove trailing whitespace
      .trim();
  } catch (error) {
    console.error("HTML to Markdown conversion error:", error);
    // Fallback to basic tag stripping
    return html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

function getHeader(
  headers: Record<string, string | string[]>,
  name: string,
): string | null {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || null : value || null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function detectIfReply(
  hookData: z.infer<typeof StalwartHookSchema>,
): boolean {
  const subject = hookData.subject || "";
  const inReplyTo = getHeader(hookData.headers, "in-reply-to");
  const references = getHeader(hookData.headers, "references");

  // Check for common reply indicators in subject
  const replyPatterns = /^(re:|fw:|fwd:)/i;
  if (replyPatterns.test(subject.trim())) {
    return true;
  }

  // Check for reply headers
  if (inReplyTo || references) {
    return true;
  }

  return false;
}

function generateFolderName(
  classification: { campaign_name: string; confidence: number },
  duplicateRank: number,
  isReply: boolean,
): string {
  const campaignFolder = classification.campaign_name
    .replace(/[^a-zA-Z0-9\-_\s]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50); // Limit folder name length

  if (duplicateRank > 0) {
    return `${campaignFolder}/Duplicates`;
  }

  if (isReply) {
    return `${campaignFolder}/replied`;
  }

  if (classification.confidence < 0.3) {
    return `${campaignFolder}/unchecked`;
  }

  return `${campaignFolder}/inbox`;
}

async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  try {
    const response = await ai.run("@cf/baai/bge-m3", {
      text: text.substring(0, 8000),
    });

    return response.data[0] as number[];
  } catch (error) {
    console.error("Embedding generation error:", error);
    throw new Error("Failed to generate message embedding");
  }
}

// OpenAPI documentation
app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "Stalwart MTA Hook API",
    description: "Processes incoming emails via Stalwart mail server hooks",
  },
  servers: [
    {
      url: "https://stalwart.circulardemocracy.org",
      description: "Production Stalwart hook server",
    },
  ],
});

export default app;
