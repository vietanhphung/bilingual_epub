import type { AppEnv } from "../config/schema.js";

export interface BudgetConfig {
  maxSourceTokensPerRequest: number;
  maxEstimatedOutputTokensPerRequest: number;
  maxRequestsPerRun: number;
  maxInputTokensPerRun: number;
  maxOutputTokensPerRun: number;
  maxInputTokensPerDay: number;
  maxOutputTokensPerDay: number;
  maxInputTokensPerMonth: number;
  maxOutputTokensPerMonth: number;
  tokenSafetyMarginPercent: number;
  maxCostPerRunUsd?: number | undefined;
  maxCostPerDayUsd?: number | undefined;
  maxCostPerMonthUsd?: number | undefined;
}

export interface UsageSoFar {
  requestsThisRun: number;
  inputTokensThisRun: number;
  outputTokensThisRun: number;
  inputTokensToday: number;
  outputTokensToday: number;
  inputTokensThisMonth: number;
  outputTokensThisMonth: number;
  costThisRunUsd?: number | undefined;
  costTodayUsd?: number | undefined;
  costThisMonthUsd?: number | undefined;
}

export function budgetConfigFromEnv(env: AppEnv): BudgetConfig {
  return {
    maxSourceTokensPerRequest: env.MAX_SOURCE_TOKENS_PER_REQUEST,
    maxEstimatedOutputTokensPerRequest: env.MAX_ESTIMATED_OUTPUT_TOKENS_PER_REQUEST,
    maxRequestsPerRun: env.MAX_REQUESTS_PER_RUN,
    maxInputTokensPerRun: env.MAX_INPUT_TOKENS_PER_RUN,
    maxOutputTokensPerRun: env.MAX_OUTPUT_TOKENS_PER_RUN,
    maxInputTokensPerDay: env.MAX_INPUT_TOKENS_PER_DAY,
    maxOutputTokensPerDay: env.MAX_OUTPUT_TOKENS_PER_DAY,
    maxInputTokensPerMonth: env.MAX_INPUT_TOKENS_PER_MONTH,
    maxOutputTokensPerMonth: env.MAX_OUTPUT_TOKENS_PER_MONTH,
    tokenSafetyMarginPercent: env.TOKEN_SAFETY_MARGIN_PERCENT,
    maxCostPerRunUsd: env.MAX_COST_PER_RUN_USD,
    maxCostPerDayUsd: env.MAX_COST_PER_DAY_USD,
    maxCostPerMonthUsd: env.MAX_COST_PER_MONTH_USD,
  };
}

export type BudgetScope = "REQUEST" | "RUN" | "DAY" | "MONTH" | "COST";

export type BudgetDecision =
  | { allowed: true }
  | { allowed: false; scope: BudgetScope; reason: string };

/**
 * Pure decision logic for "can this batch be submitted right now" — no
 * I/O. Scheduling decides *when* work starts; this decides *when it must
 * stop*, per request/run/day/month/cost, with a safety margin reserved
 * off every non-per-request limit for response variability and
 * formatting overhead.
 */
export class TokenBudgetManager {
  constructor(private readonly config: BudgetConfig) {}

  private effectiveLimit(limit: number): number {
    return Math.floor(limit * (1 - this.config.tokenSafetyMarginPercent / 100));
  }

