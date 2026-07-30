import { describe, expect, it } from "vitest";
import type { Job } from "../../src/domain/job.js";
import type { Segment } from "../../src/domain/segment.js";
import { buildProcessingReport } from "../../src/app/processing-report.js";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    inputPath: "/tmp/book.epub",
    outputPath: "/tmp/book-bilingual.epub",
    inputChecksum: "abc",
    sourceLanguage: "fr",
    targetLanguage: "en",
    displayOrder: "ENGLISH_FIRST",
    granularity: "PARAGRAPH",
    provider: "mock",
    model: "mock-1",
    status: "COMPLETED",
    totalSegments: 10,
    completedSegments: 9,
    failedSegments: 1,
    accumulatedInputTokens: 500,
    accumulatedOutputTokens: 600,
    estimatedCost: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:05:00.000Z",
    lastRunAt: "2026-01-01T00:05:00.000Z",
    nextRunAt: null,
    errorMessage: null,
    ...overrides,
  };
}

function makeFailedSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: "seg-1",
    jobId: "job-1",
    chapterPath: "ch1.xhtml",
    elementLocator: "body[0]>p[0]",
    orderIndex: 0,
    sourceText: "Bonjour.",
    sourceHtml: "Bonjour.",
    sourceChecksum: "checksum",
    translatedText: null,
    translatedHtml: null,
    status: "FAILED",
    retryCount: 1,
    inputTokens: null,
    outputTokens: null,
    errorMessage: "Translation is blank",
    ...overrides,
  };
}

describe("buildProcessingReport", () => {
  it("captures the documented top-level fields from the job", () => {
    const job = makeJob();
    const report = buildProcessingReport(job, [], [], "2026-01-01T00:05:00.000Z");

    expect(report).toMatchObject({
      jobId: "job-1",
      sourceFile: "/tmp/book.epub",
      outputFile: "/tmp/book-bilingual.epub",
      sourceLanguage: "fr",
      targetLanguage: "en",
      displayOrder: "ENGLISH_FIRST",
      totalSegments: 10,
      translatedSegments: 9,
      failedSegments: 1,
      inputTokens: 500,
      outputTokens: 600,
      provider: "mock",
      model: "mock-1",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:05:00.000Z",
    });
  });

  it("summarizes failed segments by id, chapter, and error message", () => {
    const job = makeJob();
    const failed = [makeFailedSegment()];
    const report = buildProcessingReport(job, failed, []);

    expect(report.failures).toEqual([
      { id: "seg-1", chapterPath: "ch1.xhtml", errorMessage: "Translation is blank" },
    ]);
  });

  it("includes validation issues verbatim", () => {
    const job = makeJob();
    const issues = [{ code: "UNRESOLVED_LINK", message: "ch1.xhtml: link to missing file" }];
    const report = buildProcessingReport(job, [], issues);
    expect(report.validationIssues).toEqual(issues);
  });
});
