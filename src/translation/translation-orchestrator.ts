import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { AppDatabase } from "../persistence/database.js";
import { SegmentRepository } from "../persistence/segment-repository.js";
import { TranslationCache, computeCacheKey } from "../persistence/translation-cache.js";
import {
  UsageRepository,
  dateKeyInTimezone,
  monthKeyInTimezone,
} from "../persistence/usage-repository.js";
import type { Job } from "../domain/job.js";
import { AuthenticationError, RateLimitError } from "../domain/errors.js";
import type { TranslationBatchRequest, TranslationStrategy } from "../domain/translation.js";
import { validateTranslationBatch } from "./translation-validator.js";
import {
  extractPlaceholderTags,
  placeholderizeInlineContent,
  reconstructInlineContent,
} from "../epub/inline-placeholder.js";
import { normalizeText } from "../epub/paragraph-segmenter.js";
import { buildBatches, estimateSegmentTokens } from "./batch-builder.js";
import { TokenBudgetManager, type BudgetConfig } from "../budget/token-budget-manager.js";
import { estimateCostUsd } from "../budget/cost-calculator.js";

export type OrchestratorStopReason = "BUDGET" | "RATE_LIMIT" | "AUTH_ERROR";

export interface OrchestratorRunResult {
  processedCount: number;
  translatedCount: number;
  failedCount: number;
  cacheHits: number;
  requestsMade: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | undefined;
  stopReason?: OrchestratorStopReason | undefined;
  stopMessage?: string | undefined;
}

