import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../../src/persistence/database.js";
import { JobRepository } from "../../src/persistence/job-repository.js";
import { SegmentRepository } from "../../src/persistence/segment-repository.js";
import { TranslationCache, computeCacheKey } from "../../src/persistence/translation-cache.js";
import {
  translatePendingSegments,
  type OrchestratorOptions,
} from "../../src/translation/translation-orchestrator.js";
import { extractTranslatableBlocks } from "../../src/epub/content-extractor.js";
import { normalizeText, segmentBlocks } from "../../src/epub/paragraph-segmenter.js";
import { MockTranslationStrategy } from "../../src/translation/providers/mock-translation-strategy.js";
import type {
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationStrategy,
} from "../../src/domain/translation.js";

function makeJob() {
  const db = openDatabase(":memory:");
  const jobRepo = new JobRepository(db);
  const segmentRepo = new SegmentRepository(db);
  const job = jobRepo.create({
    id: randomUUID(),
    inputPath: "/tmp/book.epub",
    outputPath: "/tmp/out.epub",
    inputChecksum: "abc",
    sourceLanguage: "fr",
    targetLanguage: "en",
    displayOrder: "ENGLISH_FIRST",
    granularity: "PARAGRAPH",
    provider: "mock",
    model: "mock-1",
    totalSegments: 4,
  });
  const content = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <p>Un.</p>
  <p>Deux.</p>
  <p>Trois.</p>
  <p>Quatre.</p>
</body></html>`;
  const blocks = extractTranslatableBlocks({ path: "ch1.xhtml", content });
  const segments = segmentBlocks(blocks);
  segmentRepo.insertMany(job.id, segments);
  return { db, jobRepo, segmentRepo, job, segments };
}

function defaultOptions(): OrchestratorOptions {
  return {
    budget: {
      maxSourceTokensPerRequest: 100_000,
      maxEstimatedOutputTokensPerRequest: 100_000,
      maxRequestsPerRun: 100,
      maxInputTokensPerRun: 1_000_000,
      maxOutputTokensPerRun: 1_000_000,
      maxInputTokensPerDay: 10_000_000,
      maxOutputTokensPerDay: 10_000_000,
      maxInputTokensPerMonth: 100_000_000,
      maxOutputTokensPerMonth: 100_000_000,
      tokenSafetyMarginPercent: 0,
    },
    timezone: "UTC",
    requestDelayMs: 0,
    pricing: { inputPricePerMillionTokensUsd: undefined, outputPricePerMillionTokensUsd: undefined },
    sleep: async () => {},
  };
}

class RecordingStrategy implements TranslationStrategy {
  readonly provider = "mock";
  readonly model = "mock-1";
  calls: TranslationBatchRequest[] = [];
  constructor(private readonly impl: TranslationStrategy) {}
  countTokens(request: TranslationBatchRequest) {
    return this.impl.countTokens(request);
  }
  async translateBatch(request: TranslationBatchRequest): Promise<TranslationBatchResult> {
    this.calls.push(request);
    return this.impl.translateBatch(request);
  }
}

describe("translatePendingSegments (resumability)", () => {
  it("translates all pending segments and persists them as TRANSLATED", async () => {
    const { db, job, segmentRepo } = makeJob();
    const strategy = new MockTranslationStrategy();

    const result = await translatePendingSegments(db, job, strategy, defaultOptions());
    expect(result.processedCount).toBe(4);
    expect(result.translatedCount).toBe(4);
    expect(result.failedCount).toBe(0);

    const counts = segmentRepo.countByStatus(job.id);
    expect(counts).toEqual({ PENDING: 0, TRANSLATED: 4, FAILED: 0 });
  });

  it("does not resend already-TRANSLATED segments on a second run (simulated restart)", async () => {
    const { db, job, segmentRepo } = makeJob();
    const recording = new RecordingStrategy(new MockTranslationStrategy());

    await translatePendingSegments(db, job, recording, defaultOptions());
    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]!.segments).toHaveLength(4);

    const beforeSecondRun = segmentRepo.listByJob(job.id);

    // Simulate the process being killed and a fresh run() call afterward:
    // the same job, a brand-new orchestrator invocation.
    const secondResult = await translatePendingSegments(db, job, recording, defaultOptions());
    expect(secondResult.processedCount).toBe(0);
    expect(recording.calls).toHaveLength(1); // no new provider call

    const afterSecondRun = segmentRepo.listByJob(job.id);
    expect(afterSecondRun).toEqual(beforeSecondRun);
  });

  it("only re-processes segments explicitly reset to PENDING after a failure", async () => {
    const { db, job, segmentRepo, segments } = makeJob();
    const failingThenWorking: TranslationStrategy = {
      provider: "mock",
      model: "mock-1",
      countTokens: (req) => new MockTranslationStrategy().countTokens(req),
      translateBatch: async (req) => {
        // Simulate the provider dropping one segment's id from its response.
        const survivors = req.segments.filter((s) => s.id !== segments[0]!.id);
        const mock = new MockTranslationStrategy();
        return mock.translateBatch({ segments: survivors });
      },
    };

    const first = await translatePendingSegments(db, job, failingThenWorking, defaultOptions());
    expect(first.translatedCount).toBe(3);
    expect(first.failedCount).toBe(1);

    const counts = segmentRepo.countByStatus(job.id);
    expect(counts.FAILED).toBe(1);

    // Explicitly retry the failed one (what the `retry` CLI command will do).
    segmentRepo.resetToPending(job.id, segments[0]!.id);
    const second = await translatePendingSegments(db, job, new MockTranslationStrategy(), defaultOptions());
    expect(second.processedCount).toBe(1);
    expect(second.translatedCount).toBe(1);

    const finalCounts = segmentRepo.countByStatus(job.id);
    expect(finalCounts).toEqual({ PENDING: 0, TRANSLATED: 4, FAILED: 0 });
  });

  it("serves a cache hit without calling the provider", async () => {
    const { db, job, segmentRepo, segments } = makeJob();
    const cache = new TranslationCache(db);
    const first = segments[0]!;
    const cacheKey = computeCacheKey({
      sourceLanguage: job.sourceLanguage,
      targetLanguage: job.targetLanguage,
      provider: job.provider,
      model: job.model,
      normalizedSourceText: normalizeText(first.sourceText),
    });
    cache.set(cacheKey, "[EN] Cached translation.");

    const strategy: TranslationStrategy = {
      provider: "mock",
      model: "mock-1",
      countTokens: async () => ({ inputTokens: 0, estimatedOutputTokens: 0 }),
      translateBatch: vi.fn(async (req: TranslationBatchRequest) => {
        // Only the non-cached segments should ever reach here.
        expect(req.segments.some((s) => s.id === first.id)).toBe(false);
        return new MockTranslationStrategy().translateBatch(req);
      }),
    };

    const result = await translatePendingSegments(db, job, strategy, defaultOptions());
    expect(result.cacheHits).toBe(1);
    expect(result.translatedCount).toBe(4);

    const translated = segmentRepo.listByJobAndStatus(job.id, "TRANSLATED");
    const cachedSegment = translated.find((s) => s.id === first.id)!;
    expect(cachedSegment.translatedText).toBe("[EN] Cached translation.");
  });

  it("marks a segment FAILED (not thrown) when a provider network error occurs", async () => {
    const { db, job, segmentRepo } = makeJob();
    const throwingStrategy: TranslationStrategy = {
      provider: "mock",
      model: "mock-1",
      countTokens: async () => ({ inputTokens: 0, estimatedOutputTokens: 0 }),
      translateBatch: async () => {
        throw new Error("network down");
      },
    };

    const result = await translatePendingSegments(db, job, throwingStrategy, defaultOptions());
    expect(result.failedCount).toBe(4);
    expect(result.translatedCount).toBe(0);

    const failed = segmentRepo.listByJobAndStatus(job.id, "FAILED");
    expect(failed).toHaveLength(4);
    expect(failed[0]!.errorMessage).toMatch(/network down/);
  });

  it("stops with BUDGET once the per-run request limit is reached, leaving the rest PENDING", async () => {
    const db = openDatabase(":memory:");
    const jobRepo = new JobRepository(db);
    const segmentRepo = new SegmentRepository(db);
    const job = jobRepo.create({
      id: randomUUID(),
      inputPath: "/tmp/book.epub",
      outputPath: "/tmp/out.epub",
      inputChecksum: "abc",
      sourceLanguage: "fr",
      targetLanguage: "en",
      displayOrder: "ENGLISH_FIRST",
      granularity: "PARAGRAPH",
      provider: "mock",
      model: "mock-1",
      totalSegments: 2,
    });
    // Two chapters -> batch-builder puts them in separate batches, so a
    // maxRequestsPerRun of 1 can only ever submit the first.
    const blocks = [
      ...extractTranslatableBlocks({ path: "ch1.xhtml", content: "<p>Un.</p>" }),
      ...extractTranslatableBlocks({ path: "ch2.xhtml", content: "<p>Deux.</p>" }),
    ];
    const segments = segmentBlocks(blocks);
    segmentRepo.insertMany(job.id, segments);

    const options = defaultOptions();
    options.budget.maxRequestsPerRun = 1;

    const result = await translatePendingSegments(db, job, new MockTranslationStrategy(), options);
    expect(result.stopReason).toBe("BUDGET");
    expect(result.translatedCount).toBe(1);

    const counts = segmentRepo.countByStatus(job.id);
    expect(counts).toEqual({ PENDING: 1, TRANSLATED: 1, FAILED: 0 });

    // A subsequent run (relaxed budget) picks up exactly the remaining segment.
    const second = await translatePendingSegments(db, job, new MockTranslationStrategy(), defaultOptions());
    expect(second.processedCount).toBe(1);
    expect(second.stopReason).toBeUndefined();
    expect(segmentRepo.countByStatus(job.id)).toEqual({ PENDING: 0, TRANSLATED: 2, FAILED: 0 });
  });

  it("stops with RATE_LIMIT (not FAILED) when the provider is throttled, leaving segments PENDING for retry", async () => {
    const { db, job, segmentRepo } = makeJob();
    const { RateLimitError } = await import("../../src/domain/errors.js");
    const rateLimitedStrategy: TranslationStrategy = {
      provider: "mock",
      model: "mock-1",
      countTokens: (req) => new MockTranslationStrategy().countTokens(req),
      translateBatch: async () => {
        throw new RateLimitError("slow down");
      },
    };

    const result = await translatePendingSegments(db, job, rateLimitedStrategy, defaultOptions());
    expect(result.stopReason).toBe("RATE_LIMIT");
    expect(result.failedCount).toBe(0);

    const counts = segmentRepo.countByStatus(job.id);
    expect(counts).toEqual({ PENDING: 4, TRANSLATED: 0, FAILED: 0 });
  });
});
