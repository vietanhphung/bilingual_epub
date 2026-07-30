import type { AppEnv } from "../../config/schema.js";

/**
 * Builds a per-run budget sized to one paid translation instead of the
 * CLI's small shared daily/monthly defaults. The whole point of charging
 * per translation is that a paying user's book gets a budget scoped to
 * exactly what they paid for and runs to completion in one background
 * pass, rather than sharing the global MAX_*_TOKENS_PER_DAY ceiling meant
 * for free/manual CLI use and pausing until the next window.
 *
 * Day/month ledger limits are intentionally left as configured — they
 * still protect the operator's provider account from a runaway bill
 * across all jobs. Set them generously in production once paid traffic is
 * real (see README "Running this as a hosted product").
 */
export function buildPaidRunEnv(
  env: AppEnv,
  estimatedInputTokens: number,
  estimatedOutputTokens: number,
): AppEnv {
  const requestTokenCap = env.MAX_SOURCE_TOKENS_PER_REQUEST;
  const headroom = 1.5;
  const estimatedRequests = Math.max(1, Math.ceil(estimatedInputTokens / requestTokenCap));

  return {
    ...env,
    MAX_REQUESTS_PER_RUN: Math.ceil(estimatedRequests * headroom) + 5,
    MAX_INPUT_TOKENS_PER_RUN: Math.ceil(estimatedInputTokens * headroom) + requestTokenCap,
    MAX_OUTPUT_TOKENS_PER_RUN:
      Math.ceil(estimatedOutputTokens * headroom) + env.MAX_ESTIMATED_OUTPUT_TOKENS_PER_REQUEST,
  };
}
