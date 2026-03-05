import { Hono } from "hono";
import apiApp from "./api";
import { apiKeyAuthMiddleware } from "./auth_middleware";
import stalwartApp from "./stalwart";
const app = new Hono();
// Global middleware for API key authentication on specific routes
app.use("*", apiKeyAuthMiddleware);
// Mount the stalwart app under the /stalwart route
app.route("/stalwart", stalwartApp);
// Mount the main API app at the root
app.route("/", apiApp);
export default app;
