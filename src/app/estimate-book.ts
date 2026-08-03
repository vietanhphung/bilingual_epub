import { inspectBook } from "./inspect-book.js";
import { buildBatches, estimateSegmentTokens } from "../translation/batch-builder.js";
import { estimateCostUsd, type PricingConfig } from "../budget/cost-calculator.js";
import type { RunBudgetPreset } from "../config/presets.js";

export interface UnsafeParagraph {
  id: string;
  chapterPath: string;
  estimatedTokens: number;
}

export interface EstimateReport {
  chapterCount: number;
  paragraphCount: number;
  sourceTokenEstimate: number;
  estimatedOutputTokens: number;
  estimatedApiCalls: number;
  estimatedScheduledRuns: number;
  /** null for MANUAL scheduling, where the user decides when runs happen. */
  estimatedCompletionDate: string | null;
  estimatedCostUsd: number | undefined;
  unsafeParagraphs: UnsafeParagraph[];
}

/**
 * Reports scope and cost without making any translation calls: the
 * inspection + segmentation + batching pipeline runs exactly as it would
 * for a real job, but no TranslationStrategy is ever invoked.
 */
export async function estimateBook(
  buffer: Buffer,
  preset: RunBudgetPreset,
  pricing: PricingConfig,
  now: Date = new Date(),
): Promise<EstimateReport> {
  const inspection = await inspectBook(buffer);
  const tokenized = inspection.segments.map((s) => ({
    id: s.id,
    chapterPath: s.chapterPath,
    estimatedTokens: estimateSegmentTokens(s.sourceText, s.id),
  }));

  const sourceTokenEstimate = tokenized.reduce((sum, t) => sum + t.estimatedTokens, 0);
  const estimatedOutputTokens = Math.ceil(sourceTokenEstimate * 1.2);

  const batches = buildBatches(tokenized, preset.maxSourceTokensPerRequest, preset.tokenSafetyMarginPercent);
  const estimatedApiCalls = batches.length;
  const estimatedScheduledRuns = Math.max(1, Math.ceil(estimatedApiCalls / preset.maxRequestsPerRun));

  const estimatedCompletionDate = computeCompletionDate(preset.scheduleMode, estimatedScheduledRuns, now);
  const estimatedCostUsd = estimateCostUsd(pricing, sourceTokenEstimate, estimatedOutputTokens);

  const unsafeParagraphs = tokenized.filter((t) => t.estimatedTokens > preset.maxSourceTokensPerRequest);

  return {
    chapterCount: inspection.chapterCount,
    paragraphCount: inspection.paragraphCount,
    sourceTokenEstimate,
    estimatedOutputTokens,
    estimatedApiCalls,
    estimatedScheduledRuns,
    estimatedCompletionDate,
    estimatedCostUsd,
    unsafeParagraphs,
  };
}

function computeCompletionDate(
  scheduleMode: "MANUAL" | "DAILY" | "WEEKLY",
  scheduledRuns: number,
  now: Date,
): string | null {
  if (scheduleMode === "MANUAL") return null;
  const intervalDays = scheduleMode === "DAILY" ? 1 : 7;
  const completion = new Date(now);
  completion.setUTCDate(completion.getUTCDate() + (scheduledRuns - 1) * intervalDays);
  return completion.toISOString().slice(0, 10);
}