  canSubmitBatch(
    estimate: { inputTokens: number; estimatedOutputTokens: number },
    usage: UsageSoFar,
    estimatedCostUsd?: number,
  ): BudgetDecision {
    if (estimate.inputTokens > this.config.maxSourceTokensPerRequest) {
      return {
        allowed: false,
        scope: "REQUEST",
        reason: `Batch source tokens (${estimate.inputTokens}) exceed the per-request limit (${this.config.maxSourceTokensPerRequest})`,
      };
    }
    if (estimate.estimatedOutputTokens > this.config.maxEstimatedOutputTokensPerRequest) {
      return {
        allowed: false,
        scope: "REQUEST",
        reason: `Batch estimated output tokens (${estimate.estimatedOutputTokens}) exceed the per-request limit (${this.config.maxEstimatedOutputTokensPerRequest})`,
      };
    }

    if (usage.requestsThisRun + 1 > this.config.maxRequestsPerRun) {
      return {
        allowed: false,
        scope: "RUN",
        reason: `This run has already reached its request limit (${this.config.maxRequestsPerRun})`,
      };
    }

    const runInputLimit = this.effectiveLimit(this.config.maxInputTokensPerRun);
    if (usage.inputTokensThisRun + estimate.inputTokens > runInputLimit) {
      return {
        allowed: false,
        scope: "RUN",
        reason: `Batch would exceed this run's input token budget (${runInputLimit} after ${this.config.tokenSafetyMarginPercent}% safety margin)`,
      };
    }
    const runOutputLimit = this.effectiveLimit(this.config.maxOutputTokensPerRun);
    if (usage.outputTokensThisRun + estimate.estimatedOutputTokens > runOutputLimit) {
      return {
        allowed: false,
        scope: "RUN",
        reason: `Batch would exceed this run's output token budget (${runOutputLimit} after ${this.config.tokenSafetyMarginPercent}% safety margin)`,
      };
    }

    const dayInputLimit = this.effectiveLimit(this.config.maxInputTokensPerDay);
    if (usage.inputTokensToday + estimate.inputTokens > dayInputLimit) {
      return {
        allowed: false,
        scope: "DAY",
        reason: `Batch would exceed today's input token budget (${dayInputLimit} after safety margin)`,
      };
    }
    const dayOutputLimit = this.effectiveLimit(this.config.maxOutputTokensPerDay);
    if (usage.outputTokensToday + estimate.estimatedOutputTokens > dayOutputLimit) {
      return {
        allowed: false,
        scope: "DAY",
        reason: `Batch would exceed today's output token budget (${dayOutputLimit} after safety margin)`,
      };
    }

    const monthInputLimit = this.effectiveLimit(this.config.maxInputTokensPerMonth);
    if (usage.inputTokensThisMonth + estimate.inputTokens > monthInputLimit) {
      return {
        allowed: false,
        scope: "MONTH",
        reason: `Batch would exceed this month's input token budget (${monthInputLimit} after safety margin)`,
      };
    }
    const monthOutputLimit = this.effectiveLimit(this.config.maxOutputTokensPerMonth);
    if (usage.outputTokensThisMonth + estimate.estimatedOutputTokens > monthOutputLimit) {
      return {
        allowed: false,
        scope: "MONTH",
        reason: `Batch would exceed this month's output token budget (${monthOutputLimit} after safety margin)`,
      };
    }

    if (estimatedCostUsd !== undefined) {
      const { maxCostPerRunUsd, maxCostPerDayUsd, maxCostPerMonthUsd } = this.config;
      if (maxCostPerRunUsd !== undefined && (usage.costThisRunUsd ?? 0) + estimatedCostUsd > maxCostPerRunUsd) {
        return { allowed: false, scope: "COST", reason: `Batch would exceed the per-run cost budget ($${maxCostPerRunUsd})` };
      }
      if (maxCostPerDayUsd !== undefined && (usage.costTodayUsd ?? 0) + estimatedCostUsd > maxCostPerDayUsd) {
        return { allowed: false, scope: "COST", reason: `Batch would exceed today's cost budget ($${maxCostPerDayUsd})` };
      }
      if (
        maxCostPerMonthUsd !== undefined &&
        (usage.costThisMonthUsd ?? 0) + estimatedCostUsd > maxCostPerMonthUsd
      ) {
        return { allowed: false, scope: "COST", reason: `Batch would exceed this month's cost budget ($${maxCostPerMonthUsd})` };
      }
    }

    return { allowed: true };
  }
}
