import { createMiddleware } from "hono/factory";
import { jwk } from "hono/jwk";
export const authMiddleware = createMiddleware(async (c, next) => {
    const env = c.env;
    if (!env.SUPABASE_URL) {
        console.error("SUPABASE_URL is not set. Skipping auth.");
        return c.json({ error: "Auth not configured" }, 500);
    }
    const jwks_uri = `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
    const auth = jwk({
        jwks_uri: jwks_uri,
    });
    return auth(c, next);
});
