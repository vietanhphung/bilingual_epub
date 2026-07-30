export interface PricingConfig {
  inputPricePerMillionTokensUsd: number | undefined;
  outputPricePerMillionTokensUsd: number | undefined;
}

/**
 * Estimates USD cost from token counts. Returns undefined (not zero) when
 * pricing isn't configured — an unpriced run has *unknown* cost, not free
 * cost, and callers must not treat undefined as "no monetary budget risk."
 */
export function estimateCostUsd(
  pricing: PricingConfig,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const { inputPricePerMillionTokensUsd, outputPricePerMillionTokensUsd } = pricing;
  if (
    inputPricePerMillionTokensUsd === undefined ||
    outputPricePerMillionTokensUsd === undefined
  ) {
    return undefined;
  }
  return (
    (inputTokens / 1_000_000) * inputPricePerMillionTokensUsd +
    (outputTokens / 1_000_000) * outputPricePerMillionTokensUsd
  );
}
