import { estimateCostUsd } from "../budget/cost-calculator.js";
import { PricingNotConfiguredError } from "../domain/errors.js";
import type { AppEnv } from "../config/schema.js";

export interface TranslationPrice {
  /** What the LLM provider is estimated to cost for this translation. */
  providerCostUsd: number;
  /** What the user is charged: max(minimum, providerCost * markup), in cents. */
  amountUsdCents: number;
}

/**
 * Prices a single translation from its estimated token count. This is the
 * pay-per-translation alternative to the CLI's global day/month token
 * budgets: instead of a shared ceiling that makes everyone wait for the
 * next window, each paid translation is priced (and later budgeted, see
 * buildPaidRunBudgetEnv) for exactly the tokens it's expected to use, so it
 * can run to completion in one go.
 *
 * Throws PricingNotConfiguredError if the operator hasn't set
 * MODEL_*_PRICE_PER_MILLION_TOKENS_USD — charging a real amount from an
 * unknown cost would be a silent guess, which this codebase's existing
 * cost-calculator explicitly refuses to do (undefined, never $0).
 */
export function priceTranslationUsd(
  env: AppEnv,
  estimatedInputTokens: number,
  estimatedOutputTokens: number,
): TranslationPrice {
  const providerCostUsd = estimateCostUsd(
    {
      inputPricePerMillionTokensUsd: env.MODEL_INPUT_PRICE_PER_MILLION_TOKENS_USD,
      outputPricePerMillionTokensUsd: env.MODEL_OUTPUT_PRICE_PER_MILLION_TOKENS_USD,
    },
    estimatedInputTokens,
    estimatedOutputTokens,
  );

  if (providerCostUsd === undefined) {
    throw new PricingNotConfiguredError(
      "MODEL_INPUT_PRICE_PER_MILLION_TOKENS_USD / MODEL_OUTPUT_PRICE_PER_MILLION_TOKENS_USD " +
        "must be set to charge for translations. Check your provider's current pricing page and " +
        "set both in .env before enabling paid translations.",
    );
  }

  const markedUpCents = Math.ceil(providerCostUsd * env.PLATFORM_MARKUP_MULTIPLIER * 100);
  const amountUsdCents = Math.max(env.PLATFORM_MINIMUM_CHARGE_USD_CENTS, markedUpCents);

  return { providerCostUsd, amountUsdCents };
}
