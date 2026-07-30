import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/persistence/database.js";
import { JobRepository } from "../../src/persistence/job-repository.js";
import { SegmentRepository } from "../../src/persistence/segment-repository.js";
import { createJob } from "../../src/app/create-job.js";
import { runJob } from "../../src/app/run-job.js";
import { MockTranslationStrategy } from "../../src/translation/providers/mock-translation-strategy.js";
import { validateEpub } from "../../src/epub/epub-validator.js";
import { buildSimpleFixtureEpub } from "../fixtures/build-epub.js";
import { envSchema } from "../../src/config/schema.js";

const testEnv = envSchema.parse({ REQUEST_DELAY_MS: "0" });

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "bilingual-epub-test-"));
});

describe("persisted job pipeline (Milestone 6)", () => {
  it("runs create -> translate -> render -> COMPLETED and writes a valid output EPUB", async () => {
    const inputPath = join(workDir, "book.epub");
    const outputPath = join(workDir, "book-bilingual.epub");
    await writeFile(inputPath, await buildSimpleFixtureEpub());

    const db = openDatabase(":memory:");
    const strategy = new MockTranslationStrategy();

    const job = await createJob(db, {
      inputPath,
      outputPath,
      config: {
        sourceLanguage: "fr",
        targetLanguage: "en",
        displayOrder: "ENGLISH_FIRST",
        granularity: "PARAGRAPH",
      },
      provider: "mock",
      model: "mock-1",
    });
    expect(job.status).toBe("READY");
    expect(job.totalSegments).toBeGreaterThan(0);

    const { job: completed, reportPath } = await runJob(db, job.id, strategy, testEnv);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedSegments).toBe(job.totalSegments);
    expect(completed.failedSegments).toBe(0);

    const outputBuffer = await readFile(outputPath);
    const validation = await validateEpub(outputBuffer);
    expect(validation.issues).toEqual([]);
    expect(validation.valid).toBe(true);

    expect(reportPath).toBe(`${outputPath}.report.json`);
    const report = JSON.parse(await readFile(reportPath!, "utf-8"));
    expect(report.jobId).toBe(job.id);
    expect(report.totalSegments).toBe(job.totalSegments);
    expect(report.translatedSegments).toBe(job.totalSegments);
    expect(report.failedSegments).toBe(0);
    expect(report.failures).toEqual([]);
    expect(report.validationIssues).toEqual([]);
    expect(report.provider).toBe("mock");
  });

  it("is idempotent when run again after COMPLETED (no duplicate translation or re-render)", async () => {
    const inputPath = join(workDir, "book.epub");
    const outputPath = join(workDir, "book-bilingual.epub");
    await writeFile(inputPath, await buildSimpleFixtureEpub());

    const db = openDatabase(":memory:");
    const strategy = new MockTranslationStrategy();

    const job = await createJob(db, {
      inputPath,
      outputPath,
      config: {
        sourceLanguage: "fr",
        targetLanguage: "en",
        displayOrder: "ENGLISH_FIRST",
        granularity: "PARAGRAPH",
      },
      provider: "mock",
      model: "mock-1",
    });
    await runJob(db, job.id, strategy, testEnv);
    const outputBytesFirst = await readFile(outputPath);

    const { job: secondRun } = await runJob(db, job.id, strategy, testEnv);
    expect(secondRun.status).toBe("COMPLETED");

    const outputBytesSecond = await readFile(outputPath);
    expect(outputBytesSecond).toEqual(outputBytesFirst);
  });

  it("resumes after a simulated restart: a fresh runJob() call does not retranslate completed segments", async () => {
    const inputPath = join(workDir, "book.epub");
    const outputPath = join(workDir, "book-bilingual.epub");
    await writeFile(inputPath, await buildSimpleFixtureEpub());

    const db = openDatabase(":memory:");

    const job = await createJob(db, {
      inputPath,
      outputPath,
      config: {
        sourceLanguage: "fr",
        targetLanguage: "en",
        displayOrder: "ENGLISH_FIRST",
        granularity: "PARAGRAPH",
      },
      provider: "mock",
      model: "mock-1",
    });

    const segmentRepo = new SegmentRepository(db);

    // Translate half the segments "now" (simulating a run that was killed
    // before it finished the whole book) by directly marking them
    // TRANSLATED, bypassing the orchestrator.
    const allSegments = segmentRepo.listByJob(job.id);
    const half = allSegments.slice(0, Math.ceil(allSegments.length / 2));
    for (const segment of half) {
      segmentRepo.markTranslated(job.id, segment.id, {
        translatedText: `[EN] ${segment.sourceText}`,
        translatedHtml: `[EN] ${segment.sourceText}`,
        inputTokens: 1,
        outputTokens: 1,
      });
    }
    // Move the job to TRANSLATING directly (in real usage runJob's own
    // READY -> TRANSLATING transition would have already happened before
    // the process was killed mid-run); emulate that prior state here.
    db.prepare("UPDATE jobs SET status = 'TRANSLATING' WHERE id = ?").run(job.id);

    let translateBatchCallCount = 0;
    const countingStrategy = new MockTranslationStrategy();
    const originalTranslateBatch = countingStrategy.translateBatch.bind(countingStrategy);
    countingStrategy.translateBatch = async (request) => {
      translateBatchCallCount += 1;
      const requestedIds = new Set(request.segments.map((s) => s.id));
      for (const segment of half) {
        expect(requestedIds.has(segment.id)).toBe(false);
      }
      return originalTranslateBatch(request);
    };

    const { job: finished } = await runJob(db, job.id, countingStrategy, testEnv);
    expect(finished.status).toBe("COMPLETED");
    // The fixture spans two chapters, and batches don't cross chapter
    // boundaries, so this may take more than one provider call — the
    // property under test is that none of them ever resend `half`.
    expect(translateBatchCallCount).toBeGreaterThanOrEqual(1);

    const finalSegments = segmentRepo.listByJob(job.id);
    expect(finalSegments.every((s) => s.status === "TRANSLATED")).toBe(true);
    for (const segment of half) {
      const persisted = finalSegments.find((s) => s.id === segment.id)!;
      expect(persisted.translatedText).toBe(`[EN] ${segment.sourceText}`);
    }
  });

  it("pauses as PAUSED_BUDGET when the run request limit is hit, then resumes and completes", async () => {
    const inputPath = join(workDir, "book.epub");
    const outputPath = join(workDir, "book-bilingual.epub");
    await writeFile(inputPath, await buildSimpleFixtureEpub());

    const db = openDatabase(":memory:");
    const strategy = new MockTranslationStrategy();

    const job = await createJob(db, {
      inputPath,
      outputPath,
      config: {
        sourceLanguage: "fr",
        targetLanguage: "en",
        displayOrder: "ENGLISH_FIRST",
        granularity: "PARAGRAPH",
      },
      provider: "mock",
      model: "mock-1",
    });

    // The fixture has two chapters, so batches never cross chapters; one
    // request per run can only ever finish the first chapter.
    const tightEnv = envSchema.parse({ REQUEST_DELAY_MS: "0", MAX_REQUESTS_PER_RUN: "1" });
    const { job: paused } = await runJob(db, job.id, strategy, tightEnv);
    expect(paused.status).toBe("PAUSED_BUDGET");
    expect(paused.errorMessage).toMatch(/RUN/);

    const { job: finished } = await runJob(db, job.id, strategy, testEnv);
    expect(finished.status).toBe("COMPLETED");

    const outputBuffer = await readFile(outputPath);
    const validation = await validateEpub(outputBuffer);
    expect(validation.valid).toBe(true);
  });

  it("only lets one concurrent runJob() call process a given job (locking)", async () => {
    const inputPath = join(workDir, "book.epub");
    const outputPath = join(workDir, "book-bilingual.epub");
    await writeFile(inputPath, await buildSimpleFixtureEpub());

    const db = openDatabase(":memory:");
    const job = await createJob(db, {
      inputPath,
      outputPath,
      config: {
        sourceLanguage: "fr",
        targetLanguage: "en",
        displayOrder: "ENGLISH_FIRST",
        granularity: "PARAGRAPH",
      },
      provider: "mock",
      model: "mock-1",
    });

    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;
    const strategy = new MockTranslationStrategy();
    const originalTranslateBatch = strategy.translateBatch.bind(strategy);
    strategy.translateBatch = async (request) => {
      concurrentCalls += 1;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const result = await originalTranslateBatch(request);
      concurrentCalls -= 1;
      return result;
    };

    const [resultA, resultB] = await Promise.all([
      runJob(db, job.id, strategy, testEnv),
      runJob(db, job.id, strategy, testEnv),
    ]);

    // Exactly one of the two calls should have been turned away by the lock.
    const skipped = [resultA, resultB].filter((r) => r.skippedLocked);
    const completed = [resultA, resultB].filter((r) => r.job.status === "COMPLETED");
    expect(skipped).toHaveLength(1);
    expect(completed).toHaveLength(1);
    expect(maxConcurrentCalls).toBe(1);
  });
});
