import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../../src/budget/cost-calculator.js";

describe("estimateCostUsd", () => {
  it("returns undefined when pricing is not configured", () => {
    expect(
      estimateCostUsd(
        { inputPricePerMillionTokensUsd: undefined, outputPricePerMillionTokensUsd: undefined },
        1000,
        1000,
      ),
    ).toBeUndefined();
  });

  it("returns undefined when only one price is configured", () => {
    expect(
      estimateCostUsd(
        { inputPricePerMillionTokensUsd: 3, outputPricePerMillionTokensUsd: undefined },
        1000,
        1000,
      ),
    ).toBeUndefined();
  });

  it("computes cost from configured per-million-token prices", () => {
    const cost = estimateCostUsd(
      { inputPricePerMillionTokensUsd: 3, outputPricePerMillionTokensUsd: 15 },
      1_000_000,
      1_000_000,
    );
    expect(cost).toBeCloseTo(18, 5);
  });
});
