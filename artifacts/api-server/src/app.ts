import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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
app.use(cors());
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
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
