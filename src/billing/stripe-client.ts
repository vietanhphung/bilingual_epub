import Stripe from "stripe";
import type { AppEnv } from "../config/schema.js";
import { AppError } from "../domain/errors.js";

let cachedClient: Stripe | undefined;

/**
 * Lazily builds a Stripe client from STRIPE_SECRET_KEY. Kept out of
 * strategy-factory/env.ts on purpose: billing is optional (mock/local use
 * of the CLI never needs it), so failing fast only happens the moment a
 * billing route is actually hit, not at process startup.
 */
export function getStripeClient(env: AppEnv): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(
      "STRIPE_SECRET_KEY is not set. Create a Stripe account, grab a test-mode secret key " +
        "from dashboard.stripe.com/test/apikeys, and add it to .env.",
      "STRIPE_NOT_CONFIGURED",
    );
  }
  if (!cachedClient) {
    cachedClient = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return cachedClient;
}

export function resetStripeClientCache(): void {
  cachedClient = undefined;
}
