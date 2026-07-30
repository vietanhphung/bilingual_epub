import { describe, expect, it } from "vitest";
import { resolvePreset, SCHEDULER_PRESETS } from "../../src/config/presets.js";

describe("scheduler presets", () => {
  it("matches the documented SAFE_DAILY values", () => {
    expect(resolvePreset("SAFE_DAILY")).toEqual({
      maxRequestsPerRun: 5,
      maxSourceTokensPerRequest: 8000,
      maxInputTokensPerRun: 50_000,
      maxOutputTokensPerRun: 70_000,
      tokenSafetyMarginPercent: 20,
      scheduleMode: "DAILY",
    });
  });

  it("matches the documented BALANCED_DAILY values", () => {
    expect(resolvePreset("BALANCED_DAILY")).toEqual({
      maxRequestsPerRun: 10,
      maxSourceTokensPerRequest: 8000,
      maxInputTokensPerRun: 100_000,
      maxOutputTokensPerRun: 140_000,
      tokenSafetyMarginPercent: 20,
      scheduleMode: "DAILY",
    });
  });

  it("matches the documented WEEKLY values", () => {
    expect(resolvePreset("WEEKLY")).toEqual({
      maxRequestsPerRun: 25,
      maxSourceTokensPerRequest: 8000,
      maxInputTokensPerRun: 250_000,
      maxOutputTokensPerRun: 350_000,
      tokenSafetyMarginPercent: 20,
      scheduleMode: "WEEKLY",
    });
  });

  it("exposes exactly the three non-custom presets", () => {
    expect(Object.keys(SCHEDULER_PRESETS).sort()).toEqual([
      "BALANCED_DAILY",
      "SAFE_DAILY",
      "WEEKLY",
    ]);
  });
});
