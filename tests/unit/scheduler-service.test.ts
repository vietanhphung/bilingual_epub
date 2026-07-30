import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/persistence/database.js";
import { JobRepository } from "../../src/persistence/job-repository.js";
import { createJob } from "../../src/app/create-job.js";
import { SchedulerService, buildCronExpression } from "../../src/scheduler/scheduler-service.js";
import { MockTranslationStrategy } from "../../src/translation/providers/mock-translation-strategy.js";
import { envSchema } from "../../src/config/schema.js";
import { buildSimpleFixtureEpub } from "../fixtures/build-epub.js";

describe("buildCronExpression", () => {
  it("returns null for MANUAL mode", () => {
    const env = envSchema.parse({ SCHEDULE_MODE: "MANUAL" });
    expect(buildCronExpression(env)).toBeNull();
  });

  it("builds a daily expression from SCHEDULE_TIME", () => {
    const env = envSchema.parse({ SCHEDULE_MODE: "DAILY", SCHEDULE_TIME: "02:30" });
    expect(buildCronExpression(env)).toBe("30 2 * * *");
  });

  it("builds a weekly expression including the configured day", () => {
    const env = envSchema.parse({
      SCHEDULE_MODE: "WEEKLY",
      SCHEDULE_TIME: "14:00",
      SCHEDULE_DAY_OF_WEEK: "WED",
    });
    expect(buildCronExpression(env)).toBe("0 14 * * 3");
  });
});

describe("SchedulerService.runDueJobsOnce", () => {
  it("runs a READY job to COMPLETED and leaves an already-COMPLETED job untouched", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "bilingual-epub-scheduler-test-"));
    const inputPath = join(workDir, "book.epub");
    const outputPath = join(workDir, "book-bilingual.epub");
    await writeFile(inputPath, await buildSimpleFixtureEpub());

    const db = openDatabase(":memory:");
    const jobRepo = new JobRepository(db);
    const env = envSchema.parse({ REQUEST_DELAY_MS: "0" });

    const dueJob = await createJob(db, {
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
    expect(dueJob.status).toBe("READY");

    const completedJob = jobRepo.create({
      id: randomUUID(),
      inputPath: "/tmp/book2.epub",
      outputPath: "/tmp/out2.epub",
      inputChecksum: "def",
      sourceLanguage: "fr",
      targetLanguage: "en",
      displayOrder: "ENGLISH_FIRST",
      granularity: "PARAGRAPH",
      provider: "mock",
      model: "mock-1",
      totalSegments: 0,
    });
    jobRepo.transition(completedJob.id, "EXTRACTING");
    jobRepo.transition(completedJob.id, "SEGMENTING");
    jobRepo.transition(completedJob.id, "READY");
    jobRepo.transition(completedJob.id, "TRANSLATING");
    jobRepo.transition(completedJob.id, "RENDERING");
    jobRepo.transition(completedJob.id, "VALIDATING");
    jobRepo.transition(completedJob.id, "COMPLETED");

    const service = new SchedulerService({
      db,
      env,
      strategyForJob: () => new MockTranslationStrategy(),
    });

    await service.runDueJobsOnce();

    const dueJobAfter = jobRepo.getOrThrow(dueJob.id);
    expect(dueJobAfter.status).toBe("COMPLETED");

    const completedJobAfter = jobRepo.getOrThrow(completedJob.id);
    expect(completedJobAfter.status).toBe("COMPLETED");
  });

  it("resumes a PAUSED_BUDGET job on the next tick", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "bilingual-epub-scheduler-test-"));
    const inputPath = join(workDir, "book.epub");
    const outputPath = join(workDir, "book-bilingual.epub");
    await writeFile(inputPath, await buildSimpleFixtureEpub());

    const db = openDatabase(":memory:");
    const jobRepo = new JobRepository(db);

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

    const tightEnv = envSchema.parse({ REQUEST_DELAY_MS: "0", MAX_REQUESTS_PER_RUN: "1" });
    const tightService = new SchedulerService({
      db,
      env: tightEnv,
      strategyForJob: () => new MockTranslationStrategy(),
    });
    await tightService.runDueJobsOnce();
    expect(jobRepo.getOrThrow(job.id).status).toBe("PAUSED_BUDGET");

    const relaxedEnv = envSchema.parse({ REQUEST_DELAY_MS: "0" });
    const relaxedService = new SchedulerService({
      db,
      env: relaxedEnv,
      strategyForJob: () => new MockTranslationStrategy(),
    });
    await relaxedService.runDueJobsOnce();
    expect(jobRepo.getOrThrow(job.id).status).toBe("COMPLETED");
  });
});
