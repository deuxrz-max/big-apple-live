import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import { RoomError } from "./lib/room-store";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0]?.replace(
            /\/participants\/[^/]+/g,
            "/participants/:sessionId",
          ),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors());
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true }));

// Scope account auth: the audio routes use private room capabilities in their
// Authorization header, NOT Clerk JWTs, and must continue to work unchanged.
app.use(
  ["/api/me", "/api/account"],
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof RoomError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err?.status === 400 || err?.status === 413) {
    res.status(err.status).json({
      error: err.status === 413 ? "Request body too large" : "Invalid JSON request body",
    });
    return;
  }
  req.log.error({ err }, "Unhandled API error");
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

export default app;
