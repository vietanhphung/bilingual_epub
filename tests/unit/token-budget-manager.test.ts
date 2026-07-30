import { describe, expect, it } from "vitest";
import { TokenBudgetManager, type BudgetConfig, type UsageSoFar } from "../../src/budget/token-budget-manager.js";

function budget(overrides: Partial<BudgetConfig> = {}): BudgetConfig {
  return {
    maxSourceTokensPerRequest: 8000,
    maxEstimatedOutputTokensPerRequest: 12000,
    maxRequestsPerRun: 10,
    maxInputTokensPerRun: 100_000,
    maxOutputTokensPerRun: 140_000,
    maxInputTokensPerDay: 100_000,
    maxOutputTokensPerDay: 140_000,
    maxInputTokensPerMonth: 2_000_000,
    maxOutputTokensPerMonth: 2_800_000,
    tokenSafetyMarginPercent: 20,
    ...overrides,
  };
}

function usage(overrides: Partial<UsageSoFar> = {}): UsageSoFar {
  return {
    requestsThisRun: 0,
    inputTokensThisRun: 0,
    outputTokensThisRun: 0,
    inputTokensToday: 0,
    outputTokensToday: 0,
    inputTokensThisMonth: 0,
    outputTokensThisMonth: 0,
    ...overrides,
  };
}

describe("TokenBudgetManager", () => {
  it("allows a small batch well within all limits", () => {
    const manager = new TokenBudgetManager(budget());
    const decision = manager.canSubmitBatch({ inputTokens: 1000, estimatedOutputTokens: 1200 }, usage());
    expect(decision.allowed).toBe(true);
  });

  it("rejects a batch exceeding the per-request source token limit", () => {
    const manager = new TokenBudgetManager(budget({ maxSourceTokensPerRequest: 8000 }));
    const decision = manager.canSubmitBatch({ inputTokens: 9000, estimatedOutputTokens: 100 }, usage());
    expect(decision).toEqual({
      allowed: false,
      scope: "REQUEST",
      reason: expect.stringContaining("9000"),
    });
  });

  it("rejects once maxRequestsPerRun would be exceeded", () => {
    const manager = new TokenBudgetManager(budget({ maxRequestsPerRun: 2 }));
    const decision = manager.canSubmitBatch(
      { inputTokens: 100, estimatedOutputTokens: 100 },
      usage({ requestsThisRun: 2 }),
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.scope).toBe("RUN");
  });

  it("applies the safety margin to run/day/month limits", () => {
    // 100 tokens/day limit, 50% margin -> effective 50; 40 used + 20 more should fail.
    const manager = new TokenBudgetManager(
      budget({ maxInputTokensPerDay: 100, tokenSafetyMarginPercent: 50 }),
    );
    const decision = manager.canSubmitBatch(
      { inputTokens: 20, estimatedOutputTokens: 1 },
      usage({ inputTokensToday: 40 }),
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.scope).toBe("DAY");
  });

  it("rejects when the monthly budget would be exceeded", () => {
    const manager = new TokenBudgetManager(budget({ maxInputTokensPerMonth: 1000, tokenSafetyMarginPercent: 0 }));
    const decision = manager.canSubmitBatch(
      { inputTokens: 500, estimatedOutputTokens: 1 },
      usage({ inputTokensThisMonth: 600 }),
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.scope).toBe("MONTH");
  });

  it("rejects when the estimated cost would exceed the per-run cost budget", () => {
    const manager = new TokenBudgetManager(budget({ maxCostPerRunUsd: 1, tokenSafetyMarginPercent: 0 }));
    const decision = manager.canSubmitBatch(
      { inputTokens: 100, estimatedOutputTokens: 100 },
      usage({ costThisRunUsd: 0.8 }),
      0.5,
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.scope).toBe("COST");
  });

  it("ignores cost budgets when no cost estimate is provided (pricing unconfigured)", () => {
    const manager = new TokenBudgetManager(budget({ maxCostPerRunUsd: 0.01, tokenSafetyMarginPercent: 0 }));
    const decision = manager.canSubmitBatch(
      { inputTokens: 100, estimatedOutputTokens: 100 },
      usage(),
      undefined,
    );
    expect(decision.allowed).toBe(true);
  });
});
