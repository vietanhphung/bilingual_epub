import { describe, expect, it } from "vitest";
import { inspectBook } from "../../src/app/inspect-book.js";
import { buildSimpleFixtureEpub } from "../fixtures/build-epub.js";

describe("inspectBook", () => {
  it("lists every supported paragraph in stable reading order without translating", async () => {
    const buffer = await buildSimpleFixtureEpub();
    const report = await inspectBook(buffer);

    expect(report.chapterCount).toBe(2);
    expect(report.paragraphCount).toBeGreaterThan(0);

    const orderIndexes = report.segments.map((s) => s.orderIndex);
    expect(orderIndexes).toEqual([...orderIndexes].sort((a, b) => a - b));

    // Chapter 1 content should precede chapter 2 content in reading order.
    const chapter1Segments = report.segments.filter(
      (s) => s.chapterPath === "OEBPS/text/chapter1.xhtml",
    );
    const chapter2Segments = report.segments.filter(
      (s) => s.chapterPath === "OEBPS/text/chapter2.xhtml",
    );
    expect(Math.max(...chapter1Segments.map((s) => s.orderIndex))).toBeLessThan(
      Math.min(...chapter2Segments.map((s) => s.orderIndex)),
    );
  });

  it("is deterministic across repeated calls on the same input", async () => {
    const buffer = await buildSimpleFixtureEpub();
    const first = await inspectBook(buffer);
    const second = await inspectBook(buffer);
    expect(first.segments.map((s) => s.id)).toEqual(second.segments.map((s) => s.id));
  });
});
