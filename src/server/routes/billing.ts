import { Router } from "express";
import type { AppDatabase } from "../../persistence/database.js";
import type { AppEnv } from "../../config/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { getStripeClient } from "../../billing/stripe-client.js";
import { settleCheckoutSession } from "./billing-webhook.js";

export function billingRouter(db: AppDatabase, env: AppEnv): Router {
  const router = Router();

  router.get("/config", (_req, res) => {
    res.json({ publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null });
  });

  // Local-dev fallback: without `stripe listen --forward-to`, the webhook
  // never reaches localhost. The frontend calls this right after the
  // Checkout success redirect so the demo works without extra setup; in
  // production the webhook above is what you rely on, since a user closing
  // the tab before this call fires must not leave the order unpaid.
  router.post("/reconcile/:sessionId", requireAuth, async (req, res, next) => {
    try {
      const stripe = getStripeClient(env);
      const session = await stripe.checkout.sessions.retrieve(req.params.sessionId as string);
      await settleCheckoutSession(db, env, session);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
