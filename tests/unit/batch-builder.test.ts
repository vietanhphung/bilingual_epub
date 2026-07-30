import { describe, expect, it } from "vitest";
import { buildBatches, estimateSegmentTokens } from "../../src/translation/batch-builder.js";

describe("estimateSegmentTokens", () => {
  it("estimates roughly 4 characters per token, minimum 1", () => {
    expect(estimateSegmentTokens("")).toBe(1);
    expect(estimateSegmentTokens("abcd")).toBe(1);
    expect(estimateSegmentTokens("a".repeat(400))).toBe(100);
  });
});

describe("buildBatches", () => {
  it("packs segments up to the safety-margined token target", () => {
    const segments = [
      { id: "a", chapterPath: "ch1", estimatedTokens: 40 },
      { id: "b", chapterPath: "ch1", estimatedTokens: 40 },
      { id: "c", chapterPath: "ch1", estimatedTokens: 40 },
    ];
    // limit 100, margin 20% -> target 80: a+b=80 fits, c starts a new batch.
    const batches = buildBatches(segments, 100, 20);
    expect(batches).toEqual([["a", "b"], ["c"]]);
  });

  it("never splits a paragraph even if it alone exceeds the target", () => {
    const segments = [{ id: "huge", chapterPath: "ch1", estimatedTokens: 500 }];
    const batches = buildBatches(segments, 100, 20);
    expect(batches).toEqual([["huge"]]);
  });

  it("starts a new batch on a chapter boundary rather than mixing chapters", () => {
    const segments = [
      { id: "a", chapterPath: "ch1", estimatedTokens: 10 },
      { id: "b", chapterPath: "ch2", estimatedTokens: 10 },
    ];
    const batches = buildBatches(segments, 1000, 0);
    expect(batches).toEqual([["a"], ["b"]]);
  });

  it("preserves segment order within and across batches", () => {
    const segments = [
      { id: "1", chapterPath: "ch1", estimatedTokens: 10 },
      { id: "2", chapterPath: "ch1", estimatedTokens: 10 },
      { id: "3", chapterPath: "ch1", estimatedTokens: 10 },
    ];
    const batches = buildBatches(segments, 15, 0);
    expect(batches.flat()).toEqual(["1", "2", "3"]);
  });

  it("returns no batches for an empty segment list", () => {
    expect(buildBatches([], 1000, 0)).toEqual([]);
  });
});
