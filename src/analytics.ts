import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createClient } from "@supabase/supabase-js";
import { authMiddleware, requireAppRole } from "./auth";
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
app.use("/api/v1/messages/analytics", authMiddleware);
app.use(
  "/api/v1/messages/analytics",
  requireAppRole("politician", "staff", "admin"),
);

// =============================================================================
// SCHEMAS
// =============================================================================

const MessageAnalyticsItemSchema = z.object({
  date: z.string().datetime(),
  campaign_id: z.number(),
  campaign_name: z.string(),
  message_count: z.number(),
});

const MessageAnalyticsResponseSchema = z.object({
  analytics: z.array(MessageAnalyticsItemSchema),
});

const ErrorResponseSchema = z.object({
  success: z.boolean().default(false),
  error: z.string(),
});

// =============================================================================
// ROUTES
// =============================================================================

// Get Message Analytics
const getMessageAnalyticsRoute = createRoute({
  method: "get",
  path: "/api/v1/messages/analytics",
  security: [{ Bearer: [] }],
  request: {
    query: z.object({
      days: z
        .string()
        .regex(/^\d+$/)
        .optional()
        .default("7")
        .describe(
          "Number of days to look back for daily analytics (default: 7)",
        ),
      bucket: z
        .enum(["day", "week"])
        .optional()
        .default("day")
        .describe("Aggregation bucket: day (default) or week"),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: MessageAnalyticsResponseSchema,
        },
      },
      description: "Message analytics grouped by day or week and campaign",
    },
    500: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Internal server error",
    },
  },
  tags: ["Analytics"],
  summary: "/api/v1/messages/analytics",
  description:
    "Retrieve message analytics grouped by day (last 7 days by default) or by calendar week",
});

app.openapi(getMessageAnalyticsRoute, async (c) => {
  try {
    const { days, bucket } = c.req.valid("query");
    const daysBack = parseInt(days, 10);
    const authHeader = c.req.header("Authorization");
    const supabaseUrl = process.env.SUPABASE_URL || c.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || c.env.SUPABASE_KEY;
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysBack);

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: authHeader ? { Authorization: authHeader } : {},
      },
      auth: {
        persistSession: false,
      },
    });

    const sourceView =
      bucket === "week"
        ? "message_analytics_weekly_view"
        : "message_analytics_view";
    let query = supabase
      .from(sourceView)
      .select("date, campaign_id, campaign_name, message_count");

    if (bucket === "day") {
      query = query.gte("date", fromDate.toISOString());
    }

    const { data: analytics, error } = await query.order("date", {
      ascending: true,
    });

    if (error) {
      throw error;
    }

    return c.json({ analytics: analytics ?? [] }, 200);
  } catch (error) {
    console.error("Error fetching message analytics:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch message analytics",
      },
      500,
    );
  }
});

export default app;
