import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../../src/persistence/database.js";
import { JobRepository } from "../../src/persistence/job-repository.js";
import { AppError } from "../../src/domain/errors.js";

function makeRepo() {
  const db = openDatabase(":memory:");
  return { db, repo: new JobRepository(db) };
}

function baseInput() {
  return {
    id: randomUUID(),
    inputPath: "/tmp/book.epub",
    outputPath: "/tmp/book-bilingual.epub",
    inputChecksum: "abc123",
    sourceLanguage: "fr" as const,
    targetLanguage: "en" as const,
    displayOrder: "ENGLISH_FIRST" as const,
    granularity: "PARAGRAPH" as const,
    provider: "mock",
    model: "mock-1",
    totalSegments: 10,
  };
}

describe("JobRepository", () => {
  it("creates a job in CREATED status with zeroed counters", () => {
    const { repo } = makeRepo();
    const job = repo.create(baseInput());
    expect(job.status).toBe("CREATED");
    expect(job.completedSegments).toBe(0);
    expect(job.failedSegments).toBe(0);
    expect(job.totalSegments).toBe(10);
  });

  it("round-trips through get()", () => {
    const { repo } = makeRepo();
    const created = repo.create(baseInput());
    const fetched = repo.get(created.id);
    expect(fetched).toEqual(created);
  });

  it("throws for an unknown job id", () => {
    const { repo } = makeRepo();
    expect(() => repo.getOrThrow("does-not-exist")).toThrow(AppError);
  });

  it("allows a valid transition and rejects an invalid one", () => {
    const { repo } = makeRepo();
    const job = repo.create(baseInput());
    const next = repo.transition(job.id, "EXTRACTING");
    expect(next.status).toBe("EXTRACTING");

    expect(() => repo.transition(job.id, "COMPLETED")).toThrow(AppError);
  });

  it("records an error message on transition to FAILED", () => {
    const { repo } = makeRepo();
    const job = repo.create(baseInput());
    repo.transition(job.id, "EXTRACTING");
    repo.transition(job.id, "SEGMENTING");
    const failed = repo.transition(job.id, "FAILED", { errorMessage: "boom" });
    expect(failed.status).toBe("FAILED");
    expect(failed.errorMessage).toBe("boom");
  });

  it("lists jobs newest first", () => {
    const { repo } = makeRepo();
    const a = repo.create(baseInput());
    const b = repo.create({ ...baseInput(), id: randomUUID() });
    const jobs = repo.list();
    expect(jobs.map((j) => j.id)).toContain(a.id);
    expect(jobs.map((j) => j.id)).toContain(b.id);
  });

  it("updateProgress persists segment and token counters", () => {
    const { repo } = makeRepo();
    const job = repo.create(baseInput());
    const updated = repo.updateProgress(job.id, {
      completedSegments: 3,
      failedSegments: 1,
      accumulatedInputTokens: 100,
      accumulatedOutputTokens: 150,
    });
    expect(updated.completedSegments).toBe(3);
    expect(updated.failedSegments).toBe(1);
    expect(updated.accumulatedInputTokens).toBe(100);
    expect(updated.accumulatedOutputTokens).toBe(150);
  });
});
