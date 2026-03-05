export const apiKeyAuthMiddleware = async (c, next) => {
    const apiKey = c.req.header("x-api-key");
    // Skip auth check for non-API routes or OPTIONS
    if (c.req.method === "OPTIONS") {
        return await next();
    }
    // Check if this is the messages route
    if (c.req.path.endsWith("/api/v1/messages")) {
        if (!apiKey || apiKey !== c.env.API_KEY) {
            return c.json({
                success: false,
                error: "Unauthorized",
                details: "Invalid or missing API Key",
            }, 401);
        }
    }
    await next();
};
