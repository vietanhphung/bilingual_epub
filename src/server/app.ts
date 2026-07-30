import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import multer from "multer";
import type { AppDatabase } from "../persistence/database.js";
import type { AppEnv } from "../config/schema.js";
import { AppError } from "../domain/errors.js";
import { getLogger } from "../logging/logger.js";
import { attachUser } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { uploadsRouter } from "./routes/uploads.js";
import { translationsRouter } from "./routes/translations.js";
import { billingRouter } from "./routes/billing.js";
import { stripeWebhookHandler } from "./routes/billing-webhook.js";
import "./types.js";

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  UPLOAD_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  INVALID_DRIVE_LINK: 400,
  DRIVE_DOWNLOAD_FAILED: 502,
  FILE_TOO_LARGE: 413,
  INVALID_EPUB: 422,
  UNSAFE_ARCHIVE: 422,
  MANIFEST_RESOLUTION: 422,
  UNSUPPORTED_LANGUAGE: 400,
  UNSUPPORTED_GRANULARITY: 400,
  STRIPE_NOT_CONFIGURED: 503,
  PRICING_NOT_CONFIGURED: 503,
};

export function createServer(db: AppDatabase, env: AppEnv): express.Express {
  const app = express();
  app.use(cors({ origin: env.WEB_APP_ORIGIN, credentials: true }));
  app.use(cookieParser());

  // Mounted before express.json(): Stripe signature verification needs the
  // exact raw request body bytes, not a re-serialized parsed copy.
  app.post("/api/billing/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler(db, env));

  app.use(express.json({ limit: "1mb" }));
  app.use(attachUser(db, env));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter(db, env));
  app.use("/api/uploads", uploadsRouter(db, env));
  app.use("/api/translations", translationsRouter(db, env));
  app.use("/api/billing", billingRouter(db, env));

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ error: `UPLOAD_${err.code}`, message: err.message });
      return;
    }
    if (err instanceof AppError) {
      const status = STATUS_BY_ERROR_CODE[err.code] ?? 400;
      res.status(status).json({ error: err.code, message: err.message });
      return;
    }
    getLogger().error({ err }, "unhandled server error");
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong." });
  };
  app.use(errorHandler);

  return app;
}
