import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { authMiddleware } from "./auth";
import type { DatabaseClient } from "./database";

// Define types for env and app
interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
}

interface Variables {
  db: DatabaseClient;
}

const app = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// Apply auth middleware to all routes in this file
app.use("/api/v1/campaigns/*", authMiddleware);

// =============================================================================
// SCHEMAS
// =============================================================================

const CampaignSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
});

const CreateCampaignSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters"),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers, and hyphens",
    ),
  description: z.string().optional(),
});

const MessageSchema = z.object({
  id: z.number(),
  external_id: z.string(),
  channel: z.string(),
  channel_source: z.string(),
  politician_id: z.number(),
  sender_hash: z.string(),
  campaign_id: z.number(),
  classification_confidence: z.number(),
  language: z.string(),
  received_at: z.string(),
  processed_at: z.string(),
  duplicate_rank: z.number(),
  processing_status: z.string(),
  stalwart_message_id: z.string().nullable(),
  stalwart_account_id: z.string().nullable(),
});

const GetMessagesQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).optional().default("1"),
  pageSize: z.string().regex(/^\d+$/).optional().default("20"),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  minConfidence: z.string().regex(/^[0-1](\.\d+)?$/).optional(),
  maxConfidence: z.string().regex(/^[0-1](\.\d+)?$/).optional(),
  duplicateStatus: z.enum(["original", "duplicate"]).optional(),
  search: z.string().optional(),
});

const MessagesResponseSchema = z.object({
  messages: z.array(MessageSchema),
  pagination: z.object({
    page: z.number(),
    pageSize: z.number(),
    totalCount: z.number(),
    totalPages: z.number(),
    filteredCount: z.number(),
  }),
  filters: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    minConfidence: z.number().optional(),
    maxConfidence: z.number().optional(),
    duplicateStatus: z.string().optional(),
    search: z.string().optional(),
  }),
});

// =============================================================================
// ROUTES
// =============================================================================

// List Campaigns
const listCampaignsRoute = createRoute({
  method: "get",
  path: "/api/v1/campaigns",
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: { "application/json": { schema: z.array(CampaignSchema) } },
      description: "A list of campaigns",
    },
  },
  tags: ["Campaigns"],
});

app.openapi(listCampaignsRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const data = await db.request<any[]>("/campaigns?select=*");
  return c.json(data);
});

// Get campaign statistics
const statsRoute = createRoute({
  method: "get",
  path: "/api/v1/campaigns/stats",
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            campaigns: z.array(
              z.object({
                id: z.number(),
                name: z.string(),
                message_count: z.number(),
                recent_count: z.number(),
                avg_confidence: z.number().optional(),
              }),
            ),
          }),
        },
      },
      description: "Campaign statistics",
    },
  },
  tags: ["Campaigns", "Statistics"], // Added Campaigns tag
  summary: "/api/v1/campaigns/stats",
});

app.openapi(statsRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  try {
    const stats = await db.request("/rpc/get_campaign_stats");
    return c.json({ campaigns: stats });
  } catch (_error) {
    return c.json({ success: false, error: "Failed to fetch statistics" }, 500);
  }
});

// Get Single Campaign
const getCampaignRoute = createRoute({
  method: "get",
  path: "/api/v1/campaigns/{id}",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().regex(/^\d+$/) }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: CampaignSchema } },
      description: "A single campaign",
    },
    404: { description: "Campaign not found" },
  },
  tags: ["Campaigns"],
});

app.openapi(getCampaignRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const { id } = c.req.valid("param");
  const data = await db.request<any[]>(
    `/campaigns?id=eq.${id}&select=*&limit=1`,
  );
  if (!data || data.length === 0) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json(data[0]);
});

// Create Campaign
const createCampaignRoute = createRoute({
  method: "post",
  path: "/api/v1/campaigns",
  security: [{ Bearer: [] }],
  request: {
    body: { content: { "application/json": { schema: CreateCampaignSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: CampaignSchema } },
      description: "The created campaign",
    },
  },
  tags: ["Campaigns"],
});

app.openapi(createCampaignRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const campaignData = c.req.valid("json");
  const data = await db.request<any[]>("/campaigns", {
    method: "POST",
    body: JSON.stringify(campaignData),
  });
  return c.json(data[0], 201);
});

// Get Campaign Messages
const getCampaignMessagesRoute = createRoute({
  method: "get",
  path: "/api/v1/campaigns/{id}/messages",
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().regex(/^\d+$/) }),
    query: GetMessagesQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: MessagesResponseSchema } },
      description: "Campaign messages with filters applied",
    },
    404: { description: "Campaign not found" },
  },
  tags: ["Campaigns", "Messages"],
});

app.openapi(getCampaignMessagesRoute, async (c) => {
  const db = c.get("db") as DatabaseClient;
  const { id } = c.req.valid("param");
  const query = c.req.valid("query");

  // Verify campaign exists
  const campaign = await db.request<any[]>(
    `/campaigns?id=eq.${id}&select=id&limit=1`,
  );
  if (!campaign || campaign.length === 0) {
    return c.json({ error: "Campaign not found" }, 404);
  }

  // Parse and validate query parameters
  const page = Number.parseInt(query.page, 10);
  const pageSize = Number.parseInt(query.pageSize, 10);
  const minConfidence = query.minConfidence
    ? Number.parseFloat(query.minConfidence)
    : undefined;
  const maxConfidence = query.maxConfidence
    ? Number.parseFloat(query.maxConfidence)
    : undefined;

  // Get filtered messages
  const result = await db.getCampaignMessages(Number.parseInt(id, 10), {
    page,
    pageSize,
    startDate: query.startDate,
    endDate: query.endDate,
    minConfidence,
    maxConfidence,
    duplicateStatus: query.duplicateStatus,
    search: query.search,
  });

  return c.json(result);
});

export default app;