export interface OrchestratorOptions {
  budget: BudgetConfig;
  timezone: string;
  requestDelayMs: number;
  pricing: { inputPricePerMillionTokensUsd: number | undefined; outputPricePerMillionTokensUsd: number | undefined };
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

function reconstructTranslatedHtml(
  sourceHtml: string,
  translatedPlaceholderText: string,
): string | null {
  const $ = cheerio.load(`<x-root>${sourceHtml}</x-root>`, { xmlMode: true });
  const root = $("x-root")[0] as Element;
  const { placeholders } = placeholderizeInlineContent($, root);
  return reconstructInlineContent(translatedPlaceholderText, placeholders);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Translates PENDING segments for a job, batch by batch, stopping cleanly
 * before exceeding the configured request/run/day/month/cost budget
 * (PAUSED_BUDGET), on a rate limit the provider itself couldn't recover
 * from after retrying (PAUSED_RATE_LIMIT), or on an authentication error
 * (job FAILED — retrying a bad key indefinitely wastes time and can
 * trigger provider lockouts). Each batch is persisted in its own
 * transaction immediately after it completes, so a process killed
 * mid-run loses at most the batch in flight — every earlier batch in the
 * same run is already durable, and PENDING segments are never resent.
 */
export async function translatePendingSegments(
  db: AppDatabase,
  job: Job,
  strategy: TranslationStrategy,
  options: OrchestratorOptions,
): Promise<OrchestratorRunResult> {
  const segmentRepo = new SegmentRepository(db);
  const cache = new TranslationCache(db);
  const usageRepo = new UsageRepository(db);
  const budgetManager = new TokenBudgetManager(options.budget);
  const sleep = options.sleep ?? defaultSleep;

  const now = new Date();
  const dateKey = dateKeyInTimezone(now, options.timezone);
  const monthKey = monthKeyInTimezone(now, options.timezone);
  const usageToday = usageRepo.sumForDateKey(dateKey);
  const usageThisMonth = usageRepo.sumForMonthKey(monthKey);

  const cacheKeyFor = (sourceText: string) =>
    computeCacheKey({
      sourceLanguage: job.sourceLanguage,
      targetLanguage: job.targetLanguage,
      provider: job.provider,
      model: job.model,
      normalizedSourceText: normalizeText(sourceText),
    });

  const pending = segmentRepo.listByJobAndStatus(job.id, "PENDING");

  let cacheHits = 0;
  let translatedCount = 0;
  let failedCount = 0;
  let requestsThisRun = 0;
  let inputTokensThisRun = 0;
  let outputTokensThisRun = 0;
  let costThisRunUsd: number | undefined;
  let stopReason: OrchestratorStopReason | undefined;
  let stopMessage: string | undefined;

  // Cache hits are resolved and persisted up front — they never touch the
  // provider or the budget, so they should never be what a pause blocks on.
  const remaining: typeof pending = [];
  for (const segment of pending) {
    const cached = cache.get(cacheKeyFor(segment.sourceText));
    if (cached === undefined) {
      remaining.push(segment);
      continue;
    }
    cacheHits += 1;
    const reconstructed = reconstructTranslatedHtml(segment.sourceHtml, cached);
    const persistCacheHit = db.transaction(() => {
      if (reconstructed === null) {
        segmentRepo.markFailed(
          job.id,
          segment.id,
          "Inline placeholder reconstruction failed; retaining source paragraph",
        );
        failedCount += 1;
      } else {
        segmentRepo.markTranslated(job.id, segment.id, {
          translatedText: cached,
          translatedHtml: reconstructed,
          inputTokens: 0,
          outputTokens: 0,
        });
        translatedCount += 1;
      }
    });
    persistCacheHit();
  }

  const batches = buildBatches(
    remaining.map((s) => ({
      id: s.id,
      chapterPath: s.chapterPath,
      estimatedTokens: estimateSegmentTokens(s.sourceText),
    })),
    options.budget.maxSourceTokensPerRequest,
    options.budget.tokenSafetyMarginPercent,
  );
  const segmentsById = new Map(remaining.map((s) => [s.id, s]));

  for (const batchIds of batches) {
    const batchSegments = batchIds.map((id) => segmentsById.get(id)!);
    const request: TranslationBatchRequest = {
      segments: batchSegments.map((s) => ({
        id: s.id,
        sourceLanguage: job.sourceLanguage,
        targetLanguage: job.targetLanguage,
        text: s.sourceText,
        protectedPlaceholders: extractPlaceholderTags(s.sourceText),
      })),
    };

    const estimate = await strategy.countTokens(request);
    const costEstimate = estimateCostUsd(
      options.pricing,
      estimate.inputTokens,
      estimate.estimatedOutputTokens,
    );

    const decision = budgetManager.canSubmitBatch(
      estimate,
      {
        requestsThisRun,
        inputTokensThisRun,
        outputTokensThisRun,
        inputTokensToday: usageToday.inputTokens + inputTokensThisRun,
        outputTokensToday: usageToday.outputTokens + outputTokensThisRun,
        inputTokensThisMonth: usageThisMonth.inputTokens + inputTokensThisRun,
        outputTokensThisMonth: usageThisMonth.outputTokens + outputTokensThisRun,
        costThisRunUsd,
      },
      costEstimate,
    );

    if (!decision.allowed) {
      stopReason = "BUDGET";
      stopMessage = `${decision.scope}: ${decision.reason}`;
      break;
    }

    if (requestsThisRun > 0 && options.requestDelayMs > 0) {
      await sleep(options.requestDelayMs);
    }

    let result;
    try {
      result = await strategy.translateBatch(request);
    } catch (err) {
      if (err instanceof RateLimitError) {
        stopReason = "RATE_LIMIT";
        stopMessage = err.message;
        break;
      }
      if (err instanceof AuthenticationError) {
        stopReason = "AUTH_ERROR";
        stopMessage = err.message;
        break;
      }
      // Any other provider error fails just this batch's segments; the
      // rest of the job continues (a single paragraph failing shouldn't
      // fail the whole book).
      const message = err instanceof Error ? err.message : String(err);
      const persistBatchFailure = db.transaction(() => {
        for (const segment of batchSegments) {
          segmentRepo.markFailed(job.id, segment.id, message);
          failedCount += 1;
        }
      });
      persistBatchFailure();
      continue;
    }

    requestsThisRun += 1;
    inputTokensThisRun += result.usage.inputTokens;
    outputTokensThisRun += result.usage.outputTokens;
    const actualCost = estimateCostUsd(options.pricing, result.usage.inputTokens, result.usage.outputTokens);
    if (actualCost !== undefined) {
      costThisRunUsd = (costThisRunUsd ?? 0) + actualCost;
    }

    const outcome = validateTranslationBatch(request, result);

    const persistBatch = db.transaction(() => {
      for (const [id, translatedText] of outcome.valid) {
        const segment = segmentsById.get(id)!;
        const reconstructed = reconstructTranslatedHtml(segment.sourceHtml, translatedText);
        if (reconstructed === null) {
          segmentRepo.markFailed(
            job.id,
            id,
            "Inline placeholder reconstruction failed; retaining source paragraph",
          );
          failedCount += 1;
          continue;
        }
        segmentRepo.markTranslated(job.id, id, {
          translatedText,
          translatedHtml: reconstructed,
          inputTokens: 0,
          outputTokens: 0,
        });
        translatedCount += 1;
        cache.set(cacheKeyFor(segment.sourceText), translatedText);
      }
      for (const rejected of outcome.rejected) {
        segmentRepo.markFailed(job.id, rejected.id, rejected.reason);
        failedCount += 1;
      }
      for (const missingId of outcome.missingIds) {
        segmentRepo.markFailed(
          job.id,
          missingId,
          "Provider did not return a translation for this segment",
        );
        failedCount += 1;
      }
      usageRepo.record({
        jobId: job.id,
        provider: job.provider,
        model: job.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        timezone: options.timezone,
        now: new Date(),
      });
    });
    persistBatch();
  }

  return {
    processedCount: pending.length,
    translatedCount,
    failedCount,
    cacheHits,
    requestsMade: requestsThisRun,
    inputTokens: inputTokensThisRun,
    outputTokens: outputTokensThisRun,
    costUsd: costThisRunUsd,
    stopReason,
    stopMessage,
  };
}
