import { describe, expect, it } from "vitest";
import { resolveBookConfig } from "../../src/config/resolve-book-config.js";
import {
  UnsupportedGranularityError,
  UnsupportedLanguageError,
} from "../../src/domain/errors.js";

describe("resolveBookConfig", () => {
  it("accepts a valid direction", () => {
    const config = resolveBookConfig({ sourceLanguage: "fr", targetLanguage: "en" });
    expect(config.sourceLanguage).toBe("fr");
    expect(config.targetLanguage).toBe("en");
  });

  it("throws UnsupportedLanguageError for an unsupported source language", () => {
    expect(() =>
      resolveBookConfig({ sourceLanguage: "de", targetLanguage: "en" }),
    ).toThrow(UnsupportedLanguageError);
  });

  it("throws UnsupportedLanguageError when source and target match", () => {
    expect(() =>
      resolveBookConfig({ sourceLanguage: "en", targetLanguage: "en" }),
    ).toThrow(UnsupportedLanguageError);
  });

  it("throws UnsupportedGranularityError for a non-PARAGRAPH granularity", () => {
    expect(() =>
      resolveBookConfig({
        sourceLanguage: "fr",
        targetLanguage: "en",
        granularity: "SENTENCE",
      }),
    ).toThrow(UnsupportedGranularityError);
  });
});
