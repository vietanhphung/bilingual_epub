import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { AppDatabase } from "../../persistence/database.js";
import type { AppEnv } from "../../config/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { UploadRepository } from "../../persistence/upload-repository.js";
import { OrderRepository, type TranslationOrder } from "../../persistence/order-repository.js";
import { UserRepository } from "../../persistence/user-repository.js";
import { JobRepository } from "../../persistence/job-repository.js";
import { resolveBookConfig } from "../../config/resolve-book-config.js";
import { isEligibleForFreeTranslation } from "../../billing/entitlement.js";
import { priceTranslationUsd } from "../../billing/pricing.js";
import { getStripeClient } from "../../billing/stripe-client.js";
import { startOrderJob } from "../lib/start-order-job.js";
import { AppError } from "../../domain/errors.js";
import type { Job } from "../../domain/job.js";

const createOrderSchema = z.object({
  uploadId: z.string().min(1),
  sourceLanguage: z.enum(["en", "fr"]),
  targetLanguage: z.enum(["en", "fr"]),
  displayOrder: z.enum(["ENGLISH_FIRST", "FRENCH_FIRST"]).default("ENGLISH_FIRST"),
});

function jobSummary(job: Job | undefined) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    totalSegments: job.totalSegments,
    completedSegments: job.completedSegments,
    failedSegments: job.failedSegments,
    accumulatedInputTokens: job.accumulatedInputTokens,
    accumulatedOutputTokens: job.accumulatedOutputTokens,
    errorMessage: job.errorMessage,
  };
}

function orderSummary(order: TranslationOrder, job: Job | undefined) {
  return {
    id: order.id,
    status: order.status,
    isFree: order.isFree,
    amountUsdCents: order.amountUsdCents,
    sourceLanguage: order.sourceLanguage,
    targetLanguage: order.targetLanguage,
    displayOrder: order.displayOrder,
    estimatedInputTokens: order.estimatedInputTokens,
    estimatedOutputTokens: order.estimatedOutputTokens,
    errorMessage: order.errorMessage,
    createdAt: order.createdAt,
    job: jobSummary(job),
  };
}

export function translationsRouter(db: AppDatabase, env: AppEnv): Router {
  const router = Router();
  const uploads = new UploadRepository(db);
  const orders = new OrderRepository(db);
  const users = new UserRepository(db);
  const jobs = new JobRepository(db);

  router.post("/", requireAuth, async (req, res, next) => {
    try {
      const parsed = createOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message });
        return;
      }
      const { uploadId, sourceLanguage, targetLanguage, displayOrder } = parsed.data;

      const upload = uploads.get(uploadId);
      if (!upload || upload.userId !== req.user!.id) {
        res.status(404).json({ error: "UPLOAD_NOT_FOUND" });
        return;
      }

      const config = resolveBookConfig({ sourceLanguage, targetLanguage, displayOrder });
      // Re-read the user fresh: req.user is a request-start snapshot, and free-eligibility
      // must reflect the very latest state, not one that might have changed mid-request.
      const user = users.getOrThrow(req.user!.id);
      const eligibleForFree = isEligibleForFreeTranslation(user);

      if (eligibleForFree) {
        const order = orders.create({
          id: randomUUID(),
          userId: user.id,
          uploadId: upload.id,
          sourceLanguage: config.sourceLanguage,
          targetLanguage: config.targetLanguage,
          displayOrder: config.displayOrder,
          estimatedInputTokens: upload.sourceTokenEstimate,
          estimatedOutputTokens: upload.estimatedOutputTokens,
          amountUsdCents: 0,
          isFree: true,
          status: "FREE_GRANTED",
        });
        users.markFreeTranslationUsed(user.id);
        await startOrderJob(db, env, order);
        res.status(201).json({ order: orderSummary(orders.getOrThrow(order.id), undefined), checkoutUrl: null });
        return;
      }

      const price = priceTranslationUsd(env, upload.sourceTokenEstimate, upload.estimatedOutputTokens);
      const order = orders.create({
        id: randomUUID(),
        userId: user.id,
        uploadId: upload.id,
        sourceLanguage: config.sourceLanguage,
        targetLanguage: config.targetLanguage,
        displayOrder: config.displayOrder,
        estimatedInputTokens: upload.sourceTokenEstimate,
        estimatedOutputTokens: upload.estimatedOutputTokens,
        amountUsdCents: price.amountUsdCents,
        isFree: false,
        status: "AWAITING_PAYMENT",
      });

      const stripe = getStripeClient(env);
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        client_reference_id: order.id,
        ...(user.stripeCustomerId
          ? { customer: user.stripeCustomerId }
          : { customer_email: user.email }),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: price.amountUsdCents,
              product_data: {
                name: `Bilingual EPUB translation: ${upload.originalFilename}`,
                description: `~${upload.sourceTokenEstimate.toLocaleString()} source tokens, ${config.sourceLanguage} -> ${config.targetLanguage}`,
              },
            },
          },
        ],
        metadata: { orderId: order.id },
        success_url: `${env.WEB_APP_ORIGIN}/orders/${order.id}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.WEB_APP_ORIGIN}/orders/${order.id}?checkout=cancelled`,
      });

      orders.setStripeSession(order.id, session.id);
      res.status(201).json({ order: orderSummary(orders.getOrThrow(order.id), undefined), checkoutUrl: session.url });
    } catch (err) {
      next(err);
    }
  });

  router.get("/", requireAuth, (req, res) => {
    const mine = orders.listByUser(req.user!.id);
    res.json({
      orders: mine.map((order) => orderSummary(order, order.jobId ? jobs.get(order.jobId) : undefined)),
    });
  });

  router.get("/:id", requireAuth, (req, res) => {
    const order = orders.get(req.params.id as string);
    if (!order || order.userId !== req.user!.id) {
      res.status(404).json({ error: "ORDER_NOT_FOUND" });
      return;
    }
    res.json({ order: orderSummary(order, order.jobId ? jobs.get(order.jobId) : undefined) });
  });

  router.get("/:id/download", requireAuth, (req, res) => {
    const order = orders.get(req.params.id as string);
    if (!order || order.userId !== req.user!.id) {
      res.status(404).json({ error: "ORDER_NOT_FOUND" });
      return;
    }
    const job = order.jobId ? jobs.get(order.jobId) : undefined;
    if (!job || job.status !== "COMPLETED") {
      res.status(409).json({ error: "NOT_READY", message: "Translation isn't finished yet." });
      return;
    }
    res.download(job.outputPath, `${job.id}-bilingual.epub`, (err) => {
      if (err && !res.headersSent) {
        throw new AppError("Failed to send output file.", "DOWNLOAD_FAILED");
      }
    });
  });

  return router;
}
