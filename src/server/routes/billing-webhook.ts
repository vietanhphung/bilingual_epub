import type { Request, Response } from "express";
import type Stripe from "stripe";
import type { AppDatabase } from "../../persistence/database.js";
import type { AppEnv } from "../../config/schema.js";
import { getStripeClient } from "../../billing/stripe-client.js";
import { OrderRepository } from "../../persistence/order-repository.js";
import { UserRepository } from "../../persistence/user-repository.js";
import { startOrderJob } from "../lib/start-order-job.js";
import { getLogger } from "../../logging/logger.js";

/**
 * Idempotently turns a paid Stripe Checkout Session into a running
 * translation job. Called from both the webhook (the source of truth in
 * production) and the reconcile endpoint (a same-effect fallback for local
 * dev, where Stripe can't reach localhost without `stripe listen`).
 */
export async function settleCheckoutSession(
  db: AppDatabase,
  env: AppEnv,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const orders = new OrderRepository(db);
  const users = new UserRepository(db);

  const orderId = session.client_reference_id ?? undefined;
  const order = orderId ? orders.get(orderId) : orders.findByStripeSessionId(session.id);
  if (!order) return;
  if (order.status !== "AWAITING_PAYMENT") return; // already settled or not ours to settle
  if (session.payment_status !== "paid") return;

  const customerId = typeof session.customer === "string" ? session.customer : undefined;
  if (customerId) {
    const user = users.get(order.userId);
    if (user && !user.stripeCustomerId) users.setStripeCustomerId(user.id, customerId);
  }

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
  orders.markPaid(order.id, paymentIntentId);
  await startOrderJob(db, env, orders.getOrThrow(order.id));
}

export function stripeWebhookHandler(db: AppDatabase, env: AppEnv) {
  return async (req: Request, res: Response): Promise<void> => {
    const logger = getLogger();
    if (!env.STRIPE_WEBHOOK_SECRET) {
      res.status(503).json({ error: "STRIPE_NOT_CONFIGURED" });
      return;
    }

    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") {
      res.status(400).send("missing stripe-signature header");
      return;
    }

    let event: Stripe.Event;
    try {
      const stripe = getStripeClient(env);
      event = stripe.webhooks.constructEvent(req.body as Buffer, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      logger.warn({ err }, "rejected stripe webhook: signature verification failed");
      res.status(400).send("invalid signature");
      return;
    }

    try {
      if (event.type === "checkout.session.completed") {
        await settleCheckoutSession(db, env, event.data.object);
      }
      res.json({ received: true });
    } catch (err) {
      logger.error({ err, eventId: event.id }, "failed to process stripe webhook event");
      res.status(500).json({ error: "WEBHOOK_PROCESSING_FAILED" });
    }
  };
}
