import type { MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";

export interface AuthEnv {
  API_KEY: string;
}

const requireApiKey = bearerAuth<{ Bindings: AuthEnv }>({
  verifyToken: (token, c) => token === c.env.API_KEY,
});

export const apiKeyAuthMiddleware: MiddlewareHandler<{
  Bindings: AuthEnv;
}> = async (c, next) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }
  return requireApiKey(c, next);
};
