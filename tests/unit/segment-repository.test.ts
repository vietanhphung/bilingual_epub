import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../../src/persistence/database.js";
import { JobRepository } from "../../src/persistence/job-repository.js";
import { SegmentRepository } from "../../src/persistence/segment-repository.js";
import type { DraftSegment } from "../../src/epub/paragraph-segmenter.js";

function makeContext() {
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
  return { db, jobRepo, segmentRepo, job };
}

function draftSegments(): DraftSegment[] {
  return [
    {
      id: "ch1-p0001-aaaaaaaaaa",
      chapterPath: "ch1.xhtml",
      elementLocator: "body[0]>p[0]",
      tagName: "p",
      orderIndex: 0,
      sourceText: "Bonjour.",
      sourceHtml: "Bonjour.",
      sourceChecksum: "checksum-1",
      placeholders: [],
    },
    {
      id: "ch1-p0002-bbbbbbbbbb",
      chapterPath: "ch1.xhtml",
      elementLocator: "body[0]>p[1]",
      tagName: "p",
      orderIndex: 1,
      sourceText: "Au revoir.",
      sourceHtml: "Au revoir.",
      sourceChecksum: "checksum-2",
      placeholders: [],
    },
  ];
}

describe("SegmentRepository", () => {
  it("inserts segments as PENDING and lists them in order", () => {
    const { segmentRepo, job } = makeContext();
    segmentRepo.insertMany(job.id, draftSegments());

    const segments = segmentRepo.listByJob(job.id);
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => s.status)).toEqual(["PENDING", "PENDING"]);
    expect(segments.map((s) => s.orderIndex)).toEqual([0, 1]);
  });

  it("marks a segment TRANSLATED and removes it from the PENDING list", () => {
    const { segmentRepo, job } = makeContext();
    const [first, second] = draftSegments();
    segmentRepo.insertMany(job.id, [first!, second!]);

    segmentRepo.markTranslated(job.id, first!.id, {
      translatedText: "[EN] Bonjour.",
      translatedHtml: "[EN] Bonjour.",
      inputTokens: 5,
      outputTokens: 5,
    });

    const pending = segmentRepo.listByJobAndStatus(job.id, "PENDING");
    expect(pending.map((s) => s.id)).toEqual([second!.id]);

    const translated = segmentRepo.listByJobAndStatus(job.id, "TRANSLATED");
    expect(translated).toHaveLength(1);
    expect(translated[0]!.translatedText).toBe("[EN] Bonjour.");
  });

  it("marks a segment FAILED and increments retry count", () => {
    const { segmentRepo, job } = makeContext();
    const [first] = draftSegments();
    segmentRepo.insertMany(job.id, [first!]);

    segmentRepo.markFailed(job.id, first!.id, "provider error");
    const failed = segmentRepo.listByJobAndStatus(job.id, "FAILED");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.errorMessage).toBe("provider error");
    expect(failed[0]!.retryCount).toBe(1);
  });

  it("countByStatus reflects a mix of statuses", () => {
    const { segmentRepo, job } = makeContext();
    const [first, second] = draftSegments();
    segmentRepo.insertMany(job.id, [first!, second!]);
    segmentRepo.markTranslated(job.id, first!.id, {
      translatedText: "x",
      translatedHtml: "x",
      inputTokens: 1,
      outputTokens: 1,
    });

    const counts = segmentRepo.countByStatus(job.id);
    expect(counts).toEqual({ PENDING: 1, TRANSLATED: 1, FAILED: 0 });
  });

  it("resetToPending returns a FAILED segment to the PENDING queue", () => {
    const { segmentRepo, job } = makeContext();
    const [first] = draftSegments();
    segmentRepo.insertMany(job.id, [first!]);
    segmentRepo.markFailed(job.id, first!.id, "oops");

    segmentRepo.resetToPending(job.id, first!.id);
    const pending = segmentRepo.listByJobAndStatus(job.id, "PENDING");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.errorMessage).toBeNull();
  });
});
