import { describe, expect, it } from "vitest";
import { estimateBook } from "../../src/app/estimate-book.js";
import { resolvePreset } from "../../src/config/presets.js";
import { buildSimpleFixtureEpub } from "../fixtures/build-epub.js";

describe("estimateBook", () => {
  it("reports chapters, paragraphs, and token estimates without translating", async () => {
    const buffer = await buildSimpleFixtureEpub();
    const report = await estimateBook(
      buffer,
      resolvePreset("BALANCED_DAILY"),
      { inputPricePerMillionTokensUsd: undefined, outputPricePerMillionTokensUsd: undefined },
    );

    expect(report.chapterCount).toBe(2);
    expect(report.paragraphCount).toBeGreaterThan(0);
    expect(report.sourceTokenEstimate).toBeGreaterThan(0);
    expect(report.estimatedOutputTokens).toBeGreaterThan(0);
    expect(report.estimatedApiCalls).toBeGreaterThan(0);
    expect(report.unsafeParagraphs).toEqual([]);
  });

  it("returns undefined cost when pricing is not configured", async () => {
    const buffer = await buildSimpleFixtureEpub();
    const report = await estimateBook(
      buffer,
      resolvePreset("BALANCED_DAILY"),
      { inputPricePerMillionTokensUsd: undefined, outputPricePerMillionTokensUsd: undefined },
    );
    expect(report.estimatedCostUsd).toBeUndefined();
  });

  it("computes a cost estimate when pricing is configured", async () => {
    const buffer = await buildSimpleFixtureEpub();
    const report = await estimateBook(buffer, resolvePreset("BALANCED_DAILY"), {
      inputPricePerMillionTokensUsd: 3,
      outputPricePerMillionTokensUsd: 15,
    });
    expect(report.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("returns null completion date for MANUAL scheduling and a date for DAILY", async () => {
    const buffer = await buildSimpleFixtureEpub();
    const manualReport = await estimateBook(
      buffer,
      { ...resolvePreset("BALANCED_DAILY"), scheduleMode: "MANUAL" },
      { inputPricePerMillionTokensUsd: undefined, outputPricePerMillionTokensUsd: undefined },
    );
    expect(manualReport.estimatedCompletionDate).toBeNull();

    const dailyReport = await estimateBook(
      buffer,
      resolvePreset("SAFE_DAILY"),
      { inputPricePerMillionTokensUsd: undefined, outputPricePerMillionTokensUsd: undefined },
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(dailyReport.estimatedCompletionDate).toMatch(/^2026-01-\d{2}$/);
  });

  it("flags paragraphs that exceed the per-request token limit as unsafe", async () => {
    const buffer = await buildSimpleFixtureEpub();
    const tinyPreset = { ...resolvePreset("SAFE_DAILY"), maxSourceTokensPerRequest: 1 };
    const report = await estimateBook(buffer, tinyPreset, {
      inputPricePerMillionTokensUsd: undefined,
      outputPricePerMillionTokensUsd: undefined,
    });
    expect(report.unsafeParagraphs.length).toBeGreaterThan(0);
  });
});
